import * as path from 'path';
import type { Settings, HookMatcher } from '../../targets/claude-code/hooks.js';

// ─── Context hook utilities ────────────────────────────────────────────────
//
// The session-start-context hook is always-on (registered unconditionally by
// init, removed by uninstall). It has internal sentinel awareness per feature.

const CONTEXT_HOOK_MARKER = 'session-start-context';

/**
 * Add the session-start-context hook to SessionStart in settings JSON.
 * Idempotent — returns unchanged JSON if hook already present.
 */
export function addContextHook(settingsJson: string, devflowDir: string): string {
  if (hasContextHook(settingsJson)) {
    return settingsJson;
  }

  const settings: Settings = JSON.parse(settingsJson);

  if (!settings.hooks) {
    settings.hooks = {};
  }

  const hookCommand = path.join(devflowDir, 'scripts', 'hooks', 'run-hook') + ` ${CONTEXT_HOOK_MARKER}`;
  const newEntry: HookMatcher = {
    hooks: [
      {
        type: 'command',
        command: hookCommand,
        timeout: 10,
      },
    ],
  };

  if (!settings.hooks.SessionStart) {
    settings.hooks.SessionStart = [];
  }

  settings.hooks.SessionStart.push(newEntry);

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Remove the session-start-context hook from settings JSON.
 * Idempotent — returns unchanged JSON if hook not present.
 * Preserves all other SessionStart hooks.
 */
export function removeContextHook(settingsJson: string): string {
  const settings: Settings = JSON.parse(settingsJson);

  if (!settings.hooks?.SessionStart) {
    return settingsJson;
  }

  const before = settings.hooks.SessionStart.length;
  settings.hooks.SessionStart = settings.hooks.SessionStart.filter(
    (matcher) => !matcher.hooks.some((h) => h.command.includes(CONTEXT_HOOK_MARKER)),
  );

  if (settings.hooks.SessionStart.length === before) {
    return settingsJson;
  }

  if (settings.hooks.SessionStart.length === 0) {
    delete settings.hooks.SessionStart;
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Check if the session-start-context hook is present in settings JSON.
 * Accepts either a JSON string or a parsed Settings object.
 */
export function hasContextHook(input: string | Settings): boolean {
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) : input;
  return settings.hooks?.SessionStart?.some(
    (matcher) => matcher.hooks.some((h) => h.command.includes(CONTEXT_HOOK_MARKER)),
  ) ?? false;
}
