import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getHomeDirectory } from '../utils/paths.js';

interface DebugOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
}

// ─── Pure functions — no I/O, fully testable ─────────────────────────────────

/**
 * Apply DEVFLOW_HOOK_DEBUG=1 to a settings JSON string.
 * Returns a new serialized settings string. Does not mutate.
 * Follows the applyFlags pattern from flags.ts.
 */
export function applyDebugTrace(settingsJson: string): string {
  const settings = JSON.parse(settingsJson) as Record<string, unknown>;
  settings.env ??= {};
  (settings.env as Record<string, unknown>).DEVFLOW_HOOK_DEBUG = '1';
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Remove DEVFLOW_HOOK_DEBUG from a settings JSON string.
 * Removes the env object entirely when it becomes empty.
 * Returns a new serialized settings string. Does not mutate.
 * Follows the stripFlags pattern from flags.ts.
 */
export function stripDebugTrace(settingsJson: string): string {
  const settings = JSON.parse(settingsJson) as Record<string, unknown>;
  const env = settings.env as Record<string, unknown> | undefined;
  if (env) {
    delete env.DEVFLOW_HOOK_DEBUG;
    if (Object.keys(env).length === 0) {
      delete settings.env;
    }
  }
  return JSON.stringify(settings, null, 2) + '\n';
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
      let updated: string;
      try {
        updated = applyDebugTrace(settingsJson);
      } catch {
        p.log.error('settings.json is malformed — fix it before modifying env vars');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');
      p.log.success('Hook debug tracing enabled');
      p.log.info(color.dim('Remember to disable after debugging: devflow debug --disable'));
      return;
    }

    if (options.disable) {
      let updated: string;
      try {
        updated = stripDebugTrace(settingsJson);
      } catch {
        p.log.error('settings.json is malformed — fix it before modifying env vars');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');
      p.log.success('Hook debug tracing disabled');
      return;
    }

    // No option — show usage
    p.log.info('Usage: devflow debug --enable | --disable | --status');
  });
