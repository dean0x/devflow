/**
 * Thin impure shell for the devflow agents TUI.
 *
 * applies ADR-013: impure I/O shell in CLI layer; pure logic lives in state.ts/render.ts.
 * avoids PF-014: all cleanup wired via Promise resolve — never process.exit() inside
 *   a finally-guarded scope. Cleanup is idempotent and runs on save, cancel,
 *   SIGINT, SIGTERM, and keypress limit exhaustion.
 *
 * Bounded: MAX_KEYPRESSES = 50_000 hard limit (reliability rule — every loop bounded).
 *
 * Returns a Promise resolving to { action: 'save'|'cancel', state } on any
 * terminal event that terminates the TUI.
 */

import * as readline from 'readline';
import { reduce } from './state.js';
import { renderFrame } from './render.js';
import type { AgentsViewState } from './state.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_KEYPRESSES = 50_000;

/** Non-viewport fixed lines in a rendered frame (see render.ts layout). */
const FIXED_ROWS = 9;

// ---------------------------------------------------------------------------
// Terminal escape sequences
// ---------------------------------------------------------------------------

const ESC = '\x1b';
const ENTER_ALT = `${ESC}[?1049h`;
const LEAVE_ALT = `${ESC}[?1049l`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
/** Move cursor to top-left without clearing (less flicker than full clear). */
const HOME = `${ESC}[H`;
/** Erase from cursor to end of line. */
const ERASE_EOL = `${ESC}[K`;

// ---------------------------------------------------------------------------
// Keypress normalization
// ---------------------------------------------------------------------------

interface ReadlineKey {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}

function normalizeKey(str: string, key: ReadlineKey | null | undefined): string {
  if (key?.ctrl && key.name === 'c') return 'ctrl-c';
  const name = key?.name ?? '';
  switch (name) {
    case 'up':     return 'up';
    case 'down':   return 'down';
    case 'left':   return 'left';
    case 'right':  return 'right';
    case 'tab':    return 'tab';
    case 'return': return 'enter';
    case 'escape': return 'escape';
    case 'space':  return 'space';
    default:
      return str ?? name;
  }
}

// ---------------------------------------------------------------------------
// Dims / viewport
// ---------------------------------------------------------------------------

function getDims(): { rows: number; cols: number } {
  return {
    rows: process.stdout.rows ?? 24,
    cols: process.stdout.columns ?? 80,
  };
}

function computeViewportHeight(termRows: number): number {
  return Math.max(1, termRows - FIXED_ROWS);
}

// ---------------------------------------------------------------------------
// Redraw
// ---------------------------------------------------------------------------

function redraw(state: AgentsViewState): void {
  const dims = getDims();
  const lines = renderFrame(state, dims);

  let out = HOME;
  for (const line of lines) {
    out += line + ERASE_EOL + '\n';
  }
  process.stdout.write(out);
}

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
 * @returns Promise resolving to { action, state } when the user saves or cancels.
 */
export async function runAgentsTui(initialState: AgentsViewState): Promise<TuiResult> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  // ── Enable readline keypress events ─────────────────────────────────────
  readline.emitKeypressEvents(stdin);

  // ── Enter alt-screen, hide cursor ───────────────────────────────────────
  stdout.write(ENTER_ALT + HIDE_CURSOR);

  // ── Raw mode ─────────────────────────────────────────────────────────────
  if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
    stdin.setRawMode(true);
  }
  stdin.resume();

  return new Promise<TuiResult>((resolve) => {
    let state = initialState;
    let cleaned = false;
    let keypressCount = 0;

    // Initial viewport size
    const dims = getDims();
    state = { ...state, viewportHeight: computeViewportHeight(dims.rows) };
    redraw(state);

    // ── Cleanup (idempotent) ───────────────────────────────────────────────
    function cleanup(): void {
      if (cleaned) return;
      cleaned = true;

      stdin.removeListener('keypress', onKeypress);
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      stdout.removeListener('resize', onResize);

      if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
        try { stdin.setRawMode(false); } catch { /* ignore */ }
      }

      stdout.write(LEAVE_ALT + SHOW_CURSOR);
    }

    function settle(result: TuiResult): void {
      cleanup();
      resolve(result);
    }

    // ── Resize handler ─────────────────────────────────────────────────────
    function onResize(): void {
      const d = getDims();
      state = { ...state, viewportHeight: computeViewportHeight(d.rows) };
      redraw(state);
    }

    // ── Keypress handler ───────────────────────────────────────────────────
    function onKeypress(str: string, key: ReadlineKey): void {
      keypressCount++;
      if (keypressCount > MAX_KEYPRESSES) {
        // Hard safety bound — cancel on exhaustion (avoids unbounded event loop)
        settle({ action: 'cancel', state });
        return;
      }

      const normalized = normalizeKey(str, key);
      const { state: next, intent } = reduce(state, normalized);
      state = next;

      switch (intent) {
        case 'save':
          settle({ action: 'save', state });
          return;
        case 'cancel':
          settle({ action: 'cancel', state });
          return;
        case 'none':
          redraw(state);
          return;
        default: {
          const _: never = intent;
          void _;
          redraw(state);
        }
      }
    }

    // ── Signal handlers ────────────────────────────────────────────────────
    function onSigint(): void {
      settle({ action: 'cancel', state });
    }

    function onSigterm(): void {
      settle({ action: 'cancel', state });
    }

    // Register all listeners
    stdin.on('keypress', onKeypress);
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    stdout.on('resize', onResize);
  });
}
