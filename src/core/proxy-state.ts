/**
 * Proxy state persistence and routing config helpers for the Devflow external
 * model routing feature.
 *
 * applies ADR-013: pure core-layer module — no Claude Code adapter concerns.
 * avoids PF-014: never call process.exit() inside finally-guarded scopes; all
 *   fallible operations return Result instead of throwing.
 *
 * State file: ~/.devflow/proxy.json
 * Routing config: ~/.devflow/proxy-routing.json (written by proxy CLI command)
 *
 * NOTE: the internal routing runtime package name ("subswitch") must NEVER appear
 * in user-visible strings or error messages. User-facing vocabulary:
 * "external model routing" / "Devflow proxy".
 */

import { createRequire } from 'module';
import { join } from 'path';
import { promises as fs } from 'fs';
import { writeFileAtomicExclusive } from './fs-atomic.js';

// ---------------------------------------------------------------------------
// Result type (local; matches codebase pattern of per-module definitions)
// ---------------------------------------------------------------------------

export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Proxy state schema
// ---------------------------------------------------------------------------

/** Default port for the Devflow proxy. */
export const DEFAULT_PROXY_PORT = 4141;

/**
 * State persisted to ~/.devflow/proxy.json.
 * Tolerant-parsed: missing or invalid fields receive safe defaults on read.
 */
export interface ProxyState {
  readonly version: 1;
  readonly enabled: boolean;
  readonly port: number;
  /** Absolute path to the routing runtime bin JS file, or null if not resolved. */
  readonly binPath: string | null;
  /** Absolute path to the routing config file, or null if not written yet. */
  readonly configPath: string | null;
  /** GPT model IDs currently included in the routing config. */
  readonly models: string[];
  /** ISO timestamp of last state resolution, or null. */
  readonly resolvedAt: string | null;
  /** Devflow version at time of last state write, or null. */
  readonly devflowVersion: string | null;
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

/**
 * Read proxy state from ~/.devflow/proxy.json with tolerant parsing.
 * Returns a default disabled state when the file is missing.
 */
export async function readProxyState(devflowDir: string): Promise<Result<ProxyState, string>> {
  const statePath = join(devflowDir, 'proxy.json');
  try {
    const content = await fs.readFile(statePath, 'utf-8');
    const data = JSON.parse(content) as Record<string, unknown>;

    // Tolerant parse: provide safe defaults for missing/invalid fields.
    const state: ProxyState = {
      version: 1,
      enabled: typeof data.enabled === 'boolean' ? data.enabled : false,
      port: typeof data.port === 'number' && data.port > 0 ? data.port : DEFAULT_PROXY_PORT,
      binPath: typeof data.binPath === 'string' ? data.binPath : null,
      configPath: typeof data.configPath === 'string' ? data.configPath : null,
      models: Array.isArray(data.models) &&
        (data.models as unknown[]).every(m => typeof m === 'string')
        ? (data.models as string[])
        : [],
      resolvedAt: typeof data.resolvedAt === 'string' ? data.resolvedAt : null,
      devflowVersion: typeof data.devflowVersion === 'string' ? data.devflowVersion : null,
    };
    return Ok(state);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // File missing → return a default disabled state (not an error).
      return Ok({
        version: 1,
        enabled: false,
        port: DEFAULT_PROXY_PORT,
        binPath: null,
        configPath: null,
        models: [],
        resolvedAt: null,
        devflowVersion: null,
      });
    }
    return Err(`Failed to read proxy state: ${(err as Error).message}`);
  }
}

/**
 * Atomically write proxy state to ~/.devflow/proxy.json.
 * Creates the parent directory if needed.
 */
export async function writeProxyState(
  devflowDir: string,
  state: ProxyState,
): Promise<Result<void, string>> {
  const statePath = join(devflowDir, 'proxy.json');
  try {
    await fs.mkdir(devflowDir, { recursive: true });
    await writeFileAtomicExclusive(statePath, JSON.stringify(state, null, 2) + '\n');
    return Ok(undefined);
  } catch (err: unknown) {
    return Err(`Failed to write proxy state: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Build the routing config JSON for ~/.devflow/proxy-routing.json.
 * Produces `{port, codex:{models:[...]}}` for the routing runtime config.
 * Pure function — no I/O.
 */
export function buildRoutingConfigJson(port: number, models: string[]): string {
  const config = {
    port,
    codex: {
      models: [...models],
    },
  };
  return JSON.stringify(config, null, 2) + '\n';
}

/**
 * Build a complete ProxyState object with the current timestamp.
 * Pure constructor helper — no I/O.
 */
export function buildProxyState(opts: {
  enabled: boolean;
  port: number;
  binPath: string | null;
  configPath: string | null;
  models: string[];
  devflowVersion: string | null;
}): ProxyState {
  return {
    version: 1,
    enabled: opts.enabled,
    port: opts.port,
    binPath: opts.binPath,
    configPath: opts.configPath,
    models: [...opts.models],
    resolvedAt: new Date().toISOString(),
    devflowVersion: opts.devflowVersion,
  };
}

/**
 * Returns the proxy base URL for the given port.
 * Pure function.
 */
export function proxyBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

// ---------------------------------------------------------------------------
// isProxyEnabled — the primary contract other modules consume
// ---------------------------------------------------------------------------

/**
 * Check whether the Devflow proxy is currently enabled.
 * Returns false when the proxy state file is missing, unreadable, or malformed.
 * This is the SOLE export that agent-models and cli commands use to check proxy state.
 *
 * @param devflowDir - Path to the ~/.devflow directory (injected for testability).
 */
export async function isProxyEnabled(devflowDir: string): Promise<boolean> {
  const result = await readProxyState(devflowDir);
  if (!result.ok) return false;
  return result.value.enabled;
}

// ---------------------------------------------------------------------------
// resolveProxyBin — locate the routing runtime entry point
// ---------------------------------------------------------------------------

/**
 * Resolve the routing runtime binary from devflow's own node_modules.
 *
 * Uses createRequire(import.meta.url).resolve('subswitch/package.json') to find
 * the package, then reads its `bin` field to locate the JS entry point.
 *
 * Returns the absolute path so callers can spawn as `node <path>`.
 * (npm does not guarantee exec bits on installed package binaries.)
 *
 * Returns a Result error whose user-facing message is:
 *   "routing runtime missing — reinstall devflow-kit"
 * when the routing runtime is not found (MODULE_NOT_FOUND). The internal package
 * name MUST NOT appear in user-visible strings per the branding constraint.
 *
 * Includes `npxWarning: true` when the resolved path contains `/_npx/` —
 * npx-cached installs are not guaranteed to persist across machine restarts.
 */
export async function resolveProxyBin(): Promise<Result<{ binPath: string; npxWarning: boolean }, string>> {
  // createRequire is the ESM-safe way to resolve CommonJS/package paths.
  const require = createRequire(import.meta.url);
  let pkgJsonPath: string;
  try {
    pkgJsonPath = require.resolve('subswitch/package.json');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'MODULE_NOT_FOUND') {
      return Err('routing runtime missing — reinstall devflow-kit');
    }
    return Err(`Failed to resolve routing runtime: ${(err as Error).message}`);
  }

  try {
    const pkgJson = JSON.parse(
      await fs.readFile(pkgJsonPath, 'utf-8'),
    ) as Record<string, unknown>;

    const bin = pkgJson.bin;
    let binRelPath: string | undefined;

    if (typeof bin === 'string') {
      binRelPath = bin;
    } else if (typeof bin === 'object' && bin !== null) {
      // bin is a { name: relPath } map — prefer the 'subswitch' key, fall back to first entry.
      const binObj = bin as Record<string, string>;
      binRelPath = binObj['subswitch'] ?? Object.values(binObj)[0];
    }

    if (!binRelPath) {
      return Err('routing runtime missing — reinstall devflow-kit');
    }

    const pkgDir = join(pkgJsonPath, '..');
    const binPath = join(pkgDir, binRelPath);
    const npxWarning = binPath.includes('/_npx/');

    return Ok({ binPath, npxWarning });
  } catch (err: unknown) {
    return Err(`Failed to read routing runtime package info: ${(err as Error).message}`);
  }
}
