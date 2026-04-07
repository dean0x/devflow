import { Command } from 'commander';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as p from '@clack/prompts';
import color from 'picocolors';
import { getClaudeDirectory, getDevFlowDirectory } from '../utils/paths.js';
import type { HookMatcher, Settings } from '../utils/hooks.js';

const PREAMBLE_HOOK_MARKER = 'preamble';
const LEGACY_HOOK_MARKER = 'ambient-prompt';
const CLASSIFICATION_HOOK_MARKER = 'session-start-classification';

/** Filter hook entries from a parsed Settings object for a given event. Returns true if any were removed. */
function filterHookEntries(
  settings: Settings,
  eventName: string,
  shouldRemove: (matcher: HookMatcher) => boolean,
): boolean {
  if (!settings.hooks?.[eventName]) return false;

  const before = settings.hooks[eventName].length;
  settings.hooks[eventName] = settings.hooks[eventName].filter(
    (matcher) => !shouldRemove(matcher),
  );

  if (settings.hooks[eventName].length === before) return false;

  if (settings.hooks[eventName].length === 0) {
    delete settings.hooks[eventName];
  }
  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }
  return true;
}

const isLegacy = (matcher: HookMatcher) =>
  matcher.hooks.some((h) => h.command.includes(LEGACY_HOOK_MARKER));

const isAmbient = (matcher: HookMatcher) =>
  matcher.hooks.some((h) =>
    h.command.includes(PREAMBLE_HOOK_MARKER) || h.command.includes(LEGACY_HOOK_MARKER),
  );

const isClassification = (matcher: HookMatcher) =>
  matcher.hooks.some((h) => h.command.includes(CLASSIFICATION_HOOK_MARKER));

/**
 * Remove only the legacy `ambient-prompt` hook entries.
 * Used by `addAmbientHook` to clean before adding the new preamble hook.
 */
export function removeLegacyAmbientHook(settingsJson: string): string {
  const settings: Settings = JSON.parse(settingsJson);
  if (!filterHookEntries(settings, 'UserPromptSubmit', isLegacy)) return settingsJson;
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Add the ambient UserPromptSubmit hook and SessionStart classification hook to settings JSON.
 * Removes any legacy `ambient-prompt` hook first, then adds the new `preamble` hook.
 * Also adds the SessionStart classification hook (reads router SKILL.md).
 * Idempotent — each hook checked independently.
 */
export function addAmbientHook(settingsJson: string, devflowDir: string): string {
  const settings: Settings = JSON.parse(settingsJson);
  let changed = filterHookEntries(settings, 'UserPromptSubmit', isLegacy);

  if (!settings.hooks) {
    settings.hooks = {};
  }

  // --- UserPromptSubmit: preamble hook ---
  const hasPreamble = settings.hooks.UserPromptSubmit?.some((m) =>
    m.hooks.some((h) => h.command.includes(PREAMBLE_HOOK_MARKER)),
  );

  if (!hasPreamble) {
    if (!settings.hooks.UserPromptSubmit) {
      settings.hooks.UserPromptSubmit = [];
    }

    settings.hooks.UserPromptSubmit.push({
      hooks: [
        {
          type: 'command',
          command: path.join(devflowDir, 'scripts', 'hooks', 'run-hook') + ' preamble',
          timeout: 5,
        },
      ],
    });
    changed = true;
  }

  // --- SessionStart: classification hook ---
  const hasClassificationHook = settings.hooks.SessionStart?.some((m) =>
    m.hooks.some((h) => h.command.includes(CLASSIFICATION_HOOK_MARKER)),
  );

  if (!hasClassificationHook) {
    if (!settings.hooks.SessionStart) {
      settings.hooks.SessionStart = [];
    }

    settings.hooks.SessionStart.push({
      hooks: [
        {
          type: 'command',
          command: path.join(devflowDir, 'scripts', 'hooks', 'run-hook') + ' session-start-classification',
          timeout: 5,
        },
      ],
    });
    changed = true;
  }

  if (!changed) return settingsJson;
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Remove the ambient hooks from settings JSON.
 * Removes preamble + legacy from UserPromptSubmit, and classification from SessionStart.
 * Idempotent — returns unchanged JSON if hooks not present.
 * Preserves other hooks. Cleans empty arrays/objects.
 */
export function removeAmbientHook(settingsJson: string): string {
  const settings: Settings = JSON.parse(settingsJson);
  const removedPrompt = filterHookEntries(settings, 'UserPromptSubmit', isAmbient);
  const removedClassification = filterHookEntries(settings, 'SessionStart', isClassification);

  if (!removedPrompt && !removedClassification) return settingsJson;
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Check if the ambient hook (legacy or current) is registered in settings JSON.
 */
export function hasAmbientHook(settingsJson: string): boolean {
  const settings: Settings = JSON.parse(settingsJson);

  const hasPreamble = settings.hooks?.UserPromptSubmit?.some((matcher) =>
    matcher.hooks.some((h) =>
      h.command.includes(PREAMBLE_HOOK_MARKER) || h.command.includes(LEGACY_HOOK_MARKER),
    ),
  ) ?? false;

  const hasClassificationHook = settings.hooks?.SessionStart?.some((matcher) =>
    isClassification(matcher),
  ) ?? false;

  return hasPreamble || hasClassificationHook;
}

interface AmbientOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
}

export const ambientCommand = new Command('ambient')
  .description('Enable or disable ambient mode (always-on quality enforcement)')
  .option('--enable', 'Register ambient mode hooks')
  .option('--disable', 'Remove ambient mode hooks')
  .option('--status', 'Check if ambient mode is enabled')
  .action(async (options: AmbientOptions) => {
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
      const settings: Settings = JSON.parse(settingsContent);
      // Try to extract devflowDir from existing hooks (e.g., Stop hook path)
      const stopHook = settings.hooks?.Stop?.[0]?.hooks?.[0]?.command;
      if (stopHook) {
        const hookBinary = stopHook.split(' ')[0];
        devflowDir = path.resolve(hookBinary, '..', '..', '..');
      } else {
        devflowDir = getDevFlowDirectory();
      }
    } catch {
      devflowDir = getDevFlowDirectory();
    }

    if (options.enable) {
      const updated = addAmbientHook(settingsContent, devflowDir);
      if (updated === settingsContent) {
        p.log.info('Ambient mode already enabled');
        return;
      }
      await fs.writeFile(settingsPath, updated, 'utf-8');
      p.log.success('Ambient mode enabled — hooks registered');
      p.log.info(color.dim('Skills auto-load and agents orchestrate based on each prompt'));
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
