/**
 * Thin adapter — devflow flags TUI shell over the generic runTui driver.
 *
 * applies ADR-013: impure I/O shell in CLI layer; pure logic lives in state.ts/render.ts.
 * avoids PF-014: cleanup wired via Promise resolve — never process.exit() inside
 *   a finally-guarded scope.
 * avoids PF-017: thin adapter over the generic shell (src/cli/tui/terminal.ts).
 *
 * Public API:
 *   - runFlagsTui(initialRows, io?) → Promise<FlagsTuiResult>
 *
 * Bounded: MAX_KEYPRESSES = 50_000 hard limit (re-exported from src/cli/tui/terminal.ts).
 */

import { reduce, resizeViewport } from './state.js';
import { renderFrame, computeViewportHeight } from './render.js';
import type { FlagsViewState, FlagRow } from './state.js';
import type { FlagsIntent } from './state.js';
import { runTui, type TuiIO } from '../tui/terminal.js';

export { MAX_KEYPRESSES } from '../tui/terminal.js';
export type { TuiIO } from '../tui/terminal.js';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * The result returned by runFlagsTui when the user exits the TUI.
 *
 *   save   — user pressed enter to persist; rows contain the final flag values.
 *   cancel — user pressed esc or q; values unchanged from initial rows.
 *   abort  — user pressed ctrl-c or triggered an OS interrupt; terminal is
 *            restored and the process should exit (load-bearing distinction
 *            at the init.ts consumer, which treats abort as a process exit signal
 *            and cancel as "no changes, continue the wizard").
 *
 * `rows` is always the final TUI row state; the action discriminant tells
 * the caller whether to persist the values or discard them.
 */
export interface FlagsTuiResult {
  readonly action: 'save' | 'cancel' | 'abort';
  readonly rows: readonly FlagRow[];
}

// ---------------------------------------------------------------------------
// runFlagsTui
// ---------------------------------------------------------------------------

/**
 * Launch the interactive flags TUI.
 *
 * @param initialRows - Initial flag rows (built by buildFlagRows).
 * @param io - Optional I/O override (defaults to process.stdin/stdout). Pass fake
 *   streams in tests to drive the TUI without a real TTY.
 * @returns Promise resolving to { action, rows } when the user saves, cancels, or aborts.
 */
export async function runFlagsTui(
  initialRows: readonly FlagRow[],
  io?: Partial<TuiIO>,
): Promise<FlagsTuiResult> {
  const initialState: FlagsViewState = {
    rows: initialRows,
    cursor: 0,
    viewportOffset: 0,
    // Placeholder height — onResize overwrites this at startup with actual terminal dims
    viewportHeight: 10,
    editing: null,
  };

  // C='none' makes runTui return Promise<{ intent: Exclude<FlagsIntent,'none'>; state }>.
  // Exclude<FlagsIntent,'none'> = 'save' | 'cancel' | 'abort', which matches
  // FlagsTuiResult.action exactly — no casts needed, and adding a new FlagsIntent member
  // is a compile error here (exhaustiveness enforced at the type level).
  //
  // D-INLINE: flags editor uses inline mode — renders in-place in the scroll buffer
  // without entering the alt screen. This is friendlier for devflow init's wizard
  // context where the flags editor is embedded in a multi-step interactive flow.
  const result = await runTui<FlagsViewState, FlagsIntent, 'none'>({
    initialState,
    reduce,
    renderFrame,
    // resizeViewport re-clamps viewportOffset for the new height — setting the
    // height alone can strand the cursor outside the visible slice.
    onResize: (state, dims) => resizeViewport(state, computeViewportHeight(dims.rows)),
    signalAction: 'abort',
    continueIntent: 'none',
    screen: 'inline',
    io,
  });

  return {
    action: result.intent,
    rows: result.state.rows,
  };
}
