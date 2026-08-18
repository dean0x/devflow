/**
 * Tests for src/cli/agents-view/render.ts — pure TUI frame renderer.
 *
 * Uses stripAnsi for content-only assertions (no ANSI color codes in comparisons).
 * Tests three canonical states: proxy-on with dirty row / proxy-off with dormant
 * row / minimal edge cases.
 */

import { describe, it, expect } from 'vitest';
import { renderFrame, buildModelCycle, formatAgentName } from '../src/cli/agents-view/index.js';
import { stripAnsi } from '../src/hud/colors.js';
import type { AgentsViewState, AgentRow } from '../src/cli/agents-view/state.js';
import { type ExternalModelCatalog } from '../src/core/model-discovery.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UNKNOWN_CATALOG: ExternalModelCatalog = { known: false };

function makeRow(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    name: 'code',
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
  const proxyEnabled = overrides.proxyEnabled ?? true;
  const catalog: ExternalModelCatalog =
    'catalog' in overrides ? (overrides.catalog as ExternalModelCatalog) : UNKNOWN_CATALOG;
  const modelCycle: readonly string[] =
    'modelCycle' in overrides
      ? (overrides.modelCycle as readonly string[])
      : buildModelCycle(catalog);
  const rows = overrides.rows ?? [
    makeRow({ name: 'diagnose', shippedDefault: 'opus' }),
    makeRow({ name: 'code', shippedDefault: 'sonnet' }),
    makeRow({ name: 'design', shippedDefault: 'opus' }),
  ];
  return {
    rows,
    cursor: 1,
    activeField: 'model',
    viewportOffset: 0,
    viewportHeight: 10,
    proxyEnabled,
    catalog,
    modelCycle,
    ...overrides,
  };
}

function renderStripped(
  state: AgentsViewState,
  dims: { rows: number; cols: number } = { rows: 24, cols: 80 },
): string[] {
  return renderFrame(state, dims).map(stripAnsi);
}

// ---------------------------------------------------------------------------
// Basic structure
// ---------------------------------------------------------------------------

describe('renderFrame — structure', () => {
  it('returns an array of strings', () => {
    const lines = renderFrame(makeState(), { rows: 24, cols: 80 });
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('includes title line with "Devflow Agents"', () => {
    const lines = renderStripped(makeState());
    const titleLine = lines.find(l => l.includes('Devflow Agents'));
    expect(titleLine).toBeDefined();
  });

  it('shows proxy status in header — proxy on', () => {
    const lines = renderStripped(makeState({ proxyEnabled: true }));
    const titleLine = lines.find(l => l.includes('Devflow Agents'));
    expect(titleLine).toBeDefined();
    expect(titleLine).toContain('proxy: enabled');
  });

  it('shows proxy status in header — proxy off', () => {
    const lines = renderStripped(makeState({ proxyEnabled: false }));
    const titleLine = lines.find(l => l.includes('Devflow Agents'));
    expect(titleLine).toBeDefined();
    expect(titleLine).toContain('proxy: disabled');
  });

  it('T7: column header includes AGENT, MODEL, EFFORT, and STATE (Fix 3)', () => {
    const lines = renderStripped(makeState());
    const headerLine = lines.find(l =>
      l.includes('AGENT') && l.includes('MODEL') && l.includes('EFFORT') && l.includes('STATE')
    );
    expect(headerLine).toBeDefined();
  });

  it('includes keybinding footer', () => {
    const lines = renderStripped(makeState());
    const footer = lines.find(l => l.includes('enter') && l.includes('esc'));
    expect(footer).toBeDefined();
  });

  it('shows all three agents by name (capitalized for TUI — Fix 4)', () => {
    const lines = renderStripped(makeState());
    const text = lines.join('\n');
    // Fix 4: formatAgentName title-cases each hyphen-separated segment
    expect(text).toContain('Diagnose');
    expect(text).toContain('Code');
    expect(text).toContain('Design');
    // Original lowercase names must NOT appear (they are transformed)
    expect(text).not.toContain('diagnose');
  });
});

// ---------------------------------------------------------------------------
// Cursor row marker
// ---------------------------------------------------------------------------

describe('cursor row marker', () => {
  it('marks cursor row with ❯', () => {
    const lines = renderStripped(makeState({ cursor: 1 }));
    // The row with ❯ should contain 'Code' (capitalized — Fix 4)
    const cursorLine = lines.find(l => l.includes('❯'));
    expect(cursorLine).toBeDefined();
    expect(cursorLine).toContain('Code');
  });

  it('non-cursor rows do not have ❯', () => {
    const lines = renderStripped(makeState({ cursor: 1 }));
    const nonCursorWithMarker = lines.filter(l => l.includes('❯') && l.includes('Diagnose'));
    expect(nonCursorWithMarker).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Default rows (no configuration)
// ---------------------------------------------------------------------------

describe('default rows', () => {
  it('shows default model with shipped default in parens', () => {
    const state = makeState({
      rows: [makeRow({ name: 'code', shippedDefault: 'sonnet' })],
      cursor: 0,
      activeField: 'effort', // model not active so no brackets
    });
    const lines = renderStripped(state);
    const text = lines.join('\n');
    // Should show 'default' with '(sonnet)' dim hint
    expect(text).toContain('default');
    expect(text).toContain('sonnet');
  });
});

// ---------------------------------------------------------------------------
// Dirty marker
// ---------------------------------------------------------------------------

describe('dirty marker ●', () => {
  it('shows ● on dirty model field (cursor row, model not active)', () => {
    const state = makeState({
      rows: [
        makeRow({
          name: 'code',
          shippedDefault: 'sonnet',
          configuredModel: 'opus',
          originalModel: 'default', // dirty
        }),
      ],
      cursor: 0,
      activeField: 'effort', // model is NOT the active field
    });
    const lines = renderStripped(state);
    // The cursor row should show ● before the model value
    const cursorLine = lines.find(l => l.includes('❯'));
    expect(cursorLine).toBeDefined();
    expect(cursorLine).toContain('●');
  });

  it('shows ● on dirty effort field (cursor row, effort not active)', () => {
    const state = makeState({
      rows: [
        makeRow({
          name: 'code',
          shippedDefault: 'sonnet',
          configuredEffort: 'high',
          originalEffort: 'default', // dirty
        }),
      ],
      cursor: 0,
      activeField: 'model', // effort is NOT the active field
    });
    const lines = renderStripped(state);
    const text = lines.join('\n');
    expect(text).toContain('●');
  });

  it('does not show ● on clean fields', () => {
    const state = makeState({
      rows: [makeRow({ name: 'code', shippedDefault: 'sonnet' })],
      cursor: 0,
    });
    const lines = renderStripped(state);
    const cursorLine = lines.find(l => l.includes('❯'));
    expect(cursorLine).toBeDefined();
    expect(cursorLine).not.toContain('●');
  });
});

// ---------------------------------------------------------------------------
// Active field brackets
// ---------------------------------------------------------------------------

describe('active field brackets ‹ ›', () => {
  it('wraps model value in ‹ › when model is the active field on cursor row', () => {
    const state = makeState({
      rows: [makeRow({ name: 'code', shippedDefault: 'sonnet' })],
      cursor: 0,
      activeField: 'model',
    });
    const lines = renderStripped(state);
    const cursorLine = lines.find(l => l.includes('❯'));
    expect(cursorLine).toBeDefined();
    expect(cursorLine).toContain('‹');
    expect(cursorLine).toContain('›');
  });

  it('wraps effort value in ‹ › when effort is the active field on cursor row', () => {
    const state = makeState({
      rows: [makeRow({ name: 'code', shippedDefault: 'sonnet', configuredEffort: 'high', originalEffort: 'high' })],
      cursor: 0,
      activeField: 'effort',
    });
    const lines = renderStripped(state);
    const cursorLine = lines.find(l => l.includes('❯'));
    expect(cursorLine).toBeDefined();
    expect(cursorLine).toContain('‹');
    expect(cursorLine).toContain('›');
  });

  it('non-cursor rows do not have ‹ › brackets', () => {
    const state = makeState({ cursor: 1 });
    const lines = renderStripped(state);
    const nonCursorLines = lines.filter(
      l => (l.includes('Bug-Analyzer') || l.includes('Designer')) && !l.includes('❯')
    );
    for (const line of nonCursorLines) {
      expect(line).not.toContain('‹');
    }
  });
});

// ---------------------------------------------------------------------------
// Proxy-on with dirty row (canonical state 1)
// ---------------------------------------------------------------------------

describe('proxy-on with dirty row', () => {
  it('renders dirty model with ● on cursor row', () => {
    const state = makeState({
      proxyEnabled: true,
      cursor: 0,
      activeField: 'effort',
      rows: [
        makeRow({
          name: 'code',
          shippedDefault: 'sonnet',
          configuredModel: 'gpt-5.5',
          originalModel: 'default', // dirty
        }),
      ],
    });
    const lines = renderStripped(state);
    const cursorLine = lines.find(l => l.includes('❯'));
    expect(cursorLine).toBeDefined();
    expect(cursorLine).toContain('gpt-5.5');
    expect(cursorLine).toContain('●');
  });

  it('shows unsaved changes count', () => {
    const state = makeState({
      rows: [
        makeRow({ name: 'code', shippedDefault: 'sonnet', configuredModel: 'opus', originalModel: 'default' }),
        makeRow({ name: 'other', shippedDefault: 'haiku', configuredEffort: 'high', originalEffort: 'default' }),
      ],
    });
    const lines = renderStripped(state);
    const text = lines.join('\n');
    expect(text).toContain('2 unsaved');
  });

  it('does not show unsaved count when 0 changes', () => {
    const state = makeState();
    const lines = renderStripped(state);
    const text = lines.join('\n');
    expect(text).not.toContain('unsaved');
  });
});

// ---------------------------------------------------------------------------
// Proxy-off with dormant row (canonical state 2)
// ---------------------------------------------------------------------------

describe('proxy-off with dormant row', () => {
  it('shows dormant annotation "gpt-5.5 saved" for dormant row', () => {
    const state = makeState({
      proxyEnabled: false,
      cursor: 0,
      activeField: 'effort',
      rows: [
        makeRow({
          name: 'code',
          shippedDefault: 'sonnet',
          configuredModel: 'default',
          originalModel: 'default',
          dormantModel: 'gpt-5.5',
        }),
      ],
    });
    const lines = renderStripped(state);
    const text = lines.join('\n');
    expect(text).toContain('gpt-5.5');
    expect(text).toContain('saved');
  });

  it('shows proxy enable hint in footer when proxy is off', () => {
    const state = makeState({ proxyEnabled: false });
    const lines = renderStripped(state);
    const text = lines.join('\n');
    expect(text).toContain('devflow proxy --enable');
  });
});

// ---------------------------------------------------------------------------
// Scroll indicators
// ---------------------------------------------------------------------------

describe('scroll indicators', () => {
  it('shows ↓ N more when rows overflow below', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow({ name: `agent-${i}` })
    );
    const state = makeState({
      rows,
      cursor: 0,
      viewportOffset: 0,
      viewportHeight: 5,
    });
    const lines = renderStripped(state, { rows: 14, cols: 80 });
    const text = lines.join('\n');
    expect(text).toContain('more');
    expect(text).toContain('↓');
  });

  it('shows ↑ N more when rows overflow above', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow({ name: `agent-${i}` })
    );
    const state = makeState({
      rows,
      cursor: 8,
      viewportOffset: 5,
      viewportHeight: 5,
    });
    const lines = renderStripped(state, { rows: 14, cols: 80 });
    const text = lines.join('\n');
    expect(text).toContain('more');
    expect(text).toContain('↑');
  });

  it('does not show scroll indicator when all rows fit', () => {
    const rows = [
      makeRow({ name: 'agent-0' }),
      makeRow({ name: 'agent-1' }),
      makeRow({ name: 'agent-2' }),
    ];
    const state = makeState({
      rows,
      cursor: 0,
      viewportOffset: 0,
      viewportHeight: 10,
    });
    const lines = renderStripped(state, { rows: 24, cols: 80 });
    const text = lines.join('\n');
    // No scroll indicators when everything fits
    expect(text).not.toMatch(/↓ \d+ more/);
    expect(text).not.toMatch(/↑ \d+ more/);
  });
});

// ---------------------------------------------------------------------------
// Narrow width handling
// ---------------------------------------------------------------------------

describe('narrow width', () => {
  it('renders without throwing at narrow widths', () => {
    const state = makeState();
    expect(() => renderFrame(state, { rows: 24, cols: 40 })).not.toThrow();
  });

  it('renders without throwing at very narrow widths', () => {
    const state = makeState();
    expect(() => renderFrame(state, { rows: 24, cols: 20 })).not.toThrow();
  });

  it('never wraps mid-row (each output line has no newlines)', () => {
    const state = makeState();
    const lines = renderFrame(state, { rows: 24, cols: 30 });
    for (const line of lines) {
      expect(line).not.toContain('\n');
    }
  });
});

// ---------------------------------------------------------------------------
// AC-P3-WIDTH: line widths at 80 and 60 columns
// ---------------------------------------------------------------------------

describe('AC-P3-WIDTH: no line exceeds terminal width', () => {
  // At 80 cols (standard terminal): all columns scale to full size.
  // totalContent = 2 + 18 + 32 + 13 + 13 = 78, so every data row is 78 chars.
  // The keybindingsLine (77 chars) also fits within 80.
  it('at 80 cols: every stripped line is ≤ 80 visible chars', () => {
    const state = makeState({
      proxyEnabled: false, // shows proxy hint line (longest footer variant)
      rows: [
        makeRow({ name: 'code', shippedDefault: 'sonnet', configuredModel: 'opus', originalModel: 'default' }),
        makeRow({ name: 'design', shippedDefault: 'opus' }),
      ],
      cursor: 0,
      viewportHeight: 10,
    });
    const COLS = 80;
    const lines = renderStripped(state, { rows: 24, cols: COLS });
    for (const line of lines) {
      expect(
        line.length,
        `Line exceeds ${COLS} cols: "${line}"`,
      ).toBeLessThanOrEqual(COLS);
    }
  });

  // At 60 cols: responsive-scale block exercises the Math.max floors.
  // scale = 60/78 ≈ 0.769; column widths after floor: agent=13, model=24, effort=10, state=10.
  // Max data row visible width = 2 + 13 + 24 + 10 + 10 = 59 ≤ 60.
  // keybindingsLine is sliced to dims.cols (60) before dim() is applied.
  it('at 60 cols: every stripped line is ≤ 60 visible chars', () => {
    const state = makeState({
      proxyEnabled: false, // shows proxy hint line (longest footer variant)
      rows: [
        makeRow({ name: 'code', shippedDefault: 'sonnet', configuredModel: 'opus', originalModel: 'default' }),
        makeRow({ name: 'design', shippedDefault: 'opus' }),
      ],
      cursor: 0,
      viewportHeight: 10,
    });
    const COLS = 60;
    const lines = renderStripped(state, { rows: 24, cols: COLS });
    for (const line of lines) {
      expect(
        line.length,
        `Line exceeds ${COLS} cols: "${line}"`,
      ).toBeLessThanOrEqual(COLS);
    }
  });
});

// ---------------------------------------------------------------------------
// Minimal / empty state
// ---------------------------------------------------------------------------

describe('minimal state', () => {
  it('renders without throwing for empty rows', () => {
    const state = makeState({ rows: [] });
    expect(() => renderFrame(state, { rows: 24, cols: 80 })).not.toThrow();
  });

  it('renders without throwing for single row', () => {
    const state = makeState({
      rows: [makeRow({ name: 'code', shippedDefault: 'sonnet' })],
      cursor: 0,
    });
    expect(() => renderFrame(state, { rows: 24, cols: 80 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Alias rendering (Fix 1 — bare alias, no canonical-id annotation)
// ---------------------------------------------------------------------------

describe('alias rendering', () => {
  // T4 / T14-MANDATORY-REWRITE: alias renders BARE, not as "sol (gpt-5.6-sol)".
  //
  // The OLD behavior (pre-Fix 1) annotated alias models as "sol (gpt-5.6-sol)".
  // Fix 1 removes the annotation branch. Aliases now render bare.
  //
  // Falsification record (T14):
  //   GREEN before Fix 1: renderModelCell showed "sol (gpt-5.6-sol)" via aliasToId.
  //   RED  after rewrite, before code fix: catalog has populated models, buildModelCycle
  //        puts 'sol' in cycle; old render code showed "(gpt-5.6-sol)" annotation.
  //        New assertion `not.toContain('(gpt-5.6-sol)')` → FAIL (exit code 1).
  //   GREEN after code fix: annotation branch deleted; row renders bare "sol" → PASS.
  it('T14/T4: alias renders bare — no canonical-id annotation (sol not "sol (gpt-5.6-sol)")', () => {
    // Populated catalog — models array is non-empty so pickerNames returns ['sol'].
    // buildModelCycle puts 'sol' in the cycle; renderModelCell renders it bare.
    const catalog: ExternalModelCatalog = {
      known: true,
      source: 'live',
      models: [{ id: 'gpt-5.6-sol', aliases: ['sol'] }],
      selectableNames: ['sol', 'gpt-5.6-sol'],
      aliasToId: new Map([['sol', 'gpt-5.6-sol'], ['gpt-5.6-sol', 'gpt-5.6-sol']]),
    };
    const state = makeState({
      proxyEnabled: true,
      catalog,
      modelCycle: buildModelCycle(catalog),
      rows: [makeRow({ name: 'code', shippedDefault: 'sonnet', configuredModel: 'sol', originalModel: 'sol' })],
      cursor: 0,
      activeField: 'effort', // model not active — no ‹ › brackets
    });
    const lines = renderStripped(state);
    const rowLine = lines.find(l => l.includes('Code'));
    expect(rowLine).toBeDefined();
    // T4 core assertion: alias renders bare
    expect(rowLine).toContain('sol');
    expect(rowLine).not.toContain('sol (gpt-5.6-sol)');
    // No canonical-id in parens at all
    expect(rowLine).not.toMatch(/\(gpt-/);
  });

  it('T4: "default (opus)" parenthetical SURVIVES alias-annotation removal', () => {
    // The shipped-default hint "(opus)" must not be stripped by Fix 1.
    // This parenthetical answers a DIFFERENT question: "what model is the default?",
    // not "what is the canonical id of this alias?".
    const state = makeState({
      proxyEnabled: true,
      catalog: UNKNOWN_CATALOG,
      modelCycle: buildModelCycle(UNKNOWN_CATALOG),
      rows: [makeRow({ name: 'review', shippedDefault: 'opus', configuredModel: 'default' })],
      cursor: 0,
      activeField: 'effort',
    });
    const lines = renderStripped(state);
    const rowLine = lines.find(l => l.includes('Review'));
    expect(rowLine).toBeDefined();
    expect(rowLine).toContain('default (opus)');
  });

  it('T4: "(unavailable)" parenthetical SURVIVES alias-annotation removal', () => {
    // Off-cycle pins still render as "model (unavailable)".
    const state = makeState({
      proxyEnabled: true,
      catalog: UNKNOWN_CATALOG,
      modelCycle: ['default', 'sonnet', 'opus'],
      rows: [makeRow({
        name: 'code',
        configuredModel: 'retired-model',
        originalModel: 'retired-model',
        offCyclePin: 'retired-model',
      })],
      cursor: 0,
      activeField: 'effort',
    });
    const lines = renderStripped(state);
    const rowLine = lines.find(l => l.includes('Code'));
    expect(rowLine).toBeDefined();
    expect(rowLine).toContain('retired-model (unavailable)');
  });

  it('in-cycle canonical id (no alias) renders bare', () => {
    // A canonical id that IS in the picker cycle (because it has no aliases)
    // renders bare. 'gpt-5.5' has no aliases → it IS the picker name.
    const catalog: ExternalModelCatalog = {
      known: true,
      source: 'live',
      models: [{ id: 'gpt-5.5', aliases: [] }],
      selectableNames: ['gpt-5.5'],
      aliasToId: new Map([['gpt-5.5', 'gpt-5.5']]),
    };
    const state = makeState({
      proxyEnabled: true,
      catalog,
      modelCycle: buildModelCycle(catalog), // includes 'gpt-5.5'
      rows: [makeRow({ name: 'code', configuredModel: 'gpt-5.5', originalModel: 'gpt-5.5' })],
      cursor: 0,
      activeField: 'effort',
    });
    const lines = renderStripped(state);
    const rowLine = lines.find(l => l.includes('Code'));
    expect(rowLine).toBeDefined();
    expect(rowLine).toContain('gpt-5.5');
    expect(rowLine).not.toContain('gpt-5.5 (gpt-5.5)');
    expect(rowLine).not.toContain('(unavailable)');
  });
});

// ---------------------------------------------------------------------------
// T8-T11: STATE column rendering (Fix 3)
// ---------------------------------------------------------------------------

describe('STATE column (Fix 3)', () => {
  it('T8: active row shows "active" in STATE column', () => {
    const state = makeState({
      rows: [makeRow({ name: 'code', configuredModel: 'sonnet', installed: true, inRegistry: true })],
      cursor: 0,
      activeField: 'effort',
    });
    const lines = renderStripped(state);
    const rowLine = lines.find(l => l.includes('Code'));
    expect(rowLine).toBeDefined();
    expect(rowLine).toContain('active');
  });

  it('T9: not-installed row shows "not installed" in STATE column', () => {
    const state = makeState({
      rows: [makeRow({ name: 'code', installed: false, inRegistry: true })],
      cursor: 0,
      activeField: 'effort',
    });
    const lines = renderStripped(state);
    const rowLine = lines.find(l => l.includes('Code'));
    expect(rowLine).toBeDefined();
    expect(rowLine).toContain('not installed');
  });

  it('T10: orphan row (inRegistry=false) shows "unknown" in STATE column', () => {
    // An arbitrary key from agent-models.json not present in the plugin registry.
    const state = makeState({
      rows: [makeRow({ name: 'old-custom-agent', installed: false, inRegistry: false })],
      cursor: 0,
      activeField: 'effort',
    });
    const lines = renderStripped(state);
    const rowLine = lines.find(l => l.includes('Old-Custom-Agent'));
    expect(rowLine).toBeDefined();
    expect(rowLine).toContain('unknown');
    // Must not show 'not installed' — 'unknown' takes priority (inRegistry check first)
    expect(rowLine).not.toContain('not installed');
  });

  it('T11: stripAnsi on name cell — ANSI escape in orphan name is stripped from raw output', () => {
    // Orphan names come from arbitrary JSON keys — a hostile key could inject ANSI codes.
    // render.ts must call stripAnsi(row.name) BEFORE rendering so raw output is clean.
    const ansiName = '\x1b[31mevil-agent\x1b[0m'; // red "evil-agent"
    const state = makeState({
      rows: [makeRow({ name: ansiName, installed: false, inRegistry: false })],
      cursor: 0,
      activeField: 'effort',
    });
    // The RAW frame (not stripped) must not contain the ANSI opener \x1b[31m from the name.
    const rawLines = renderFrame(state, { rows: 24, cols: 80 });
    const allRaw = rawLines.join('\n');
    // The injection sequence from the name must be absent in raw output.
    // (render.ts colors STATE column, so some \x1b[ will appear — but not from the name)
    // Check specifically for the red color code that was in the name:
    expect(allRaw).not.toContain('\x1b[31mevil-agent');
    // The visible text 'evil-agent' must still appear (stripped, title-cased as 'Evil-Agent')
    const strippedLines = rawLines.map(stripAnsi);
    const rowLine = strippedLines.find(l => l.includes('Evil-Agent'));
    expect(rowLine).toBeDefined();
  });

  it('newline in an orphan name does not break the one-line-per-string frame contract', () => {
    // stripAnsi strips escape sequences and C0 controls but PRESERVES \n by
    // contract. Orphan names are arbitrary JSON keys from agent-models.json, so a
    // key containing a newline would emit an embedded newline into a frame line —
    // breaking renderFrame's documented contract and desyncing terminal.ts's
    // redraw (it appends ERASE_EOL + '\n' per returned line).
    const state = makeState({
      rows: [makeRow({ name: 'evil\ninjected', installed: false, inRegistry: false })],
      cursor: 0,
      activeField: 'effort',
    });
    const rawLines = renderFrame(state, { rows: 24, cols: 80 });
    for (const line of rawLines) {
      expect(line, `frame line contains an embedded newline: ${JSON.stringify(line)}`)
        .not.toContain('\n');
    }
    // The key is still visible (both halves survive, joined by the replacement space)
    const rowLine = rawLines.map(stripAnsi).find(l => l.includes('Evil injected'));
    expect(rowLine).toBeDefined();
  });

  it('tab in an orphan name does not reach the frame (measures 1, renders up to 8 columns)', () => {
    // stripAnsi also preserves \x09. A tab measures as one character in
    // padToVisible but occupies up to eight terminal columns, misaligning every
    // column to its right.
    const state = makeState({
      rows: [makeRow({ name: 'a\tb', installed: false, inRegistry: false })],
      cursor: 0,
      activeField: 'effort',
    });
    const rawLines = renderFrame(state, { rows: 24, cols: 80 });
    for (const line of rawLines) {
      expect(line, `frame line contains a tab: ${JSON.stringify(line)}`).not.toContain('\t');
    }
    const rowLine = rawLines.map(stripAnsi).find(l => l.includes('A b'));
    expect(rowLine).toBeDefined();
    // Column alignment holds: at 80 cols the STATE cell starts at the declared
    // offset PREFIX(2) + AGENT(18) + MODEL(32) + EFFORT(13) = 65. A surviving tab
    // would shift it, because padToVisible counts \t as a single character.
    expect(rowLine?.slice(65)).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// (unavailable) — off-cycle pin (AC-F4)
// ---------------------------------------------------------------------------

describe('(unavailable) off-cycle pin', () => {
  it('renders "model (unavailable)" when configuredModel is absent from modelCycle', () => {
    // A previously saved model that has since been retired is not in the current
    // modelCycle. The cell must show "<model> (unavailable)" so the user notices.
    const state = makeState({
      proxyEnabled: true,
      catalog: UNKNOWN_CATALOG,
      // modelCycle does NOT include 'retired-model'
      modelCycle: ['default', 'sonnet', 'opus'],
      rows: [makeRow({
        name: 'code',
        configuredModel: 'retired-model',
        originalModel: 'retired-model',
        offCyclePin: 'retired-model',
      })],
      cursor: 0,
      activeField: 'effort',
    });
    const lines = renderStripped(state);
    const rowLine = lines.find(l => l.includes('Code'));
    expect(rowLine).toBeDefined();
    expect(rowLine).toContain('retired-model (unavailable)');
  });
});

// ---------------------------------------------------------------------------
// Column bounds — visible width does not exceed cols
// ---------------------------------------------------------------------------

describe('column bounds', () => {
  it('visible length of each row line does not exceed declared cols at 80', () => {
    // Each rendered line's VISIBLE length (after stripping ANSI) must not exceed
    // the declared terminal width. Overflow causes visual corruption in the TUI.
    const state = makeState({
      rows: [
        makeRow({ name: 'bug-analyzer-agent', shippedDefault: 'opus', configuredModel: 'claude-3-5-sonnet-20241022' }),
        makeRow({ name: 'code', shippedDefault: 'sonnet', configuredModel: 'default' }),
      ],
      cursor: 0,
    });
    const COLS = 80;
    const lines = renderStripped(state, { rows: 24, cols: COLS });
    for (const line of lines) {
      // stripAnsi already applied by renderStripped — line IS the visible text
      expect(line.length, `line wider than ${COLS}: ${JSON.stringify(line)}`).toBeLessThanOrEqual(COLS);
    }
  });
});

// ---------------------------------------------------------------------------
// Escape sequence injection safety
// ---------------------------------------------------------------------------

describe('escape sequence injection safety', () => {
  it('ANSI escape code in agent name does not expand visible column width', () => {
    // An agent name containing ANSI codes must still be padded by VISIBLE width.
    // padToVisible uses stripAnsi before measuring, so the column width is correct.
    const ansiName = '\x1b[31mcode\x1b[0m'; // red "code"
    const state = makeState({
      rows: [makeRow({ name: ansiName, shippedDefault: 'sonnet' })],
      cursor: 0,
    });
    const COLS = 80;
    // renderStripped strips ANSI — the visible line width must be ≤ COLS
    const lines = renderStripped(state, { rows: 24, cols: COLS });
    const rowLine = lines.find(l => l.includes('Code'));
    expect(rowLine).toBeDefined();
    if (rowLine !== undefined) {
      expect(rowLine.length).toBeLessThanOrEqual(COLS);
    }
  });

  it('NUL byte in model name does not cause the row line to grow unbounded', () => {
    // NUL bytes in rendered names: renderModelCell uses truncateVisible which
    // measures by stripAnsi result. The rendered line should remain ≤ COLS.
    const nulModel = 'sol\x00evil';
    const state = makeState({
      rows: [makeRow({ name: 'code', configuredModel: nulModel, originalModel: nulModel })],
      // Put nulModel in modelCycle so it doesn't trigger (unavailable) path
      modelCycle: ['default', nulModel],
      catalog: UNKNOWN_CATALOG,
      cursor: 0,
    });
    const COLS = 80;
    const lines = renderStripped(state, { rows: 24, cols: COLS });
    const rowLine = lines.find(l => l.includes('Code'));
    expect(rowLine).toBeDefined();
    // Must not throw and must not produce a line wider than COLS
    if (rowLine !== undefined) {
      expect(rowLine.length).toBeLessThanOrEqual(COLS);
    }
  });

  // C2-SEC-3: OSC-8 hyperlinks and other non-SGR escape sequences in model fields
  // must be stripped from the TUI output BEFORE rendering — not just for width
  // measurement. padToVisible/truncateVisible strip for width but return the original
  // string, so a short OSC-8 payload (zero visible width) passes through untouched.
  // The fix: sanitize raw values at the start of renderModelCell.

  it('C2-SEC-3: OSC-8 hyperlink in configuredModel is stripped from raw TUI output', () => {
    // A hostile model name wraps an OSC-8 hyperlink around the visible text.
    // After the fix, the raw TUI output must not contain the OSC-8 opener.
    const osc8Model = '\x1b]8;;https://evil.com\x07gpt-5.5\x1b]8;;\x07';
    const state = makeState({
      rows: [makeRow({ name: 'code', configuredModel: osc8Model, originalModel: osc8Model })],
      // Include the raw model in the cycle so it does NOT trigger (unavailable)
      modelCycle: ['default', osc8Model],
      catalog: UNKNOWN_CATALOG,
      cursor: 0,
      activeField: 'effort',
    });
    const rawLines = renderFrame(state, { rows: 24, cols: 80 });
    const allRaw = rawLines.join('\n');
    // OSC-8 opener must not appear in the raw terminal output
    expect(allRaw).not.toContain('\x1b]8;');
    // After stripping, the visible text ('gpt-5.5') must still appear
    const strippedLines = rawLines.map(stripAnsi);
    const rowLine = strippedLines.find(l => l.includes('Code'));
    expect(rowLine).toBeDefined();
    if (rowLine !== undefined) {
      expect(rowLine).toContain('gpt-5.5');
    }
  });

  it('C2-SEC-3: OSC-8 hyperlink in shippedDefault is stripped from raw TUI output', () => {
    // The shippedDefault hint is rendered in the model cell as "(shippedDefault)".
    const osc8Default = '\x1b]8;;https://evil.com\x07sonnet\x1b]8;;\x07';
    const state = makeState({
      rows: [makeRow({ name: 'code', shippedDefault: osc8Default, configuredModel: 'default' })],
      cursor: 0,
      activeField: 'effort',
    });
    const rawLines = renderFrame(state, { rows: 24, cols: 80 });
    const allRaw = rawLines.join('\n');
    expect(allRaw).not.toContain('\x1b]8;');
  });

  it('C2-SEC-3: OSC-8 hyperlink in dormantModel is stripped from raw TUI output', () => {
    // dormantModel annotation is rendered as "gpt-5.5 saved" dim text.
    const osc8Dormant = '\x1b]8;;https://evil.com\x07gpt-5.5\x1b]8;;\x07';
    const state = makeState({
      proxyEnabled: false,
      rows: [makeRow({
        name: 'code',
        configuredModel: 'default',
        originalModel: 'default',
        dormantModel: osc8Dormant,
      })],
      cursor: 0,
      activeField: 'effort',
    });
    const rawLines = renderFrame(state, { rows: 24, cols: 80 });
    const allRaw = rawLines.join('\n');
    expect(allRaw).not.toContain('\x1b]8;');
  });
});

// ---------------------------------------------------------------------------
// T5: static guard — aliasToId not referenced in render.ts (Fix 1)
// ---------------------------------------------------------------------------

describe('T5: render.ts source does not reference aliasToId', () => {
  it('aliasToId identifier absent from render.ts — annotation branch fully deleted', async () => {
    // Fix 1 deleted the alias→canonical-id annotation branch from renderModelCell.
    // The render module must no longer import or read catalog.aliasToId.
    // This test guards against accidental re-introduction.
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const renderPath = fileURLToPath(
      new URL('../src/cli/agents-view/render.ts', import.meta.url),
    );
    const src = readFileSync(renderPath, 'utf-8');
    expect(src, 'render.ts must not reference aliasToId after Fix 1').not.toContain('aliasToId');
  });
});

// ---------------------------------------------------------------------------
// T13: formatAgentName — hyphen-aware title-case in TUI, --list stays lowercase (Fix 4)
// ---------------------------------------------------------------------------

describe('T13: formatAgentName (Fix 4)', () => {
  it('title-cases each hyphen-separated segment', () => {
    expect(formatAgentName('coder')).toBe('Coder');
    expect(formatAgentName('bug-analyzer')).toBe('Bug-Analyzer');
    expect(formatAgentName('designer')).toBe('Designer');
    // Multi-segment: each part is capitalized independently
    expect(formatAgentName('my-custom-agent')).toBe('My-Custom-Agent');
    // Single-segment name: unchanged behavior, safe for next-PR renames
    expect(formatAgentName('code')).toBe('Code');
    // Three-segment name: all segments capitalized
    expect(formatAgentName('claude-md-auditor')).toBe('Claude-Md-Auditor');
  });

  it('empty string is returned unchanged', () => {
    expect(formatAgentName('')).toBe('');
  });

  it('already-capitalized names are unchanged', () => {
    expect(formatAgentName('Coder')).toBe('Coder');
  });

  it('TUI renders agent names with capital first letter', () => {
    const state = makeState({
      rows: [
        makeRow({ name: 'diagnose', shippedDefault: 'opus' }),
        makeRow({ name: 'code', shippedDefault: 'sonnet' }),
      ],
      cursor: 0,
    });
    const lines = renderStripped(state);
    const text = lines.join('\n');
    // TUI must show hyphen-aware title-cased names
    expect(text).toContain('Diagnose');
    expect(text).toContain('Code');
    // Lowercase originals must NOT appear — they are transformed
    expect(text).not.toContain('\ndiagnose');
    expect(text).not.toContain('\ncode');
  });

  it('--list formatListOutput uses raw lowercase name (not formatAgentName)', async () => {
    // The --list path calls padEnd on the raw name without formatAgentName.
    // Verify formatAgentName is NOT imported by agents.ts (--list module).
    const { readFileSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const agentsPath = fileURLToPath(
      new URL('../src/cli/commands/agents.ts', import.meta.url),
    );
    const src = readFileSync(agentsPath, 'utf-8');
    expect(src, '--list path in agents.ts must not call formatAgentName').not.toContain('formatAgentName');
  });
});
