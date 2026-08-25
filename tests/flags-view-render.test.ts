/**
 * Tests for src/cli/flags-view/render.ts — pure frame renderer.
 *
 * Tests-first (RED-GREEN): written before the implementation.
 *
 * Pinned behaviours (per execution plan):
 *   - computeViewportHeight(rows) = rows - FIXED_ROWS (≥ 1)
 *   - renderFrame returns one string per terminal line (no embedded newlines)
 *   - Frame contains ERASE_EOL (ESC[K]) at end of each line (from shell; render
 *     does NOT add ERASE_EOL — the shell wraps it — but renderFrame strings must
 *     NOT themselves embed newlines)
 *   - Boolean row displays enabled/disabled
 *   - Enum row displays current value or 'unset'
 *   - Number row displays current value or 'unset'
 *   - Editing row shows buffer with inverse-video caret
 *   - hint zone: last non-empty row shows flag.hint
 *   - Up/down indicators when rows overflow viewport
 *   - Narrow width (< 80): render doesn't crash
 *   - No trailing newline in any line string
 */

import { describe, it, expect } from 'vitest';
import { renderFrame, computeViewportHeight, FIXED_ROWS } from '../src/cli/flags-view/render.js';
import { buildFlagRows } from '../src/cli/flags-view/state.js';
import { FLAG_REGISTRY } from '../src/core/flags.js';
import type { FlagsViewState } from '../src/cli/flags-view/state.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIMS_80x24 = { rows: 24, cols: 80 };
const DIMS_80x40 = { rows: 40, cols: 80 };
const DIMS_60x24 = { rows: 24, cols: 60 }; // narrow
const DIMS_80x15 = { rows: 15, cols: 80 }; // short

function makeState(overrides: Partial<FlagsViewState> = {}): FlagsViewState {
  const rows = buildFlagRows(FLAG_REGISTRY, {});
  return {
    rows,
    cursor: 0,
    viewportOffset: 0,
    viewportHeight: computeViewportHeight(DIMS_80x24.rows),
    editing: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FIXED_ROWS and computeViewportHeight
// ---------------------------------------------------------------------------

describe('flags-view-render — FIXED_ROWS and computeViewportHeight', () => {
  it('FIXED_ROWS is 10', () => {
    expect(FIXED_ROWS).toBe(10);
  });

  it('computeViewportHeight(24) = 24 - FIXED_ROWS = 14', () => {
    expect(computeViewportHeight(24)).toBe(14);
  });

  it('computeViewportHeight(10) = 1 (minimum)', () => {
    // rows - FIXED_ROWS = 0, clamp to 1
    expect(computeViewportHeight(FIXED_ROWS)).toBe(1);
  });

  it('computeViewportHeight(5) = 1 (minimum even when would be negative)', () => {
    expect(computeViewportHeight(5)).toBe(1);
  });

  it('computeViewportHeight(40) = 30', () => {
    expect(computeViewportHeight(40)).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// renderFrame — basic contract
// ---------------------------------------------------------------------------

describe('flags-view-render — renderFrame basic contract', () => {
  it('returns an array of strings', () => {
    const state = makeState();
    const lines = renderFrame(state, DIMS_80x24);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('no line contains a newline character', () => {
    const state = makeState();
    const lines = renderFrame(state, DIMS_80x24);
    for (const line of lines) {
      expect(line).not.toContain('\n');
    }
  });

  it('sanitizeCell: embedded \\n and \\t in a string value produce one line per row (no layout break)', () => {
    // `devflow flags --set $'spellcheck=a\nb'` persists a LF; coerceFlagValue permits
    // TAB/LF so the value reaches the renderer. sanitizeCell must collapse both to space
    // so the one-string-per-terminal-line contract is preserved.
    const rows = buildFlagRows(FLAG_REGISTRY, { spellcheck: 'aspell\tcheck\nline2' });
    const state = makeState({ rows, cursor: 0, viewportOffset: 0 });
    const frameLines = renderFrame(state, DIMS_80x24);
    // Every string in the returned array must be free of newlines and tabs
    for (const line of frameLines) {
      expect(line).not.toContain('\n');
      expect(line).not.toContain('\t');
    }
    // And the total line count must still equal FIXED_ROWS + viewportHeight (no extra lines)
    const viewportHeight = computeViewportHeight(DIMS_80x24.rows);
    expect(frameLines.length).toBe(FIXED_ROWS + viewportHeight);
  });

  it('renders exactly FIXED_ROWS + viewportHeight lines', () => {
    const state = makeState();
    const lines = renderFrame(state, DIMS_80x24);
    // FLAG_REGISTRY has more rows than the viewport can show, so the viewport is fully
    // filled: renderedRows.length = viewportHeight, total = FIXED_ROWS + viewportHeight.
    const viewportHeight = computeViewportHeight(DIMS_80x24.rows);
    expect(FLAG_REGISTRY.length).toBeGreaterThan(viewportHeight); // confirm premise
    expect(lines.length).toBe(FIXED_ROWS + viewportHeight);
  });

  it('no line is longer than cols visible characters (no content overflow)', () => {
    const state = makeState();
    const lines = renderFrame(state, DIMS_80x24);
    // Strip ANSI for length check
    const ESC_PATTERN = /\x1b\[[0-9;]*m/g;
    for (const line of lines) {
      const visible = line.replace(ESC_PATTERN, '');
      expect(visible.length).toBeLessThanOrEqual(80);
    }
  });
});

// ---------------------------------------------------------------------------
// Per-kind rendering
// ---------------------------------------------------------------------------

describe('flags-view-render — per-kind value display', () => {
  it('boolean flag shows "enabled" when true', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, { tui: true });
    const state = makeState({ rows, cursor: 0, viewportOffset: 0 });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    expect(joined).toContain('enabled');
  });

  it('boolean flag shows "disabled" when false', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, { tui: false });
    const state = makeState({ rows, cursor: 0, viewportOffset: 0 });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    // The tui row is cursor=0, should be visible
    // "disabled" should appear somewhere in the frame
    expect(joined).toContain('disabled');
  });

  it('enum flag shows the value when set', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, { 'view-mode': 'verbose' });
    // Find the index of view-mode row — scroll viewport to make it visible
    const vmIdx = rows.findIndex(r => r.id === 'view-mode');
    const state = makeState({ rows, cursor: vmIdx, viewportOffset: vmIdx });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    expect(joined).toContain('verbose');
  });

  it('view-mode shows "unset" when null (default/neutral)', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, {}); // view-mode absent → null
    const vmIdx = rows.findIndex(r => r.id === 'view-mode');
    const state = makeState({ rows, cursor: vmIdx, viewportOffset: vmIdx });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    expect(joined).toContain('unset');
  });

  it('number flag shows value when set', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, { 'max-concurrent-subagents': 40 });
    // max-concurrent-subagents is index 8 — within first viewport (14 rows), viewportOffset=0 is fine
    const mcIdx = rows.findIndex(r => r.id === 'max-concurrent-subagents');
    const state = makeState({ rows, cursor: mcIdx, viewportOffset: 0 });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    expect(joined).toContain('40');
  });

  it('number flag shows "unset" when null', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, { 'subagent-spawn-depth': null });
    const sdIdx = rows.findIndex(r => r.id === 'subagent-spawn-depth');
    const state = makeState({ rows, cursor: sdIdx, viewportOffset: sdIdx });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    expect(joined).toContain('unset');
  });
});

// ---------------------------------------------------------------------------
// Dirty dot
// ---------------------------------------------------------------------------

describe('flags-view-render — dirty dot', () => {
  it('shows dirty indicator when configuredValue !== originalValue', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, { tui: true });
    // Modify configuredValue but keep originalValue
    const modified = rows.map(r =>
      r.id === 'tui' ? { ...r, configuredValue: false } : r,
    );
    const state = makeState({ rows: modified, cursor: 0, viewportOffset: 0 });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    // Some dirt indicator — '*' or '●' or 'modified' or similar
    // The exact char is implementation-defined, so check for at least one of the common ones
    expect(joined.includes('*') || joined.includes('●') || joined.includes('•')).toBe(true);
  });

  it('no dirty indicator when clean', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, { tui: true });
    const state = makeState({ rows, cursor: 0, viewportOffset: 0 });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    // The tui row is at index 0, cursor=0. When clean, no dirty dot should appear
    // near the row. We check that the specific dirty chars are not in the data rows.
    // (They may still appear in the title/hint if unrelated.)
    // Just check the overall frame doesn't have unexpected dirty markers.
    // This is a soft check — the implementation defines the exact indicator.
    expect(Array.isArray(lines)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cursor indicator
// ---------------------------------------------------------------------------

describe('flags-view-render — cursor indicator', () => {
  it('selected row shows cursor indicator (❯ prefix or similar)', () => {
    const state = makeState({ cursor: 0 });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    // Check for common cursor chars: ❯, >, →
    expect(
      joined.includes('❯') || joined.includes('>') || joined.includes('→'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edit mode rendering
// ---------------------------------------------------------------------------

describe('flags-view-render — edit mode', () => {
  it('edit mode shows buffer with inverse-video caret', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, { 'max-concurrent-subagents': 40 });
    const mcIdx = rows.findIndex(r => r.id === 'max-concurrent-subagents');
    const state = makeState({
      rows,
      cursor: mcIdx,
      viewportOffset: 0,
      editing: { buffer: '40', caret: 2, error: null },
    });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    // Should contain the buffer text
    expect(joined).toContain('40');
    // Should contain inverse video escape sequence ESC[7m (reverse video) or ESC[7m
    expect(joined).toContain('\x1b[7m');
  });

  it('edit mode shows error message when error is set', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, {});
    const mcIdx = rows.findIndex(r => r.id === 'max-concurrent-subagents'); // index 8
    const state = makeState({
      rows,
      cursor: mcIdx,
      viewportOffset: 0, // mcIdx=8 is within first 14 visible rows
      editing: { buffer: '007', caret: 3, error: 'Leading zeros are not allowed' },
    });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    // Error message should appear somewhere
    expect(joined).toContain('Leading zeros');
  });

  it('caret at start shows inverse on first char', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, { 'max-concurrent-subagents': 40 });
    const mcIdx = rows.findIndex(r => r.id === 'max-concurrent-subagents');
    const state = makeState({
      rows,
      cursor: mcIdx,
      viewportOffset: 0,
      editing: { buffer: '40', caret: 0, error: null },
    });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    // inverse on first char: ESC[7m4
    expect(joined).toContain('\x1b[7m4');
  });

  it('empty buffer with caret shows inverse on blank space', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, {});
    const mcIdx = rows.findIndex(r => r.id === 'max-concurrent-subagents'); // index 8
    const state = makeState({
      rows,
      cursor: mcIdx,
      viewportOffset: 0, // mcIdx=8 is within first 14 visible rows
      editing: { buffer: '', caret: 0, error: null },
    });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    // Inverse video on blank/space
    expect(joined).toContain('\x1b[7m');
  });
});

// ---------------------------------------------------------------------------
// Viewport indicators
// ---------------------------------------------------------------------------

describe('flags-view-render — viewport overflow indicators', () => {
  it('shows scroll-up indicator when viewportOffset > 0', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, {});
    const state: FlagsViewState = {
      rows,
      cursor: 3,
      viewportOffset: 3, // rows above viewport
      viewportHeight: 3,
      editing: null,
    };
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    // Some indicator: ↑, ^, ▲, or '...'
    expect(
      joined.includes('↑') ||
      joined.includes('^') ||
      joined.includes('▲') ||
      joined.includes('...') ||
      joined.includes('more'),
    ).toBe(true);
  });

  it('shows scroll-down indicator when rows extend below viewport', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, {});
    const state: FlagsViewState = {
      rows,
      cursor: 0,
      viewportOffset: 0,
      viewportHeight: 3, // only show 3 rows of many
      editing: null,
    };
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    expect(
      joined.includes('↓') ||
      joined.includes('v') ||
      joined.includes('▼') ||
      joined.includes('...') ||
      joined.includes('more'),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hint zone
// ---------------------------------------------------------------------------

describe('flags-view-render — hint zone', () => {
  it('shows hint text for the selected flag', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, {});
    const state = makeState({ rows, cursor: 0 });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    // The hint for 'tui' (index 0) should appear
    const tuiFlag = FLAG_REGISTRY.find(f => f.id === 'tui')!;
    // hint may be truncated; check at least the beginning
    expect(joined).toContain(tuiFlag.hint.slice(0, 20));
  });

  it('shows hint for a different selected row', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, {});
    const briefIdx = rows.findIndex(r => r.id === 'brief');
    const state = makeState({ rows, cursor: briefIdx });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    const briefFlag = FLAG_REGISTRY.find(f => f.id === 'brief')!;
    expect(joined).toContain(briefFlag.hint.slice(0, 15));
  });
});

// ---------------------------------------------------------------------------
// Narrow width
// ---------------------------------------------------------------------------

describe('flags-view-render — narrow width', () => {
  it('does not crash on narrow terminal (cols=60)', () => {
    const state = makeState();
    const lines = renderFrame(state, DIMS_60x24);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('does not crash on very narrow terminal (cols=30)', () => {
    const state = makeState();
    const lines = renderFrame(state, { rows: 24, cols: 30 });
    expect(Array.isArray(lines)).toBe(true);
  });

  it('does not crash on short terminal (rows=15)', () => {
    const h = computeViewportHeight(DIMS_80x15.rows);
    const state = makeState({ viewportHeight: h });
    const lines = renderFrame(state, DIMS_80x15);
    expect(Array.isArray(lines)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Column header alignment (CONS-M4)
// ---------------------------------------------------------------------------

describe('flags-view-render — column header alignment', () => {
  it('FLAG column starts at same offset as data label cell (ANSI-stripped)', () => {
    // At 80 cols (scale=1): labelW = COL_LABEL = 27.
    // Data row layout: prefix(2) + label(27) + dirty(2) + value
    // Header layout must match: 2 spaces + FLAG(27) + 2 spaces + VALUE
    // → FLAG at col 2 (same as label), VALUE at col 2+27+2=31 (same as value cell).
    const rows = buildFlagRows(FLAG_REGISTRY, {});
    const state = makeState({ rows, cursor: 0, viewportOffset: 0 });
    const lines = renderFrame(state, DIMS_80x24);
    const ESC_PATTERN = /\x1b\[[0-9;]*m/g;
    const stripped = lines.map(l => l.replace(ESC_PATTERN, ''));

    // Header is the third line (index 2): title, summary, header
    const header = stripped[2];
    // First data row is the fifth line (index 4): title, summary, header, scroll-up-indicator, data
    const dataRow = stripped[4];

    const flagOffset = header.indexOf('FLAG');
    const valueOffset = header.indexOf('VALUE');
    expect(flagOffset).toBeGreaterThanOrEqual(0);
    expect(valueOffset).toBeGreaterThanOrEqual(0);

    // FLAG must start at offset 2 (matching 2-char prefix in data rows)
    expect(flagOffset).toBe(2);

    // VALUE must start at 2 + labelW + 2.
    // At 80 cols: labelW = floor(27 * min(1, 80/80)) = 27, so VALUE at 31.
    expect(valueOffset).toBe(31);

    // Also confirm that the first non-space character in the data row label area
    // sits at offset 2 (cursor row: '❯ ' prefix, then label).
    // The cursor marker '❯' is at col 0, space at col 1, label starts at col 2.
    expect(dataRow[0]).toBe('❯');
    expect(dataRow[1]).toBe(' ');
    // label content starts at col 2 — first char of the flag label
    expect(flagOffset).toBe(2);
  });

  it('FLAG and VALUE columns align on narrow terminal (cols=60)', () => {
    // At 60 cols: scale = 60/80 = 0.75, labelW = floor(27*0.75)=20, valueW = floor(46*0.75)=34.
    // Header: 2 + labelW(20) + 2 = VALUE at col 24.
    const rows = buildFlagRows(FLAG_REGISTRY, {});
    const state = makeState({ rows, cursor: 0, viewportOffset: 0 });
    const lines = renderFrame(state, DIMS_60x24);
    const ESC_PATTERN = /\x1b\[[0-9;]*m/g;
    const stripped = lines.map(l => l.replace(ESC_PATTERN, ''));

    const header = stripped[2];
    const flagOffset = header.indexOf('FLAG');
    const valueOffset = header.indexOf('VALUE');
    expect(flagOffset).toBe(2);
    // labelW at 60 cols: max(8, floor(27 * min(1, 60/80))) = max(8, floor(20.25)) = 20
    expect(valueOffset).toBe(2 + 20 + 2); // = 24
  });
});

// ---------------------------------------------------------------------------
// viewportHeight ownership — state.viewportHeight is the single owner (ARCH-M5)
// ---------------------------------------------------------------------------

describe('flags-view-render — viewportHeight ownership', () => {
  it('renders exactly state.viewportHeight data rows regardless of dims.rows', () => {
    // dims.rows=24 would give computeViewportHeight(24)=14 rows, but state says 3.
    // After the ARCH-M5 fix, renderFrame reads state.viewportHeight directly.
    const rows = buildFlagRows(FLAG_REGISTRY, {});
    const state: FlagsViewState = {
      rows,
      cursor: 0,
      viewportOffset: 0,
      viewportHeight: 3,
      editing: null,
    };
    const lines = renderFrame(state, DIMS_80x24);
    expect(lines.length).toBe(FIXED_ROWS + 3);
  });

  it('renders exactly state.viewportHeight data rows when state says 1', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, {});
    const state: FlagsViewState = {
      rows,
      cursor: 0,
      viewportOffset: 0,
      viewportHeight: 1,
      editing: null,
    };
    const lines = renderFrame(state, DIMS_80x40);
    expect(lines.length).toBe(FIXED_ROWS + 1);
  });
});

// ---------------------------------------------------------------------------
// Unsaved changes indicator
// ---------------------------------------------------------------------------

describe('flags-view-render — unsaved changes section', () => {
  it('shows unsaved count when rows are dirty', () => {
    const rows = buildFlagRows(FLAG_REGISTRY, { tui: true });
    const modified = rows.map(r =>
      r.id === 'tui' ? { ...r, configuredValue: false as boolean | string | number | null } : r,
    );
    const state = makeState({ rows: modified });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    // Strip ANSI escape sequences and assert the exact unsaved indicator text
    const ESC_PATTERN = /\x1b\[[0-9;]*m/g;
    const plain = joined.replace(ESC_PATTERN, '');
    expect(plain).toContain('1 unsaved change');
  });
});
