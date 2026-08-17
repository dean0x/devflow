/**
 * Tests for src/cli/agents-view/terminal.ts — TUI shell.
 *
 * Drives runAgentsTui with injected fake streams (PassThrough) so no real TTY
 * is needed. Pins the two load-bearing guards documented in the feature KB:
 *
 *   (a) Resolve path calls stdin.pause() — without it the resumed stdin handle
 *       keeps the Node event loop alive and the CLI hangs after TUI exit.
 *
 *   (b) MAX_KEYPRESSES hard bound — feeding more than MAX_KEYPRESSES synthetic
 *       keypresses resolves the TUI with action:'cancel'.
 *
 * Regression contract: temporarily breaking stdin.pause() in cleanup MUST fail
 * test (a), and temporarily breaking the MAX_KEYPRESSES check MUST fail test (b).
 */

import { describe, it, expect } from 'vitest';
import { PassThrough } from 'stream';
import * as readline from 'readline';
import { runAgentsTui, MAX_KEYPRESSES } from '../src/cli/agents-view/terminal.js';
import type { AgentsViewState, AgentRow } from '../src/cli/agents-view/state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(name = 'coder'): AgentRow {
  return {
    name,
    shippedDefault: 'sonnet',
    configuredModel: 'default',
    originalModel: 'default',
    configuredEffort: 'default',
    originalEffort: 'default',
    dormantModel: null,
    offCyclePin: null,
  };
}

function makeInitialState(): AgentsViewState {
  return {
    rows: [makeRow()],
    cursor: 0,
    activeField: 'model',
    viewportOffset: 0,
    viewportHeight: 10,
    proxyEnabled: false,
    catalog: { known: false },
    modelCycle: [],
  };
}

/**
 * Build fake stdin (PassThrough) and stdout (write-sink) suitable for injection
 * into runAgentsTui.
 *
 * Wraps stdin.pause() to track whether it was called — tests assert this to
 * verify the event-loop-release guard fires on every resolve path.
 */
function makeFakeIO() {
  // Fake stdin: a readable PassThrough stream.
  // readline.emitKeypressEvents will attach a 'data' listener to it; writing
  // bytes causes synchronous 'keypress' events (verified in quick Node probe).
  const stdin = new PassThrough() as PassThrough & {
    isTTY?: boolean;
    setRawMode?: (mode: boolean) => void;
  };
  // isTTY intentionally absent → setRawMode guard in terminal.ts skips cleanly.

  let pauseCalled = false;
  const origPause = stdin.pause.bind(stdin);
  stdin.pause = () => {
    pauseCalled = true;
    return origPause();
  };

  // Fake stdout: a write-sink with terminal dimension stubs.
  const stdout = new PassThrough() as PassThrough & {
    rows?: number;
    columns?: number;
  };
  stdout.rows = 24;
  stdout.columns = 80;

  return {
    stdin,
    stdout,
    wasPauseCalled: () => pauseCalled,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runAgentsTui — io injection', () => {
  it('(a) resolve path: settle calls stdin.pause() before the promise resolves', async () => {
    const io = makeFakeIO();

    // runAgentsTui sets up all listeners synchronously before returning its
    // promise — no await needed before writing.
    const tuiPromise = runAgentsTui(makeInitialState(), { stdin: io.stdin, stdout: io.stdout });

    // ESC byte (0x1b) → readline parses as escape key → normalizeKey → 'escape'
    // → reduce → cancel intent → settle → cleanup → stdin.pause()
    io.stdin.write('\x1b');

    const result = await tuiPromise;

    expect(result.action).toBe('cancel');
    // The event-loop-release guard must have fired.
    expect(io.wasPauseCalled()).toBe(true);
  });

  it('(a) save path also calls stdin.pause()', async () => {
    const io = makeFakeIO();
    const tuiPromise = runAgentsTui(makeInitialState(), { stdin: io.stdin, stdout: io.stdout });

    // CR (0x0d) → readline parses as 'return' → normalizeKey → 'enter' → save intent
    io.stdin.write('\r');

    const result = await tuiPromise;

    expect(result.action).toBe('save');
    expect(io.wasPauseCalled()).toBe(true);
  });

  it('(b) MAX_KEYPRESSES bound: feeding more than the limit resolves with cancel', async () => {
    const io = makeFakeIO();
    const tuiPromise = runAgentsTui(makeInitialState(), { stdin: io.stdin, stdout: io.stdout });

    // Write MAX_KEYPRESSES + 1 bytes so keypressCount exceeds the limit.
    // Each byte 'a' is a distinct keypress that increments the counter.
    // The 'a' key maps to the default branch (intent:'none') so the TUI keeps
    // running until the bound fires on keypressCount > MAX_KEYPRESSES.
    const bytes = Buffer.alloc(MAX_KEYPRESSES + 1).fill('a'.charCodeAt(0));
    io.stdin.write(bytes);

    const result = await tuiPromise;

    expect(result.action).toBe('cancel');
  });

  it('(b) MAX_KEYPRESSES value is 50_000 (regression guard — do not reduce without updating KB)', () => {
    // Pin the exact value so a reduction is visible in review even when tests pass.
    expect(MAX_KEYPRESSES).toBe(50_000);
  });
});
