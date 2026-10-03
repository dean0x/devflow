import {
  devflowHookOwner,
  ensureHook,
  hasHook,
  removeHooks,
  runHookCommand,
  type HookMatcher,
  type HookPredicate,
  type Settings,
} from '../../targets/claude-code/hooks.js';

// ─── Capture hook utilities ────────────────────────────────────────────────
//
// The capture bundle (capture-prompt, capture-turn, capture-question) is
// always-on, like session-start-context (context.ts) — registered
// unconditionally by init, removed by uninstall. There is no per-feature
// toggle: capture hooks only append to the memory/learning queues, gated
// per-queue internally by each script's own feature-config read (see
// queue-append's queue_read_gates). Follows the context.ts add/remove/has
// pattern rather than memory.ts's toggle pattern.
//
// Stop-event concurrency contract: Claude Code runs the hooks of one event in
// parallel, so array position in settings.json orders nothing at run time —
// memory-worker can spawn background-memory-update before capture-turn has
// appended this turn's assistant row. The worker tolerates that: a queue that
// holds only user rows is left in place and the LLM run skipped
// (D-QUEUE-NO-ORPHAN-DELETE in background-memory-update), so the next run
// takes the whole turn. init.ts still registers the capture bundle before the
// memory bundle, which keeps settings.json stable across re-inits.

const CAPTURE_PROMPT_MARKER = 'capture-prompt';
const CAPTURE_TURN_MARKER = 'capture-turn';
const CAPTURE_QUESTION_MARKER = 'capture-question';
const CAPTURE_QUESTION_MATCHER = 'AskUserQuestion';

/**
 * Map of hook event type → run-hook marker for the capture hooks.
 * Three hooks total: UserPromptSubmit, Stop, PostToolUse (matcher-scoped).
 */
const CAPTURE_HOOK_CONFIG: Record<string, string> = {
  UserPromptSubmit: CAPTURE_PROMPT_MARKER,
  Stop: CAPTURE_TURN_MARKER,
  PostToolUse: CAPTURE_QUESTION_MARKER,
};

/**
 * D-EXACT-HOOK-OWNER: a capture hook is devflow's only when its command ends in
 * `/scripts/hooks/run-hook <marker>` (hooks.ts), under any directory. The capture
 * hooks have been registered through run-hook since they first shipped, so there
 * is no legacy form to recognise.
 */
function isCaptureHook(marker: string): HookPredicate {
  return devflowHookOwner([marker]);
}

/**
 * Add all 3 capture hooks (UserPromptSubmit, Stop, PostToolUse) to settings JSON.
 * Idempotent — skips hooks that already exist. Returns unchanged JSON if all 3 present.
 * The PostToolUse entry is scoped with `matcher: "AskUserQuestion"` so it only fires
 * for AskUserQuestion tool calls.
 */
export function addCaptureHooks(settingsJson: string, devflowDir: string): string {
  const settings: Settings = JSON.parse(settingsJson);

  if (hasCaptureHooks(settings)) {
    return settingsJson;
  }

  for (const [hookType, marker] of Object.entries(CAPTURE_HOOK_CONFIG)) {
    const newEntry: HookMatcher = {
      hooks: [{ type: 'command', command: runHookCommand(devflowDir, marker), timeout: 10 }],
    };
    if (hookType === 'PostToolUse') {
      newEntry.matcher = CAPTURE_QUESTION_MATCHER;
    }
    ensureHook(settings, hookType, isCaptureHook(marker), newEntry);
  }

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Remove all capture hooks (UserPromptSubmit, Stop, PostToolUse) from settings JSON.
 * Accepts either a JSON string or a parsed Settings object.
 * Idempotent — returns unchanged JSON if no capture hooks present.
 * Preserves non-capture hooks (e.g. ambient preamble on UserPromptSubmit, memory-worker on Stop).
 */
export function removeCaptureHooks(input: string | Settings): string {
  // No-change return must match the formatted style of the mutating return
  // below (2-space indent + trailing newline) so object callers can't
  // observe a different representation depending on whether a change
  // happened. String input is returned byte-identical (no re-formatting).
  const settingsJson =
    typeof input === 'string' ? input : JSON.stringify(input, null, 2) + '\n';
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) : structuredClone(input);

  let changed = false;
  for (const [hookType, marker] of Object.entries(CAPTURE_HOOK_CONFIG)) {
    // Evaluate every removal — never short-circuit.
    const removed = removeHooks(settings, hookType, isCaptureHook(marker));
    changed = changed || removed;
  }

  if (!changed) {
    return settingsJson;
  }

  return JSON.stringify(settings, null, 2) + '\n';
}

/**
 * Check if ALL 3 capture hooks are registered in settings JSON or parsed Settings object.
 */
export function hasCaptureHooks(input: string | Settings): boolean {
  return countCaptureHooks(input) === Object.keys(CAPTURE_HOOK_CONFIG).length;
}

/**
 * Count how many of the 3 capture hooks are present (0-3).
 * Accepts either a JSON string or a parsed Settings object.
 */
export function countCaptureHooks(input: string | Settings): number {
  const settings: Settings = typeof input === 'string' ? JSON.parse(input) : input;

  let count = 0;
  for (const [hookType, marker] of Object.entries(CAPTURE_HOOK_CONFIG)) {
    if (hasHook(settings, hookType, isCaptureHook(marker))) count++;
  }

  return count;
}
