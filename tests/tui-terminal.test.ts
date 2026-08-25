/**
 * Tests for src/cli/tui/terminal.ts — the shared TUI shell driver.
 *
 * Focus: the cleanup invariant. The shell puts the terminal into alt-screen +
 * raw mode + hidden cursor BEFORE it can render anything, so any path that
 * leaves without running cleanup() strands the user's shell with no echo and no
 * line editing until they run `stty sane`.
 *
 * The save/cancel/signal paths are covered by flags-view-terminal.test.ts and
 * agents-terminal.test.ts. What is pinned here is the path those cannot reach:
 * an exception escaping the render or reduce callbacks. A throw inside an
 * EventEmitter listener does not reject the enclosing promise — it escapes as an
 * uncaughtException — so without an explicit guard the process dies with the
 * terminal still in raw mode (the PF-014 failure class: cleanup that does not run).
 */

import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'stream';
import { runTui, normalizeKey, type TuiIO } from '../src/cli/tui/terminal.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHOW_CURSOR = '\x1b[?25h';
const LEAVE_ALT = '\x1b[?1049l';

interface Harness {
  stdin: PassThrough;
  stdout: PassThrough;
  io: Partial<TuiIO>;
  rawModeCalls: boolean[];
  written: () => string;
}

/** TTY-like fake streams that record setRawMode transitions and all output. */
function makeHarness(): Harness {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const rawModeCalls: boolean[] = [];
  const chunks: string[] = [];

  (stdin as unknown as { isTTY: boolean }).isTTY = true;
  (stdin as unknown as { setRawMode: (m: boolean) => void }).setRawMode = (m: boolean) => {
    rawModeCalls.push(m);
  };
  (stdout as unknown as { rows: number }).rows = 24;
  (stdout as unknown as { columns: number }).columns = 80;

  const realWrite = stdout.write.bind(stdout);
  stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    return (realWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as PassThrough['write'];

  return {
    stdin,
    stdout,
    io: { stdin, stdout } as Partial<TuiIO>,
    rawModeCalls,
    written: () => chunks.join(''),
  };
}

/** Assert the terminal was fully restored: raw mode off, cursor shown, alt-screen left. */
function expectTerminalRestored(h: Harness, pauseSpy: ReturnType<typeof vi.spyOn>): void {
  expect(h.rawModeCalls, 'setRawMode(true) then setRawMode(false)').toEqual([true, false]);
  expect(pauseSpy, 'stdin.pause() releases the ref\'d TTY handle').toHaveBeenCalled();
  expect(h.written()).toContain(SHOW_CURSOR);
  expect(h.written()).toContain(LEAVE_ALT);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// TS-M5: normalizeKey accepts undefined str (readline emits undefined for
// non-printable escape sequences)
// ---------------------------------------------------------------------------

describe('normalizeKey — undefined str (TS-M5)', () => {
  it('returns the key name when str is undefined and key has a name', () => {
    // Node readline emits undefined as first arg for non-printable sequences
    expect(normalizeKey(undefined, { name: 'up' })).toBe('up');
    expect(normalizeKey(undefined, { name: 'return' })).toBe('enter');
    expect(normalizeKey(undefined, { name: 'escape' })).toBe('escape');
  });

  it('returns empty string when both str and key.name are absent', () => {
    expect(normalizeKey(undefined, null)).toBe('');
  });

  it('still handles ctrl-c with undefined str', () => {
    expect(normalizeKey(undefined, { ctrl: true, name: 'c' })).toBe('ctrl-c');
  });
});

// ---------------------------------------------------------------------------
// SEC-S3: setRawMode(true) runs inside the guarded try block so a throw
// (EIO on a detached TTY) routes through cleanup() before any listener is
// registered.
// ---------------------------------------------------------------------------

describe('runTui — guarded startup (SEC-S3)', () => {
  it('restores the terminal when setRawMode(true) throws before keypress listeners are registered', async () => {
    const h = makeHarness();
    let rawModeOffCalled = false;

    // Override: true throws (EIO), false records itself via rawModeOffCalled
    (h.stdin as unknown as { setRawMode: (m: boolean) => void }).setRawMode = (m: boolean) => {
      if (m) throw new Error('EIO: input/output error');
      rawModeOffCalled = true; // cleanup called setRawMode(false)
    };

    await expect(
      runTui<{ n: number }, 'none' | 'done', 'none'>({
        initialState: { n: 0 },
        reduce: s => ({ state: s, intent: 'none' }),
        renderFrame: () => ['frame'],
        signalAction: 'done',
        continueIntent: 'none',
        io: h.io,
      }),
    ).rejects.toThrow('EIO: input/output error');

    // Cleanup must restore the terminal even though setRawMode(true) threw
    // before any keypress listener was registered.
    expect(h.written()).toContain(SHOW_CURSOR);
    expect(h.written()).toContain(LEAVE_ALT);
    expect(rawModeOffCalled, 'cleanup called setRawMode(false) via its own try/catch').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REL-M1: renderFrame output is clamped to dims.rows at the single write site
// so every runTui consumer inherits the bound.
// ---------------------------------------------------------------------------

describe('runTui — frame line clamping (REL-M1)', () => {
  it('emits at most dims.rows lines when renderFrame returns more', async () => {
    const h = makeHarness();
    // Use 3 rows so the excess is obvious (renderFrame returns 10)
    (h.stdout as unknown as { rows: number }).rows = 3;

    const tui = runTui<{ n: number }, 'none' | 'done', 'none'>({
      initialState: { n: 0 },
      reduce: s => ({ state: { n: s.n + 1 }, intent: 'done' }),
      // Returns 10 distinctly-named lines — only the first 3 should appear in output
      renderFrame: () => ['row0', 'row1', 'row2', 'row3', 'row4', 'row5', 'row6', 'row7', 'row8', 'row9'],
      signalAction: 'done',
      continueIntent: 'none',
      io: h.io,
    });

    await new Promise<void>(r => setTimeout(r, 10));
    h.stdin.push('x');
    await tui;

    const output = h.written();
    // Lines within dims.rows (0–2) must appear; lines beyond must not
    expect(output).toContain('row0');
    expect(output).toContain('row1');
    expect(output).toContain('row2');
    expect(output).not.toContain('row3');
    expect(output).not.toContain('row4');
  });

  it('preserves at least one line when dims.rows is 1 or less', async () => {
    const h = makeHarness();
    (h.stdout as unknown as { rows: number }).rows = 1;

    const tui = runTui<{ n: number }, 'none' | 'done', 'none'>({
      initialState: { n: 0 },
      reduce: s => ({ state: { n: s.n + 1 }, intent: 'done' }),
      renderFrame: () => ['only-line', 'hidden-line'],
      signalAction: 'done',
      continueIntent: 'none',
      io: h.io,
    });

    await new Promise<void>(r => setTimeout(r, 10));
    h.stdin.push('x');
    await tui;

    const output = h.written();
    expect(output).toContain('only-line');
    expect(output).not.toContain('hidden-line');
  });
});

// ---------------------------------------------------------------------------
// TEST-M1 / REG-S3: frame output contract — byte-level assertions
//
// renderToStdout's documented contract:
//   HOME + line + ERASE_EOL per line, '\n' between lines but NOT after the last,
//   then ERASE_BELOW (\x1b[0J) to clear stale content on terminal shrink.
//
// Both the ERASE_BELOW append and the no-trailing-newline guard are single-line
// fixes that revert silently when deleted. The assertions below are the regression
// guards: each would fail independently against a broken implementation.
//
// Failure modes:
//   • "exact composition" assertion — toContain(expectedFrame) fails if ERASE_BELOW
//     is deleted (the expected string ends in \x1b[0J which is absent in the output).
//   • "no trailing newline" assertion — not.toContain('line-b\x1b[K\n\x1b[0J') fails
//     if a '\n' is re-introduced before ERASE_BELOW.
// ---------------------------------------------------------------------------

describe('renderToStdout — frame output contract (TEST-M1 / REG-S3)', () => {
  const HOME_SEQ = '\x1b[H';
  const ERASE_EOL_SEQ = '\x1b[K';
  const ERASE_BELOW_SEQ = '\x1b[0J';

  it('exact escape-sequence composition for a 2-line frame: HOME + lines + ERASE_EOL + ERASE_BELOW', async () => {
    const h = makeHarness();

    const tui = runTui<{ n: number }, 'none' | 'done', 'none'>({
      initialState: { n: 0 },
      reduce: s => ({ state: { n: s.n + 1 }, intent: 'done' }),
      renderFrame: () => ['line-a', 'line-b'],
      signalAction: 'done',
      continueIntent: 'none',
      io: h.io,
    });

    await new Promise<void>(r => setTimeout(r, 10));
    h.stdin.push('x');
    await tui;

    // Full expected frame bytes:
    //   HOME + 'line-a' + ERASE_EOL + '\n' + 'line-b' + ERASE_EOL + ERASE_BELOW
    // Deleting the ERASE_BELOW append makes toContain fail (ERASE_BELOW absent).
    const expectedFrame =
      `${HOME_SEQ}line-a${ERASE_EOL_SEQ}\nline-b${ERASE_EOL_SEQ}${ERASE_BELOW_SEQ}`;
    expect(h.written()).toContain(expectedFrame);
  });

  it('last frame line has no trailing newline before ERASE_BELOW', async () => {
    const h = makeHarness();

    const tui = runTui<{ n: number }, 'none' | 'done', 'none'>({
      initialState: { n: 0 },
      reduce: s => ({ state: { n: s.n + 1 }, intent: 'done' }),
      renderFrame: () => ['line-a', 'line-b'],
      signalAction: 'done',
      continueIntent: 'none',
      io: h.io,
    });

    await new Promise<void>(r => setTimeout(r, 10));
    h.stdin.push('x');
    await tui;

    // A trailing '\n' before ERASE_BELOW would scroll the alt-screen on every
    // redraw.  Verify the '\n' is absent: re-introducing it makes this fail.
    expect(h.written()).not.toContain(`line-b${ERASE_EOL_SEQ}\n${ERASE_BELOW_SEQ}`);
  });

  it('a 1-line frame has no newline separators', async () => {
    const h = makeHarness();

    const tui = runTui<{ n: number }, 'none' | 'done', 'none'>({
      initialState: { n: 0 },
      reduce: s => ({ state: { n: s.n + 1 }, intent: 'done' }),
      renderFrame: () => ['solo'],
      signalAction: 'done',
      continueIntent: 'none',
      io: h.io,
    });

    await new Promise<void>(r => setTimeout(r, 10));
    h.stdin.push('x');
    await tui;

    // Single line: HOME + 'solo' + ERASE_EOL + ERASE_BELOW, no '\n' at all in the frame.
    expect(h.written()).toContain(`${HOME_SEQ}solo${ERASE_EOL_SEQ}${ERASE_BELOW_SEQ}`);
    expect(h.written()).not.toContain(`solo${ERASE_EOL_SEQ}\n`);
  });
});

// ---------------------------------------------------------------------------

describe('runTui — cleanup always runs', () => {
  it('restores the terminal when the INITIAL render throws', async () => {
    const h = makeHarness();
    const pauseSpy = vi.spyOn(h.stdin, 'pause');
    const boom = new Error('render exploded');

    // The initial render happens after alt-screen + raw mode are already set.
    await expect(
      runTui<{ n: number }, 'none' | 'done', 'none'>({
        initialState: { n: 0 },
        reduce: s => ({ state: s, intent: 'none' }),
        renderFrame: () => { throw boom; },
        signalAction: 'done',
        continueIntent: 'none',
        io: h.io,
      }),
    ).rejects.toThrow('render exploded');

    expectTerminalRestored(h, pauseSpy);
  });

  it('restores the terminal when onResize throws during startup', async () => {
    const h = makeHarness();
    const pauseSpy = vi.spyOn(h.stdin, 'pause');

    await expect(
      runTui<{ n: number }, 'none' | 'done', 'none'>({
        initialState: { n: 0 },
        reduce: s => ({ state: s, intent: 'none' }),
        renderFrame: () => ['frame'],
        onResize: () => { throw new Error('resize exploded'); },
        signalAction: 'done',
        continueIntent: 'none',
        io: h.io,
      }),
    ).rejects.toThrow('resize exploded');

    expectTerminalRestored(h, pauseSpy);
  });

  it('restores the terminal when reduce throws on a keypress', async () => {
    const h = makeHarness();
    const pauseSpy = vi.spyOn(h.stdin, 'pause');

    const tui = runTui<{ n: number }, 'none' | 'done', 'none'>({
      initialState: { n: 0 },
      reduce: () => { throw new Error('reduce exploded'); },
      renderFrame: () => ['frame'],
      signalAction: 'done',
      continueIntent: 'none',
      io: h.io,
    });

    // Let the first frame render, then deliver a key that trips the reducer.
    await new Promise(r => setTimeout(r, 10));
    h.stdin.push('x');

    await expect(tui).rejects.toThrow('reduce exploded');
    expectTerminalRestored(h, pauseSpy);
  });

  it('a non-Error throw is still surfaced as an Error, with cleanup', async () => {
    const h = makeHarness();
    const pauseSpy = vi.spyOn(h.stdin, 'pause');

    const promise = runTui<{ n: number }, 'none' | 'done', 'none'>({
      initialState: { n: 0 },
      reduce: s => ({ state: s, intent: 'none' }),
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      renderFrame: () => { throw 'a bare string'; },
      signalAction: 'done',
      continueIntent: 'none',
      io: h.io,
    });

    await expect(promise).rejects.toBeInstanceOf(Error);
    expectTerminalRestored(h, pauseSpy);
  });

  it('the normal save path still resolves and restores the terminal', async () => {
    // Guard against the error handling above regressing the happy path.
    const h = makeHarness();
    const pauseSpy = vi.spyOn(h.stdin, 'pause');

    const tui = runTui<{ n: number }, 'none' | 'done', 'none'>({
      initialState: { n: 0 },
      reduce: s => ({ state: { n: s.n + 1 }, intent: 'done' }),
      renderFrame: () => ['frame'],
      signalAction: 'done',
      continueIntent: 'none',
      io: h.io,
    });

    await new Promise(r => setTimeout(r, 10));
    h.stdin.push('x');

    const result = await tui;
    expect(result.intent).toBe('done');
    expect(result.state.n).toBe(1);
    expectTerminalRestored(h, pauseSpy);
  });
});
