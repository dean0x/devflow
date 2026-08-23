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

  const result = await runTui<FlagsViewState, FlagsIntent>({
    initialState,
    reduce,
    renderFrame,
    // resizeViewport re-clamps viewportOffset for the new height — setting the
    // height alone can strand the cursor outside the visible slice.
    onResize: (state, dims) => resizeViewport(state, computeViewportHeight(dims.rows)),
    signalAction: 'abort' as FlagsIntent,
    continueIntent: 'none' as FlagsIntent,
    io,
  });

  return {
    action: result.intent as 'save' | 'cancel' | 'abort',
    rows: result.state.rows,
  };
}
