import * as path from 'path';
import type { Settings, HookMatcher } from '../utils/hooks.js';

// ─── Dream worker hook utilities ───────────────────────────────────────────
//
// spawn-dream-worker (SessionStart) is always-on, like session-start-context
// (context.ts) and the capture bundle (capture.ts) — registered unconditionally
// by init, removed by uninstall. There is no per-feature toggle at the hook
// registration level: the hook internally gates on the decisions dual-signal
// (dream/config.json's `decisions` field AND the `.devflow/decisions/.disabled`
// sentinel) before deciding whether to spawn background-dream-update. Follows
// the context.ts add/remove/has pattern.

const SPAWN_DREAM_WORKER_MARKER = 'spawn-dream-worker';

/**
 * Add the spawn-dream-worker hook to SessionStart in settings JSON.
 * Idempotent — returns unchanged JSON if hook already present.
 */
export function addDreamHook(settingsJson: string, devflowDir: string): string {
  if (hasDreamHook(settingsJson)) {
    return settingsJson;
  }

  const settings: Settings = JSON.parse(settingsJson);

  if (!settings.hooks) {
    settings.hooks = {};
  }

  const hookCommand = path.join(devflowDir, 'scripts', 'hooks', 'run-hook') + ` ${SPAWN_DREAM_WORKER_MARKER}`;
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
 * Remove the spawn-dream-worker hook from settings JSON.
 * Idempotent — returns unchanged JSON if hook not present.
 * Preserves all other SessionStart hooks (session-start-memory, session-start-context).
 */
export function removeDreamHook(settingsJson: string): string {
  const settings: Settings = JSON.parse(settingsJson);

  if (!settings.hooks?.SessionStart) {
    return settingsJson;
  }

  const before = settings.hooks.SessionStart.length;
  settings.hooks.SessionStart = settings.hooks.SessionStart.filter(
    (matcher) => !matcher.hooks.some((h) => h.command.includes(SPAWN_DREAM_WORKER_MARKER)),
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
 * Check if the spawn-dream-worker hook is present in settings JSON.
 * Accepts either a JSON string or a parsed Settings object.
 */
export function hasDreamHook(input: string | Settings): boolean {
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) : input;
  return settings.hooks?.SessionStart?.some(
    (matcher) => matcher.hooks.some((h) => h.command.includes(SPAWN_DREAM_WORKER_MARKER)),
  ) ?? false;
}
