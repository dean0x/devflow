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
 * Accepted top-level keys for the subswitch 0.4.0 FileConfigSchema (z.strictObject).
 * Unknown top-level keys cause a hard relay startup error — never emit them.
 *
 * @D-EFR-4 Subswitch 0.4.0 routing config contract:
 *   FileConfigSchema is a z.strictObject with exactly 5 accepted top-level keys:
 *   port, logLevel, anthropic, providers, limits. Unknown keys cause a hard startup
 *   error — the relay refuses to start. anthropic and limits are themselves
 *   strictObject + prefault({}), so they may be partially specified.
 *
 */
const ROUTING_CONFIG_ALLOWED_TOP_KEYS = new Set<string>([
  'port', 'logLevel', 'anthropic', 'providers', 'limits',
]);

/**
 * Sub-keys of a preserved `anthropic` / `limits` block that the pinned relay rejects
 * outright — each is a registered LEGACY KEY, and a legacy key is a hard startup
 * error naming its replacement, not a warning. They are stripped when carrying a
 * user's existing config forward so an upgrade cannot leave the relay unable to boot.
 *
 * Every entry was valid under a version devflow previously pinned, which is what makes
 * it reachable in a real user's file:
 *   anthropic.streamIdleTimeoutMs — valid in 0.2.0, removed in 0.3.0 (relay no longer
 *     bounds the stream-idle phase on a connected client).
 *   limits.connectTimeoutMs       — moved to anthropic.connectTimeoutMs in 0.3.0;
 *     stripping it loses nothing (relay default governs).
 *   limits.maxConcurrentRequests  — valid in 0.2.0, removed in 0.3.0 (admission gate
 *     removed).
 *   limits.maxBodyBytes           — valid through 0.3.0, renamed to
 *     limits.maxBufferedBodyBytes in 0.4.0. The old spelling is a registered legacy
 *     key, so leaving it in place would stop the relay from booting.
 *
 * Keys retired before 0.2.0 are deliberately absent: a config that worked against the
 * version devflow shipped cannot contain them.
 */
const ROUTING_CONFIG_REJECTED_SUBKEYS: Readonly<Record<'anthropic' | 'limits', readonly string[]>> = {
  anthropic: ['streamIdleTimeoutMs'],
  limits: ['connectTimeoutMs', 'maxConcurrentRequests', 'maxBodyBytes'],
};

/**
 * Build the routing config JSON for ~/.devflow/proxy-routing.json.
 *
 * Authoritatively sets `port`. Preserves any existing valid `anthropic`,
 * `limits`, `logLevel`, and `providers` blocks from `existingContent`, filtering
 * out unknown top-level keys and every sub-key in ROUTING_CONFIG_REJECTED_SUBKEYS
 * (each one a hard relay startup error). No `anthropic` block is injected when
 * the user has not set one — the relay's own default governs (D-EFR-4).
 *
 * If `existingContent` is missing or malformed, falls back to a port-only config.
 *
 * applies ADR-013: pure core-layer function — no I/O.
 * @D-EFR-4: see note above for the strict top-key constraint.
 */
export function buildRoutingConfigJson(port: number, existingContent?: string): string {
  // Parse existing config tolerantly; a malformed file falls back to clean defaults.
  const preserved: Record<string, unknown> = {};
  if (existingContent !== undefined) {
    try {
      const parsed = JSON.parse(existingContent) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          // Only preserve the 5 accepted top-level keys; port is always ours.
          if (ROUTING_CONFIG_ALLOWED_TOP_KEYS.has(k) && k !== 'port') {
            preserved[k] = v;
          }
        }
      }
    } catch {
      // Malformed existing config — fall through to clean defaults.
    }
  }

  const config: Record<string, unknown> = { port };

  // Preserve logLevel if present in existing config.
  if (preserved.logLevel !== undefined) {
    config.logLevel = preserved.logLevel;
  }

  // Anthropic block: preserve user settings; strip legacy rejected sub-keys.
  // No default is injected — the relay's own default governs (D-EFR-4).
  if (
    typeof preserved.anthropic === 'object' &&
    preserved.anthropic !== null &&
    !Array.isArray(preserved.anthropic)
  ) {
    const existingAnthropic = { ...(preserved.anthropic as Record<string, unknown>) };
    for (const key of ROUTING_CONFIG_REJECTED_SUBKEYS.anthropic) {
      delete existingAnthropic[key];
    }
    if (Object.keys(existingAnthropic).length > 0) {
      config.anthropic = existingAnthropic;
    }
  }

  // Preserve providers block if present.
  if (preserved.providers !== undefined) {
    config.providers = preserved.providers;
  }

  // Preserve limits block if present, minus the sub-keys the relay hard-errors on
  // (see ROUTING_CONFIG_REJECTED_SUBKEYS).
  if (preserved.limits !== undefined) {
    if (
      typeof preserved.limits === 'object' &&
      preserved.limits !== null &&
      !Array.isArray(preserved.limits)
    ) {
      const limitsObj = { ...(preserved.limits as Record<string, unknown>) };
      for (const key of ROUTING_CONFIG_REJECTED_SUBKEYS.limits) {
        delete limitsObj[key];
      }
      config.limits = limitsObj;
    } else {
      config.limits = preserved.limits;
    }
  }

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
  devflowVersion: string | null;
}): ProxyState {
  return {
    version: 1,
    enabled: opts.enabled,
    port: opts.port,
    binPath: opts.binPath,
    configPath: opts.configPath,
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
 * Returns true when ~/.devflow/proxy.json exists on disk — i.e. Devflow has
 * previously managed the proxy on this machine.
 *
 * This is the evidence gate used by init and uninstall before stripping
 * ANTHROPIC_BASE_URL / CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT:
 * we only strip those vars when we can prove Devflow wrote them.
 *
 * D-STRIP-1: gate proxy env stripping on devflow-managed evidence.
 *   readProxyState() returns Ok(defaultState) on ENOENT — it cannot distinguish
 *   "file absent" from "file present with DEFAULT_PROXY_PORT". Callers that need
 *   to differentiate must use proxyJsonExists() rather than checking the result
 *   of readProxyState().
 */
export async function proxyJsonExists(devflowDir: string): Promise<boolean> {
  try {
    await fs.access(join(devflowDir, 'proxy.json'));
    return true;
  } catch {
    return false;
  }
}

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
 * Regex for acceptable routing runtime version strings used as cache-key
 * path components. Rejects path-traversal attempts (e.g. '../../etc/x'),
 * excessively long strings, and empty strings.
 *
 * SECURITY: version is used as a path component in cache keys.
 * path.join normalises '..', so an unvalidated version string is an
 * arbitrary-file-overwrite primitive through writeFileAtomicExclusive.
 * This is the second, independent layer; Phase A's path-containment
 * assertion in cache.ts is the first.
 */
export const RUNTIME_VERSION_RE = /^[A-Za-z0-9.+-]{1,32}$/;

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
 *
 * Includes `version` when the package.json version passes RUNTIME_VERSION_RE.
 * When validation fails the field is absent — the bin is still usable but
 * callers that need the version for cache keys must treat it as unavailable.
 */
export async function resolveProxyBin(): Promise<Result<{ binPath: string; npxWarning: boolean; version?: string }, string>> {
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

    // Validate version for safe use as a cache-key path component (AC-S4).
    const rawVersion = pkgJson.version;
    const version =
      typeof rawVersion === 'string' && RUNTIME_VERSION_RE.test(rawVersion)
        ? rawVersion
        : undefined;

    return Ok({ binPath, npxWarning, version });
  } catch (err: unknown) {
    return Err(`Failed to read routing runtime package info: ${(err as Error).message}`);
  }
}
