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
import { renderFrame, FIXED_ROWS, computeViewportHeight } from './render.js';
import type { AgentsViewState } from './state.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard upper bound on keypress events — resolves with 'cancel' on exhaustion. */
export const MAX_KEYPRESSES = 50_000;

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
// Optional I/O injection (for testing)
// ---------------------------------------------------------------------------

/**
 * Minimal stdin/stdout surface required by the TUI shell.
 * Default values are process.stdin/stdout. Exposed so tests can pass fake streams.
 */
export interface TuiIO {
  stdin: NodeJS.EventEmitter & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => void;
    resume(): void;
    pause(): void;
  };
  stdout: NodeJS.EventEmitter & {
    rows?: number;
    columns?: number;
    write(data: string, cb?: (err?: Error | null) => void): boolean;
  };
}

// ---------------------------------------------------------------------------
// Dims / viewport
// ---------------------------------------------------------------------------

function getDims(stdout: TuiIO['stdout']): { rows: number; cols: number } {
  return {
    rows: stdout.rows ?? 24,
    cols: stdout.columns ?? 80,
  };
}

// ---------------------------------------------------------------------------
// Redraw
// ---------------------------------------------------------------------------

function redraw(state: AgentsViewState, stdout: TuiIO['stdout']): void {
  const dims = getDims(stdout);
  const lines = renderFrame(state, dims);

  let out = HOME;
  for (const line of lines) {
    out += line + ERASE_EOL + '\n';
  }
  stdout.write(out);
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
 * @param io - Optional I/O override (defaults to process.stdin/stdout). Pass fake
 *   streams in tests to drive the TUI without a real TTY.
 * @returns Promise resolving to { action, state } when the user saves or cancels.
 */
export async function runAgentsTui(
  initialState: AgentsViewState,
  io?: Partial<TuiIO>,
): Promise<TuiResult> {
  // D-SEAM: default to process.stdin/stdout; callers (tests) may inject fakes.
  const stdin: TuiIO['stdin'] = (io?.stdin ?? process.stdin) as TuiIO['stdin'];
  const stdout: TuiIO['stdout'] = (io?.stdout ?? process.stdout) as TuiIO['stdout'];

  // ── Enable readline keypress events ─────────────────────────────────────
  // Cast required: readline expects NodeJS.ReadableStream; real stdin and test
  // PassThrough streams both satisfy it at runtime.
  readline.emitKeypressEvents(stdin as unknown as NodeJS.ReadableStream);

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
    const dims = getDims(stdout);
    state = { ...state, viewportHeight: computeViewportHeight(dims.rows) };
    redraw(state, stdout);

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

      // Pause stdin to release the ref'd TTY handle — mirrors the stdin.resume()
      // at startup. Without this the resumed stdin keeps the event loop alive and
      // the CLI (which has no forced process.exit) hangs after the TUI resolves.
      stdin.pause();

      stdout.write(LEAVE_ALT + SHOW_CURSOR);
    }

    function settle(result: TuiResult): void {
      cleanup();
      resolve(result);
    }

    // ── Resize handler ─────────────────────────────────────────────────────
    function onResize(): void {
      const d = getDims(stdout);
      state = { ...state, viewportHeight: computeViewportHeight(d.rows) };
      redraw(state, stdout);
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
          redraw(state, stdout);
          return;
        default: {
          const _: never = intent;
          void _;
          redraw(state, stdout);
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
