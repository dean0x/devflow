import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory } from '../utils/paths.js';

/**
 * The hook entry structure used by Claude Code settings.json.
 */
interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
}

interface HookMatcher {
  hooks: HookEntry[];
}

interface Settings {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

const AMBIENT_HOOK_MARKER = 'ambient-prompt.sh';

/**
 * Add the ambient UserPromptSubmit hook to settings JSON.
 * Idempotent — returns unchanged JSON if hook already exists.
 */
export function addAmbientHook(settingsJson: string, devflowDir: string): string {
  const settings: Settings = JSON.parse(settingsJson);

  if (hasAmbientHook(settingsJson)) {
    return settingsJson;
  }

  if (!settings.hooks) {
    settings.hooks = {};
  }

  const hookCommand = path.join(devflowDir, 'scripts', 'hooks', AMBIENT_HOOK_MARKER);

  const newEntry: HookMatcher = {
    hooks: [
      {
        type: 'command',
        command: hookCommand,
        timeout: 5,
      },
    ],
  };

  if (!settings.hooks.UserPromptSubmit) {
    settings.hooks.UserPromptSubmit = [];
  }

  settings.hooks.UserPromptSubmit.push(newEntry);

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Remove the ambient UserPromptSubmit hook from settings JSON.
 * Idempotent — returns unchanged JSON if hook not present.
 * Preserves other UserPromptSubmit hooks. Cleans empty arrays/objects.
 */
export function removeAmbientHook(settingsJson: string): string {
  const settings: Settings = JSON.parse(settingsJson);

  if (!settings.hooks?.UserPromptSubmit) {
    return settingsJson;
  }

  settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
    (matcher) => !matcher.hooks.some((h) => h.command.includes(AMBIENT_HOOK_MARKER)),
  );

  if (settings.hooks.UserPromptSubmit.length === 0) {
    delete settings.hooks.UserPromptSubmit;
  }

  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Check if the ambient hook is registered in settings JSON.
 */
export function hasAmbientHook(settingsJson: string): boolean {
  const settings: Settings = JSON.parse(settingsJson);

  if (!settings.hooks?.UserPromptSubmit) {
    return false;
  }

  return settings.hooks.UserPromptSubmit.some((matcher) =>
    matcher.hooks.some((h) => h.command.includes(AMBIENT_HOOK_MARKER)),
  );
}

export const ambientCommand = new Command('ambient')
  .description('Enable or disable ambient mode (always-on quality enforcement)')
  .option('--enable', 'Register UserPromptSubmit hook for ambient mode')
  .option('--disable', 'Remove ambient mode hook')
  .option('--status', 'Check if ambient mode is enabled')
  .action(async (options) => {
    const hasFlag = options.enable || options.disable || options.status;
    if (!hasFlag) {
      p.intro(color.bgMagenta(color.white(' Ambient Mode ')));
      p.note(
        `${color.cyan('devflow ambient --enable')}   Register always-on hook\n` +
        `${color.cyan('devflow ambient --disable')}  Remove always-on hook\n` +
        `${color.cyan('devflow ambient --status')}   Check current state`,
        'Usage',
      );
      p.outro(color.dim('Or use /ambient <prompt> for one-shot classification'));
      return;
    }

    const claudeDir = getClaudeDirectory();
    const settingsPath = path.join(claudeDir, 'settings.json');

    let settingsContent: string;
    try {
      settingsContent = await fs.readFile(settingsPath, 'utf-8');
    } catch {
      if (options.status) {
        p.log.info('Ambient mode: disabled (no settings.json found)');
        return;
      }
      // Create minimal settings.json
      settingsContent = '{}';
    }

    if (options.status) {
      const enabled = hasAmbientHook(settingsContent);
      p.log.info(`Ambient mode: ${enabled ? color.green('enabled') : color.dim('disabled')}`);
      return;
    }

    // Resolve devflow scripts directory from settings.json hooks or default
    let devflowDir: string;
    try {
      const settings = JSON.parse(settingsContent);
      // Try to extract devflowDir from existing hooks (e.g., Stop hook path)
      const stopHook = settings.hooks?.Stop?.[0]?.hooks?.[0]?.command;
      if (stopHook) {
        // e.g., /Users/dean/.devflow/scripts/hooks/stop-update-memory.sh → /Users/dean/.devflow
        devflowDir = path.resolve(stopHook, '..', '..', '..');
      } else {
        devflowDir = path.join(process.env.HOME || '~', '.devflow');
      }
    } catch {
      devflowDir = path.join(process.env.HOME || '~', '.devflow');
    }

    if (options.enable) {
      const updated = addAmbientHook(settingsContent, devflowDir);
      if (updated === settingsContent) {
        p.log.info('Ambient mode already enabled');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');
      p.log.success('Ambient mode enabled — UserPromptSubmit hook registered');
      p.log.info(color.dim('Every prompt will now be classified for proportional quality enforcement'));
    }

    if (options.disable) {
      const updated = removeAmbientHook(settingsContent);
      if (updated === settingsContent) {
        p.log.info('Ambient mode already disabled');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');
      p.log.success('Ambient mode disabled — hook removed');
    }
  });
