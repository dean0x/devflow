/**
 * Thin adapter — devflow agents TUI shell over the generic runTui driver.
 *
 * applies ADR-013: impure I/O shell in CLI layer; pure logic lives in state.ts/render.ts.
 * avoids PF-014: all cleanup wired via Promise resolve — never process.exit() inside
 *   a finally-guarded scope. Cleanup is idempotent and runs on save, cancel,
 *   SIGINT, SIGTERM, and keypress limit exhaustion.
 * avoids PF-017: this is the thin adapter, not a copy of the generic shell.
 *
 * Public API (frozen — agents-terminal.test.ts is the acceptance gate):
 *   - runAgentsTui(initialState, io?) → Promise<TuiResult>
 *   - MAX_KEYPRESSES (re-exported from shared shell)
 *   - TuiIO (re-exported from shared shell)
 *   - TuiResult
 *
 * Bounded: MAX_KEYPRESSES = 50_000 hard limit (re-exported from src/cli/tui/terminal.ts).
 */

import { reduce } from './state.js';
import { renderFrame, computeViewportHeight } from './render.js';
import type { AgentsViewState } from './state.js';
import { runTui, type TuiIO } from '../tui/terminal.js';
export { MAX_KEYPRESSES } from '../tui/terminal.js';
export type { TuiIO } from '../tui/terminal.js';
import type { Intent } from './state.js';

// ---------------------------------------------------------------------------
// TuiResult
// ---------------------------------------------------------------------------

export interface TuiResult {
  readonly action: 'save' | 'cancel';
  readonly state: AgentsViewState;
}

// ---------------------------------------------------------------------------
// runAgentsTui
// ---------------------------------------------------------------------------

/**
 * Launch the interactive agents TUI.
 *
 * @param initialState - Initial state built by the agents command.
 * @param io - Optional I/O override (defaults to process.stdin/stdout). Pass fake
 *   streams in tests to drive the TUI without a real TTY.
 * @returns Promise resolving to { action, state } when the user saves or cancels.
 */
export async function runAgentsTui(
  initialState: AgentsViewState,
  io?: Partial<TuiIO>,
): Promise<TuiResult> {
  // C='none' makes runTui return Promise<{ intent: Exclude<Intent,'none'>; state }>.
  // Exclude<Intent,'none'> = 'save' | 'cancel', which matches TuiResult.action exactly —
  // no casts needed, and adding a new Intent member is a compile error here
  // (exhaustiveness enforced at the type level).
  const result = await runTui<AgentsViewState, Intent, 'none'>({
    initialState,
    reduce,
    renderFrame,
    onResize: (state, dims) => ({
      ...state,
      viewportHeight: computeViewportHeight(dims.rows),
    }),
    signalAction: 'cancel',
    continueIntent: 'none',
    io,
  });

  return {
    action: result.intent,
    state: result.state,
  };
}
