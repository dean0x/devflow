import { homedir, platform } from 'os';
import * as path from 'path';

/**
 * Get the OS-specific path for Claude Code managed settings.
 * Managed settings have highest precedence and cannot be overridden by users.
 * - macOS: /Library/Application Support/ClaudeCode/managed-settings.json
 * - Linux: /etc/claude-code/managed-settings.json
 *
 * @throws {Error} On unsupported platforms (Windows)
 */
export function getManagedSettingsPath(): string {
  const os = platform();
  if (os === 'darwin') {
    return '/Library/Application Support/ClaudeCode/managed-settings.json';
  }
  if (os === 'linux') {
    return '/etc/claude-code/managed-settings.json';
  }
  throw new Error(`Managed settings not supported on platform: ${os}`);
}

/**
 * The home directory — `HOME`, else the passwd entry `os.homedir()` reports —
 * or null when neither names one. Never throws: `os.homedir()` itself throws on
 * a system with no passwd entry for the user.
 */
export function readHomeDirectory(
  env: NodeJS.ProcessEnv = process.env,
  osHomedir: () => string = homedir,
): string | null {
  const fromEnv = env.HOME;
  if (fromEnv) return fromEnv;
  try {
    return osHomedir() || null;
  } catch {
    return null;
  }
}

/**
 * Get home directory with proper fallback and validation
 * Priority: process.env.HOME > os.homedir()
 *
 * @throws {Error} If unable to determine home directory
 */
export function getHomeDirectory(): string {
  const home = readHomeDirectory();
  if (home === null) {
    throw new Error('Unable to determine home directory. Set HOME environment variable.');
  }
  return home;
}

/**
 * The Claude Code configuration directory: `CLAUDE_CONFIG_DIR` when it is an
 * absolute path, else `~/.claude`.
 *
 * D-CLAUDE-CONFIG-DIR: Claude Code itself relocates its whole configuration tree
 * (settings.json, agents, skills, rules, history.jsonl) to `CLAUDE_CONFIG_DIR`, so
 * devflow installs into — and uninstalls from — the directory Claude Code actually
 * reads, and no other variable names the Claude directory: an install anywhere
 * else is invisible to the session.
 * A relative value is ignored rather than resolved against the cwd: an install
 * target that moves with the working directory is never the one Claude Code loads.
 * Never throws — the fallback is always a well-formed path.
 */
export function getClaudeDirectory(): string {
  const configured = process.env.CLAUDE_CONFIG_DIR;
  if (configured !== undefined && configured !== '' && path.isAbsolute(configured)) {
    return configured;
  }
  return path.join(getHomeDirectory(), '.claude');
}

/**
 * The devflow machine root: always `~/.devflow`.
 *
 * D-ONE-HOME: there is one machine root and no environment variable relocates it.
 * The CLI, the HUD, every hook and every prompt resolve `$HOME/.devflow` the same
 * way, so no value exported in one shell can split an install from the hooks and
 * prompts that read it. Per-repo data lives under `<repo>/.devflow`, which is
 * project data, not an install location.
 */
export function getDevFlowDirectory(): string {
  return path.join(getHomeDirectory(), '.devflow');
}

/**
 * The machine-wide install locations.
 *
 * D-SCOPE-RETIRED: devflow has exactly one install scope — the user's machine —
 * because every hook and prompt reads `~/.devflow`. `init --scope local`
 * refuses and points at `devflow uninstall --scope local`, the one reader of a
 * repo-local layout (D-LEGACY-LOCAL-CLEANUP in uninstall.ts).
 */
export function getInstallationPaths(): { claudeDir: string; devflowDir: string } {
  return {
    claudeDir: getClaudeDirectory(),
    devflowDir: getDevFlowDirectory(),
  };
}

/** The machine-wide install locations and the home directory they sit under. */
export interface ResolvedInstallationPaths {
  readonly homeDir: string;
  readonly claudeDir: string;
  readonly devflowDir: string;
}

/**
 * {@link getInstallationPaths} as a Result: the one way these paths fail is a
 * process with no home directory, which a command reports and exits on rather
 * than catching a throw.
 */
export function resolveInstallationPaths():
  | { readonly ok: true; readonly value: ResolvedInstallationPaths }
  | { readonly ok: false; readonly error: string } {
  const homeDir = readHomeDirectory();
  if (homeDir === null) {
    return { ok: false, error: 'Unable to determine home directory. Set HOME environment variable.' };
  }
  return { ok: true, value: { homeDir, ...getInstallationPaths() } };
}
