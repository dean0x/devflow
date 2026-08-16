/**
 * Tests for src/cli/agents-view/render.ts — pure TUI frame renderer.
 *
 * Uses stripAnsi for content-only assertions (no ANSI color codes in comparisons).
 * Tests three canonical states: proxy-on with dirty row / proxy-off with dormant
 * row / minimal edge cases.
 */

import { describe, it, expect } from 'vitest';
import { renderFrame, buildModelCycle } from '../src/cli/agents-view/index.js';
import { stripAnsi } from '../src/hud/colors.js';
import type { AgentsViewState, AgentRow } from '../src/cli/agents-view/state.js';
import { type ExternalModelCatalog } from '../src/core/model-discovery.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UNKNOWN_CATALOG: ExternalModelCatalog = { known: false };

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

  it('includes column header with AGENT, MODEL, EFFORT', () => {
    const lines = renderStripped(makeState());
    const headerLine = lines.find(l =>
      l.includes('AGENT') && l.includes('MODEL') && l.includes('EFFORT')
    );
    expect(headerLine).toBeDefined();
  });

  it('includes keybinding footer', () => {
    const lines = renderStripped(makeState());
    const footer = lines.find(l => l.includes('enter') && l.includes('esc'));
    expect(footer).toBeDefined();
  });

  it('shows all three agents by name', () => {
    const lines = renderStripped(makeState());
    const text = lines.join('\n');
    expect(text).toContain('bug-analyzer');
    expect(text).toContain('coder');
    expect(text).toContain('designer');
  });
});

// ---------------------------------------------------------------------------
// Cursor row marker
// ---------------------------------------------------------------------------

describe('cursor row marker', () => {
  it('marks cursor row with ❯', () => {
    const lines = renderStripped(makeState({ cursor: 1 }));
    // The row with ❯ should contain 'coder'
    const cursorLine = lines.find(l => l.includes('❯'));
    expect(cursorLine).toBeDefined();
    expect(cursorLine).toContain('coder');
  });

  it('non-cursor rows do not have ❯', () => {
    const lines = renderStripped(makeState({ cursor: 1 }));
    const nonCursorWithMarker = lines.filter(l => l.includes('❯') && l.includes('bug-analyzer'));
    expect(nonCursorWithMarker).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Default rows (no configuration)
// ---------------------------------------------------------------------------

describe('default rows', () => {
  it('shows default model with shipped default in parens', () => {
    const state = makeState({
      rows: [makeRow({ name: 'coder', shippedDefault: 'sonnet' })],
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
          name: 'coder',
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
          name: 'coder',
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
      rows: [makeRow({ name: 'coder', shippedDefault: 'sonnet' })],
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
      rows: [makeRow({ name: 'coder', shippedDefault: 'sonnet' })],
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
      rows: [makeRow({ name: 'coder', shippedDefault: 'sonnet', configuredEffort: 'high', originalEffort: 'high' })],
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
      l => (l.includes('bug-analyzer') || l.includes('designer')) && !l.includes('❯')
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
          name: 'coder',
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
        makeRow({ name: 'coder', shippedDefault: 'sonnet', configuredModel: 'opus', originalModel: 'default' }),
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
          name: 'coder',
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
// Minimal / empty state
// ---------------------------------------------------------------------------

describe('minimal state', () => {
  it('renders without throwing for empty rows', () => {
    const state = makeState({ rows: [] });
    expect(() => renderFrame(state, { rows: 24, cols: 80 })).not.toThrow();
  });

  it('renders without throwing for single row', () => {
    const state = makeState({
      rows: [makeRow({ name: 'coder', shippedDefault: 'sonnet' })],
      cursor: 0,
    });
    expect(() => renderFrame(state, { rows: 24, cols: 80 })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Alias rendering (AC-F2)
// ---------------------------------------------------------------------------

describe('alias rendering', () => {
  it('renders alias with canonical-id annotation: "sol (gpt-5.6-sol)"', () => {
    // When catalog.known and aliasToId maps 'sol' → 'gpt-5.6-sol', the model
    // cell must show "sol (gpt-5.6-sol)" — AC-F2.
    const catalog: ExternalModelCatalog = {
      known: true,
      source: 'live',
      models: [],
      selectableNames: ['sol', 'gpt-5.6-sol'],
      aliasToId: new Map([['sol', 'gpt-5.6-sol'], ['gpt-5.6-sol', 'gpt-5.6-sol']]),
    };
    const state = makeState({
      proxyEnabled: true,
      catalog,
      modelCycle: buildModelCycle(catalog),
      rows: [makeRow({ name: 'coder', shippedDefault: 'sonnet', configuredModel: 'sol', originalModel: 'sol' })],
      cursor: 0,
      activeField: 'effort', // model field not active — show bare value
    });
    const lines = renderStripped(state);
    const rowLine = lines.find(l => l.includes('coder'));
    expect(rowLine).toBeDefined();
    expect(rowLine).toContain('sol (gpt-5.6-sol)');
  });

  it('renders canonical id bare (no annotation when alias === id)', () => {
    // A canonical id has aliasToId entry that maps to itself — render bare.
    const catalog: ExternalModelCatalog = {
      known: true,
      source: 'live',
      models: [],
      selectableNames: ['gpt-5.6-sol'],
      aliasToId: new Map([['gpt-5.6-sol', 'gpt-5.6-sol']]),
    };
    const state = makeState({
      proxyEnabled: true,
      catalog,
      modelCycle: buildModelCycle(catalog),
      rows: [makeRow({ name: 'coder', configuredModel: 'gpt-5.6-sol', originalModel: 'gpt-5.6-sol' })],
      cursor: 0,
      activeField: 'effort',
    });
    const lines = renderStripped(state);
    const rowLine = lines.find(l => l.includes('coder'));
    expect(rowLine).toBeDefined();
    // Must show the id; must NOT show a secondary annotation in parens
    expect(rowLine).toContain('gpt-5.6-sol');
    // Should NOT contain double annotation like 'gpt-5.6-sol (gpt-5.6-sol)'
    expect(rowLine).not.toContain('gpt-5.6-sol (gpt-5.6-sol)');
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
        name: 'coder',
        configuredModel: 'retired-model',
        originalModel: 'retired-model',
        offCyclePin: 'retired-model',
      })],
      cursor: 0,
      activeField: 'effort',
    });
    const lines = renderStripped(state);
    const rowLine = lines.find(l => l.includes('coder'));
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
        makeRow({ name: 'coder', shippedDefault: 'sonnet', configuredModel: 'default' }),
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
    const ansiName = '\x1b[31mcoder\x1b[0m'; // red "coder"
    const state = makeState({
      rows: [makeRow({ name: ansiName, shippedDefault: 'sonnet' })],
      cursor: 0,
    });
    const COLS = 80;
    // renderStripped strips ANSI — the visible line width must be ≤ COLS
    const lines = renderStripped(state, { rows: 24, cols: COLS });
    const rowLine = lines.find(l => l.includes('coder'));
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
      rows: [makeRow({ name: 'coder', configuredModel: nulModel, originalModel: nulModel })],
      // Put nulModel in modelCycle so it doesn't trigger (unavailable) path
      modelCycle: ['default', nulModel],
      catalog: UNKNOWN_CATALOG,
      cursor: 0,
    });
    const COLS = 80;
    const lines = renderStripped(state, { rows: 24, cols: COLS });
    const rowLine = lines.find(l => l.includes('coder'));
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
      rows: [makeRow({ name: 'coder', configuredModel: osc8Model, originalModel: osc8Model })],
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
    const rowLine = strippedLines.find(l => l.includes('coder'));
    expect(rowLine).toBeDefined();
    if (rowLine !== undefined) {
      expect(rowLine).toContain('gpt-5.5');
    }
  });

  it('C2-SEC-3: OSC-8 hyperlink in shippedDefault is stripped from raw TUI output', () => {
    // The shippedDefault hint is rendered in the model cell as "(shippedDefault)".
    const osc8Default = '\x1b]8;;https://evil.com\x07sonnet\x1b]8;;\x07';
    const state = makeState({
      rows: [makeRow({ name: 'coder', shippedDefault: osc8Default, configuredModel: 'default' })],
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
        name: 'coder',
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
