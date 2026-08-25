/**
 * Generic TUI shell — shared by agents-view and flags-view.
 *
 * applies ADR-013: impure I/O shell in CLI layer; pure logic lives in state + render.
 * avoids PF-014: cleanup wired via Promise resolve — never process.exit() inside
 *   a finally-guarded scope.
 * avoids PF-017: one generic shell, thin adapters per TUI — not copy-adapted per consumer.
 *
 * Bounded: MAX_KEYPRESSES = 50_000 hard limit (reliability rule — every loop bounded).
 *
 * Frame output contract — alt mode (avoids stale-frame ghosting on terminal shrink):
 *   - Each frame line ends with ERASE_EOL (clears to end of line).
 *   - Lines are joined with '\n' EXCEPT the last, which has no trailing '\n'.
 *   - ERASE_BELOW (ESC[0J) is appended after the last line to erase content below
 *     the frame on every redraw.
 *
 * Frame output contract — inline mode (D-INLINE):
 *   - No ENTER_ALT/LEAVE_ALT; renders in place in the normal scroll buffer.
 *   - First frame: write lines directly, track prevLineCount.
 *   - Subsequent frames: cursor-up (prevLineCount-1) + \r, rewrite lines, ERASE_BELOW.
 *   - Exit: cursor-up to frame top, ERASE_BELOW, SHOW_CURSOR — erases widget completely.
 *   - Height is clamped to stdout.rows - INLINE_MARGIN to prevent terminal scroll.
 */

import * as readline from 'readline';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard upper bound on keypress events — resolves with signalAction on exhaustion. */
export const MAX_KEYPRESSES = 50_000;

/**
 * Lines reserved below the inline widget so the shell prompt is never clobbered.
 * D-INLINE: height clamped to stdout.rows - INLINE_MARGIN in inline mode.
 */
export const INLINE_MARGIN = 2;

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
/**
 * Move cursor up N lines (D-INLINE: used by inline-mode repaints).
 * Returns an empty string for n ≤ 0 so callers need no guard.
 */
const cursorUp = (n: number): string => (n > 0 ? `${ESC}[${n}A` : '');

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
 * @template A  Full intent union (e.g. `'none' | 'save' | 'cancel'`). Must extend string
 *              so the `!==` comparison in the driver is always a string equality check.
 * @template C  The "continue" intent — the member of A that means "keep running".
 *              `extends A` enforces it is a valid member of the union.
 *
 * D-TS: the three-generic form makes `runTui`'s return type carry the invariant that
 * the resolved intent is never `continueIntent`:
 *   Promise<{ intent: Exclude<A, C>; state: S }>
 * Adding a new member to A without updating the adapter's result type is a compile error.
 */
export interface RunTuiSpec<S, A extends string, C extends A> {
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
   * exhaustion forces exit. Typed as `Exclude<A, C>` — it can never be the
   * continue intent, so the constraint is expressed in the type. Typically 'cancel' or 'abort'.
   */
  signalAction: Exclude<A, C>;
  /**
   * The intent value that means "keep running — redraw and wait for the next key".
   * Any other value from reduce causes the TUI to resolve.
   * Typed as `C` (the continue-intent parameter) so adapters need no casts.
   */
  continueIntent: C;
  /** Optional I/O override (defaults to process.stdin/stdout). Inject fakes in tests. */
  io?: Partial<TuiIO>;
  /**
   * Screen mode:
   *   'alt'    — enter the alternate screen buffer (default; agents-view uses this).
   *   'inline' — render in-place in the normal scroll buffer with cursor-up repaints;
   *              no ENTER_ALT/LEAVE_ALT; erases widget on exit; height clamped to
   *              stdout.rows - INLINE_MARGIN. D-INLINE: flags editor uses inline mode.
   */
  screen?: 'alt' | 'inline';
}

// ---------------------------------------------------------------------------
// Keypress normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a readline keypress event to a canonical key string.
 * Maps backspace/delete/home/end to named tokens (raw bytes otherwise).
 */
export function normalizeKey(str: string | undefined, key: ReadlineKey | null | undefined): string {
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
  // D-REL-M1: clamp to terminal height so HOME-anchored redraws never desync
  // on small panes. max(1, …) ensures at least one line is always written.
  const lines = renderFrame(state, dims).slice(0, Math.max(1, dims.rows));

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
 * In 'alt' mode (default): enters the alternate screen buffer, hides the cursor,
 * enables raw mode, and redraws by moving to HOME on each keypress.
 *
 * In 'inline' mode (D-INLINE): renders in-place in the normal scroll buffer.
 * Repaints use cursor-up instead of ENTER_ALT/HOME. Height is clamped to
 * stdout.rows - INLINE_MARGIN. Widget is erased completely on exit.
 *
 * Resolves when `reduce` returns an intent !== `spec.continueIntent`, when a
 * signal fires, or when MAX_KEYPRESSES is exhausted.
 *
 * @returns Promise resolving to `{ intent, state }` at exit.
 */
export async function runTui<S, A extends string, C extends A>(
  spec: RunTuiSpec<S, A, C>,
): Promise<{ intent: Exclude<A, C>; state: S }> {
  // D-SEAM: default to process streams; callers (tests) may inject fakes.
  const stdin: TuiIO['stdin'] = (spec.io?.stdin ?? process.stdin) as TuiIO['stdin'];
  const stdout: TuiIO['stdout'] = (spec.io?.stdout ?? process.stdout) as TuiIO['stdout'];
  const isInline = spec.screen === 'inline';

  // REL-H1 driver bail: reject BEFORE any terminal mutation when stdin is not a
  // TTY and no spec.io.stdin was injected.
  //
  // Without this guard: alt-screen is entered, raw mode is skipped (no setRawMode
  // on non-TTY stdin), stdin ends immediately (no keypresses), the promise never
  // settles, the process exits, and cleanup() never runs — leaving the terminal
  // in alt-screen with hidden cursor.
  //
  // spec.io?.stdin injected = test / pipe path that owns its own stream lifecycle.
  // That path may deliberately pass a non-isTTY stream (e.g. PassThrough in tests)
  // and is exempted from this guard.
  if (!spec.io?.stdin && !stdin.isTTY) {
    throw new Error(
      'runTui: stdin is not a TTY — use process.stdin on a real TTY or inject spec.io.stdin',
    );
  }

  // ── Enable readline keypress events ─────────────────────────────────────
  readline.emitKeypressEvents(stdin);

  return new Promise<{ intent: Exclude<A, C>; state: S }>((resolve, reject) => {
    let state = spec.initialState;
    let cleaned = false;
    let keypressCount = 0;
    // D-INLINE: tracks how many lines the last inline frame occupied.
    // Used for cursor-up repaint and widget-erase on exit. Zero = no frame written yet.
    let prevLineCount = 0;

    // ── Inline-mode helpers ──────────────────────────────────────────────
    function getInlineDims(): RenderDims {
      const d = getDims(stdout);
      return { rows: Math.max(1, d.rows - INLINE_MARGIN), cols: d.cols };
    }

    /**
     * Render one inline frame in-place.
     * First call: writes lines directly, sets prevLineCount.
     * Subsequent calls: cursor-up (prevLineCount-1) + \r, rewrites, ERASE_BELOW.
     * D-INLINE: ERASE_BELOW handles shrinking frames without a high-watermark.
     */
    function renderInline(s: S): void {
      const dims = getInlineDims();
      const lines = spec.renderFrame(s, dims).slice(0, dims.rows);
      const lineCount = lines.length;

      let out = '';
      if (prevLineCount > 0) {
        // Move back to start of previous frame
        out += cursorUp(prevLineCount - 1) + '\r';
      }
      for (let i = 0; i < lineCount; i++) {
        out += lines[i] + ERASE_EOL;
        if (i < lineCount - 1) out += '\n';
      }
      // Erase stale lines below current frame (handles shrinking frames)
      out += ERASE_BELOW;
      stdout.write(out);
      prevLineCount = lineCount;
    }

    /** Dispatch render to the appropriate mode. */
    function doRender(s: S): void {
      if (isInline) {
        renderInline(s);
      } else {
        renderToStdout(s, stdout, spec.renderFrame);
      }
    }

    // ── Guarded startup — terminal setup, initial resize, and first render ─
    //
    // All operations that modify terminal state run inside this try block so
    // that any throw (including setRawMode EIO on a detached TTY) routes
    // through cleanup(). cleanup() is a function declaration and is therefore
    // hoisted, so it is callable here even though its textual definition
    // appears later. removeListener on a not-yet-registered listener is a
    // no-op, making partial setup safe to tear down.
    try {
      // D-SEC-S3: enter screen and enable raw mode inside the guarded block
      // so a setRawMode throw cannot leave the terminal stranded.
      // D-INLINE: inline mode skips ENTER_ALT — renders in the scroll buffer.
      stdout.write(isInline ? HIDE_CURSOR : ENTER_ALT + HIDE_CURSOR);
      if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(true);
      }
      stdin.resume();

      // Apply initial resize (sets viewportHeight from actual terminal dims).
      const initialDims = isInline ? getInlineDims() : getDims(stdout);
      if (spec.onResize) {
        state = spec.onResize(state, initialDims);
      }
      doRender(state);
    } catch (err) {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

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

      if (isInline) {
        // D-INLINE: erase widget and restore cursor.
        // Move to start of frame, erase to bottom, show cursor.
        let out = prevLineCount > 1 ? cursorUp(prevLineCount - 1) + '\r' : '\r';
        if (prevLineCount > 0) out += ERASE_BELOW;
        out += SHOW_CURSOR;
        stdout.write(out);
      } else {
        stdout.write(LEAVE_ALT + SHOW_CURSOR);
      }
    }

    function settle(intent: Exclude<A, C>, finalState: S): void {
      cleanup();
      resolve({ intent, state: finalState });
    }

    /**
     * Tear down and reject. Used when a handler throws.
     *
     * A throw inside an EventEmitter listener does NOT reject the enclosing
     * promise — it escapes as an uncaughtException and kills the process with
     * cleanup() never having run, leaving raw mode and alt-screen set. Routing
     * every handler failure through here keeps the PF-014 invariant (cleanup
     * always runs) while still surfacing the error rather than swallowing it.
     */
    function fail(err: unknown): void {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    }

    // ── Resize handler ─────────────────────────────────────────────────────
    function onResize(): void {
      try {
        const d = isInline ? getInlineDims() : getDims(stdout);
        if (spec.onResize) {
          state = spec.onResize(state, d);
        }
        doRender(state);
      } catch (err) {
        fail(err);
      }
    }

    // ── Keypress handler ───────────────────────────────────────────────────
    function onKeypress(str: string | undefined, key: ReadlineKey | undefined): void {
      try {
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
          // D-TS: TS cannot narrow A to Exclude<A,C> from a !== check on a generic C.
          // The invariant holds at runtime: any intent that is not continueIntent is Exclude<A,C>.
          settle(intent as Exclude<A, C>, state);
          return;
        }
        doRender(state);
      } catch (err) {
        fail(err);
      }
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
