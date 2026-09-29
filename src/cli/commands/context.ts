import {
  devflowHookOwner,
  hasHook,
  removeHooks,
  runHookCommand,
  type Settings,
} from '../../targets/claude-code/hooks.js';

// ─── Context hook utilities ────────────────────────────────────────────────
//
// The session-start-context hook is always-on (registered unconditionally by
// init, removed by uninstall). It has internal sentinel awareness per feature.

const CONTEXT_HOOK_MARKER = 'session-start-context';

/**
 * D-EXACT-HOOK-OWNER: the context hook is devflow's only when its command ends in
 * `/scripts/hooks/run-hook session-start-context` (hooks.ts), under any directory.
 * It has been registered through run-hook since it first shipped, so there is no
 * legacy form to recognise.
 */
const isContextHook = devflowHookOwner([CONTEXT_HOOK_MARKER]);

/**
 * Add the session-start-context hook to SessionStart in settings JSON.
 * Idempotent — returns unchanged JSON if hook already present.
 */
export function addContextHook(settingsJson: string, devflowDir: string): string {
  if (hasContextHook(settingsJson)) {
    return settingsJson;
  }

  const settings: Settings = JSON.parse(settingsJson);
  settings.hooks ??= {};
  settings.hooks.SessionStart ??= [];
  settings.hooks.SessionStart.push({
    hooks: [{ type: 'command', command: runHookCommand(devflowDir, CONTEXT_HOOK_MARKER), timeout: 10 }],
  });

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Remove the session-start-context hook from settings JSON.
 * Idempotent — returns unchanged JSON if hook not present.
 * Removes the single hook, so the other hooks of its matcher group and every
 * other SessionStart group stay in place (D-EXACT-HOOK-OWNER).
 */
export function removeContextHook(settingsJson: string): string {
  const settings: Settings = JSON.parse(settingsJson);
  if (!removeHooks(settings, 'SessionStart', isContextHook)) {
    return settingsJson;
  }
  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Check if the session-start-context hook is present in settings JSON.
 * Accepts either a JSON string or a parsed Settings object.
 */
export function hasContextHook(input: string | Settings): boolean {
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) : input;
  return hasHook(settings, 'SessionStart', isContextHook);
}
