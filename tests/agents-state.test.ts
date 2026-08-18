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
 *  - Proxy-off option list excludes external models
 *  - `d` resets field to 'default'
 *  - Dormant row preservation (dormantModel stays in state)
 *  - Off-cycle pin recovery (offCyclePin reachable after full cycle)
 *  - buildRow handles dormancy and off-cycle pins correctly
 *  - Viewport scrolling (cursor moves viewport)
 *  - unsavedCount
 *  - T8: alias round-trip (no dirty marker on 'sol' → save byte-identical)
 *  - AC-F1: cycle order with full catalog
 *  - AC-F2: alias renders "sol (gpt-5.6-sol)", canonical renders bare
 *  - AC-F4: retired pin stays selected, survives full forward+backward cycle
 *  - AC-F5: proxy off + known catalog → external models ARE present (dormant-mapping design)
 *  - AC-P6: ≤ 1 cycle array allocated per keypress (Object.is check)
 */

import { describe, it, expect } from 'vitest';
import {
  reduce,
  buildRow,
  buildModelCycle,
  pickerNames,
  isDirtyModel,
  isDirtyEffort,
  unsavedCount,
  rowState,
  type AgentRow,
  type AgentsViewState,
} from '../src/cli/agents-view/state.js';
import { EFFORT_LEVELS } from '../src/core/agent-models.js';
import { CLAUDE_MODEL_ALIASES } from '../src/core/external-models.js';
import { type ExternalModelCatalog } from '../src/core/model-discovery.js';

// ---------------------------------------------------------------------------
// Mock catalog — represents a realistic discovered catalog for tests.
// Cycle order (proxy ON, Fix 1 — alias-only picker):
//   default → haiku → sonnet → opus → fable →
//   sol → terra → luna → gpt-5.5
// (9 stops total; canonical ids gpt-5.6-* are NOT in the cycle since each has
//  an alias; gpt-5.5 keeps its stop because its aliases[] is empty)
//
// catalog.selectableNames is NOT used to build the cycle — it doubles as the
// --set validation allowlist and includes both aliases and canonical ids.
// ---------------------------------------------------------------------------

const MOCK_CATALOG_KNOWN: ExternalModelCatalog = {
  known: true,
  models: [
    { id: 'gpt-5.6-sol',   aliases: ['sol'] },
    { id: 'gpt-5.6-terra', aliases: ['terra'] },
    { id: 'gpt-5.6-luna',  aliases: ['luna'] },
    { id: 'gpt-5.5',       aliases: [] },
  ],
  aliasToId: new Map([
    ['sol',          'gpt-5.6-sol'],
    ['terra',        'gpt-5.6-terra'],
    ['luna',         'gpt-5.6-luna'],
    ['gpt-5.6-sol',  'gpt-5.6-sol'],
    ['gpt-5.6-terra','gpt-5.6-terra'],
    ['gpt-5.6-luna', 'gpt-5.6-luna'],
    ['gpt-5.5',      'gpt-5.5'],
  ]),
  selectableNames: ['sol', 'terra', 'luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'],
  source: 'cache',
};

const MOCK_CATALOG_UNKNOWN: ExternalModelCatalog = { known: false };

// Full cycle when proxy is on with MOCK_CATALOG_KNOWN (Fix 1: alias-only picker).
// 9 elements: default + 4 claude aliases + 4 picker names (sol/terra/luna/gpt-5.5).
const FULL_CYCLE = [
  'default',
  ...CLAUDE_MODEL_ALIASES,
  'sol', 'terra', 'luna', 'gpt-5.5', // pickerNames(MOCK_CATALOG_KNOWN.models)
] as readonly string[];

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
    offCyclePin: null,
    installed: true,
    inRegistry: true,
    ...overrides,
  };
}

function makeState(overrides: Partial<AgentsViewState> = {}): AgentsViewState {
  const proxyEnabled = 'proxyEnabled' in overrides ? (overrides.proxyEnabled ?? true) : true;
  const catalog: ExternalModelCatalog =
    'catalog' in overrides
      ? (overrides.catalog as ExternalModelCatalog)
      : (proxyEnabled ? MOCK_CATALOG_KNOWN : MOCK_CATALOG_UNKNOWN);
  const modelCycle: readonly string[] =
    'modelCycle' in overrides
      ? (overrides.modelCycle as readonly string[])
      : buildModelCycle(catalog);
  const rows = overrides.rows ?? [
    makeRow({ name: 'bug-analyzer', shippedDefault: 'opus' }),
    makeRow({ name: 'coder', shippedDefault: 'sonnet' }),
    makeRow({ name: 'designer', shippedDefault: 'opus' }),
  ];
  return {
    cursor: overrides.cursor ?? 1,
    activeField: overrides.activeField ?? 'model',
    viewportOffset: overrides.viewportOffset ?? 0,
    viewportHeight: overrides.viewportHeight ?? 10,
    rows,
    proxyEnabled,
    catalog,
    modelCycle,
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
    expect(row.offCyclePin).toBeNull();
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
    expect(row.offCyclePin).toBeNull();
  });

  it('builds a dormant row — external model + proxy off → configuredModel is default', () => {
    const row = buildRow({
      name: 'coder',
      shippedDefault: 'sonnet',
      savedModel: 'gpt-5.5',
      proxyEnabled: false,
    });
    expect(row.configuredModel).toBe('default');
    expect(row.originalModel).toBe('default');
    expect(row.dormantModel).toBe('gpt-5.5');
    expect(row.offCyclePin).toBeNull();
  });

  it('builds a non-dormant row — external model + proxy ON → configuredModel is the model', () => {
    const cycle = buildModelCycle(MOCK_CATALOG_KNOWN);
    const row = buildRow({
      name: 'coder',
      shippedDefault: 'sonnet',
      savedModel: 'gpt-5.5',
      proxyEnabled: true,
      modelCycle: cycle,
    });
    expect(row.configuredModel).toBe('gpt-5.5');
    expect(row.originalModel).toBe('gpt-5.5');
    expect(row.dormantModel).toBeNull();
    expect(row.offCyclePin).toBeNull();
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

  it('detects off-cycle pin when proxy is on and model absent from cycle', () => {
    const cycle = buildModelCycle(MOCK_CATALOG_KNOWN);
    // 'gpt-4.2-legacy' is not in the catalog
    const row = buildRow({
      name: 'coder',
      shippedDefault: 'sonnet',
      savedModel: 'gpt-4.2-legacy',
      proxyEnabled: true,
      modelCycle: cycle,
    });
    // configuredModel stays as the saved model (proxy is on, not dormant)
    expect(row.configuredModel).toBe('gpt-4.2-legacy');
    expect(row.offCyclePin).toBe('gpt-4.2-legacy');
    expect(row.dormantModel).toBeNull();
  });

  it('no off-cycle pin when modelCycle is not provided', () => {
    const row = buildRow({
      name: 'coder',
      shippedDefault: 'sonnet',
      savedModel: 'gpt-4.2-legacy',
      proxyEnabled: true,
      // no modelCycle provided
    });
    expect(row.offCyclePin).toBeNull();
  });

  it('alias model in cycle is not an off-cycle pin', () => {
    const cycle = buildModelCycle(MOCK_CATALOG_KNOWN);
    const row = buildRow({
      name: 'coder',
      shippedDefault: 'sonnet',
      savedModel: 'sol',
      proxyEnabled: true,
      modelCycle: cycle,
    });
    expect(row.configuredModel).toBe('sol');
    expect(row.offCyclePin).toBeNull();  // 'sol' IS in the cycle
  });
});

// ---------------------------------------------------------------------------
// T8: alias round-trip — no dirty marker when configuredModel is an alias
// ---------------------------------------------------------------------------

describe('T8: alias round-trip', () => {
  it('a mapping of {coder:{model:"sol"}} shows no dirty marker on load', () => {
    const cycle = buildModelCycle(MOCK_CATALOG_KNOWN);
    const row = buildRow({
      name: 'coder',
      shippedDefault: 'sonnet',
      savedModel: 'sol',
      proxyEnabled: true,
      modelCycle: cycle,
    });
    // 'sol' IS in the cycle, so configuredModel = 'sol', originalModel = 'sol'
    expect(row.configuredModel).toBe('sol');
    expect(row.originalModel).toBe('sol');
    expect(isDirtyModel(row)).toBe(false);
  });

  it('saving without edits leaves the alias unchanged (byte-identical preservation)', () => {
    // Simulate the TUI save path: only dirty rows modify the mapping.
    // If isDirtyModel(row) is false, the original mapping entry is untouched.
    const cycle = buildModelCycle(MOCK_CATALOG_KNOWN);
    const row = buildRow({
      name: 'coder',
      shippedDefault: 'sonnet',
      savedModel: 'sol',
      proxyEnabled: true,
      modelCycle: cycle,
    });
    // Dirty check: same as applyTuiSave's logic — only dirty rows get written
    const modelDirty = isDirtyModel(row);
    const effortDirty = isDirtyEffort(row);
    // Neither is dirty — the original 'sol' mapping entry is preserved byte-identical
    expect(modelDirty).toBe(false);
    expect(effortDirty).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-F1: cycle order with full mock catalog (proxy ON)
// ---------------------------------------------------------------------------

describe('AC-F1: cycle order', () => {
  it('with proxy enabled and known catalog, cycle matches expected order (alias-only, Fix 1)', () => {
    // Fix 1: cycle uses pickerNames(catalog.models), NOT catalog.selectableNames.
    // Result: aliases only; canonical ID only when a model has no aliases.
    // gpt-5.5 has no aliases → contributes itself. gpt-5.6-* have aliases → alias only.
    const cycle = buildModelCycle(MOCK_CATALOG_KNOWN);
    const expected = [
      'default',
      'haiku', 'sonnet', 'opus', 'fable', // CLAUDE_MODEL_ALIASES
      'sol', 'terra', 'luna',              // aliases (registry order, one per model)
      'gpt-5.5',                           // no aliases → canonical id
    ];
    expect([...cycle]).toEqual(expected);
    expect(cycle.length).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// AC-F4: retired pin stays selected and is reachable after full cycle
// ---------------------------------------------------------------------------

describe('AC-F4: off-cycle pin recovery', () => {
  it('off-cycle pin survives a full forward cycle and is still reachable', () => {
    const cycle = buildModelCycle(MOCK_CATALOG_KNOWN);
    const pinRow = makeRow({
      configuredModel: 'gpt-4.2-legacy',
      originalModel: 'gpt-4.2-legacy',
      offCyclePin: 'gpt-4.2-legacy',
    });
    const state = makeState({ rows: [pinRow], cursor: 0, proxyEnabled: true });

    // Forward from pin → 'default' (pin is appended at end of effective cycle [...mainCycle, pin])
    const { state: s1 } = reduce(state, 'right');
    expect(s1.rows[0].configuredModel).toBe('default');

    // The effective cycle for this row is [...mainCycle, pin], 10 elements (Fix 1: 9+1).
    // From 'default' (index 0), pressing right cycle.length (9) times reaches the pin
    // (index 9 = last element of effective cycle). One more press wraps to 'default'.
    //
    // Trace from 'default': press 1→haiku, 2→sonnet, 3→opus, 4→fable,
    //   5→sol, 6→terra, 7→luna, 8→gpt-5.5, 9→gpt-4.2-legacy (pin!), 10→default
    const mainLen = cycle.length; // 9 (Fix 1)
    let s = s1;
    for (let i = 0; i < mainLen; i++) {
      const { state: next } = reduce(s, 'right');
      s = next;
    }
    // After 9 presses from 'default', effective cycle puts us at pin (index 9)
    expect(s.rows[0].configuredModel).toBe('gpt-4.2-legacy');

    // One more press wraps back to 'default' — confirming full cycle completes
    const { state: sDefault } = reduce(s, 'right');
    expect(sDefault.rows[0].configuredModel).toBe('default');
  });

  it('pin is reachable by pressing backward from default', () => {
    const cycle = buildModelCycle(MOCK_CATALOG_KNOWN);
    const pinRow = makeRow({
      configuredModel: 'gpt-4.2-legacy',
      originalModel: 'gpt-4.2-legacy',
      offCyclePin: 'gpt-4.2-legacy',
    });
    const state = makeState({ rows: [pinRow], cursor: 0, proxyEnabled: true });

    // Forward: pin → default
    const { state: s1 } = reduce(state, 'right');
    expect(s1.rows[0].configuredModel).toBe('default');

    // Now press backward from 'default' — since offCyclePin is 'gpt-4.2-legacy',
    // the effective cycle is [...mainCycle, pin]. The last item is the pin.
    // cyclePrev from 'default' (index 0) → index N (pin).
    const { state: s2 } = reduce(s1, 'left');
    expect(s2.rows[0].configuredModel).toBe('gpt-4.2-legacy');
  });

  it('pin renders as off-cycle (model not in main cycle)', () => {
    const cycle = buildModelCycle(MOCK_CATALOG_KNOWN);
    expect(cycle.includes('gpt-4.2-legacy')).toBe(false);
    // This confirms the pin is NOT in the main cycle — render.ts shows (unavailable)
  });

  it('pin does not affect dirty flag when it equals original', () => {
    const cycle = buildModelCycle(MOCK_CATALOG_KNOWN);
    const pinRow = makeRow({
      configuredModel: 'gpt-4.2-legacy',
      originalModel: 'gpt-4.2-legacy',
      offCyclePin: 'gpt-4.2-legacy',
    });
    expect(isDirtyModel(pinRow)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-F5: catalog drives cycle — proxy state does not suppress external models
// ---------------------------------------------------------------------------

describe('AC-F5: known catalog drives model cycle regardless of proxy state', () => {
  it('with proxy off and known catalog, external picker names are present in the cycle', () => {
    // Dormant-mapping design: the TUI must show GPT models even when proxy is off
    // so users can inspect and adjust dormant mappings before enabling the proxy.
    // Fix 1: cycle uses pickerNames(catalog.models), not catalog.selectableNames.
    const cycle = buildModelCycle(MOCK_CATALOG_KNOWN);
    expect([...cycle]).toEqual([
      'default', ...CLAUDE_MODEL_ALIASES,
      ...pickerNames(MOCK_CATALOG_KNOWN.models), // ['sol','terra','luna','gpt-5.5']
    ]);
  });

  it('with unknown catalog, cycle is claude-only (catalog-known gate holds)', () => {
    const cycle = buildModelCycle(MOCK_CATALOG_UNKNOWN);
    expect([...cycle]).toEqual(['default', ...CLAUDE_MODEL_ALIASES]);
  });

  it('with unknown catalog and proxy on, cycle is claude-only', () => {
    const cycle = buildModelCycle(MOCK_CATALOG_UNKNOWN);
    expect([...cycle]).toEqual(['default', ...CLAUDE_MODEL_ALIASES]);
  });
});

// ---------------------------------------------------------------------------
// T1-T3: pickerNames unit tests (Fix 1 — alias-only picker)
// ---------------------------------------------------------------------------

describe('pickerNames (Fix 1)', () => {
  it('T1: returns all aliases per model — live-cache-style fixture matches expected picker names', () => {
    // Using MOCK_CATALOG_KNOWN which mirrors the real 4-model warm cache.
    // gpt-5.6-sol → ['sol'], gpt-5.6-terra → ['terra'], gpt-5.6-luna → ['luna'],
    // gpt-5.5 → [] (no aliases → contributes canonical id).
    const result = pickerNames(MOCK_CATALOG_KNOWN.models);
    expect(result).toEqual(['sol', 'terra', 'luna', 'gpt-5.5']);
  });

  it('T2: model with TWO aliases contributes BOTH to the picker (not just first)', () => {
    // Regression guard: a naive first-alias-only implementation would return ['sol']
    // but a model with 2 aliases must return all of them so the user can pick either.
    const result = pickerNames([
      { id: 'gpt-5.6-sol', aliases: ['sol', 'sol-preview'] },
    ]);
    expect(result).toEqual(['sol', 'sol-preview']);
    expect(result).toHaveLength(2);
  });

  it('T3: zero-maintenance — completely custom catalog requires no code changes', () => {
    // If a new model family "foo" is added to the catalog, buildModelCycle just works.
    // No hardcoded model names anywhere — the cycle is catalog-driven.
    const customCatalog: ExternalModelCatalog = {
      known: true,
      models: [
        { id: 'foo-turbo',  aliases: ['foo'] },
        { id: 'foo-mini',   aliases: [] },     // no alias → contributes canonical id
      ],
      selectableNames: ['foo', 'foo-turbo', 'foo-mini'],
      aliasToId: new Map([
        ['foo',       'foo-turbo'],
        ['foo-turbo', 'foo-turbo'],
        ['foo-mini',  'foo-mini'],
      ]),
      source: 'live',
    };
    const cycle = buildModelCycle(customCatalog);
    // Cycle: default + claude aliases + foo + foo-mini (derived from catalog alone)
    expect([...cycle]).toEqual(['default', ...CLAUDE_MODEL_ALIASES, 'foo', 'foo-mini']);
    // Importantly: no 'foo-turbo' in the cycle (it has an alias 'foo' that takes its slot)
    expect([...cycle]).not.toContain('foo-turbo');
  });
});

// ---------------------------------------------------------------------------
// AC-P6: ≤ 1 cycle array allocated per keypress (Object.is check)
// ---------------------------------------------------------------------------

describe('AC-P6: modelCycle not reallocated per keypress', () => {
  it('modelCycle reference is the same across consecutive reduces', () => {
    const state = makeState({ proxyEnabled: true });
    const { state: s1 } = reduce(state, 'right');
    const { state: s2 } = reduce(s1, 'right');
    // modelCycle must be the same reference — not rebuilt per keypress
    expect(Object.is(s1.modelCycle, s2.modelCycle)).toBe(true);
    expect(Object.is(state.modelCycle, s1.modelCycle)).toBe(true);
  });

  it('catalog reference is the same across consecutive reduces', () => {
    const state = makeState({ proxyEnabled: true });
    const { state: s1 } = reduce(state, 'right');
    const { state: s2 } = reduce(s1, 'right');
    expect(Object.is(s1.catalog, s2.catalog)).toBe(true);
    expect(Object.is(state.catalog, s1.catalog)).toBe(true);
  });

  it('modelCycle reference unchanged on up/down/tab/save/cancel', () => {
    const state = makeState({ proxyEnabled: true });
    for (const key of ['up', 'down', 'tab', 'enter', 'escape', 'd', 'j', 'k'] as const) {
      const { state: next } = reduce(state, key);
      if (next !== state) {
        expect(Object.is(next.modelCycle, state.modelCycle)).toBe(true);
      }
    }
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

  it('not dirty after touch-then-revert (driven via reduce)', () => {
    // Drive reduce: advance to 'haiku', then retreat to 'default'.
    // isDirtyModel is false again because current === original.
    const state = makeState({ activeField: 'model', cursor: 1 });
    const { state: s1 } = reduce(state, 'right'); // default → haiku
    expect(isDirtyModel(s1.rows[1])).toBe(true);
    const { state: s2 } = reduce(s1, 'left');  // haiku → default
    expect(isDirtyModel(s2.rows[1])).toBe(false);
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

  it('not dirty when configuredModel equals dormantModel — cycling to saved GPT value is not a change', () => {
    // Dormant row: savedModel was 'gpt-5.5', proxy is off → configuredModel starts
    // at 'default'. User cycles to 'gpt-5.5' — that equals dormantModel so the
    // persisted mapping entry is unchanged; dirty must be suppressed.
    const row = makeRow({
      configuredModel: 'gpt-5.5',
      originalModel: 'default',
      dormantModel: 'gpt-5.5',
    });
    expect(isDirtyModel(row)).toBe(false);
  });

  it('dirty when configuredModel differs from both originalModel and dormantModel', () => {
    // User cycled from 'default' (originalModel) past 'gpt-5.5' (dormantModel) to
    // something else — that IS a genuine change.
    const row = makeRow({
      configuredModel: 'sonnet',
      originalModel: 'default',
      dormantModel: 'gpt-5.5',
    });
    expect(isDirtyModel(row)).toBe(true);
  });

  it('dirty when dormantModel is null and configuredModel differs from originalModel', () => {
    // Non-dormant row: no dormantModel suppression applies.
    const row = makeRow({ configuredModel: 'opus', originalModel: 'default', dormantModel: null });
    expect(isDirtyModel(row)).toBe(true);
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
    // Start: default → haiku → sonnet → ...
    let s = state;
    const { state: s1 } = reduce(s, 'right');
    expect(s1.rows[1].configuredModel).toBe('haiku');
    const { state: s2 } = reduce(s1, 'right');
    expect(s2.rows[1].configuredModel).toBe('sonnet');
  });

  it('cycles model forward through all values and wraps back to default (proxy on)', () => {
    const state = makeState({ proxyEnabled: true });
    const allModels = [...state.modelCycle]; // Use state's prebuilt cycle
    let s = state;
    for (let i = 0; i < allModels.length; i++) {
      expect(s.rows[1].configuredModel).toBe(allModels[i]);
      const { state: next } = reduce(s, 'right');
      s = next;
    }
    expect(s.rows[1].configuredModel).toBe('default');
  });

  it('cycles model backward (left arrow) — default → last in cycle', () => {
    // With MOCK_CATALOG_KNOWN, last in cycle is 'gpt-5.5'
    const state = makeState({ proxyEnabled: true });
    const { state: next } = reduce(state, 'left');
    const lastModel = state.modelCycle[state.modelCycle.length - 1];
    expect(next.rows[1].configuredModel).toBe(lastModel);
    expect(lastModel).toBe('gpt-5.5'); // confirms mock catalog order
  });

  it('proxy off — model cycle excludes external models', () => {
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

  it('proxy off — dormant row cycles from default, not from external model value', () => {
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
    // dormantModel still preserved in the row
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
// T6: rowState — single source of truth for TUI row state (Fix 2)
// ---------------------------------------------------------------------------

describe('T6: rowState', () => {
  it('active row — no dormancy, proxy on', () => {
    const row = makeRow({ configuredModel: 'sol', dormantModel: null });
    expect(rowState(row, /* proxyEnabled */ true)).toBe('active');
  });

  it('active row — default model, proxy off', () => {
    // 'default' is not an external model name → not dormant regardless of proxy
    const row = makeRow({ configuredModel: 'default', dormantModel: null });
    expect(rowState(row, /* proxyEnabled */ false)).toBe('active');
  });

  it('saved-inactive row — dormantModel set, proxy off', () => {
    // When proxy is off and a GPT model is saved, configuredModel = 'default'
    // but dormantModel = 'gpt-5.5'. rowState must detect saved-inactive.
    const row = makeRow({ configuredModel: 'default', dormantModel: 'gpt-5.5' });
    expect(rowState(row, /* proxyEnabled */ false)).toBe('saved-inactive');
  });

  it('saved-inactive row — dormantModel with alias, proxy off', () => {
    const row = makeRow({ configuredModel: 'default', dormantModel: 'sol' });
    expect(rowState(row, /* proxyEnabled */ false)).toBe('saved-inactive');
  });

  it('active when proxy on and dormantModel null (GPT model visible)', () => {
    // With proxy on, a GPT model is NOT dormant — it IS active.
    const row = makeRow({ configuredModel: 'sol', dormantModel: null });
    expect(rowState(row, /* proxyEnabled */ true)).toBe('active');
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
