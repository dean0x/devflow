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
 * its value matches the relay URL pattern (^http://127\.0\.0\.1:\d+$).
 * Never clobbers a user's custom gateway URL.
 * Returns true when the object was changed.
 */
function _stripProxyEnvFromObject(settings: Settings): boolean {
  const s = settings as Record<string, unknown>;
  const env = s.env as Record<string, unknown> | undefined;
  if (typeof env?.ANTHROPIC_BASE_URL !== 'string') return false;
  if (!OUR_BASE_URL_PATTERN.test(env.ANTHROPIC_BASE_URL)) return false;
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
 * Remove ANTHROPIC_BASE_URL from settings JSON, but ONLY when its value matches
 * the relay pattern (^http://127\.0\.0\.1:\d+$).
 * Returns new serialized settings string. Does not mutate input.
 * Cleans up an emptied env object. Never clobbers a foreign gateway URL.
 */
export function stripProxyEnv(settingsJson: string): string {
  const settings = JSON.parse(settingsJson) as Settings;
  _stripProxyEnvFromObject(settings);
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

// ─── Pure hook helpers (exported for Phase 4 reuse) ──────────────────────────

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
 * ⑤ Doctor: `node <bin> doctor` with SUBSWITCH_CONFIG env, 10s cap.
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
  const portAccepting = await deps.tcpConnectable(port, 2000);
  if (portAccepting) {
    // Port is up — check health identity
    const healthResult = await deps.httpGet(
      `${proxyBaseUrl(port)}/__subswitch/health`,
      2000,
    );
    if (healthResult.ok) {
      try {
        const body = JSON.parse(healthResult.value) as Record<string, unknown>;
        // Internal check: 'subswitch' is the internal package name — fine in code, not in output
        if (body['name'] === 'subswitch') {
          return Ok({ binPath, npxWarning, adopted: true });
        }
      } catch {
        /* JSON parse error — treat as wrong identity */
      }
    }
    // Port accepting but not our relay
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

  // ⑤ Doctor subprocess
  const doctorEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    SUBSWITCH_CONFIG: configPath,
  };
  const doctorExit = await deps.spawnDoctor(binPath, doctorEnv, 10_000, logPath);
  if (doctorExit !== 0) {
    return Err(`routing preflight failed — see ${logPath}`);
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
  const logFd = await fs.open(logFile, 'a');
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
          proc.kill();
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
    });
  } finally {
    await logFd.close();
  }
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
  .option('--port <n>', 'Port for the local relay (default: 4141)', String(DEFAULT_PROXY_PORT))
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
  let processState: 'down' | 'running-ours' | 'port-squatted' = 'down';
  let pidFromFile: number | null = null;

  try {
    const pidStr = await fs.readFile(pidPath, 'utf-8');
    const pid = parseInt(pidStr.trim(), 10);
    if (!isNaN(pid) && pid > 0) pidFromFile = pid;
  } catch { /* no pid file */ }

  if (featureEnabled) {
    const portUp = await realTcpConnectable(port, 2000);
    if (portUp) {
      const healthResult = await realHttpGet(`${proxyBaseUrl(port)}/__subswitch/health`, 2000);
      if (healthResult.ok) {
        try {
          const body = JSON.parse(healthResult.value) as Record<string, unknown>;
          processState = body['name'] === 'subswitch' ? 'running-ours' : 'port-squatted';
        } catch {
          processState = 'port-squatted';
        }
      } else {
        // Port accepting but health unreachable — may not be our relay
        processState = 'port-squatted';
      }
    }
  }

  // PID cross-check
  if (pidFromFile) {
    try {
      process.kill(pidFromFile, 0);
      // Process alive
      if (processState === 'running-ours') {
        p.log.info(
          `Process: ${color.green('running')} (pid ${pidFromFile}) — stop manually with: kill ${pidFromFile}`,
        );
      } else if (processState === 'port-squatted') {
        p.log.warn(`Process: ${color.yellow('port squatted by another app')} (pid ${pidFromFile} alive but port ${port} is not our relay)`);
      } else {
        p.log.info(`Process: ${color.yellow('pid alive but port not responding')} (pid ${pidFromFile})`);
      }
    } catch {
      // Process dead
      if (processState === 'down') {
        p.log.info(`Process: ${color.dim('down')} (last pid ${pidFromFile}, no longer running)`);
      }
    }
  } else {
    if (processState === 'running-ours') {
      p.log.info(`Process: ${color.green('running')} (no pid file)`);
    } else if (processState === 'port-squatted') {
      p.log.warn(`Process: ${color.yellow('port squatted')} — port ${port} is in use by another application`);
    } else {
      p.log.info(`Process: ${color.dim('down')}`);
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

  let port: number = priorPort;
  if (portOption !== undefined) {
    const parsed = parseInt(portOption, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
      p.log.error(`Invalid port: ${portOption}`);
      return;
    }
    port = parsed;
  }

  const s = p.spinner();
  s.start('Running preflight checks...');

  // Step 2: Write routing config
  await fs.mkdir(devflowDir, { recursive: true });
  await fs.mkdir(path.join(devflowDir, 'logs'), { recursive: true });
  await fs.writeFile(configPath, buildRoutingConfigJson(port, externalModelIds()), 'utf-8');

  // Step 3: runProxyPreflight
  const realDeps: ProxyPreflightDeps = {
    resolveProxyBin,
    fileExists: async (p) => {
      try { await fs.access(p); return true; } catch { return false; }
    },
    tcpConnectable: realTcpConnectable,
    httpGet: realHttpGet,
    readSettingsJson: () => fs.readFile(settingsPath, 'utf-8'),
    spawnDoctor: realSpawnDoctor,
    onWarn: (msg) => { s.stop(''); p.log.warn(msg); s.start(''); },
  };

  const preflightResult = await runProxyPreflight(port, codexAuthPath, configPath, logPath, realDeps);
  if (!preflightResult.ok) {
    s.stop(color.red('Preflight failed'));
    p.log.error(preflightResult.error);
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
    return;
  }

  // Step 5: Spawn relay (unless already adopted)
  if (!adopted) {
    s.message('Starting relay...');

    const logFd = await fs.open(logPath, 'a');
    const proc = cpSpawn(process.execPath, [binPath, 'serve'], {
      detached: true,
      stdio: ['ignore', logFd.fd, logFd.fd],
      env: { ...process.env as Record<string, string>, SUBSWITCH_CONFIG: configPath },
    });
    proc.unref();
    await logFd.close(); // Parent closes; child retains its copy of the fd

    if (proc.pid) {
      await fs.writeFile(pidPath, String(proc.pid), 'utf-8');
    }

    // Bounded wait: ≤50×100ms for TCP accept
    let portUp = false;
    for (let i = 0; i < 50; i++) {
      await new Promise<void>((r) => setTimeout(r, 100));
      // Check if relay process is still alive
      if (proc.pid) {
        try {
          process.kill(proc.pid, 0);
        } catch (err) {
          // Process died — check EADDRINUSE race (another session may own the port)
          if (await realTcpConnectable(port, 500)) {
            portUp = true;
          }
          break;
        }
      }
      if (await realTcpConnectable(port, 500)) {
        portUp = true;
        break;
      }
    }

    if (!portUp) {
      // Rollback: write proxy.json enabled:false, keep port/binPath for next attempt
      const rollback = buildProxyState({
        enabled: false,
        port,
        binPath,
        configPath,
        models: externalModelIds(),
        devflowVersion: getDevflowVersion(),
      });
      await writeProxyState(devflowDir, rollback);
      s.stop(color.red('Relay failed to start'));
      p.log.error(`Proxy failed to start — check ${logPath}`);
      return;
    }
  }

  s.message('Updating settings...');

  // Step 6: Single atomic settings.json pass
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
    s.stop(color.red('Cannot update settings'));
    p.log.error('settings.json is malformed — fix it before enabling the proxy');
    return;
  }

  removeProxyHooks(parsedSettings);
  _stripProxyEnvFromObject(parsedSettings);
  addProxyHooks(parsedSettings, devflowDir);
  _applyProxyEnvToObject(parsedSettings, port);
  await writeFileAtomicExclusive(settingsPath, JSON.stringify(parsedSettings, null, 2) + '\n');

  // Step 7: Sync manifest
  await syncManifestFeature(devflowDir, 'proxy', true);

  // Step 8: Reapply agent mapping
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
    return;
  }

  const changed = removeProxyHooks(parsedSettings) || _stripProxyEnvFromObject(parsedSettings);
  if (changed) {
    await writeFileAtomicExclusive(settingsPath, JSON.stringify(parsedSettings, null, 2) + '\n');
  }

  // Step 2: Write proxy.json enabled:false (keep port/models/binPath)
  const priorStateResult = await readProxyState(devflowDir);
  const priorState = priorStateResult.ok ? priorStateResult.value : null;

  const disabledState = buildProxyState({
    enabled: false,
    port: priorState?.port ?? DEFAULT_PROXY_PORT,
    binPath: priorState?.binPath ?? null,
    configPath: priorState?.configPath ?? null,
    models: priorState?.models ?? [],
    devflowVersion: getDevflowVersion(),
  });
  await writeProxyState(devflowDir, disabledState);

  // Step 3: Sync manifest
  await syncManifestFeature(devflowDir, 'proxy', false);

  // Step 4: Revert external agents to shipped defaults
  await revertExternalAgents({ installDir, devflowDir });

  p.log.success('External model routing disabled — takes effect in new Claude Code sessions');

  // Step 5: Note about running relay (plan D3: leave it running for live sessions)
  let pidFromFile: number | null = null;
  try {
    const pidStr = await fs.readFile(pidPath, 'utf-8');
    const pid = parseInt(pidStr.trim(), 10);
    if (!isNaN(pid) && pid > 0) pidFromFile = pid;
  } catch { /* no pid file */ }

  if (pidFromFile) {
    try {
      process.kill(pidFromFile, 0);
      p.log.info(
        color.dim(
          `Relay process (pid ${pidFromFile}) is still running for any live sessions and will stop at reboot. ` +
          `Manual stop: kill ${pidFromFile}`,
        ),
      );
    } catch { /* process not running */ }
  }
}
