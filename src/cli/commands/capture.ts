import * as path from 'path';
import type { Settings, HookMatcher } from '../utils/hooks.js';

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
// IMPORTANT — Stop-array ordering contract: capture-turn MUST be registered
// BEFORE memory-worker in the Stop hook array (see memory.ts). Settings.json
// hook arrays run in array order, and memory-worker's throttle/spawn decision
// assumes the current turn has already been appended to the queue by
// capture-turn earlier in the same Stop event (append-before-spawn). This
// module only ever pushes capture-turn; callers (init.ts) must register the
// capture bundle before the memory bundle to preserve this ordering.

const CAPTURE_PROMPT_MARKER = 'capture-prompt';
const CAPTURE_TURN_MARKER = 'capture-turn';
const CAPTURE_QUESTION_MARKER = 'capture-question';
const CAPTURE_QUESTION_MATCHER = 'AskUserQuestion';

/**
 * Map of hook event type → filename marker for the capture hooks.
 * Three hooks total: UserPromptSubmit, Stop, PostToolUse (matcher-scoped).
 */
const CAPTURE_HOOK_CONFIG: Record<string, string> = {
  UserPromptSubmit: CAPTURE_PROMPT_MARKER,
  Stop: CAPTURE_TURN_MARKER,
  PostToolUse: CAPTURE_QUESTION_MARKER,
};

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

  if (!settings.hooks) {
    settings.hooks = {};
  }

  for (const [hookType, marker] of Object.entries(CAPTURE_HOOK_CONFIG)) {
    const existing = settings.hooks[hookType] ?? [];
    const alreadyPresent = existing.some((matcher) =>
      matcher.hooks.some((h) => h.command.includes(marker)),
    );

    if (!alreadyPresent) {
      const hookCommand = path.join(devflowDir, 'scripts', 'hooks', 'run-hook') + ` ${marker}`;
      const newEntry: HookMatcher = {
        hooks: [
          {
            type: 'command',
            command: hookCommand,
            timeout: 10,
          },
        ],
      };

      if (hookType === 'PostToolUse') {
        newEntry.matcher = CAPTURE_QUESTION_MATCHER;
      }

      if (!settings.hooks[hookType]) {
        settings.hooks[hookType] = [];
      }

      settings.hooks[hookType].push(newEntry);
    }
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

  if (!settings.hooks) {
    return settingsJson;
  }

  let changed = false;

  for (const [hookType, marker] of Object.entries(CAPTURE_HOOK_CONFIG)) {
    if (!settings.hooks[hookType]) {
      continue;
    }

    const before = settings.hooks[hookType].length;
    settings.hooks[hookType] = settings.hooks[hookType].filter(
      (matcher) => !matcher.hooks.some((h) => h.command.includes(marker)),
    );

    if (settings.hooks[hookType].length !== before) {
      changed = true;
    }

    if (settings.hooks[hookType].length === 0) {
      delete settings.hooks[hookType];
    }
  }

  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
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

  if (!settings.hooks) {
    return 0;
  }

  let count = 0;

  for (const [hookType, marker] of Object.entries(CAPTURE_HOOK_CONFIG)) {
    const matchers = settings.hooks[hookType] ?? [];
    if (matchers.some((matcher) => matcher.hooks.some((h) => h.command.includes(marker)))) {
      count++;
    }
  }

  return count;
}
