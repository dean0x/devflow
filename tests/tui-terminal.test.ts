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
import { runTui, type TuiIO } from '../src/cli/tui/terminal.js';

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

describe('runTui — cleanup always runs', () => {
  it('restores the terminal when the INITIAL render throws', async () => {
    const h = makeHarness();
    const pauseSpy = vi.spyOn(h.stdin, 'pause');
    const boom = new Error('render exploded');

    // The initial render happens after alt-screen + raw mode are already set.
    await expect(
      runTui<{ n: number }, 'none' | 'done'>({
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
      runTui<{ n: number }, 'none' | 'done'>({
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

    const tui = runTui<{ n: number }, 'none' | 'done'>({
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

    const promise = runTui<{ n: number }, 'none' | 'done'>({
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

    const tui = runTui<{ n: number }, 'none' | 'done'>({
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
