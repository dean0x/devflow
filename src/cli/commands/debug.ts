import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getHomeDirectory } from '../../targets/claude-code/claude-paths.js';
import { writeSettingsFileAtomic } from '../../core/fs-atomic.js';

interface DebugOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
}

// ─── Pure functions — no I/O, fully testable ─────────────────────────────────

/** Why a settings file cannot take the debug switch. */
export type DebugSettingsError =
  | { readonly kind: 'malformed' }
  | { readonly kind: 'env-not-object' };

export type DebugSettingsEdit =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: DebugSettingsError };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The settings object and its `env` (undefined when absent), or why not.
 *
 * D-DEBUG-ENV-OBJECT: Claude Code reads `env` as an object of variables. A
 * present `env` that is anything else — an array, a string, `null` — is
 * rejected, never repaired and never written through: a key set on an array is
 * dropped by JSON.stringify, so the command would report success and write
 * nothing, and replacing the value would discard what the user wrote.
 */
function parseSettingsEnv(
  settingsJson: string,
): { ok: true; settings: Record<string, unknown>; env: Record<string, unknown> | undefined } | { ok: false; error: DebugSettingsError } {
  let settings: unknown;
  try {
    settings = JSON.parse(settingsJson);
  } catch {
    return { ok: false, error: { kind: 'malformed' } };
  }
  if (!isPlainObject(settings)) return { ok: false, error: { kind: 'malformed' } };
  if (!Object.prototype.hasOwnProperty.call(settings, 'env')) return { ok: true, settings, env: undefined };
  const env = settings.env;
  if (!isPlainObject(env)) return { ok: false, error: { kind: 'env-not-object' } };
  return { ok: true, settings, env };
}

/**
 * Apply DEVFLOW_HOOK_DEBUG=1 to a settings JSON string.
 * Returns a new serialized settings string. Does not mutate.
 * Follows the applyFlags pattern from flags.ts.
 */
export function applyDebugTrace(settingsJson: string): DebugSettingsEdit {
  const parsed = parseSettingsEnv(settingsJson);
  if (!parsed.ok) return parsed;
  const next = { ...parsed.settings, env: { ...parsed.env, DEVFLOW_HOOK_DEBUG: '1' } };
  return { ok: true, value: JSON.stringify(next, null, 2) + '\n' };
}

/**
 * Remove DEVFLOW_HOOK_DEBUG from a settings JSON string.
 * Removes the env object entirely when it becomes empty.
 * Returns a new serialized settings string. Does not mutate.
 * Follows the stripFlags pattern from flags.ts.
 */
export function stripDebugTrace(settingsJson: string): DebugSettingsEdit {
  const parsed = parseSettingsEnv(settingsJson);
  if (!parsed.ok) return parsed;
  if (parsed.env === undefined) return { ok: true, value: JSON.stringify(parsed.settings, null, 2) + '\n' };
  const without = <T extends Record<string, unknown>>(obj: T, key: string): Record<string, unknown> =>
    Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
  const env = without(parsed.env, 'DEVFLOW_HOOK_DEBUG');
  const next = Object.keys(env).length === 0 ? without(parsed.settings, 'env') : { ...parsed.settings, env };
  return { ok: true, value: JSON.stringify(next, null, 2) + '\n' };
}

/** The message a rejected settings file gets. Pure. */
export function describeDebugSettingsError(error: DebugSettingsError): string {
  switch (error.kind) {
    case 'malformed':
      return 'settings.json is malformed — fix it before modifying env vars';
    case 'env-not-object':
      return 'settings.json has an "env" that is not an object — fix it before modifying env vars';
    default: {
      const exhaustive: never = error;
      return exhaustive;
    }
  }
}

/**
 * Read the debug tracing state from a settings JSON string.
 * Returns true when DEVFLOW_HOOK_DEBUG === '1'.
 */
export function readDebugStatus(settingsJson: string): boolean {
  const settings = JSON.parse(settingsJson) as Record<string, unknown>;
  const rawEnv = settings.env;
  if (typeof rawEnv !== 'object' || rawEnv === null || Array.isArray(rawEnv)) return false;
  return (rawEnv as Record<string, unknown>).DEVFLOW_HOOK_DEBUG === '1';
}

// ─── Command — thin I/O wrapper over the pure functions ──────────────────────

export const debugCommand = new Command('debug')
  .description('Toggle hook debug tracing (DEVFLOW_HOOK_DEBUG)')
  .option('--enable', 'Enable debug tracing (DEVFLOW_HOOK_DEBUG=1)')
  .option('--disable', 'Disable debug tracing')
  .option('--status', 'Show debug state and log location')
  .action(async (options: DebugOptions) => {
    const claudeDir = getClaudeDirectory();
    const settingsPath = path.join(claudeDir, 'settings.json');

    if (options.status) {
      // Status reads current state — parse settings independently of the
      // shared read/parse/write pattern to keep the branch self-contained.
      let settingsJson: string;
      try {
        settingsJson = await fs.readFile(settingsPath, 'utf-8');
      } catch {
        settingsJson = '{}';
      }
      let enabled = false;
      try {
        enabled = readDebugStatus(settingsJson);
      } catch {
        // malformed — treat as disabled
      }
      p.log.info(`Debug tracing: ${enabled ? color.green('enabled') : color.dim('disabled')}`);

      const cwd = process.cwd();
      const slug = cwd.replace(/^\//, '').replace(/\//g, '-');
      const home = getHomeDirectory();
      const logPath = path.join(home, '.devflow', 'logs', slug, '.hook-debug.log');
      p.log.info(`Log file: ${color.dim(logPath)}`);
      if (enabled) {
        p.log.info(color.dim(`Tip: tail -f ${logPath}`));
      }
      return;
    }

    // Read current settings (shared by enable and disable paths)
    let settingsJson: string;
    try {
      settingsJson = await fs.readFile(settingsPath, 'utf-8');
    } catch {
      settingsJson = '{}';
    }

    if (options.enable) {
      const updated = applyDebugTrace(settingsJson);
      if (!updated.ok) {
        p.log.error(describeDebugSettingsError(updated.error));
        process.exitCode = 1;
        return;
      }
      await writeSettingsFileAtomic(settingsPath, updated.value);
      p.log.success('Hook debug tracing enabled');
      p.log.info(color.dim('Remember to disable after debugging: devflow debug --disable'));
      return;
    }

    if (options.disable) {
      const updated = stripDebugTrace(settingsJson);
      if (!updated.ok) {
        p.log.error(describeDebugSettingsError(updated.error));
        process.exitCode = 1;
        return;
      }
      await writeSettingsFileAtomic(settingsPath, updated.value);
      p.log.success('Hook debug tracing disabled');
      return;
    }

    // No option — show usage
    p.log.info('Usage: devflow debug --enable | --disable | --status');
  });
