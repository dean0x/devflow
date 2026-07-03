import type { Settings, HookMatcher } from '../utils/hooks.js';

// ─── Dream worker hook cleanup ──────────────────────────────────────────────
//
// The spawn-dream-worker SessionStart hook belonged to the retired detached
// dream worker. Decisions processing runs as the directive-spawned Dream agent
// (session-start-context Section 2), which needs no hook registration of its
// own. remove/has exist for upgrade cleanup: init and uninstall strip any
// stale entry left in settings.json by a prior install.

const SPAWN_DREAM_WORKER_MARKER = 'spawn-dream-worker';

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
    (matcher: HookMatcher) => !matcher.hooks.some((h) => h.command.includes(SPAWN_DREAM_WORKER_MARKER)),
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
