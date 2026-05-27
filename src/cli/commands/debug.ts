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

export const debugCommand = new Command('debug')
  .description('Toggle hook debug tracing (DEVFLOW_HOOK_DEBUG)')
  .option('--enable', 'Enable debug tracing (DEVFLOW_HOOK_DEBUG=1)')
  .option('--disable', 'Disable debug tracing')
  .option('--status', 'Show debug state and log location')
  .action(async (options: DebugOptions) => {
    const claudeDir = getClaudeDirectory();
    const settingsPath = path.join(claudeDir, 'settings.json');

    // Read current settings
    let settings: Record<string, unknown>;
    try {
      const raw = await fs.readFile(settingsPath, 'utf-8');
      settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      settings = {};
    }

    const env = (settings.env as Record<string, string> | undefined) ?? {};

    if (options.enable) {
      env.DEVFLOW_HOOK_DEBUG = '1';
      settings.env = env;
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
      p.log.success('Hook debug tracing enabled');
      p.log.info(color.dim('Remember to disable after debugging: devflow debug --disable'));
      return;
    }

    if (options.disable) {
      delete env.DEVFLOW_HOOK_DEBUG;
      if (Object.keys(env).length === 0) {
        delete settings.env;
      } else {
        settings.env = env;
      }
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
      p.log.success('Hook debug tracing disabled');
      return;
    }

    if (options.status) {
      const enabled = env.DEVFLOW_HOOK_DEBUG === '1';
      p.log.info(`Debug tracing: ${enabled ? color.green('enabled') : color.dim('disabled')}`);

      // Show per-project log location
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

    // No option — show usage
    p.log.info('Usage: devflow debug --enable | --disable | --status');
  });
