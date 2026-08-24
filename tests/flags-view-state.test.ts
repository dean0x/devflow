/**
 * Tests for src/cli/flags-view/state.ts — pure reducer + row builder.
 *
 * Tests-first (RED-GREEN): written before the implementation.
 *
 * Pinned behaviours (per execution plan):
 *   - Navigation up/down + viewport clamp
 *   - Boolean toggle via space/←/→
 *   - Enum cycle including view-mode glue (stops: [null,'verbose','focus'] — NO 'default')
 *   - Text rows enter edit mode via space/enter/e
 *   - Edit commit: valid inputs, invalid inputs stay editing + error
 *   - Empty buffer → unset for allowUnset rows
 *   - '007' / ' 8' → strict number format → stay editing + error
 *   - cap+1 (101 for max-concurrent-subagents) → stay editing + error
 *   - esc discards edit only (back to browse, value unchanged)
 *   - d = set devflow default
 *   - u = unset (allowUnset rows only — noop on boolean)
 *   - dirty-revert: cycle away and back → NOT dirty
 *   - up/down ignored while editing
 *   - buffer hard-bounded at 64 on paste-like bulk insert
 *   - collectFlagRecord maps view-mode null → 'default'
 */

import { describe, it, expect } from 'vitest';
import {
  reduce,
  resizeViewport,
  buildFlagRows,
  collectFlagRecord,
  type FlagsViewState,
  type FlagRow,
} from '../src/cli/flags-view/state.js';
import { FLAG_REGISTRY } from '../src/core/flags.js';
import type { FlagsRecord } from '../src/core/flags.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Make a minimal FlagsViewState for testing with an explicit set of rows. */
function makeState(
  rows: FlagRow[],
  overrides: Partial<Omit<FlagsViewState, 'rows'>> = {},
): FlagsViewState {
  return {
    rows,
    cursor: 0,
    viewportOffset: 0,
    viewportHeight: 10,
    editing: null,
    ...overrides,
  };
}

/** Build a single FlagRow from the registry for a given flag id. */
function rowFor(id: string, record: FlagsRecord = {}): FlagRow {
  const rows = buildFlagRows(FLAG_REGISTRY, record);
  const row = rows.find(r => r.id === id);
  if (!row) throw new Error(`Flag '${id}' not found in registry`);
  return row;
}

/** Apply a sequence of key strings to a state, return final state. */
function applyKeys(state: FlagsViewState, keys: string[]): FlagsViewState {
  let current = state;
  for (const key of keys) {
    current = reduce(current, key).state;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

describe('flags-view-state — navigation', () => {
  it('down moves cursor', () => {
    const rows = [rowFor('tui'), rowFor('lsp')];
    const state = makeState(rows, { cursor: 0 });
    const next = reduce(state, 'down').state;
    expect(next.cursor).toBe(1);
  });

  it('up moves cursor', () => {
    const rows = [rowFor('tui'), rowFor('lsp')];
    const state = makeState(rows, { cursor: 1 });
    const next = reduce(state, 'up').state;
    expect(next.cursor).toBe(0);
  });

  it('up at top clamps to 0', () => {
    const rows = [rowFor('tui')];
    const state = makeState(rows, { cursor: 0 });
    const next = reduce(state, 'up').state;
    expect(next.cursor).toBe(0);
  });

  it('down at bottom clamps to last row', () => {
    const rows = [rowFor('tui')];
    const state = makeState(rows, { cursor: 0 });
    const next = reduce(state, 'down').state;
    expect(next.cursor).toBe(0);
  });

  it('j moves cursor down', () => {
    const rows = [rowFor('tui'), rowFor('lsp')];
    const state = makeState(rows, { cursor: 0 });
    expect(reduce(state, 'j').state.cursor).toBe(1);
  });

  it('k moves cursor up', () => {
    const rows = [rowFor('tui'), rowFor('lsp')];
    const state = makeState(rows, { cursor: 1 });
    expect(reduce(state, 'k').state.cursor).toBe(0);
  });

  it('viewport clamps when cursor scrolls below viewport', () => {
    const rows = [rowFor('tui'), rowFor('lsp'), rowFor('tool-search'), rowFor('brief')];
    const state = makeState(rows, { cursor: 0, viewportOffset: 0, viewportHeight: 2 });
    // Move down past viewport
    const s1 = reduce(state, 'down').state;
    const s2 = reduce(s1, 'down').state;
    const s3 = reduce(s2, 'down').state;
    expect(s3.cursor).toBe(3);
    // viewportOffset should clamp to keep cursor visible (cursor=3, height=2 → offset=2)
    expect(s3.viewportOffset).toBe(2);
  });

  it('viewport clamps when cursor scrolls above viewport', () => {
    const rows = [rowFor('tui'), rowFor('lsp'), rowFor('tool-search')];
    const state = makeState(rows, { cursor: 2, viewportOffset: 1, viewportHeight: 2 });
    const s1 = reduce(state, 'up').state;
    const s2 = reduce(s1, 'up').state;
    expect(s2.cursor).toBe(0);
    expect(s2.viewportOffset).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Boolean flag cycling
// ---------------------------------------------------------------------------

describe('flags-view-state — boolean flag cycling', () => {
  it('space toggles boolean from false to true', () => {
    const row = rowFor('brief', { brief: false }); // brief=false (disabled)
    const state = makeState([row]);
    const next = reduce(state, 'space').state;
    expect(next.rows[0].configuredValue).toBe(true);
  });

  it('space toggles boolean from true to false', () => {
    const row = rowFor('tui', { tui: true });
    const state = makeState([row]);
    const next = reduce(state, 'space').state;
    expect(next.rows[0].configuredValue).toBe(false);
  });

  it('right arrow also cycles boolean forward', () => {
    const row = rowFor('tui', { tui: true });
    const state = makeState([row]);
    expect(reduce(state, 'right').state.rows[0].configuredValue).toBe(false);
  });

  it('left arrow cycles boolean backward', () => {
    const row = rowFor('tui', { tui: false }); // false → cycles backward → true
    const state = makeState([row]);
    expect(reduce(state, 'left').state.rows[0].configuredValue).toBe(true);
  });

  it('boolean stops are [true, false] — no null stop', () => {
    const row = rowFor('tui');
    expect(row.stops).toEqual([true, false]);
    expect(row.allowUnset).toBe(false);
  });

  it('dirty after toggle, not dirty if reverted', () => {
    const row = rowFor('tui', { tui: true }); // original = true
    const state = makeState([row]);
    const s1 = reduce(state, 'space').state; // → false, dirty
    expect(s1.rows[0].configuredValue).toBe(false);
    expect(s1.rows[0].originalValue).toBe(true);
    const s2 = reduce(s1, 'space').state; // → true (back to original)
    expect(s2.rows[0].configuredValue).toBe(true);
    expect(s2.rows[0].originalValue).toBe(true);
    // not dirty
    expect(s2.rows[0].configuredValue).toBe(s2.rows[0].originalValue);
  });
});

// ---------------------------------------------------------------------------
// Enum cycling
// ---------------------------------------------------------------------------

describe('flags-view-state — enum cycling', () => {
  it('view-mode stops are [null, verbose, focus] — no default stop', () => {
    const row = rowFor('view-mode');
    expect(row.stops).toEqual([null, 'verbose', 'focus']);
    // 'default' must NOT appear in stops
    expect(row.stops).not.toContain('default');
    expect(row.allowUnset).toBe(true);
  });

  it('view-mode cycles null → verbose → focus → null (cycle wrap)', () => {
    // Start at default (null)
    const row = rowFor('view-mode', {}); // no record entry → null
    const state = makeState([row]);
    const s1 = reduce(state, 'space').state;
    expect(s1.rows[0].configuredValue).toBe('verbose');
    const s2 = reduce(s1, 'space').state;
    expect(s2.rows[0].configuredValue).toBe('focus');
    const s3 = reduce(s2, 'space').state;
    expect(s3.rows[0].configuredValue).toBe(null); // wraps to null
  });

  it('view-mode dirty-revert: cycle away and back → not dirty', () => {
    const row = rowFor('view-mode', {}); // starts at null
    const state = makeState([row]);
    const s1 = reduce(state, 'space').state; // → verbose, dirty
    const s2 = reduce(s1, 'space').state;    // → focus
    const s3 = reduce(s2, 'space').state;    // → null (back to original)
    expect(s3.rows[0].configuredValue).toBe(null);
    expect(s3.rows[0].originalValue).toBe(null);
    // configuredValue === originalValue → not dirty
    expect(s3.rows[0].configuredValue).toBe(s3.rows[0].originalValue);
  });

  it('enum cycles left (backward)', () => {
    const row = rowFor('view-mode', {}); // null
    const state = makeState([row]);
    const s1 = reduce(state, 'left').state; // null → focus (backward wrap)
    expect(s1.rows[0].configuredValue).toBe('focus');
  });
});

// ---------------------------------------------------------------------------
// Text rows — enter edit mode
// ---------------------------------------------------------------------------

describe('flags-view-state — text row enter edit mode', () => {
  it('space on a number row enters edit mode', () => {
    const row = rowFor('max-concurrent-subagents', { 'max-concurrent-subagents': 40 });
    const state = makeState([row]);
    expect(state.editing).toBeNull();
    const next = reduce(state, 'space').state;
    expect(next.editing).not.toBeNull();
    expect(next.editing?.buffer).toBe('40'); // pre-filled with current value
  });

  it('enter on a number row enters edit mode', () => {
    const row = rowFor('max-concurrent-subagents', { 'max-concurrent-subagents': 40 });
    const state = makeState([row]);
    const next = reduce(state, 'enter').state;
    expect(next.editing).not.toBeNull();
  });

  it('e on a number row enters edit mode', () => {
    const row = rowFor('max-concurrent-subagents', { 'max-concurrent-subagents': 40 });
    const state = makeState([row]);
    const next = reduce(state, 'e').state;
    expect(next.editing).not.toBeNull();
  });

  it('edit mode buffer is pre-filled with formatted current value', () => {
    const row = rowFor('max-concurrent-subagents', { 'max-concurrent-subagents': 40 });
    const state = makeState([row]);
    const next = reduce(state, 'e').state;
    // buffer contains the current value as a string
    expect(next.editing?.buffer).toBe('40');
    expect(next.editing?.caret).toBe(2); // caret at end
    expect(next.editing?.error).toBeNull();
  });

  it('edit mode buffer is empty when current value is null (unset)', () => {
    const row = rowFor('subagent-spawn-depth', {}); // null = not set
    const state = makeState([row]);
    const next = reduce(state, 'e').state;
    expect(next.editing?.buffer).toBe('');
    expect(next.editing?.caret).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Edit mode — commit valid inputs
// ---------------------------------------------------------------------------

describe('flags-view-state — edit commit valid inputs', () => {
  it('entering a valid number and pressing enter commits it', () => {
    const row = rowFor('max-concurrent-subagents', { 'max-concurrent-subagents': 40 });
    const state = makeState([row]);
    // Enter edit mode
    let s = reduce(state, 'e').state;
    // Clear and type '50'
    s = { ...s, editing: { buffer: '50', caret: 2, error: null } };
    // Commit
    s = reduce(s, 'enter').state;
    expect(s.editing).toBeNull(); // left edit mode
    expect(s.rows[0].configuredValue).toBe(50);
  });

  it('valid string commits correctly', () => {
    const row = rowFor('default-model', {});
    const state = makeState([row]);
    let s = reduce(state, 'e').state;
    s = { ...s, editing: { buffer: 'claude-3-5-sonnet', caret: 17, error: null } };
    s = reduce(s, 'enter').state;
    expect(s.editing).toBeNull();
    expect(s.rows[0].configuredValue).toBe('claude-3-5-sonnet');
  });

  it('007 is a valid input for subagent-spawn-depth — actually NO, strict parsing rejects leading zeros', () => {
    // subagent-spawn-depth: min=1, max=10, integer
    const row = rowFor('subagent-spawn-depth', {});
    const state = makeState([row]);
    let s = reduce(state, 'e').state;
    s = { ...s, editing: { buffer: '007', caret: 3, error: null } };
    s = reduce(s, 'enter').state;
    // stays editing with error (leading zeros rejected)
    expect(s.editing).not.toBeNull();
    expect(s.editing?.error).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edit mode — commit invalid inputs → stay editing + error
// ---------------------------------------------------------------------------

describe('flags-view-state — edit commit invalid inputs', () => {
  it("'' (empty) → unset for allowUnset rows", () => {
    const row = rowFor('max-concurrent-subagents', { 'max-concurrent-subagents': 40 });
    const state = makeState([row]);
    let s = reduce(state, 'e').state;
    s = { ...s, editing: { buffer: '', caret: 0, error: null } };
    s = reduce(s, 'enter').state;
    // empty on allowUnset row → commit as null (unset)
    expect(s.editing).toBeNull();
    expect(s.rows[0].configuredValue).toBeNull();
  });

  it("'abc' → stay editing + error (not a number)", () => {
    const row = rowFor('max-concurrent-subagents', { 'max-concurrent-subagents': 40 });
    const state = makeState([row]);
    let s = reduce(state, 'e').state;
    s = { ...s, editing: { buffer: 'abc', caret: 3, error: null } };
    s = reduce(s, 'enter').state;
    expect(s.editing).not.toBeNull();
    expect(s.editing?.error).not.toBeNull();
  });

  it("'-1' → stay editing + error (below min=1)", () => {
    const row = rowFor('max-concurrent-subagents', { 'max-concurrent-subagents': 40 });
    const state = makeState([row]);
    let s = reduce(state, 'e').state;
    s = { ...s, editing: { buffer: '-1', caret: 2, error: null } };
    s = reduce(s, 'enter').state;
    expect(s.editing).not.toBeNull();
    expect(s.editing?.error).not.toBeNull();
  });

  it("'007' → stay editing + error (leading zeros rejected)", () => {
    const row = rowFor('max-concurrent-subagents', { 'max-concurrent-subagents': 40 });
    const state = makeState([row]);
    let s = reduce(state, 'e').state;
    s = { ...s, editing: { buffer: '007', caret: 3, error: null } };
    s = reduce(s, 'enter').state;
    expect(s.editing).not.toBeNull();
    expect(s.editing?.error).not.toBeNull();
  });

  it("' 8' → stay editing + error (leading space)", () => {
    const row = rowFor('max-concurrent-subagents', { 'max-concurrent-subagents': 40 });
    const state = makeState([row]);
    let s = reduce(state, 'e').state;
    s = { ...s, editing: { buffer: ' 8', caret: 2, error: null } };
    s = reduce(s, 'enter').state;
    expect(s.editing).not.toBeNull();
    expect(s.editing?.error).not.toBeNull();
  });

  it('101 (cap+1 for max-concurrent-subagents max=100) → stay editing + error', () => {
    const row = rowFor('max-concurrent-subagents', { 'max-concurrent-subagents': 40 });
    const state = makeState([row]);
    let s = reduce(state, 'e').state;
    s = { ...s, editing: { buffer: '101', caret: 3, error: null } };
    s = reduce(s, 'enter').state;
    expect(s.editing).not.toBeNull();
    expect(s.editing?.error).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edit mode — esc discards edit only
// ---------------------------------------------------------------------------

describe('flags-view-state — edit esc discards only', () => {
  it('esc exits edit mode without changing the value', () => {
    const row = rowFor('max-concurrent-subagents', { 'max-concurrent-subagents': 40 });
    const state = makeState([row]);
    let s = reduce(state, 'e').state;
    s = { ...s, editing: { buffer: '99', caret: 2, error: null } };
    s = reduce(s, 'escape').state;
    expect(s.editing).toBeNull(); // left edit mode
    expect(s.rows[0].configuredValue).toBe(40); // unchanged
  });

  it('esc in browse mode → cancel intent', () => {
    const row = rowFor('tui');
    const state = makeState([row]);
    const result = reduce(state, 'escape');
    expect(result.intent).toBe('cancel');
  });
});

// ---------------------------------------------------------------------------
// d = set devflow default
// ---------------------------------------------------------------------------

describe('flags-view-state — d key (devflow default)', () => {
  it('d sets configuredValue to devflowDefault', () => {
    // tui has devflowDefault = true
    const row = rowFor('tui', { tui: false }); // deviated from default
    const state = makeState([row]);
    const next = reduce(state, 'd').state;
    expect(next.rows[0].configuredValue).toBe(next.rows[0].devflowDefault);
    expect(next.rows[0].configuredValue).toBe(true);
  });

  it('d on view-mode sets to devflowDefault (null = default)', () => {
    const row = rowFor('view-mode', { 'view-mode': 'verbose' });
    const state = makeState([row]);
    const next = reduce(state, 'd').state;
    expect(next.rows[0].configuredValue).toBe(next.rows[0].devflowDefault);
    // devflowDefault for view-mode is null (mapped from 'default')
    expect(next.rows[0].configuredValue).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// u = unset (allowUnset rows only)
// ---------------------------------------------------------------------------

describe('flags-view-state — u key (unset)', () => {
  it('u unsets a number flag (sets to null)', () => {
    const row = rowFor('max-concurrent-subagents', { 'max-concurrent-subagents': 40 });
    const state = makeState([row]);
    const next = reduce(state, 'u').state;
    expect(next.rows[0].configuredValue).toBeNull();
  });

  it('u on a boolean row is a noop (allowUnset=false)', () => {
    const row = rowFor('tui', { tui: true });
    const state = makeState([row]);
    const next = reduce(state, 'u').state;
    // unchanged
    expect(next.rows[0].configuredValue).toBe(true);
  });

  it('u on view-mode enum sets to null (neutral)', () => {
    const row = rowFor('view-mode', { 'view-mode': 'verbose' });
    const state = makeState([row]);
    const next = reduce(state, 'u').state;
    expect(next.rows[0].configuredValue).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Intent — save, cancel, abort
// ---------------------------------------------------------------------------

describe('flags-view-state — intents', () => {
  it('enter in browse mode returns save intent', () => {
    // Note: enter on a boolean row enters browse save, enter on text enters edit
    const row = rowFor('tui');
    const state = makeState([row]);
    // tui is boolean, so enter = SAVE
    const result = reduce(state, 'enter');
    expect(result.intent).toBe('save');
  });

  it('q returns cancel intent', () => {
    const row = rowFor('tui');
    const state = makeState([row]);
    expect(reduce(state, 'q').intent).toBe('cancel');
  });

  it('ctrl-c returns abort intent', () => {
    const row = rowFor('tui');
    const state = makeState([row]);
    expect(reduce(state, 'ctrl-c').intent).toBe('abort');
  });

  it('esc in browse mode returns cancel intent', () => {
    const row = rowFor('tui');
    const state = makeState([row]);
    expect(reduce(state, 'escape').intent).toBe('cancel');
  });
});

// ---------------------------------------------------------------------------
// up/down ignored while editing
// ---------------------------------------------------------------------------

describe('flags-view-state — up/down ignored while editing', () => {
  it('up is ignored while in edit mode (cursor stays, no navigation)', () => {
    const rows = [
      rowFor('max-concurrent-subagents', { 'max-concurrent-subagents': 40 }),
      rowFor('subagent-spawn-depth', {}),
    ];
    const state = makeState(rows, { cursor: 1 });
    let s = reduce(state, 'e').state; // enter edit mode on cursor=1
    const cursorBefore = s.cursor;
    s = reduce(s, 'up').state;
    expect(s.cursor).toBe(cursorBefore); // cursor unchanged
    expect(s.editing).not.toBeNull(); // still editing
  });

  it('down is ignored while in edit mode', () => {
    const rows = [
      rowFor('max-concurrent-subagents', { 'max-concurrent-subagents': 40 }),
      rowFor('subagent-spawn-depth', {}),
    ];
    const state = makeState(rows, { cursor: 0 });
    let s = reduce(state, 'e').state;
    const cursorBefore = s.cursor;
    s = reduce(s, 'down').state;
    expect(s.cursor).toBe(cursorBefore);
    expect(s.editing).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Buffer hard-bounded at 64 on paste-like bulk insert
// ---------------------------------------------------------------------------

describe('flags-view-state — buffer hard-bound at 64', () => {
  it('typing 70 chars is clamped to 64', () => {
    const row = rowFor('default-model', {});
    const state = makeState([row]);
    let s = reduce(state, 'e').state;
    // Simulate inserting 70 'a' characters
    for (let i = 0; i < 70; i++) {
      s = reduce(s, 'a').state;
    }
    expect(s.editing).not.toBeNull();
    expect(s.editing!.buffer.length).toBeLessThanOrEqual(64);
  });
});

// ---------------------------------------------------------------------------
// collectFlagRecord — view-mode null → 'default'
// ---------------------------------------------------------------------------

describe('flags-view-state — collectFlagRecord', () => {
  it('view-mode null maps back to canonical "default" in the record', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, {});
    // Set view-mode to null (representing 'default')
    const viewModeRow = rows.find(r => r.id === 'view-mode')!;
    const modified = rows.map(r =>
      r.id === 'view-mode' ? { ...r, configuredValue: null } : r,
    );
    const record = collectFlagRecord(modified);
    expect(record['view-mode']).toBe('default');
  });

  it('collectFlagRecord preserves boolean true/false correctly', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, { tui: true, brief: false });
    const record = collectFlagRecord(rows);
    expect(record['tui']).toBe(true);
    expect(record['brief']).toBe(false);
  });

  it('collectFlagRecord preserves null for number flags', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, {});
    const modified = rows.map(r =>
      r.id === 'max-concurrent-subagents' ? { ...r, configuredValue: null } : r,
    );
    const record = collectFlagRecord(modified);
    expect(record['max-concurrent-subagents']).toBeNull();
  });

  it('collectFlagRecord preserves enum set value', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, { 'view-mode': 'verbose' });
    const record = collectFlagRecord(rows);
    expect(record['view-mode']).toBe('verbose');
  });
});

// ---------------------------------------------------------------------------
// buildFlagRows — row construction
// ---------------------------------------------------------------------------

describe('flags-view-state — buildFlagRows', () => {
  it('view-mode row has correct stops', () => {
    const row = rowFor('view-mode');
    expect(row.stops).toEqual([null, 'verbose', 'focus']);
    expect(row.stops).not.toContain('default');
  });

  it('view-mode devflowDefault is null (mapped from "default")', () => {
    const row = rowFor('view-mode');
    expect(row.devflowDefault).toBeNull();
  });

  it('boolean row has stops [true, false]', () => {
    const row = rowFor('tui');
    expect(row.stops).toEqual([true, false]);
  });

  it('number row has empty stops (text editing)', () => {
    const row = rowFor('max-concurrent-subagents');
    expect(row.stops).toEqual([]);
    expect(row.allowUnset).toBe(true);
  });

  it('string row has empty stops (text editing)', () => {
    const row = rowFor('default-model');
    expect(row.stops).toEqual([]);
    expect(row.allowUnset).toBe(true);
  });

  it('view-mode maps record value "verbose" to TUI "verbose" (no remap needed)', () => {
    const row = rowFor('view-mode', { 'view-mode': 'verbose' });
    expect(row.configuredValue).toBe('verbose');
  });

  it('view-mode maps record value "default" to TUI null', () => {
    const row = rowFor('view-mode', { 'view-mode': 'default' });
    expect(row.configuredValue).toBeNull();
  });

  it('originalValue equals configuredValue at construction', () => {
    const row = rowFor('tui', { tui: true });
    expect(row.originalValue).toBe(row.configuredValue);
    expect(row.originalValue).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edit-mode input handling (scrutinize pass)
//
// These pin three defects found by driving the reducer the way a user types,
// rather than by asserting the branches the implementation happens to have.
// ---------------------------------------------------------------------------

describe('edit mode — typed input', () => {
  /** Enter edit mode on a text row and type a sequence of normalized keys. */
  function typeInto(id: string, keys: string[]): FlagsViewState {
    let state = makeState([rowFor(id)]);
    state = reduce(state, 'e').state;
    expect(state.editing, 'expected to be in edit mode').not.toBeNull();
    for (const k of keys) state = reduce(state, k).state;
    return state;
  }

  it('space is inserted into the buffer, not dropped', () => {
    // normalizeKey maps the space bar to the NAME 'space' (5 chars), so a
    // length===1 test drops it. spellcheck holds a shell command — "aspell list"
    // must be typable, and the drop was silent (no error, no visual cue).
    const state = typeInto('spellcheck', [...'aspell', 'space', ...'list']);
    expect(state.editing?.buffer).toBe('aspell list');
    expect(state.editing?.caret).toBe('aspell list'.length);
  });

  it('j and k are inserted literally in edit mode (not swallowed as navigation)', () => {
    // Spec: literal q d u j k must insert in edit mode. 'j' and 'k' were grouped
    // with up/down and returned early, so multi-word commands like "aspell check"
    // and paths containing 'j'/'k' could not be entered without error or visual cue.
    const stateJ = typeInto('spellcheck', [...'as', 'j', ...'ell']);
    expect(stateJ.editing?.buffer).toBe('asjell');
    expect(stateJ.editing?.caret).toBe(6);

    const stateK = typeInto('spellcheck', [...'as', 'k', ...'ell']);
    expect(stateK.editing?.buffer).toBe('askell');
    expect(stateK.editing?.caret).toBe(6);
  });

  it('a space-containing command commits successfully', () => {
    let state = typeInto('spellcheck', [...'aspell', 'space', ...'list']);
    state = reduce(state, 'enter').state;
    expect(state.editing, 'commit should exit edit mode').toBeNull();
    expect(state.rows[0].configuredValue).toBe('aspell list');
  });

  it('control characters never enter the buffer', () => {
    // normalizeKey passes ctrl-modified keys through as their raw control byte,
    // so this is reachable by ordinary typing. coerceFlagValue rejects any string
    // containing one, and renderBuffer strips them for display — so a buffered
    // control char is both uncommittable and desyncs the caret from what is drawn.
    const state = typeInto('spellcheck', [...'aspell', '\x01', '\x1b', '\x7f']);
    expect(state.editing?.buffer).toBe('aspell');
    expect(state.editing?.caret).toBe(6);
  });

  it('ctrl-c aborts out of edit mode instead of being swallowed', () => {
    // reduceEditMode has no ctrl-c case, so it used to fall through to 'none'.
    // Raw mode suppresses the SIGINT that would otherwise rescue the user, so
    // ctrl-c was completely dead while editing.
    const state = typeInto('spellcheck', [...'asp']);
    expect(reduce(state, 'ctrl-c').intent).toBe('abort');
  });

  it('escape still discards the edit without aborting', () => {
    // Guard against over-correcting the ctrl-c fix into escape.
    const state = typeInto('spellcheck', [...'asp']);
    const result = reduce(state, 'escape');
    expect(result.intent).toBe('none');
    expect(result.state.editing).toBeNull();
    expect(result.state.rows[0].configuredValue).toBe(rowFor('spellcheck').configuredValue);
  });
});

describe('resizeViewport', () => {
  const rows = buildFlagRows(FLAG_REGISTRY, {});

  it('re-clamps the scroll offset so the cursor stays visible when the terminal shrinks', () => {
    // adjustViewport otherwise only runs on up/down, so a resize changed the height
    // without moving the offset — leaving the cursor outside the visible slice, where
    // renderFrame draws no selection marker at all until the user pressed an arrow key.
    const tall = makeState([...rows], { cursor: 15, viewportOffset: 0, viewportHeight: 30 });
    const shrunk = resizeViewport(tall, 5);

    expect(shrunk.viewportHeight).toBe(5);
    expect(shrunk.cursor).toBe(15);
    // Cursor must lie inside [offset, offset + height)
    expect(shrunk.cursor).toBeGreaterThanOrEqual(shrunk.viewportOffset);
    expect(shrunk.cursor).toBeLessThan(shrunk.viewportOffset + shrunk.viewportHeight);
  });

  it('does not scroll past the end when the terminal grows', () => {
    const small = makeState([...rows], { cursor: 2, viewportOffset: 8, viewportHeight: 3 });
    const grown = resizeViewport(small, rows.length + 10);

    expect(grown.viewportOffset).toBe(0);
    expect(grown.cursor).toBe(2);
  });

  it('is a no-op on state when the height is unchanged and the cursor is visible', () => {
    const stable = makeState([...rows], { cursor: 1, viewportOffset: 0, viewportHeight: 10 });
    const same = resizeViewport(stable, 10);
    expect(same.viewportOffset).toBe(0);
    expect(same.viewportHeight).toBe(10);
  });
});
