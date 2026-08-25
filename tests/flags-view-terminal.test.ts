/**
 * Tests for src/cli/flags-view/terminal.ts — TUI shell adapter.
 *
 * Tests-first (RED-GREEN): written before the implementation.
 *
 * Pinned behaviours (per execution plan):
 *   (a) stdin.pause() called on save, cancel, and abort paths
 *   (b) MAX_KEYPRESSES flood → resolves with cancel (via shared shell signalAction)
 *   - Driving with PassThrough: send key bytes → TUI resolves
 *   - esc → cancel intent, ctrl-c → abort intent
 *   - edit sequence: enter edit mode, type value, confirm → save with new value
 *   - Save path: save intent returns the final rows
 *
 * The tests use the same PassThrough pattern as agents-terminal.test.ts, injecting
 * a fake stdout to capture output without a real TTY.
 */

import { describe, it, expect, vi } from 'vitest';
import { PassThrough } from 'stream';
import { runFlagsTui } from '../src/cli/flags-view/terminal.js';
import { MAX_KEYPRESSES } from '../src/cli/tui/terminal.js';
import { buildFlagRows } from '../src/cli/flags-view/state.js';
import { FLAG_REGISTRY } from '../src/core/flags.js';
import type { FlagsRecord } from '../src/core/flags.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeStreams() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  (stdin as unknown as { isTTY: boolean }).isTTY = false;
  (stdin as unknown as { setRawMode: (m: boolean) => void }).setRawMode = (_m: boolean) => {};
  (stdout as unknown as { rows: number }).rows = 24;
  (stdout as unknown as { columns: number }).columns = 80;
  return { stdin, stdout };
}

function sendKey(stdin: PassThrough, key: string): void {
  stdin.push(key);
}

/** Build a default record (all flags at devflow defaults) */
function defaultRecord(): FlagsRecord {
  const record: FlagsRecord = {};
  for (const flag of FLAG_REGISTRY) {
    record[flag.id] = flag.kind === 'boolean' ? flag.defaultValue : (flag.defaultValue ?? null);
  }
  return record;
}

// ---------------------------------------------------------------------------
// (a) stdin.pause() called on all exit paths
// ---------------------------------------------------------------------------

describe('flags-view-terminal — (a) stdin.pause() on exit', () => {
  it('pause() is called when TUI resolves via esc (cancel)', async () => {
    const { stdin, stdout } = makeStreams();
    const pauseSpy = vi.spyOn(stdin, 'pause');

    const record = defaultRecord();
    const rowsIn = buildFlagRows(FLAG_REGISTRY, record);
    const tui = runFlagsTui(rowsIn, { stdin, stdout });

    // Let the first frame render
    await new Promise(r => setTimeout(r, 10));

    // Send esc → cancel
    sendKey(stdin, '\x1b');
    const result = await tui;

    expect(result.action).toBe('cancel');
    expect(pauseSpy).toHaveBeenCalled();
  });

  it('pause() is called when TUI resolves via ctrl-c (abort)', async () => {
    const { stdin, stdout } = makeStreams();
    const pauseSpy = vi.spyOn(stdin, 'pause');

    const record = defaultRecord();
    const rowsIn = buildFlagRows(FLAG_REGISTRY, record);
    const tui = runFlagsTui(rowsIn, { stdin, stdout });

    await new Promise(r => setTimeout(r, 10));

    // ctrl-c
    sendKey(stdin, '\x03');
    const result = await tui;

    expect(result.action).toBe('abort');
    expect(pauseSpy).toHaveBeenCalled();
  });

  it('pause() is called on save (enter on boolean row)', async () => {
    const { stdin, stdout } = makeStreams();
    const pauseSpy = vi.spyOn(stdin, 'pause');

    const record = defaultRecord();
    const rowsIn = buildFlagRows(FLAG_REGISTRY, record);
    const tui = runFlagsTui(rowsIn, { stdin, stdout });

    await new Promise(r => setTimeout(r, 10));

    // Enter on first row (boolean) → save
    sendKey(stdin, '\r');
    const result = await tui;

    expect(result.action).toBe('save');
    expect(pauseSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (b) MAX_KEYPRESSES flood → resolves with signalAction (abort)
// ---------------------------------------------------------------------------

describe('flags-view-terminal — (b) MAX_KEYPRESSES flood resolves', () => {
  it(`exhausting ${MAX_KEYPRESSES} keypresses resolves with abort`, async () => {
    const { stdin, stdout } = makeStreams();

    const record = defaultRecord();
    const rowsIn = buildFlagRows(FLAG_REGISTRY, record);
    const tui = runFlagsTui(rowsIn, { stdin, stdout });

    await new Promise(r => setTimeout(r, 10));

    // Flood with no-op keys (space on first boolean row cycles it but stays running)
    // Use 'j' (down) to avoid cycling — it's a navigation key that stays at bottom
    for (let i = 0; i <= MAX_KEYPRESSES; i++) {
      sendKey(stdin, 'a'); // 'a' is unrecognized in browse mode → noop
    }

    const result = await tui;
    expect(result.action).toBe('abort');
  }, 30_000); // Allow up to 30s for this test (it's a large loop)
});

// ---------------------------------------------------------------------------
// Key routing: esc → cancel
// ---------------------------------------------------------------------------

describe('flags-view-terminal — key routing', () => {
  it('esc resolves with cancel action', async () => {
    const { stdin, stdout } = makeStreams();
    const record = defaultRecord();
    const rowsIn = buildFlagRows(FLAG_REGISTRY, record);
    const tui = runFlagsTui(rowsIn, { stdin, stdout });
    await new Promise(r => setTimeout(r, 10));
    sendKey(stdin, '\x1b');
    const result = await tui;
    expect(result.action).toBe('cancel');
  });

  it('q resolves with cancel action', async () => {
    const { stdin, stdout } = makeStreams();
    const record = defaultRecord();
    const rowsIn = buildFlagRows(FLAG_REGISTRY, record);
    const tui = runFlagsTui(rowsIn, { stdin, stdout });
    await new Promise(r => setTimeout(r, 10));
    sendKey(stdin, 'q');
    const result = await tui;
    expect(result.action).toBe('cancel');
  });

  it('ctrl-c resolves with abort action', async () => {
    const { stdin, stdout } = makeStreams();
    const record = defaultRecord();
    const rowsIn = buildFlagRows(FLAG_REGISTRY, record);
    const tui = runFlagsTui(rowsIn, { stdin, stdout });
    await new Promise(r => setTimeout(r, 10));
    sendKey(stdin, '\x03');
    const result = await tui;
    expect(result.action).toBe('abort');
  });

  it('enter on boolean row resolves with save action', async () => {
    const { stdin, stdout } = makeStreams();
    const record = defaultRecord();
    const rowsIn = buildFlagRows(FLAG_REGISTRY, record);
    const tui = runFlagsTui(rowsIn, { stdin, stdout });
    await new Promise(r => setTimeout(r, 10));
    sendKey(stdin, '\r');
    const result = await tui;
    expect(result.action).toBe('save');
  });
});

// ---------------------------------------------------------------------------
// Result: save returns rows with updated values
// ---------------------------------------------------------------------------

describe('flags-view-terminal — save result', () => {
  it('cancel returns unchanged rows', async () => {
    // Applies PF-018 mechanism 4: toBeDefined() is satisfied by any non-null
    // value — it cannot observe "unchanged". Replace with toEqual(rowsIn) so
    // the test actually checks the "unchanged" claim it is named for.
    const { stdin, stdout } = makeStreams();
    const record = defaultRecord();
    const rowsIn = buildFlagRows(FLAG_REGISTRY, record);
    const tui = runFlagsTui(rowsIn, { stdin, stdout });
    await new Promise(r => setTimeout(r, 10));
    sendKey(stdin, 'q');
    const result = await tui;
    expect(result.action).toBe('cancel');
    expect(result.rows).toEqual(rowsIn); // must be deep-equal (unchanged), not merely defined
  });

  it('space on tui (boolean) toggles value, then enter saves', async () => {
    const { stdin, stdout } = makeStreams();
    // tui defaults to enabled (true) in registry — but record may have it set
    const record = { tui: true }; // explicitly set tui=true
    const rowsIn = buildFlagRows(FLAG_REGISTRY, record);
    // cursor starts at 0 = tui row
    const tui = runFlagsTui(rowsIn, { stdin, stdout });
    await new Promise(r => setTimeout(r, 10));
    // Space toggles tui: true → false
    sendKey(stdin, ' ');
    await new Promise(r => setTimeout(r, 5));
    // Enter on boolean row = save
    sendKey(stdin, '\r');
    const result = await tui;
    expect(result.action).toBe('save');
    const tuiRow = result.rows.find(r => r.id === 'tui');
    expect(tuiRow?.configuredValue).toBe(false);
  });
});
