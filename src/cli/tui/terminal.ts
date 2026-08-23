/**
 * Generic TUI shell — shared by agents-view and flags-view.
 *
 * applies ADR-013: impure I/O shell in CLI layer; pure logic lives in state + render.
 * avoids PF-014: cleanup wired via Promise resolve — never process.exit() inside
 *   a finally-guarded scope.
 * avoids PF-017: generify here, thin adapters per TUI — not copy-adapt (agents-view
 *   was the source; this is the generalisation).
 *
 * Bounded: MAX_KEYPRESSES = 50_000 hard limit (reliability rule — every loop bounded).
 *
 * Frame output contract (avoids stale-frame ghosting on terminal shrink):
 *   - Each frame line ends with ERASE_EOL (clears to end of line).
 *   - Lines are joined with '\n' EXCEPT the last, which has no trailing '\n'.
 *   - ERASE_BELOW (ESC[0J) is appended after the last line to erase content below
 *     the frame on every redraw.
 */

import * as readline from 'readline';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard upper bound on keypress events — resolves with signalAction on exhaustion. */
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
/** Erase from cursor to end of screen. */
const ERASE_BELOW = `${ESC}[0J`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReadlineKey {
  name?: string;
  ctrl?: boolean;
  sequence?: string;
}

/** Terminal dimensions. */
export interface RenderDims {
  readonly rows: number;
  readonly cols: number;
}

/**
 * Minimal stdin/stdout surface required by the TUI shell.
 * Exposed so tests can pass fake streams without a real TTY.
 *
 * `stdin` is typed as `NodeJS.ReadableStream` (extends `NodeJS.EventEmitter`)
 * so `readline.emitKeypressEvents` accepts it directly.
 * `PassThrough` and other `Readable` subclasses satisfy this interface.
 */
export interface TuiIO {
  stdin: NodeJS.ReadableStream & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  stdout: NodeJS.EventEmitter & {
    rows?: number;
    columns?: number;
    write(data: string, cb?: (err?: Error | null) => void): boolean;
  };
}

/**
 * Spec object for runTui. All pure functions; I/O only via `io`.
 *
 * @template S  TUI state type.
 * @template A  Intent type (e.g. 'none' | 'save' | 'cancel').
 */
export interface RunTuiSpec<S, A> {
  /** Initial state before the first frame renders. */
  initialState: S;
  /** Pure keypress reducer — returns next state and intent. */
  reduce: (state: S, key: string) => { state: S; intent: A };
  /** Pure frame renderer — returns one string per terminal line (no newlines in strings). */
  renderFrame: (state: S, dims: RenderDims) => string[];
  /**
   * Called on terminal resize AND once at startup with the current terminal dims.
   * Returns a new state (typically with updated viewportHeight).
   * Optional — when absent, state is unchanged on resize.
   */
  onResize?: (state: S, dims: RenderDims) => S;
  /**
   * The intent to return when a signal (SIGINT/SIGTERM) or MAX_KEYPRESSES
   * exhaustion forces exit. Typically 'cancel' or 'abort'.
   */
  signalAction: A;
  /**
   * The intent value that means "keep running — redraw and wait for the next key".
   * Any other value from reduce causes the TUI to resolve.
   */
  continueIntent: A;
  /** Optional I/O override (defaults to process.stdin/stdout). Inject fakes in tests. */
  io?: Partial<TuiIO>;
}

// ---------------------------------------------------------------------------
// Keypress normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a readline keypress event to a canonical key string.
 *
 * Gains backspace/delete/home/end (were leaking raw bytes in agents-view).
 */
export function normalizeKey(str: string, key: ReadlineKey | null | undefined): string {
  if (key?.ctrl && key.name === 'c') return 'ctrl-c';
  const name = key?.name ?? '';
  switch (name) {
    case 'up':        return 'up';
    case 'down':      return 'down';
    case 'left':      return 'left';
    case 'right':     return 'right';
    case 'tab':       return 'tab';
    case 'return':    return 'enter';
    case 'escape':    return 'escape';
    case 'space':     return 'space';
    case 'backspace': return 'backspace';
    case 'delete':    return 'delete';
    case 'home':      return 'home';
    case 'end':       return 'end';
    default:
      return str ?? name;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getDims(stdout: TuiIO['stdout']): RenderDims {
  return {
    rows: stdout.rows ?? 24,
    cols: stdout.columns ?? 80,
  };
}

/**
 * Write a complete frame to stdout.
 *
 * Frame output contract:
 *   HOME + each_line + ERASE_EOL + '\n' (except no '\n' after last line) + ERASE_BELOW
 *
 * ERASE_BELOW clears stale content below the frame when the terminal shrinks.
 * No trailing '\n' on the last line keeps the cursor on that line so ERASE_BELOW
 * erases exactly from the last data row to the bottom.
 */
function renderToStdout<S>(
  state: S,
  stdout: TuiIO['stdout'],
  renderFrame: (state: S, dims: RenderDims) => string[],
): void {
  const dims = getDims(stdout);
  const lines = renderFrame(state, dims);

  let out = HOME;
  for (let i = 0; i < lines.length; i++) {
    out += lines[i] + ERASE_EOL;
    if (i < lines.length - 1) out += '\n';
  }
  out += ERASE_BELOW;
  stdout.write(out);
}

// ---------------------------------------------------------------------------
// runTui — generic driver
// ---------------------------------------------------------------------------

/**
 * Launch a generic interactive TUI.
 *
 * The TUI enters alt-screen, hides the cursor, enables raw mode, and begins
 * processing keypresses via the provided `spec.reduce` function.
 *
 * Resolves when `reduce` returns an intent !== `spec.continueIntent`, when a
 * signal fires, or when MAX_KEYPRESSES is exhausted.
 *
 * @returns Promise resolving to `{ intent, state }` at exit.
 */
export async function runTui<S, A>(spec: RunTuiSpec<S, A>): Promise<{ intent: A; state: S }> {
  // D-SEAM: default to process streams; callers (tests) may inject fakes.
  const stdin: TuiIO['stdin'] = (spec.io?.stdin ?? process.stdin) as TuiIO['stdin'];
  const stdout: TuiIO['stdout'] = (spec.io?.stdout ?? process.stdout) as TuiIO['stdout'];

  // ── Enable readline keypress events ─────────────────────────────────────
  readline.emitKeypressEvents(stdin);

  // ── Enter alt-screen, hide cursor ───────────────────────────────────────
  stdout.write(ENTER_ALT + HIDE_CURSOR);

  // ── Raw mode ─────────────────────────────────────────────────────────────
  if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
    stdin.setRawMode(true);
  }
  stdin.resume();

  return new Promise<{ intent: A; state: S }>((resolve) => {
    let state = spec.initialState;
    let cleaned = false;
    let keypressCount = 0;

    // Apply initial resize (sets viewportHeight from actual terminal dims)
    const initialDims = getDims(stdout);
    if (spec.onResize) {
      state = spec.onResize(state, initialDims);
    }
    renderToStdout(state, stdout, spec.renderFrame);

    // ── Cleanup (idempotent) ────────────────────────────────────────────────
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
      // at startup. Without this the resumed stdin keeps the event loop alive
      // and the CLI hangs after the TUI resolves.
      stdin.pause();

      stdout.write(LEAVE_ALT + SHOW_CURSOR);
    }

    function settle(intent: A, finalState: S): void {
      cleanup();
      resolve({ intent, state: finalState });
    }

    // ── Resize handler ─────────────────────────────────────────────────────
    function onResize(): void {
      const d = getDims(stdout);
      if (spec.onResize) {
        state = spec.onResize(state, d);
      }
      renderToStdout(state, stdout, spec.renderFrame);
    }

    // ── Keypress handler ───────────────────────────────────────────────────
    function onKeypress(str: string, key: ReadlineKey): void {
      keypressCount++;
      if (keypressCount > MAX_KEYPRESSES) {
        // Hard safety bound — exit on exhaustion (avoids unbounded event loop).
        settle(spec.signalAction, state);
        return;
      }

      const normalized = normalizeKey(str, key);
      const { state: next, intent } = spec.reduce(state, normalized);
      state = next;

      if (intent !== spec.continueIntent) {
        settle(intent, state);
        return;
      }
      renderToStdout(state, stdout, spec.renderFrame);
    }

    // ── Signal handlers ────────────────────────────────────────────────────
    function onSigint(): void {
      settle(spec.signalAction, state);
    }

    function onSigterm(): void {
      settle(spec.signalAction, state);
    }

    // Register all listeners
    stdin.on('keypress', onKeypress);
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);
    stdout.on('resize', onResize);
  });
}
