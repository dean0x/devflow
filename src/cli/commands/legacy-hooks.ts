import {
  devflowHookOwner,
  hasHook,
  removeHooks,
  type Settings,
} from '../../targets/claude-code/hooks.js';

// ─── Dream worker hook cleanup ──────────────────────────────────────────────
//
// The spawn-dream-worker SessionStart hook belonged to the retired detached
// dream worker. Decisions processing runs as the directive-spawned Learning agent
// (session-start-context Section 2), which needs no hook registration of its
// own. remove/has exist for upgrade cleanup: init and uninstall strip any
// stale entry left in settings.json by a prior install.

const SPAWN_DREAM_WORKER_MARKER = 'spawn-dream-worker';

/**
 * D-EXACT-HOOK-OWNER: the dream-worker hook is devflow's only when its command
 * ends in `/scripts/hooks/run-hook spawn-dream-worker` (hooks.ts), under any
 * directory — the one form it was ever registered in.
 */
const isDreamHook = devflowHookOwner([SPAWN_DREAM_WORKER_MARKER]);

/**
 * Remove the spawn-dream-worker hook from settings JSON.
 * Idempotent — returns unchanged JSON if hook not present.
 * Removes the single hook, so the other hooks of its matcher group and every
 * other SessionStart group (session-start-memory, session-start-context) stay in place.
 */
export function removeDreamHook(settingsJson: string): string {
  const settings: Settings = JSON.parse(settingsJson);
  if (!removeHooks(settings, 'SessionStart', isDreamHook)) {
    return settingsJson;
  }
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Check if the spawn-dream-worker hook is present in settings JSON.
 * Accepts either a JSON string or a parsed Settings object.
 */
export function hasDreamHook(input: string | Settings): boolean {
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) : input;
  return hasHook(settings, 'SessionStart', isDreamHook);
}
