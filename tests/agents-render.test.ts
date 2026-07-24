/**
 * Tests for src/cli/agents-view/render.ts — pure TUI frame renderer.
 *
 * Uses stripAnsi for content-only assertions (no ANSI color codes in comparisons).
 * Tests three canonical states: proxy-on with dirty row / proxy-off with dormant
 * row / minimal edge cases.
 */

import { describe, it, expect } from 'vitest';
import { renderFrame } from '../src/cli/agents-view/render.js';
import { stripAnsi } from '../src/hud/colors.js';
import type { AgentsViewState, AgentRow } from '../src/cli/agents-view/state.js';

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
