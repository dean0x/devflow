/**
 * devflow proxy — Enable, disable, and check status of external model routing
 * (GPT models via your OpenAI/Codex subscription).
 *
 * applies ADR-013: CLI-layer module; all core logic lives in src/core/proxy-state.ts
 *   and src/core/agent-models.ts.
 * avoids PF-014: never process.exit() inside a finally-guarded scope; use return
 *   from the async action handler for all early-exit paths.
 * avoids PF-001: hook output strings use fixed templates; port number interpolation
 *   is acceptable (digit-validated integer, not user-controlled content).
 *
 * Branding note: "subswitch" must NEVER appear in user-visible strings. Internal
 * identifiers (SUBSWITCH_CONFIG env var, health body checks) are fine.
 */

import { Command } from 'commander';
import { promises as fs, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import * as path from 'path';
import * as net from 'net';
import * as http from 'http';
import * as https from 'https';
import { spawn as cpSpawn } from 'child_process';
import * as p from '@clack/prompts';
import color from 'picocolors';
import {
  readProxyState,
  writeProxyState,
  buildProxyState,
  buildRoutingConfigJson,
  proxyBaseUrl,
  resolveProxyBin,
  DEFAULT_PROXY_PORT,
} from '../../core/proxy-state.js';
import { externalModelIds } from '../../core/external-models.js';
import { syncManifestFeature, readManifest } from '../../core/manifest.js';
import { writeFileAtomicExclusive } from '../../core/fs-atomic.js';
import { scrubChildEnv, openProxyLog, rotateProxyLogIfLarge } from '../../core/proxy-log.js';
import {
  reapplyAgentMapping,
  revertExternalAgents,
  countExternalMappedAgents,
  readAgentMapping,
} from '../../core/agent-models.js';
import {
  getClaudeDirectory,
  getDevFlowDirectory,
  getHomeDirectory,
} from '../../targets/claude-code/claude-paths.js';
import type { Settings, HookMatcher } from '../../targets/claude-code/hooks.js';

// ─── Result type (local pattern) ──────────────────────────────────────────────

type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Marker used to identify ensure-proxy hook entries. */
const PROXY_HOOK_MARKER = 'ensure-proxy';

/** Pattern matching our relay's ANTHROPIC_BASE_URL value. */
const OUR_BASE_URL_PATTERN = /^http:\/\/127\.0\.0\.1:\d+$/;

/** Timeout for individual TCP connect probes and HTTP health checks (ms). */
const PROBE_TIMEOUT_MS = 2000;
/** Timeout for the relay doctor subprocess (ms). */
const DOCTOR_TIMEOUT_MS = 10_000;
/**
 * Maximum number of relay port probes during the CLI spawn wait (5s at 100ms each).
 *
 * The ensure-proxy hook uses a larger budget (80×0.1s = 8s) — this difference is
 * intentional:
 *   - CLI (--enable): the user is waiting at an interactive terminal. 5s is the
 *     maximum comfortable wait; a cold relay start typically completes in <2s.
 *   - Hook (ensure-proxy): the hook fires inside a 15-second platform timeout. The
 *     relay may be starting from a cold OS state (first session after reboot) where
 *     5s is too short. 8s gives a wider revival window while leaving 7s of headroom
 *     before the platform kills the hook.
 */
const RELAY_SPAWN_MAX_PROBES = 50;
/** Interval between relay port probes during the CLI spawn wait (ms). */
const RELAY_SPAWN_PROBE_INTERVAL_MS = 100;
/** TCP connect timeout for each relay port probe during the CLI spawn wait (ms). */
const RELAY_SPAWN_PER_PROBE_TIMEOUT_MS = 500;

// ─── Version helper ───────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let _cachedVersion: string | null | undefined;
function getDevflowVersion(): string | null {
  if (_cachedVersion !== undefined) return _cachedVersion;
  try {
    // dist/cli/commands/ → ../../.. → repo root
    const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf-8')) as Record<string, unknown>;
    _cachedVersion = typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    _cachedVersion = null;
  }
  return _cachedVersion;
}

// ─── Internal object helpers (used for single-pass atomic settings write) ────

/**
 * Mutate a parsed Settings object in place: set ANTHROPIC_BASE_URL to our relay.
 * Returns true when the object was changed (used to detect if a write is needed).
 */
function _applyProxyEnvToObject(settings: Settings, port: number): boolean {
  const s = settings as Record<string, unknown>;
  s.env = (s.env as Record<string, unknown> | undefined) ?? {};
  const env = s.env as Record<string, unknown>;
  const newUrl = proxyBaseUrl(port);
  if (env.ANTHROPIC_BASE_URL === newUrl) return false;
  env.ANTHROPIC_BASE_URL = newUrl;
  return true;
}

/**
 * Mutate a parsed Settings object in place: remove ANTHROPIC_BASE_URL only when
 * its value exactly matches our relay on the given managed port.
 *
 * REG-1: scoped to `managedPort` so a user's own localhost gateway (LiteLLM,
 * local Ollama proxy, etc.) on ANY other port is never clobbered.
 * The caller is responsible for passing the port Devflow currently owns:
 *   - disable path  → proxy.json.port (or DEFAULT_PROXY_PORT)
 *   - init path     → proxy.json.port after the preflight block
 *   - enable path   → the new port being applied (followed immediately by _applyProxyEnvToObject)
 *   - uninstall     → proxy.json.port (or DEFAULT_PROXY_PORT)
 *
 * Returns true when the object was changed.
 */
function _stripProxyEnvFromObject(settings: Settings, managedPort: number): boolean {
  const s = settings as Record<string, unknown>;
  const env = s.env as Record<string, unknown> | undefined;
  if (typeof env?.ANTHROPIC_BASE_URL !== 'string') return false;
  if (env.ANTHROPIC_BASE_URL !== proxyBaseUrl(managedPort)) return false;
  delete env.ANTHROPIC_BASE_URL;
  if (Object.keys(env).length === 0) delete s.env;
  return true;
}

/** Internal: add ensure-proxy hook to one event. Returns true when added. */
function _ensureProxyHook(settings: Settings, eventName: string, hookCmd: string): boolean {
  const existing = settings.hooks?.[eventName];
  if (existing?.some((m) => m.hooks.some((h) => h.command.includes(PROXY_HOOK_MARKER)))) {
    return false;
  }
  settings.hooks ??= {};
  settings.hooks[eventName] ??= [];
  const entry: HookMatcher = {
    hooks: [{ type: 'command', command: hookCmd, timeout: 15 }],
  };
  settings.hooks[eventName].push(entry);
  return true;
}

/** Internal: remove ensure-proxy hooks from one event. Returns true when removed. */
function _filterProxyHooks(settings: Settings, eventName: string): boolean {
  if (!settings.hooks?.[eventName]) return false;
  const before = settings.hooks[eventName].length;
  settings.hooks[eventName] = settings.hooks[eventName].filter(
    (m) => !m.hooks.some((h) => h.command.includes(PROXY_HOOK_MARKER)),
  );
  if (settings.hooks[eventName].length === before) return false;
  if (settings.hooks[eventName].length === 0) delete settings.hooks[eventName];
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  return true;
}

// ─── Pure env functions (exported for testing and cross-module reuse) ─────────

/**
 * Apply ANTHROPIC_BASE_URL=http://127.0.0.1:<port> to settings JSON.
 * Returns new serialized settings string. Does not mutate input.
 * Idempotent — calling twice with the same port produces the same result.
 */
export function applyProxyEnv(settingsJson: string, port: number): string {
  const settings = JSON.parse(settingsJson) as Settings;
  _applyProxyEnvToObject(settings, port);
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Remove ANTHROPIC_BASE_URL from settings JSON, but ONLY when its value exactly
 * matches our relay on `managedPort`.
 *
 * REG-1: `managedPort` scopes the strip to the port Devflow owns — a user's own
 * localhost gateway on any other port is never touched.  Pass `proxy.json.port`
 * (or `DEFAULT_PROXY_PORT` when the file is absent) at every call site.
 *
 * Returns new serialized settings string. Does not mutate input.
 * Cleans up an emptied env object.
 */
export function stripProxyEnv(settingsJson: string, managedPort: number): string {
  const settings = JSON.parse(settingsJson) as Settings;
  _stripProxyEnvFromObject(settings, managedPort);
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Read the proxy env state from a settings JSON string.
 *
 * Returns:
 *   'ours'           — ANTHROPIC_BASE_URL = our relay on the given port
 *   'ours-other-port'— ANTHROPIC_BASE_URL = our relay on a different port
 *   'foreign'        — ANTHROPIC_BASE_URL set but not our relay
 *   'absent'         — ANTHROPIC_BASE_URL not set
 */
export function readProxyEnvState(
  settingsJson: string,
  port: number,
): 'ours' | 'ours-other-port' | 'foreign' | 'absent' {
  const settings = JSON.parse(settingsJson) as Settings;
  const s = settings as Record<string, unknown>;
  const env = s.env as Record<string, unknown> | undefined;
  const url = env?.ANTHROPIC_BASE_URL;
  if (typeof url !== 'string') return 'absent';
  if (url === proxyBaseUrl(port)) return 'ours';
  if (OUR_BASE_URL_PATTERN.test(url)) return 'ours-other-port';
  return 'foreign';
}

// ─── Pure hook helpers ──────────────────────────────────────────────────────────

/**
 * Add ensure-proxy hooks to BOTH SessionStart and UserPromptSubmit events.
 * Idempotent — skips events that already have the hook.
 * Repairs partial state (one event present, other missing) by adding the missing one.
 * Mutates settings in place. Returns true when any hook was added.
 */
export function addProxyHooks(settings: Settings, devflowDir: string): boolean {
  const hookCmd =
    path.join(devflowDir, 'scripts', 'hooks', 'run-hook') + ' ' + PROXY_HOOK_MARKER;
  const addedSession = _ensureProxyHook(settings, 'SessionStart', hookCmd);
  const addedPrompt = _ensureProxyHook(settings, 'UserPromptSubmit', hookCmd);
  return addedSession || addedPrompt;
}

/**
 * Remove ensure-proxy hooks from all events.
 * Idempotent — no-op when hooks are not present.
 * Preserves other hooks. Cleans empty arrays/objects.
 * Mutates settings in place. Returns true when any hook was removed.
 */
export function removeProxyHooks(settings: Settings): boolean {
  const removedSession = _filterProxyHooks(settings, 'SessionStart');
  const removedPrompt = _filterProxyHooks(settings, 'UserPromptSubmit');
  return removedSession || removedPrompt;
}

/**
 * Apply the disable settings-pass: remove proxy hooks AND strip ANTHROPIC_BASE_URL.
 *
 * Both operations always run unconditionally — never short-circuited with ||.
 * A full enabled state (hooks present AND ANTHROPIC_BASE_URL set) requires
 * both calls to be evaluated; short-circuiting left ANTHROPIC_BASE_URL in
 * settings when hooks were present, keeping new sessions pointed at a disabled
 * relay.
 *
 * REG-1: `managedPort` scopes the URL strip to the port Devflow owns — pass
 * `proxy.json.port` (or `DEFAULT_PROXY_PORT`) at the call site.
 *
 * Mutates settings in place. Returns true when any change was made.
 */
export function applyDisableToSettings(settings: Settings, managedPort: number): boolean {
  const removedHooks = removeProxyHooks(settings);
  const strippedEnv = _stripProxyEnvFromObject(settings, managedPort);
  return removedHooks || strippedEnv;
}

/**
 * Check whether the ensure-proxy hook is registered on at least one event.
 * Returns true if present on either SessionStart or UserPromptSubmit.
 * Partial state (one event present, other missing) returns true —
 * addProxyHooks will repair it on next enable.
 */
export function hasProxyHooks(input: string | Settings): boolean {
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) as Settings : input;
  const check = (eventName: string) =>
    settings.hooks?.[eventName]?.some((m) =>
      m.hooks.some((h) => h.command.includes(PROXY_HOOK_MARKER)),
    ) === true;
  return check('SessionStart') || check('UserPromptSubmit');
}

// ─── Health-check identity helper ────────────────────────────────────────────

/**
 * Return true when the raw health-check response body identifies our relay.
 *
 * The internal check `parsed['name'] === 'subswitch'` is correct here — 'subswitch'
 * is the internal package name (fine in code, not in user-facing output — see branding
 * note at the top of this file). Returns false on JSON parse failure, empty body, or a
 * mismatched name field.
 *
 * Note: the ensure-proxy shell hook has its own inline copy of this check — it is a
 * different language and cannot share the TypeScript module.
 */
export function isOurRelayBody(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    return parsed['name'] === 'subswitch';
  } catch {
    return false;
  }
}

// ─── Dependency injection interface for runProxyPreflight ─────────────────────

/**
 * Injectable dependencies for runProxyPreflight.
 * All I/O is behind this interface so every preflight branch is unit-testable.
 */
export interface ProxyPreflightDeps {
  /** Resolve the routing runtime bin path. */
  resolveProxyBin: () => Promise<Result<{ binPath: string; npxWarning: boolean }, string>>;
  /** Check if a file exists at the given path. */
  fileExists: (p: string) => Promise<boolean>;
  /** Attempt a TCP connect to 127.0.0.1:port; true = accepted, false = refused/timeout. */
  tcpConnectable: (port: number, timeoutMs: number) => Promise<boolean>;
  /** HTTP GET with timeout. Ok(body) = success; Err(reason) = failure or timeout. */
  httpGet: (url: string, timeoutMs: number) => Promise<Result<string, string>>;
  /** Read settings.json content; throws on I/O error. */
  readSettingsJson: () => Promise<string>;
  /**
   * Spawn `node <binPath> doctor` with the given env; append stdout+stderr to logFile.
   * Resolves with the exit code (1 on timeout).
   */
  spawnDoctor: (
    binPath: string,
    env: Record<string, string>,
    timeoutMs: number,
    logFile: string,
  ) => Promise<number>;
  /** Called when a non-fatal warning is detected (e.g. ANTHROPIC_API_KEY present). */
  onWarn?: (msg: string) => void;
}

export interface PreflightResult {
  binPath: string;
  npxWarning: boolean;
  /** True when the port is already hosting our relay — skip spawn, adopt. */
  adopted: boolean;
}

/**
 * Run preflight checks before enabling the Devflow proxy.
 *
 * Checks (in order):
 * ① Routing runtime bin resolvable.
 * ② ~/.codex/auth.json exists.
 * ③ Port probe: free → OK; accepting → health check → adopt or fail.
 * ④ settings.json parseable; ANTHROPIC_BASE_URL not pointing elsewhere; API key warn.
 *
 * Doctor (previously check ⑤) is deliberately excluded: the relay's doctor subcommand
 * probes the relay port — a not-yet-started relay makes that probe fail (exit 1). A
 * pre-spawn gate is therefore always unsatisfiable on a cold path. Doctor now runs in
 * runPostSpawnVerification, after the relay is confirmed up. See D-EFR-2.
 *
 * Returns Ok(PreflightResult) on success, Err(message) on any check failure.
 */
export async function runProxyPreflight(
  port: number,
  codexAuthPath: string,
  configPath: string,
  logPath: string,
  deps: ProxyPreflightDeps,
): Promise<Result<PreflightResult, string>> {
  // ① Routing runtime bin
  const binResult = await deps.resolveProxyBin();
  if (!binResult.ok) return Err(binResult.error);
  const { binPath, npxWarning } = binResult.value;

  // ② Codex auth
  const codexAuthExists = await deps.fileExists(codexAuthPath);
  if (!codexAuthExists) {
    return Err('Sign in to the Codex CLI first (codex login)');
  }

  // ③ Port probe
  const portAccepting = await deps.tcpConnectable(port, PROBE_TIMEOUT_MS);
  if (portAccepting) {
    // Port is up — check health identity
    const healthResult = await deps.httpGet(
      `${proxyBaseUrl(port)}/__subswitch/health`,
      PROBE_TIMEOUT_MS,
    );
    if (healthResult.ok && isOurRelayBody(healthResult.value)) {
      return Ok({ binPath, npxWarning, adopted: true });
    }
    // Port accepting but health timed out, failed, or not our relay
    return Err(
      `port ${port} is in use by another application — pick a different port with \`devflow proxy --enable --port <n>\``,
    );
  }
  // Port refused — free to proceed

  // ④ Settings.json check
  let settingsJson: string;
  try {
    settingsJson = await deps.readSettingsJson();
  } catch {
    return Err('Could not read settings.json — check file permissions');
  }

  let parsedSettings: Record<string, unknown>;
  try {
    parsedSettings = JSON.parse(settingsJson) as Record<string, unknown>;
  } catch {
    return Err('settings.json is malformed — fix it before enabling the proxy');
  }

  const envState = readProxyEnvState(settingsJson, port);
  if (envState === 'foreign') {
    return Err(
      'An existing ANTHROPIC_BASE_URL in settings.json points to a different gateway — Devflow will not overwrite it',
    );
  }

  // API key warning (non-fatal)
  const envBlock = parsedSettings.env;
  if (
    typeof envBlock === 'object' &&
    envBlock !== null &&
    !Array.isArray(envBlock) &&
    typeof (envBlock as Record<string, unknown>).ANTHROPIC_API_KEY === 'string'
  ) {
    deps.onWarn?.(
      'ANTHROPIC_API_KEY is set in settings.json — requests will use that key through the local relay',
    );
  }

  return Ok({ binPath, npxWarning, adopted: false });
}

// ─── Production dependency implementations ────────────────────────────────────

/** Production TCP connect implementation. */
async function realTcpConnectable(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port, timeout: timeoutMs });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Production HTTP/HTTPS GET implementation — selects module from URL scheme. */
async function realHttpGet(url: string, timeoutMs: number): Promise<Result<string, string>> {
  const mod = url.startsWith('https://') ? https : http;
  return new Promise((resolve) => {
    const req = mod.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      res.on('end', () => {
        resolve(Ok(body));
      });
    });
    req.on('error', (err) => {
      resolve(Err(err.message));
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(Err('timeout'));
    });
  });
}

/** Production doctor subprocess implementation. */
async function realSpawnDoctor(
  binPath: string,
  env: Record<string, string>,
  timeoutMs: number,
  logFile: string,
): Promise<number> {
  // openProxyLog: 0700 parent dir + 0600 file creation + best-effort chmod for
  // pre-existing wider modes (SEC-2). Non-fatal on chmod failure per PF-009.
  const logFd = await openProxyLog(logFile);
  try {
    return await new Promise<number>((resolve) => {
      const proc = cpSpawn(process.execPath, [binPath, 'doctor'], {
        env,
        stdio: ['ignore', logFd.fd, logFd.fd],
      });
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill(); // SIGTERM — ask the process to terminate gracefully
          // A SIGTERM-trapping child keeps the event loop alive (no unref on
          // proc here, since we are awaiting the promise). Schedule a SIGKILL escalation
          // after a short grace period. The escalation timer is unref()'d so it never
          // prevents the CLI from exiting on its own if the process exits first.
          const sigkillTimer = setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch { /* already dead — ignore */ }
          }, 2000);
          sigkillTimer.unref();
          resolve(1);
        }
      }, timeoutMs);
      proc.on('close', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(code ?? 1);
        }
      });
      // OS-level spawn failure (EMFILE, ENOMEM, EAGAIN) must be handled — an
      // unhandled 'error' event becomes an uncaught exception. Resolve(1) so the
      // finally block closes logFd and callers get a clean failure path.
      proc.on('error', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(1);
        }
      });
    });
  } finally {
    await logFd.close();
  }
}

// ─── Production preflight deps factory ───────────────────────────────────────

/**
 * Options for buildRealPreflightDeps.
 * Captures the deliberate caller-specific difference in readSettingsJson behaviour.
 */
export interface BuildRealPreflightDepsOptions {
  /** Absolute path to ~/.claude/settings.json. */
  settingsPath: string;
  /** Called on non-fatal preflight warnings (e.g. ANTHROPIC_API_KEY present). */
  onWarn?: (msg: string) => void;
  /**
   * When true, readSettingsJson swallows I/O errors and returns '{}' instead of
   * throwing. Set to true for init.ts (which writes settings.json itself and should
   * tolerate an absent file); leave false (default) for runEnable where a read error
   * is surfaced to the user.
   */
  swallowSettingsReadError?: boolean;
}

/**
 * Build the real (production) ProxyPreflightDeps from the given options.
 * Centralises the three private implementations so both runEnable and init.ts
 * can consume them without byte-identical inline copies.
 *
 * applies ADR-013: pure configuration factory; I/O implementations factored once.
 */
export function buildRealPreflightDeps(opts: BuildRealPreflightDepsOptions): ProxyPreflightDeps {
  const { settingsPath, onWarn, swallowSettingsReadError = false } = opts;
  return {
    resolveProxyBin,
    fileExists: async (filePath: string) => {
      try { await fs.access(filePath); return true; } catch { return false; }
    },
    tcpConnectable: realTcpConnectable,
    httpGet: realHttpGet,
    readSettingsJson: swallowSettingsReadError
      ? async () => { try { return await fs.readFile(settingsPath, 'utf-8'); } catch { return '{}'; } }
      : () => fs.readFile(settingsPath, 'utf-8'),
    spawnDoctor: realSpawnDoctor,
    onWarn,
  };
}

// ─── Injectable spawn-and-wait helper ────────────────────────────────────────

/**
 * Injectable dependencies for spawnRelayAndWaitForPort.
 * All I/O is behind this interface so every relay spawn path is unit-testable.
 */
export interface SpawnAndWaitDeps {
  /** Open logPath for appending. Returns fd + close function. */
  openLog: (logPath: string) => Promise<{ fd: number; close: () => Promise<void> }>;
  /**
   * Spawn the relay process as a detached background process.
   * The implementation MUST attach `onError` via `proc.on('error', onError)` before
   * returning — this is a required invariant. Returns the spawned process pid.
   */
  spawnProcess: (opts: {
    execPath: string;
    args: string[];
    env: Record<string, string>;
    stdioFd: number;
    /** Called on OS-level spawn failure (EMFILE, ENOMEM, EAGAIN). */
    onError: (err: Error) => void;
  }) => { pid?: number };
  /** Write pid to file. Failures are non-fatal (caller treats as best-effort). */
  writePid: (pidPath: string, pid: number) => Promise<void>;
  /** Sleep ms milliseconds. */
  sleep: (ms: number) => Promise<void>;
  /**
   * Check if a process is alive via signal 0. Returns false when dead.
   * Production: wraps process.kill(pid, 0); never throws.
   */
  isProcessAlive: (pid: number) => boolean;
  /** Attempt a TCP connect to 127.0.0.1:port. True = accepted. */
  tcpConnectable: (port: number, timeoutMs: number) => Promise<boolean>;
}

/** Result type for spawnRelayAndWaitForPort. */
export type SpawnRelayResult =
  | { ok: true; spawnedPid?: number } // spawnedPid present when self-spawned; absent on adopted path
  | { ok: false; reason: string };

/**
 * Spawn the relay (unless adopted) and wait up to 50×100ms for TCP accept.
 *
 * When `adopted` is true, the relay is already running — skip spawn entirely.
 *
 * Returns `{ ok: true }` when the port accepts connections.
 * Returns `{ ok: false }` when:
 *   - relay never accepted after 50 probes (caller should rollback proxy.json)
 *   - relay process died before the port came up
 *   - OS-level spawn error (EMFILE, ENOMEM, EAGAIN) — always handled via the
 *     injected onError callback, never an uncaught exception
 *
 * avoids PF-014: no process.exit() — returns Result; caller decides error handling.
 */
export async function spawnRelayAndWaitForPort(
  port: number,
  binPath: string,
  configPath: string,
  logPath: string,
  pidPath: string,
  adopted: boolean,
  deps: SpawnAndWaitDeps,
): Promise<SpawnRelayResult> {
  if (adopted) {
    // Port already hosting our relay — skip spawn entirely, proceed to settings pass.
    return { ok: true };
  }

  const logHandle = await deps.openLog(logPath);

  let spawnError: Error | undefined;
  // SEC-2: allowlist env for the relay — only PATH/HOME/TMPDIR/LANG/LC_ALL are
  // inherited; SUBSWITCH_CONFIG is the only process-specific addition here.
  const env = { ...scrubChildEnv(), SUBSWITCH_CONFIG: configPath };

  const { pid } = deps.spawnProcess({
    execPath: process.execPath,
    args: [binPath, 'serve'],
    env,
    stdioFd: logHandle.fd,
    // Captured here; breaks the wait loop on the next iteration
    onError: (err) => { spawnError = err; },
  });
  // Parent closes its copy; the spawned child retains the fd through the OS
  await logHandle.close();

  if (pid !== undefined) {
    // Non-fatal: best-effort pid record for devflow proxy --status
    await deps.writePid(pidPath, pid);
  }

  // Bounded wait: ≤RELAY_SPAWN_MAX_PROBES×100ms (5s max) for TCP accept
  let portUp = false;
  for (let i = 0; i < RELAY_SPAWN_MAX_PROBES; i++) {
    await deps.sleep(RELAY_SPAWN_PROBE_INTERVAL_MS);

    if (spawnError !== undefined) {
      // OS-level error fired — no point waiting; relay will never start
      break;
    }

    if (pid !== undefined && !deps.isProcessAlive(pid)) {
      // Process died before port came up — check for EADDRINUSE race
      // (another session may have started and already owns the port)
      if (await deps.tcpConnectable(port, RELAY_SPAWN_PER_PROBE_TIMEOUT_MS)) {
        portUp = true;
      }
      break;
    }

    if (await deps.tcpConnectable(port, RELAY_SPAWN_PER_PROBE_TIMEOUT_MS)) {
      portUp = true;
      break;
    }
  }

  if (!portUp) {
    return { ok: false, reason: 'relay-not-started' };
  }
  return { ok: true, spawnedPid: pid };
}

/** Build the real (production) SpawnAndWaitDeps. Not exported — internal to runEnable. */
function buildRealSpawnAndWaitDeps(): SpawnAndWaitDeps {
  return {
    openLog: async (logPath) => {
      // openProxyLog: 0700 parent dir + 0600 file creation + best-effort chmod (SEC-2).
      const handle = await openProxyLog(logPath);
      return { fd: handle.fd, close: () => handle.close() };
    },
    spawnProcess: ({ execPath, args, env, stdioFd, onError }) => {
      const proc = cpSpawn(execPath, args, {
        detached: true,
        stdio: ['ignore', stdioFd, stdioFd],
        env,
      });
      // Attach error handler before unref so OS-level failures are caught
      proc.on('error', onError);
      proc.unref();
      return { pid: proc.pid };
    },
    writePid: async (pidPath, pid) => {
      // Non-fatal: failure is inconvenient (--status loses pid) but not blocking
      try { await fs.writeFile(pidPath, String(pid), 'utf-8'); } catch { /* non-fatal */ }
    },
    sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    isProcessAlive: (pid) => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    },
    tcpConnectable: realTcpConnectable,
  };
}

// ─── Atomic settings mutation for enable ─────────────────────────────────────

// ─── Post-spawn doctor verification ──────────────────────────────────────────

/**
 * Injectable dependencies for runPostSpawnVerification.
 * All I/O is behind this interface so every doctor-gate branch is unit-testable.
 */
export interface PostSpawnDoctorDeps {
  /**
   * Spawn `node <binPath> doctor` with the given env; append stdout+stderr to logFile.
   * Resolves with the exit code (1 on timeout).
   */
  spawnDoctor: (
    binPath: string,
    env: Record<string, string>,
    timeoutMs: number,
    logFile: string,
  ) => Promise<number>;
  /**
   * Kill the relay process by pid via SIGTERM. Must not throw — implementation wraps in try/catch.
   * Called only when spawnedPid is defined and doctor exits non-zero (self-spawned rollback only).
   */
  killProcess: (pid: number) => void;
  /**
   * Write proxy.json with enabled:false for rollback. Called when doctor exits non-zero.
   * Best-effort — a write failure is non-fatal (secondary to the verification failure).
   */
  writeDisabledProxyState: () => Promise<void>;
}

/**
 * Run `node <binPath> doctor` against the live relay and handle failure.
 *
 * @D-EFR-2 Doctor gates post-spawn, not pre-spawn: the relay's doctor subcommand
 *   probes the relay port to confirm it is running — a not-yet-started relay makes
 *   that probe fail (exit 1), so a pre-spawn gate is always unsatisfiable on a cold
 *   path (the port is down by definition before spawn). Moving the gate post-spawn
 *   means doctor runs against an already-live relay, turning "running: NO" into
 *   "running: YES" on the healthy path, validating codex auth and TLS reachability.
 *
 *   Kill-on-rollback is restricted to self-spawned relays (spawnedPid defined): an
 *   adopted relay may be serving other live Claude Code sessions, so we must never
 *   kill it. A just-spawned relay predates the settings pass, so no session is
 *   routing through it — SIGTERM is safe (with a SIGKILL escalation in the caller).
 *
 * @param spawnedPid  Pid of the relay we spawned; undefined when the relay was adopted.
 * @returns Ok(undefined) when doctor exits 0; Err(message) on failure. On failure the
 *          rollback (writeDisabledProxyState) and conditional kill are applied before
 *          returning — the caller does not need to do additional rollback.
 */
export async function runPostSpawnVerification(
  binPath: string,
  configPath: string,
  logPath: string,
  spawnedPid: number | undefined,
  deps: PostSpawnDoctorDeps,
): Promise<Result<undefined, string>> {
  // SEC-2: allowlist env for doctor — matches the relay spawn composition.
  const doctorEnv = { ...scrubChildEnv(), SUBSWITCH_CONFIG: configPath };
  const doctorExit = await deps.spawnDoctor(binPath, doctorEnv, DOCTOR_TIMEOUT_MS, logPath);
  if (doctorExit === 0) return Ok(undefined);

  // Doctor failed — rollback proxy state and conditionally kill the relay.
  // Both are best-effort: write failure is secondary; kill failure means process already exited.
  await deps.writeDisabledProxyState();
  if (spawnedPid !== undefined) {
    deps.killProcess(spawnedPid);
  }
  return Err(`Routing verification failed — see ${logPath}`);
}

// ─── Atomic settings mutation for enable ─────────────────────────────────────

/**
 * Perform the single atomic settings.json pass for enable:
 * strip old hooks + env, then apply new hooks + env in one write.
 *
 * The writeFileAtomicExclusive call is guarded — ENOSPC/EACCES returns Err
 * instead of crashing with an unhandled rejection.
 *
 * Returns Ok(undefined) on success, Err(reason) on hard failure.
 */
async function applyEnableSettingsPass(
  settingsPath: string,
  devflowDir: string,
  port: number,
): Promise<Result<undefined, string>> {
  let settingsContent: string;
  try {
    settingsContent = await fs.readFile(settingsPath, 'utf-8');
  } catch {
    // Missing settings.json is fine — start from an empty object
    settingsContent = '{}';
  }

  let parsedSettings: Settings;
  try {
    parsedSettings = JSON.parse(settingsContent) as Settings;
  } catch {
    return Err('settings.json is malformed — fix it before enabling the proxy');
  }

  // Atomic 4-call settings mutation: strip stale entries, then apply fresh ones.
  // REG-1: strip is scoped to `port` (the new port being applied). The apply
  // call below always overwrites ANTHROPIC_BASE_URL regardless, so the strip
  // here primarily removes any exact-port match before the write-set cycle.
  removeProxyHooks(parsedSettings);
  _stripProxyEnvFromObject(parsedSettings, port);
  addProxyHooks(parsedSettings, devflowDir);
  _applyProxyEnvToObject(parsedSettings, port);

  try {
    await writeFileAtomicExclusive(settingsPath, JSON.stringify(parsedSettings, null, 2) + '\n');
  } catch (err) {
    return Err(
      `Could not write settings.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return Ok(undefined);
}

// ─── Shared status/disable helpers ───────────────────────────────────────────

/** Relay process state as observed by TCP probe + health check. */
type ProcessState = 'down' | 'running-ours' | 'port-squatted';

/**
 * Read and parse the relay PID file. Returns null on ENOENT, parse failure, or
 * invalid value — callers treat null as "no pid available".
 */
async function readPidFile(pidPath: string): Promise<number | null> {
  try {
    const pidStr = await fs.readFile(pidPath, 'utf-8');
    const pid = parseInt(pidStr.trim(), 10);
    return !isNaN(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Probe relay process state via TCP connect + health identity check.
 * Returns 'down' when featureEnabled is false or the port is not accepting.
 */
async function resolveProcessState(
  featureEnabled: boolean,
  port: number,
): Promise<ProcessState> {
  if (!featureEnabled) return 'down';
  const portUp = await realTcpConnectable(port, PROBE_TIMEOUT_MS);
  if (!portUp) return 'down';
  const healthResult = await realHttpGet(
    `${proxyBaseUrl(port)}/__subswitch/health`,
    PROBE_TIMEOUT_MS,
  );
  // Uses shared isOurRelayBody helper (same logic as runProxyPreflight)
  if (healthResult.ok && isOurRelayBody(healthResult.value)) {
    return 'running-ours';
  }
  // Port accepting but health timed out, failed, or not our relay
  return 'port-squatted';
}

/**
 * Pure: compute the process log line from resolved state.
 * Returns null when no line should be emitted (dead pid + non-down processState).
 */
function formatProcessLine(
  processState: ProcessState,
  pidAlive: boolean,
  pidFromFile: number | null,
  port: number,
): { level: 'info' | 'warn'; msg: string } | null {
  if (pidFromFile !== null) {
    if (pidAlive) {
      if (processState === 'running-ours') {
        return {
          level: 'info',
          msg: `Process: ${color.green('running')} (pid ${pidFromFile}) — stop manually with: kill ${pidFromFile}`,
        };
      } else if (processState === 'port-squatted') {
        return {
          level: 'warn',
          msg: `Process: ${color.yellow('port squatted by another app')} (pid ${pidFromFile} alive but port ${port} is not our relay)`,
        };
      } else {
        return {
          level: 'info',
          msg: `Process: ${color.yellow('pid alive but port not responding')} (pid ${pidFromFile})`,
        };
      }
    }
    // Pid dead
    if (processState === 'down') {
      return {
        level: 'info',
        msg: `Process: ${color.dim('down')} (last pid ${pidFromFile}, no longer running)`,
      };
    }
    return null; // pid dead but port squatted/running — unusual, no line
  }
  // No pid file
  if (processState === 'running-ours') {
    return { level: 'info', msg: `Process: ${color.green('running')} (no pid file)` };
  } else if (processState === 'port-squatted') {
    return {
      level: 'warn',
      msg: `Process: ${color.yellow('port squatted')} — port ${port} is in use by another application`,
    };
  } else {
    return { level: 'info', msg: `Process: ${color.dim('down')}` };
  }
}

// ─── Port resolution ──────────────────────────────────────────────────────────

/**
 * Resolve the effective port for enable.
 *
 * When portOption is undefined (--port flag not provided by the user), falls back to
 * priorPort from proxy.json. This is the remembered-port path: a user who enabled on
 * port 5000, disabled, then re-enables without --port correctly reuses 5000.
 *
 * Previously the commander option carried a String(DEFAULT_PROXY_PORT) default so
 * portOption was never undefined — the fallback was dead code (TS-1 regression).
 *
 * @param portOption  Commander --port value; undefined when flag not provided
 * @param priorPort   Last-used port from proxy.json (or DEFAULT_PROXY_PORT)
 */
export function resolvePort(
  portOption: string | undefined,
  priorPort: number,
): Result<number, string> {
  if (portOption === undefined) return Ok(priorPort);
  const parsed = parseInt(portOption, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
    return Err(`Invalid port: ${portOption}`);
  }
  return Ok(parsed);
}

// ─── Command ──────────────────────────────────────────────────────────────────

interface ProxyOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
  port?: string;
}

export const proxyCommand = new Command('proxy')
  .description('Enable or disable external model routing (GPT models via your OpenAI/Codex subscription)')
  .option('--enable', 'Enable external model routing via the Devflow proxy')
  .option('--disable', 'Disable external model routing')
  .option('--status', 'Show proxy status')
  .option('--port <n>', 'Port for the local relay (default: remembered or 4141)')
  .action(async (options: ProxyOptions) => {
    // No flag → show status
    const hasFlag = options.enable || options.disable || options.status;
    if (!hasFlag) {
      await runStatus();
      return;
    }

    if (options.status) {
      await runStatus();
      return;
    }

    if (options.enable) {
      await runEnable(options.port);
      return;
    }

    if (options.disable) {
      await runDisable();
      return;
    }
  });

// ─── Status ───────────────────────────────────────────────────────────────────

async function runStatus(): Promise<void> {
  const devflowDir = getDevFlowDirectory();
  const claudeDir = getClaudeDirectory();
  const settingsPath = path.join(claudeDir, 'settings.json');
  const home = getHomeDirectory();
  const logPath = path.join(devflowDir, 'logs', 'proxy.log');
  const pidPath = path.join(devflowDir, 'proxy.pid');
  const codexAuthPath = path.join(home, '.codex', 'auth.json');

  p.intro(color.bgBlue(color.white(' Devflow Proxy Status ')));

  // Feature state: manifest + proxy.json
  const manifest = await readManifest(devflowDir);
  const proxyStateResult = await readProxyState(devflowDir);
  const proxyState = proxyStateResult.ok ? proxyStateResult.value : null;

  const manifestEnabled = manifest?.features.proxy ?? false;
  const stateEnabled = proxyState?.enabled ?? false;

  if (manifestEnabled !== stateEnabled) {
    p.log.warn(
      `Feature state drift: manifest says ${manifestEnabled ? color.green('enabled') : color.dim('disabled')}, ` +
      `proxy.json says ${stateEnabled ? color.green('enabled') : color.dim('disabled')} — run devflow proxy --enable or --disable to repair`,
    );
  }

  const featureEnabled = manifestEnabled && stateEnabled;
  p.log.info(
    `Feature: ${featureEnabled ? color.green('enabled') : color.dim('disabled')}` +
    (proxyState?.port ? ` (port ${proxyState.port})` : ''),
  );

  // Process state
  const port = proxyState?.port ?? DEFAULT_PROXY_PORT;
  const processState = await resolveProcessState(featureEnabled, port);
  const pidFromFile = await readPidFile(pidPath);
  let pidAlive = false;
  if (pidFromFile !== null) {
    try { process.kill(pidFromFile, 0); pidAlive = true; } catch { /* dead */ }
  }
  const processLine = formatProcessLine(processState, pidAlive, pidFromFile, port);
  if (processLine !== null) {
    if (processLine.level === 'warn') {
      p.log.warn(processLine.msg);
    } else {
      p.log.info(processLine.msg);
    }
  }

  // Env state
  let envState: 'ours' | 'ours-other-port' | 'foreign' | 'absent' = 'absent';
  try {
    const settingsJson = await fs.readFile(settingsPath, 'utf-8');
    envState = readProxyEnvState(settingsJson, port);
  } catch { /* settings missing */ }

  const envStateLabels: Record<typeof envState, string> = {
    'ours': color.green('set (our relay)'),
    'ours-other-port': color.yellow('set (our relay, different port)'),
    'foreign': color.red('set (foreign gateway — Devflow will not overwrite)'),
    'absent': color.dim('not set'),
  };
  p.log.info(`ANTHROPIC_BASE_URL: ${envStateLabels[envState]}`);

  // Codex auth
  try {
    await fs.access(codexAuthPath);
    p.log.info(`Codex auth: ${color.green('present')} (${codexAuthPath})`);
  } catch {
    p.log.info(`Codex auth: ${color.dim('absent')} — run codex login`);
  }

  // Agent mapping count
  const mappingResult = await readAgentMapping(devflowDir);
  if (mappingResult.ok) {
    const count = countExternalMappedAgents(mappingResult.value);
    if (count > 0) {
      p.log.info(`External-mapped agents: ${color.cyan(String(count))}`);
    } else {
      p.log.info('External-mapped agents: none — use devflow agents to configure');
    }
  }

  // Log path
  p.log.info(`Proxy log: ${color.dim(logPath)}`);

  if (featureEnabled && processState === 'running-ours') {
    p.note(
      `${color.cyan('devflow proxy --disable')}  Disable external model routing\n` +
      `${color.cyan('devflow proxy --status')}   Refresh status`,
      'Management',
    );
  } else {
    p.note(
      `${color.cyan('devflow proxy --enable')}   Enable external model routing\n` +
      `${color.cyan('devflow proxy --status')}   Refresh status`,
      'Management',
    );
  }
}

// ─── Enable ───────────────────────────────────────────────────────────────────

async function runEnable(portOption: string | undefined): Promise<void> {
  const devflowDir = getDevFlowDirectory();
  const claudeDir = getClaudeDirectory();
  const settingsPath = path.join(claudeDir, 'settings.json');
  const installDir = path.join(claudeDir, 'agents', 'devflow');
  const home = getHomeDirectory();
  const codexAuthPath = path.join(home, '.codex', 'auth.json');
  const configPath = path.join(devflowDir, 'proxy-routing.json');
  const logPath = path.join(devflowDir, 'logs', 'proxy.log');
  const pidPath = path.join(devflowDir, 'proxy.pid');

  // Step 1: Read prior proxy.json (remembered port); --port flag overrides
  const priorStateResult = await readProxyState(devflowDir);
  const priorPort = priorStateResult.ok ? priorStateResult.value.port : DEFAULT_PROXY_PORT;

  const portResult = resolvePort(portOption, priorPort);
  if (!portResult.ok) {
    p.log.error(portResult.error);
    process.exitCode = 1;
    return;
  }
  const port = portResult.value;

  const s = p.spinner();
  s.start('Running preflight checks...');

  // Step 2: Write routing config
  await fs.mkdir(devflowDir, { recursive: true });
  // SEC-2: mode 0o700 for the logs directory (new directories only; pre-existing
  // dirs are unaffected by mkdir). openProxyLog handles individual file mode.
  await fs.mkdir(path.join(devflowDir, 'logs'), { recursive: true, mode: 0o700 });

  // SEC-2 pre-spawn rotation: rotate proxy.log before the relay opens an fd on it.
  // MUST run before spawnRelayAndWaitForPort (Step 5) — a rename while the relay
  // holds an append fd would orphan that fd. At this point no relay is running.
  await rotateProxyLogIfLarge(logPath);

  try {
    await fs.writeFile(configPath, buildRoutingConfigJson(port, externalModelIds()), 'utf-8');
  } catch (err) {
    s.stop(color.red('Failed to write routing config'));
    p.log.error(`Could not write routing config: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  // Step 3: Preflight checks (①–④: bin, codex auth, port probe, settings)
  // preflightDeps is saved so spawnDoctor can be reused in step 6 (post-spawn verification).
  const preflightDeps = buildRealPreflightDeps({
    settingsPath,
    // runEnable propagates settings read errors (init.ts swallows — see swallowSettingsReadError)
    swallowSettingsReadError: false,
    onWarn: (msg) => { s.stop(''); p.log.warn(msg); s.start(''); },
  });
  const preflightResult = await runProxyPreflight(
    port,
    codexAuthPath,
    configPath,
    logPath,
    preflightDeps,
  );
  if (!preflightResult.ok) {
    s.stop(color.red('Preflight failed'));
    p.log.error(preflightResult.error);
    process.exitCode = 1;
    return;
  }
  const { binPath, npxWarning, adopted } = preflightResult.value;

  s.message('Writing proxy state...');

  // Step 4: Write proxy.json enabled:true
  const newState = buildProxyState({
    enabled: true,
    port,
    binPath,
    configPath,
    models: externalModelIds(),
    devflowVersion: getDevflowVersion(),
  });
  const writeStateResult = await writeProxyState(devflowDir, newState);
  if (!writeStateResult.ok) {
    s.stop(color.red('Failed to write proxy state'));
    p.log.error(writeStateResult.error);
    process.exitCode = 1;
    return;
  }

  // Step 5: Spawn relay and wait for port
  if (!adopted) {
    s.message('Starting relay...');
  }
  const spawnResult = await spawnRelayAndWaitForPort(
    port,
    binPath,
    configPath,
    logPath,
    pidPath,
    adopted,
    buildRealSpawnAndWaitDeps(),
  );
  if (!spawnResult.ok) {
    // Rollback: write proxy.json enabled:false, keep port/binPath for next attempt
    const rollback = buildProxyState({
      enabled: false,
      port,
      binPath,
      configPath,
      models: externalModelIds(),
      devflowVersion: getDevflowVersion(),
    });
    // Best-effort rollback — a write failure here is secondary to the spawn failure
    await writeProxyState(devflowDir, rollback);
    s.stop(color.red('Relay failed to start'));
    p.log.error(`Proxy failed to start — check ${logPath}`);
    process.exitCode = 1;
    return;
  }
  const { spawnedPid } = spawnResult;

  // Step 6: Post-spawn doctor verification — runs against the live relay (see D-EFR-2).
  // Relay is confirmed up before this runs, so "running: YES" is the expected outcome.
  s.message('Verifying routing connection...');
  const verifyResult = await runPostSpawnVerification(
    binPath,
    configPath,
    logPath,
    spawnedPid,
    {
      spawnDoctor: preflightDeps.spawnDoctor,
      // Best-effort SIGTERM + SIGKILL escalation after 2s grace period.
      // Only called when we spawned the relay (spawnedPid defined) — see D-EFR-2.
      killProcess: (pid) => {
        try { process.kill(pid, 'SIGTERM'); } catch { /* already exited — ignore */ }
        const sigkillTimer = setTimeout(() => {
          try { process.kill(pid, 'SIGKILL'); } catch { /* already exited — ignore */ }
        }, 2000);
        sigkillTimer.unref();
      },
      writeDisabledProxyState: async () => {
        const rollback = buildProxyState({
          enabled: false,
          port,
          binPath,
          configPath,
          models: externalModelIds(),
          devflowVersion: getDevflowVersion(),
        });
        // Best-effort — write failure here is secondary to the verification failure
        await writeProxyState(devflowDir, rollback);
      },
    },
  );
  if (!verifyResult.ok) {
    // Rollback and conditional kill already applied inside runPostSpawnVerification
    s.stop(color.red('Routing verification failed'));
    p.log.error(verifyResult.error);
    process.exitCode = 1;
    return;
  }

  s.message('Updating settings...');

  // Step 7: Atomic settings mutation
  const settingsResult = await applyEnableSettingsPass(settingsPath, devflowDir, port);
  if (!settingsResult.ok) {
    // Roll back to disabled state — settings write failed after relay started
    const rollback = buildProxyState({
      enabled: false,
      port,
      binPath,
      configPath,
      models: externalModelIds(),
      devflowVersion: getDevflowVersion(),
    });
    await writeProxyState(devflowDir, rollback);
    s.stop(color.red('Cannot update settings'));
    p.log.error(settingsResult.error);
    process.exitCode = 1;
    return;
  }

  // Step 8: Sync manifest
  await syncManifestFeature(devflowDir, 'proxy', true);

  // Step 9: Reapply agent mapping
  const reapplyResult = await reapplyAgentMapping({
    proxyEnabled: true,
    installDir,
    devflowDir,
  });
  const mappedCount = reapplyResult.updated.length;

  s.stop(color.green('External model routing enabled'));

  if (adopted) {
    p.log.info(`Relay already running on port ${port} — adopted`);
  } else {
    p.log.success(`Relay started on port ${port}`);
  }

  if (npxWarning) {
    p.log.warn('Relay binary resolved from npx cache — may not persist across reboots; run devflow init to reinstall');
  }

  if (mappedCount > 0) {
    p.log.info(`Restored external model mapping for ${mappedCount} agent(s)`);
  }

  p.log.info(color.dim('Takes effect in new Claude Code sessions. Use devflow agents to configure per-agent models.'));
}

// ─── Disable ──────────────────────────────────────────────────────────────────

async function runDisable(): Promise<void> {
  const devflowDir = getDevFlowDirectory();
  const claudeDir = getClaudeDirectory();
  const settingsPath = path.join(claudeDir, 'settings.json');
  const installDir = path.join(claudeDir, 'agents', 'devflow');
  const pidPath = path.join(devflowDir, 'proxy.pid');

  // Read prior state FIRST (before settings pass) to determine managed port.
  // REG-1: applyDisableToSettings strips ANTHROPIC_BASE_URL only when the URL
  // port matches the port Devflow manages — callers must supply it.  Reading
  // proxy.json here also consolidates state for Step 2 below.
  const priorStateResult = await readProxyState(devflowDir);
  const priorState = priorStateResult.ok ? priorStateResult.value : null;
  const managedPort = priorState?.port ?? DEFAULT_PROXY_PORT;

  // Step 1: Settings pass (removeProxyHooks + stripProxyEnv, single atomic write)
  let settingsContent: string;
  try {
    settingsContent = await fs.readFile(settingsPath, 'utf-8');
  } catch {
    settingsContent = '{}';
  }

  let parsedSettings: Settings;
  try {
    parsedSettings = JSON.parse(settingsContent) as Settings;
  } catch {
    p.log.error('settings.json is malformed — fix it before disabling the proxy');
    process.exitCode = 1;
    return;
  }

  const changed = applyDisableToSettings(parsedSettings, managedPort);
  if (changed) {
    // Guard ENOSPC/EACCES — unhandled rejection leaves proxy in partial state
    try {
      await writeFileAtomicExclusive(settingsPath, JSON.stringify(parsedSettings, null, 2) + '\n');
    } catch (err) {
      p.log.error(
        `Could not write settings.json: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
      return;
    }
  }

  // Step 2: Write proxy.json enabled:false (keep port/models/binPath)
  const disabledState = buildProxyState({
    enabled: false,
    port: priorState?.port ?? DEFAULT_PROXY_PORT,
    binPath: priorState?.binPath ?? null,
    configPath: priorState?.configPath ?? null,
    models: priorState?.models ?? [],
    devflowVersion: getDevflowVersion(),
  });
  // REL-2: guard proxy state write
  const writeDisabledResult = await writeProxyState(devflowDir, disabledState);
  if (!writeDisabledResult.ok) {
    p.log.error(`Could not write proxy state: ${writeDisabledResult.error}`);
    process.exitCode = 1;
    return;
  }

  // Step 3: Sync manifest
  await syncManifestFeature(devflowDir, 'proxy', false);

  // Step 4: Revert external agents to shipped defaults
  await revertExternalAgents({ installDir, devflowDir });

  p.log.success('External model routing disabled — takes effect in new Claude Code sessions');

  // Step 5: Note about running relay (plan D3: leave it running for live sessions)
  // CPLX-7: readPidFile replaces the inline read/parse/validate idiom
  const pidFromFile = await readPidFile(pidPath);
  if (pidFromFile !== null) {
    try {
      process.kill(pidFromFile, 0);
      // Cross-check relay identity before emitting the kill hint. A stale or
      // recycled PID that passes signal 0 may belong to an unrelated process. We
      // confirm identity via a port health check — the relay is ours only if the health
      // endpoint returns isOurRelayBody. Non-blocking: we never kill programmatically.
      const disablePort = priorState?.port ?? DEFAULT_PROXY_PORT;
      const portUp = await realTcpConnectable(disablePort, PROBE_TIMEOUT_MS);
      let identityConfirmed = false;
      if (portUp) {
        const healthResult = await realHttpGet(
          `${proxyBaseUrl(disablePort)}/__subswitch/health`,
          PROBE_TIMEOUT_MS,
        );
        identityConfirmed = healthResult.ok && isOurRelayBody(healthResult.value);
      }
      if (identityConfirmed) {
        p.log.info(
          color.dim(
            `Relay process (pid ${pidFromFile}) is still running for any live sessions and will stop at reboot. ` +
            `Manual stop: kill ${pidFromFile}`,
          ),
        );
      } else {
        p.log.info(
          color.dim(
            `A process with pid ${pidFromFile} from proxy.pid appears alive — ` +
            `identity could not be confirmed (port not responding as our relay). ` +
            `Verify it is the relay before stopping it manually.`,
          ),
        );
      }
    } catch { /* process not running */ }
  }
}
