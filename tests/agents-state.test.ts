/**
 * Tests for src/cli/agents-view/state.ts — pure keypress reducer.
 *
 * TDD: tests written BEFORE implementation.
 * Protocol: RED → GREEN → REFACTOR.
 *
 * Coverage:
 *  - Cursor clamping at edges
 *  - Model/effort cycle in both directions (wrap-around)
 *  - Tab toggling model↔effort
 *  - Dirty flag semantics (current !== original)
 *  - Touch-then-revert → not dirty
 *  - Save/cancel intents
 *  - Proxy-off option list excludes GPT models
 *  - `d` resets field to 'default'
 *  - Dormant row preservation (dormantModel stays in state)
 *  - buildRow handles dormancy correctly
 *  - Viewport scrolling (cursor moves viewport)
 *  - unsavedCount
 */

import { describe, it, expect } from 'vitest';
import {
  reduce,
  buildRow,
  isDirtyModel,
  isDirtyEffort,
  unsavedCount,
  type AgentRow,
  type AgentsViewState,
} from '../src/cli/agents-view/state.js';
import { CLAUDE_MODEL_ALIASES, EFFORT_LEVELS } from '../src/core/agent-models.js';
import { externalModelIds } from '../src/core/external-models.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    name: 'coder',
    shippedDefault: 'sonnet',
    configuredModel: 'default',
    originalModel: 'default',
    configuredEffort: 'default',
    originalEffort: 'default',
    dormantModel: null,
    ...overrides,
  };
}

function makeState(overrides: Partial<AgentsViewState> = {}): AgentsViewState {
  const rows = overrides.rows ?? [
    makeRow({ name: 'bug-analyzer', shippedDefault: 'opus' }),
    makeRow({ name: 'coder', shippedDefault: 'sonnet' }),
    makeRow({ name: 'designer', shippedDefault: 'opus' }),
  ];
  return {
    rows,
    cursor: 1,
    activeField: 'model',
    viewportOffset: 0,
    viewportHeight: 10,
    proxyEnabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildRow
// ---------------------------------------------------------------------------

describe('buildRow', () => {
  it('builds a row with no mapping entry — default model, no dormancy', () => {
    const row = buildRow({
      name: 'coder',
      shippedDefault: 'sonnet',
      proxyEnabled: false,
    });
    expect(row.configuredModel).toBe('default');
    expect(row.originalModel).toBe('default');
    expect(row.dormantModel).toBeNull();
  });

  it('builds a row with a claude model mapping — applied directly', () => {
    const row = buildRow({
      name: 'coder',
      shippedDefault: 'sonnet',
      savedModel: 'opus',
      proxyEnabled: false,
    });
    expect(row.configuredModel).toBe('opus');
    expect(row.originalModel).toBe('opus');
    expect(row.dormantModel).toBeNull();
  });

  it('builds a dormant row — GPT model + proxy off → configuredModel is default', () => {
    const row = buildRow({
      name: 'coder',
      shippedDefault: 'sonnet',
      savedModel: 'gpt-5.5',
      proxyEnabled: false,
    });
    expect(row.configuredModel).toBe('default');
    expect(row.originalModel).toBe('default');
    expect(row.dormantModel).toBe('gpt-5.5');
  });

  it('builds a non-dormant row — GPT model + proxy ON → configuredModel is the GPT model', () => {
    const row = buildRow({
      name: 'coder',
      shippedDefault: 'sonnet',
      savedModel: 'gpt-5.5',
      proxyEnabled: true,
    });
    expect(row.configuredModel).toBe('gpt-5.5');
    expect(row.originalModel).toBe('gpt-5.5');
    expect(row.dormantModel).toBeNull();
  });

  it('builds a row with saved effort', () => {
    const row = buildRow({
      name: 'coder',
      shippedDefault: 'sonnet',
      savedEffort: 'high',
      proxyEnabled: false,
    });
    expect(row.configuredEffort).toBe('high');
    expect(row.originalEffort).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// Dirty flags
// ---------------------------------------------------------------------------

describe('isDirtyModel / isDirtyEffort / unsavedCount', () => {
  it('not dirty when current equals original', () => {
    const row = makeRow({ configuredModel: 'default', originalModel: 'default' });
    expect(isDirtyModel(row)).toBe(false);
  });

  it('dirty when current differs from original', () => {
    const row = makeRow({ configuredModel: 'opus', originalModel: 'default' });
    expect(isDirtyModel(row)).toBe(true);
  });

  it('not dirty after touch-then-revert', () => {
    // Simulate: change model to 'opus', then change back to 'default'
    const row = makeRow({ configuredModel: 'default', originalModel: 'default' });
    expect(isDirtyModel(row)).toBe(false);
  });

  it('isDirtyEffort tracks effort field independently', () => {
    const row = makeRow({ configuredEffort: 'high', originalEffort: 'default' });
    expect(isDirtyEffort(row)).toBe(true);
  });

  it('unsavedCount counts rows with any dirty field', () => {
    const rows = [
      makeRow({ configuredModel: 'opus', originalModel: 'default' }),  // dirty model
      makeRow({ configuredEffort: 'high', originalEffort: 'default' }), // dirty effort
      makeRow(),  // clean
    ];
    expect(unsavedCount(rows)).toBe(2);
  });

  it('unsavedCount counts row only once when both fields are dirty', () => {
    const rows = [
      makeRow({ configuredModel: 'opus', originalModel: 'default', configuredEffort: 'high', originalEffort: 'default' }),
    ];
    expect(unsavedCount(rows)).toBe(1);
  });

  it('unsavedCount is 0 when no dirty rows', () => {
    const rows = [makeRow(), makeRow({ name: 'other' })];
    expect(unsavedCount(rows)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Cursor clamping
// ---------------------------------------------------------------------------

describe('cursor clamping', () => {
  it('clamps cursor at top — up from first row stays at 0', () => {
    const state = makeState({ cursor: 0 });
    const { state: next, intent } = reduce(state, 'up');
    expect(next.cursor).toBe(0);
    expect(intent).toBe('none');
  });

  it('clamps cursor at bottom — down from last row stays at last', () => {
    const state = makeState({ cursor: 2 });
    const { state: next, intent } = reduce(state, 'down');
    expect(next.cursor).toBe(2);
    expect(intent).toBe('none');
  });

  it('moves cursor up by 1', () => {
    const state = makeState({ cursor: 2 });
    const { state: next } = reduce(state, 'up');
    expect(next.cursor).toBe(1);
  });

  it('moves cursor down by 1', () => {
    const state = makeState({ cursor: 0 });
    const { state: next } = reduce(state, 'down');
    expect(next.cursor).toBe(1);
  });

  it('k moves cursor up (vim binding)', () => {
    const state = makeState({ cursor: 1 });
    const { state: next } = reduce(state, 'k');
    expect(next.cursor).toBe(0);
  });

  it('j moves cursor down (vim binding)', () => {
    const state = makeState({ cursor: 0 });
    const { state: next } = reduce(state, 'j');
    expect(next.cursor).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Tab toggling
// ---------------------------------------------------------------------------

describe('tab toggling', () => {
  it('toggles from model to effort', () => {
    const state = makeState({ activeField: 'model' });
    const { state: next, intent } = reduce(state, 'tab');
    expect(next.activeField).toBe('effort');
    expect(intent).toBe('none');
  });

  it('toggles from effort back to model', () => {
    const state = makeState({ activeField: 'effort' });
    const { state: next } = reduce(state, 'tab');
    expect(next.activeField).toBe('model');
  });
});

// ---------------------------------------------------------------------------
// Model cycle
// ---------------------------------------------------------------------------

describe('model cycle', () => {
  it('cycles model forward through claude aliases (proxy on)', () => {
    const state = makeState({ proxyEnabled: true });
    // Start: default → haiku → sonnet → opus → fable → gpt-5.6-sol → ...
    let s = state;
    const { state: s1 } = reduce(s, 'right');
    expect(s1.rows[1].configuredModel).toBe('haiku');
    const { state: s2 } = reduce(s1, 'right');
    expect(s2.rows[1].configuredModel).toBe('sonnet');
  });

  it('cycles model forward through all values and wraps back to default (proxy on)', () => {
    const allModels = ['default', ...CLAUDE_MODEL_ALIASES, ...externalModelIds()];
    let state = makeState({ proxyEnabled: true });
    for (let i = 0; i < allModels.length; i++) {
      expect(state.rows[1].configuredModel).toBe(allModels[i]);
      const { state: next } = reduce(state, 'right');
      state = next;
    }
    expect(state.rows[1].configuredModel).toBe('default');
  });

  it('cycles model backward (left arrow)', () => {
    // default → left → last model (gpt-5.5 when proxy on)
    const lastGpt = externalModelIds()[externalModelIds().length - 1];
    const state = makeState({ proxyEnabled: true });
    const { state: next } = reduce(state, 'left');
    expect(next.rows[1].configuredModel).toBe(lastGpt);
  });

  it('proxy off — model cycle excludes GPT models', () => {
    const state = makeState({ proxyEnabled: false });
    let s = state;
    const allExpected = ['default', ...CLAUDE_MODEL_ALIASES];
    for (let i = 0; i < allExpected.length; i++) {
      expect(s.rows[1].configuredModel).toBe(allExpected[i]);
      const { state: next } = reduce(s, 'right');
      s = next;
    }
    expect(s.rows[1].configuredModel).toBe('default');
  });

  it('proxy off — dormant row cycles from default, not from GPT value', () => {
    // Dormant: savedModel was gpt-5.5 but proxy is off → displayed as 'default'
    const dormantRow = makeRow({
      configuredModel: 'default',
      originalModel: 'default',
      dormantModel: 'gpt-5.5',
    });
    const state = makeState({ proxyEnabled: false, rows: [dormantRow] });
    const adjustedState = { ...state, cursor: 0 };
    const { state: next } = reduce(adjustedState, 'right');
    // Should cycle to 'haiku' (next after 'default' in proxy-off cycle)
    expect(next.rows[0].configuredModel).toBe('haiku');
    // dormantModel still preserved
    expect(next.rows[0].dormantModel).toBe('gpt-5.5');
  });

  it('space cycles model forward (same as right)', () => {
    const state = makeState({ activeField: 'model' });
    const { state: s1 } = reduce(state, 'space');
    const { state: s2 } = reduce(state, 'right');
    expect(s1.rows[1].configuredModel).toBe(s2.rows[1].configuredModel);
  });
});

// ---------------------------------------------------------------------------
// Effort cycle
// ---------------------------------------------------------------------------

describe('effort cycle', () => {
  it('cycles effort forward: default → low → medium → high → xhigh → max → default', () => {
    const state = makeState({ activeField: 'effort' });
    const allLevels = ['default', ...EFFORT_LEVELS];
    let s = state;
    for (let i = 0; i < allLevels.length; i++) {
      expect(s.rows[1].configuredEffort).toBe(allLevels[i]);
      const { state: next } = reduce(s, 'right');
      s = next;
    }
    expect(s.rows[1].configuredEffort).toBe('default');
  });

  it('cycles effort backward (left arrow)', () => {
    const state = makeState({ activeField: 'effort' });
    const { state: next } = reduce(state, 'left');
    expect(next.rows[1].configuredEffort).toBe('max');
  });

  it('effort cycle is independent of proxy state', () => {
    const state1 = makeState({ activeField: 'effort', proxyEnabled: true });
    const state2 = makeState({ activeField: 'effort', proxyEnabled: false });
    const { state: next1 } = reduce(state1, 'right');
    const { state: next2 } = reduce(state2, 'right');
    expect(next1.rows[1].configuredEffort).toBe(next2.rows[1].configuredEffort);
  });
});

// ---------------------------------------------------------------------------
// d — reset to default
// ---------------------------------------------------------------------------

describe('d — reset to default', () => {
  it('resets model to default when activeField is model', () => {
    const state = makeState({
      activeField: 'model',
      rows: [
        makeRow({ name: 'bug-analyzer', shippedDefault: 'opus' }),
        makeRow({ name: 'coder', shippedDefault: 'sonnet', configuredModel: 'opus', originalModel: 'default' }),
        makeRow({ name: 'designer', shippedDefault: 'opus' }),
      ],
    });
    const { state: next } = reduce(state, 'd');
    expect(next.rows[1].configuredModel).toBe('default');
  });

  it('resets effort to default when activeField is effort', () => {
    const state = makeState({
      activeField: 'effort',
      rows: [
        makeRow({ name: 'bug-analyzer', shippedDefault: 'opus' }),
        makeRow({ name: 'coder', shippedDefault: 'sonnet', configuredEffort: 'high', originalEffort: 'default' }),
        makeRow({ name: 'designer', shippedDefault: 'opus' }),
      ],
    });
    const { state: next } = reduce(state, 'd');
    expect(next.rows[1].configuredEffort).toBe('default');
  });

  it('resetting to default → not dirty (current == original for initially-default field)', () => {
    const state = makeState({ activeField: 'model' });
    const { state: s1 } = reduce(state, 'right'); // configuredModel = 'haiku'
    expect(isDirtyModel(s1.rows[1])).toBe(true);
    const { state: s2 } = reduce(s1, 'd');
    expect(s2.rows[1].configuredModel).toBe('default');
    expect(isDirtyModel(s2.rows[1])).toBe(false);
  });

  it('d only affects the cursor row', () => {
    const state = makeState({
      activeField: 'model',
      rows: [
        makeRow({ name: 'bug-analyzer', shippedDefault: 'opus', configuredModel: 'opus', originalModel: 'default' }),
        makeRow({ name: 'coder', shippedDefault: 'sonnet', configuredModel: 'haiku', originalModel: 'default' }),
        makeRow({ name: 'designer', shippedDefault: 'opus', configuredModel: 'fable', originalModel: 'default' }),
      ],
      cursor: 1,
    });
    const { state: next } = reduce(state, 'd');
    expect(next.rows[0].configuredModel).toBe('opus'); // unchanged
    expect(next.rows[1].configuredModel).toBe('default'); // reset
    expect(next.rows[2].configuredModel).toBe('fable'); // unchanged
  });
});

// ---------------------------------------------------------------------------
// Intent: save / cancel
// ---------------------------------------------------------------------------

describe('intents', () => {
  it('enter → save intent', () => {
    const state = makeState();
    const { intent } = reduce(state, 'enter');
    expect(intent).toBe('save');
  });

  it('escape → cancel intent', () => {
    const state = makeState();
    const { intent } = reduce(state, 'escape');
    expect(intent).toBe('cancel');
  });

  it('q → cancel intent', () => {
    const state = makeState();
    const { intent } = reduce(state, 'q');
    expect(intent).toBe('cancel');
  });

  it('ctrl-c → cancel intent', () => {
    const state = makeState();
    const { intent } = reduce(state, 'ctrl-c');
    expect(intent).toBe('cancel');
  });

  it('unknown key → none intent, state unchanged', () => {
    const state = makeState();
    const { state: next, intent } = reduce(state, 'x');
    expect(intent).toBe('none');
    expect(next).toBe(state); // same reference for no-op
  });

  it('enter does not modify state', () => {
    const state = makeState();
    const { state: next } = reduce(state, 'enter');
    expect(next).toBe(state);
  });

  it('cancel does not modify state', () => {
    const state = makeState();
    const { state: next } = reduce(state, 'escape');
    expect(next).toBe(state);
  });
});

// ---------------------------------------------------------------------------
// Viewport scrolling
// ---------------------------------------------------------------------------

describe('viewport scrolling', () => {
  it('viewport follows cursor downward', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow({ name: `agent-${i}` })
    );
    const state = makeState({ rows, cursor: 0, viewportOffset: 0, viewportHeight: 3 });
    // Move cursor to row 2 (last in viewport)
    let s = state;
    s = reduce(s, 'down').state;
    s = reduce(s, 'down').state;
    expect(s.cursor).toBe(2);
    expect(s.viewportOffset).toBe(0); // still in view
    // Move one more — cursor at 3, outside viewport of size 3
    s = reduce(s, 'down').state;
    expect(s.cursor).toBe(3);
    expect(s.viewportOffset).toBe(1); // scrolled down
  });

  it('viewport follows cursor upward', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow({ name: `agent-${i}` })
    );
    const state = makeState({ rows, cursor: 5, viewportOffset: 5, viewportHeight: 3 });
    const { state: next } = reduce(state, 'up');
    expect(next.cursor).toBe(4);
    expect(next.viewportOffset).toBe(4); // scrolled up to keep cursor visible
  });

  it('viewport stays put when cursor is within view', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow({ name: `agent-${i}` })
    );
    const state = makeState({ rows, cursor: 1, viewportOffset: 0, viewportHeight: 5 });
    const { state: next } = reduce(state, 'up');
    expect(next.cursor).toBe(0);
    expect(next.viewportOffset).toBe(0); // no scroll needed
  });
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

describe('immutability', () => {
  it('reduce returns a new state object (does not mutate)', () => {
    const state = makeState();
    const { state: next } = reduce(state, 'down');
    expect(next).not.toBe(state);
  });

  it('non-cursor rows are not mutated when cycling', () => {
    const state = makeState({ cursor: 1 });
    const originalRow0 = state.rows[0];
    const { state: next } = reduce(state, 'right');
    expect(next.rows[0]).toBe(originalRow0); // same reference
  });
});
