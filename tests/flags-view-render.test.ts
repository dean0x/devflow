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

/** Strip ANSI escape sequences so assertions operate on plain text. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function makeState(overrides: Partial<FlagsViewState> = {}): FlagsViewState {
  const rows = buildFlagRows({});
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
    const rows = buildFlagRows({ spellcheck: 'aspell\tcheck\nline2' });
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
    // Applies PF-018 mechanism 7: assert the SPECIFIC cursor row, not the joined
    // frame. The frame always contains 'enabled' from other default-ON flags.
    const rows = buildFlagRows({ tui: true });
    const state = makeState({ rows, cursor: 0, viewportOffset: 0 });
    const lines = renderFrame(state, DIMS_80x24);
    const cursorRow = lines.find(l => stripAnsi(l).startsWith('❯'))!;
    expect(cursorRow).toBeDefined();
    expect(stripAnsi(cursorRow)).toContain('enabled');
    expect(stripAnsi(cursorRow)).not.toContain('disabled'); // negative control
  });

  it('boolean flag shows "disabled" when false', () => {
    // Applies PF-018 mechanism 7: assert the SPECIFIC cursor row, not the joined
    // frame. The frame always contains 'disabled' from other default-OFF flags.
    const rows = buildFlagRows({ tui: false });
    const state = makeState({ rows, cursor: 0, viewportOffset: 0 });
    const lines = renderFrame(state, DIMS_80x24);
    const cursorRow = lines.find(l => stripAnsi(l).startsWith('❯'))!;
    expect(cursorRow).toBeDefined();
    expect(stripAnsi(cursorRow)).toContain('disabled');
    expect(stripAnsi(cursorRow)).not.toContain('enabled'); // negative control
  });

  it('enum flag shows the value when set', () => {
    const rows = buildFlagRows({ 'view-mode': 'verbose' });
    // Find the index of view-mode row — scroll viewport to make it visible
    const vmIdx = rows.findIndex(r => r.id === 'view-mode');
    const state = makeState({ rows, cursor: vmIdx, viewportOffset: vmIdx });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    expect(joined).toContain('verbose');
  });

  it('view-mode shows "unset" when null (default/neutral)', () => {
    // Applies PF-018 mechanism 7: 'unset' appears in the browse-mode hint line
    // unconditionally; assert the specific cursor row instead.
    const rows = buildFlagRows({}); // view-mode absent → null
    const vmIdx = rows.findIndex(r => r.id === 'view-mode');
    const state = makeState({ rows, cursor: vmIdx, viewportOffset: vmIdx });
    const lines = renderFrame(state, DIMS_80x24);
    const cursorRow = lines.find(l => stripAnsi(l).startsWith('❯'))!;
    expect(cursorRow).toBeDefined();
    expect(stripAnsi(cursorRow)).toContain('unset');
    expect(stripAnsi(cursorRow)).not.toContain('verbose'); // negative control
    expect(stripAnsi(cursorRow)).not.toContain('focus');   // negative control
  });

  it('number flag shows value when set', () => {
    // Applies PF-018 mechanism 7: assert the cursor row, not the joined frame.
    // The frame always includes '40' from the devflow-default for max-concurrent-subagents.
    const rows = buildFlagRows({ 'max-concurrent-subagents': 40 });
    const mcIdx = rows.findIndex(r => r.id === 'max-concurrent-subagents');
    const state = makeState({ rows, cursor: mcIdx, viewportOffset: 0 });
    const lines = renderFrame(state, DIMS_80x24);
    const cursorRow = lines.find(l => stripAnsi(l).startsWith('❯'))!;
    expect(cursorRow).toBeDefined();
    expect(stripAnsi(cursorRow)).toContain('40');
    expect(stripAnsi(cursorRow)).not.toContain('unset'); // negative control
  });

  it('number flag shows "unset" when null', () => {
    // Applies PF-018 mechanism 7: 'unset' appears in the browse-mode hint line
    // unconditionally; assert the specific cursor row instead.
    const rows = buildFlagRows({ 'subagent-spawn-depth': null });
    const sdIdx = rows.findIndex(r => r.id === 'subagent-spawn-depth');
    const state = makeState({ rows, cursor: sdIdx, viewportOffset: sdIdx });
    const lines = renderFrame(state, DIMS_80x24);
    const cursorRow = lines.find(l => stripAnsi(l).startsWith('❯'))!;
    expect(cursorRow).toBeDefined();
    expect(stripAnsi(cursorRow)).toContain('unset');
    expect(stripAnsi(cursorRow)).not.toContain('enabled'); // negative control
    expect(stripAnsi(cursorRow)).not.toContain('disabled'); // negative control
  });
});

// ---------------------------------------------------------------------------
// Dirty dot
// ---------------------------------------------------------------------------

describe('flags-view-render — dirty dot', () => {
  it('shows dirty indicator when configuredValue !== originalValue', () => {
    const rows = buildFlagRows({ tui: true });
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
    // Applies PF-018 mechanism 4: Array.isArray is satisfied by any return value.
    // render.ts:162 pins the dirty indicator to yellow('● ') (exactly '●' in plain
    // text), so assert its absence when configuredValue === originalValue.
    const rows = buildFlagRows({ tui: true });
    const state = makeState({ rows, cursor: 0, viewportOffset: 0 });
    const lines = renderFrame(state, DIMS_80x24);
    const plain = lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
    expect(plain).not.toContain('●');
  });
});

// ---------------------------------------------------------------------------
// Cursor indicator
// ---------------------------------------------------------------------------

describe('flags-view-render — cursor indicator', () => {
  it('selected row shows ❯ prefix; no other row shares it', () => {
    // Applies PF-018 mechanism 7: the browse-hint line always contains '→', making
    // the disjunction vacuous. Assert the specific cursor row carries ❯ and that
    // exactly one data row has it (negative control).
    const state = makeState({ cursor: 0 });
    const lines = renderFrame(state, DIMS_80x24);
    // Exactly one line must start with ❯ (the cursor row)
    const cursorLines = lines.filter(l => stripAnsi(l).startsWith('❯'));
    expect(cursorLines).toHaveLength(1);
    // The cursor row must name the tui flag (cursor=0 → row 0 = 'Fullscreen terminal UI')
    expect(stripAnsi(cursorLines[0])).toContain('Fullscreen terminal UI');
  });
});

// ---------------------------------------------------------------------------
// Edit mode rendering
// ---------------------------------------------------------------------------

describe('flags-view-render — edit mode', () => {
  it('edit mode shows buffer with inverse-video caret', () => {
    const rows = buildFlagRows({ 'max-concurrent-subagents': 40 });
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
    const rows = buildFlagRows({});
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
    const rows = buildFlagRows({ 'max-concurrent-subagents': 40 });
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
    const rows = buildFlagRows({});
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
    // Applies PF-018 mechanism 7: '↑' appears in the footer keybinding line
    // unconditionally. Assert lines[3] — the dedicated upIndicator slot in the
    // frame layout — which is empty when no rows are above and populated otherwise.
    // state.viewportHeight is the single owner (ARCH-M5 fix — see viewportHeight
    // ownership tests); viewportHeight:3 here means exactly 3 data rows are drawn.
    const rows = buildFlagRows({});
    const state: FlagsViewState = {
      rows,
      cursor: 3,
      viewportOffset: 3, // 3 rows above the viewport
      viewportHeight: 3,
      editing: null,
    };
    const lines = renderFrame(state, DIMS_80x24);
    // upIndicator is always at lines[3] (layout: title[0], summary[1], header[2], upIndicator[3])
    expect(stripAnsi(lines[3])).toMatch(/↑ \d+ more/);
    // Negative control: no rows are below with cursor=3, viewportOffset=3, viewportHeight=3,
    // rows.length=28 → rowsBelow = 28 - (3+3) = 22, so downIndicator IS populated
    // (lines[4+3]=lines[7]). Just confirm upIndicator is row-specific, not footer.
    expect(stripAnsi(lines[lines.length - 1])).not.toMatch(/↑ \d+ more/); // footer not the indicator
  });

  it('shows scroll-down indicator when rows extend below viewport', () => {
    // Applies PF-018 mechanism 7: '↓' and 'v' appear in the footer line
    // unconditionally. Assert lines[4+viewportHeight] — the dedicated downIndicator
    // slot — instead of the joined frame.
    const rows = buildFlagRows({});
    const state: FlagsViewState = {
      rows,
      cursor: 0,
      viewportOffset: 0,
      viewportHeight: 3, // only show 3 rows of 28
      editing: null,
    };
    const lines = renderFrame(state, DIMS_80x24);
    // downIndicator is at lines[4 + viewportHeight] = lines[7]
    expect(stripAnsi(lines[7])).toMatch(/↓ \d+ more/);
    // Negative control: no rows are above
    expect(stripAnsi(lines[3])).toBe(''); // upIndicator slot is empty
  });
});

// ---------------------------------------------------------------------------
// Hint zone
// ---------------------------------------------------------------------------

describe('flags-view-render — hint zone', () => {
  it('shows hint text for the selected flag', () => {
    const rows = buildFlagRows({});
    const state = makeState({ rows, cursor: 0 });
    const lines = renderFrame(state, DIMS_80x24);
    const joined = lines.join('\n');
    // The hint for 'tui' (index 0) should appear
    const tuiFlag = FLAG_REGISTRY.find(f => f.id === 'tui')!;
    // hint may be truncated; check at least the beginning
    expect(joined).toContain(tuiFlag.hint.slice(0, 20));
  });

  it('shows hint for a different selected row', () => {
    const rows = buildFlagRows({});
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
    const rows = buildFlagRows({});
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
    const rows = buildFlagRows({});
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
    const rows = buildFlagRows({});
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
    const rows = buildFlagRows({});
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
    const rows = buildFlagRows({ tui: true });
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

// ---------------------------------------------------------------------------
// ARCH-M7a: chevron composition — closing chevron styled in its own cyan segment
// ---------------------------------------------------------------------------

describe('flags-view-render — ARCH-M7a: chevron composition', () => {
  it('focused row with coloured value has closing chevron in cyan (not unstyled after inner RESET)', () => {
    // tui flag (row 0) is boolean; value true → green('enabled').
    // Before fix: cyan(`‹ ${green('enabled')} ›`) emits inner RESET before ' ›',
    //   leaving the closing chevron unstyled (ESC[0m ›).
    // After fix: cyan('‹ ') + green('enabled') + cyan(' ›') — each segment self-contained;
    //   the closing chevron is always inside its own ESC[36m ... ESC[0m span.
    const rows = buildFlagRows({ tui: true });
    const state = makeState({ rows, cursor: 0, viewportOffset: 0 });
    const lines = renderFrame(state, DIMS_80x24);

    const ESC_PATTERN = /\x1b\[[0-9;]*m/g;
    const cursorRow = lines.find(l => l.replace(ESC_PATTERN, '').startsWith('❯'));
    expect(cursorRow).toBeDefined();

    // cyan(' ›') = '\x1b[36m ›\x1b[0m'; the closing chevron must be preceded by ESC[36m
    expect(cursorRow!).toContain('\x1b[36m ›');
  });
});

// ---------------------------------------------------------------------------
// ARCH-M7b: caret survival — long buffer does not lose the inverse-video caret
// ---------------------------------------------------------------------------

describe('flags-view-render — ARCH-M7b: caret survival beyond chevron budget', () => {
  it('60-char buffer with caret at end still shows inverse-video caret in 80-col frame', () => {
    // chevronBudget at 80 cols = valueW(46) - 4 = 42.
    // A 60-char buffer exceeds the budget; the caret at position 60 (trailing space)
    // must still appear as ESC[7m (inverse video) in the cursor row.
    //
    // Before fix: truncateVisible strips ANSI from the buffer output, discarding ESC[7m.
    // After fix: renderBuffer windows the plain buffer to budget width before inserting
    //   inverse(), so the caret escape always survives.
    const rows = buildFlagRows({});
    const mcIdx = rows.findIndex(r => r.id === 'max-concurrent-subagents');
    const longBuffer = 'a'.repeat(60); // 60 > chevronBudget(42)
    const state = makeState({
      rows,
      cursor: mcIdx,
      viewportOffset: 0,
      editing: { buffer: longBuffer, caret: 60, error: null }, // caret at end
    });
    const lines = renderFrame(state, DIMS_80x24);

    const ESC_PATTERN = /\x1b\[[0-9;]*m/g;
    const cursorRow = lines.find(l => l.replace(ESC_PATTERN, '').startsWith('❯'));
    expect(cursorRow).toBeDefined();

    // The inverse-video escape must be present in the cursor row
    expect(cursorRow!).toContain('\x1b[7m');
  });
});

// ---------------------------------------------------------------------------
// ARCH-M7c: deviation signal — non-boolean deviating value uses bold, not cyan
// ---------------------------------------------------------------------------

describe('flags-view-render — ARCH-M7c: deviation signal', () => {
  it('non-boolean deviating value on non-cursor row uses bold not cyan (applies ADR-016 amendment lesson)', () => {
    // max-concurrent-subagents devflowDefault=40; value 20 deviates.
    // Before fix: formatValue returns cyan('20'), conflating "focus" and "deviation"
    //   — one colour, two semantics (ADR-016 amendment lesson).
    // After fix: formatValue returns bold('20'); cyan = focus indicator only (chevrons).
    //
    // cursor at row 0 (not mcIdx) so the max-concurrent-subagents row is non-cursor;
    // no cyan chevrons appear on it.
    const rows = buildFlagRows({ 'max-concurrent-subagents': 20 });
    const state = makeState({ rows, cursor: 0, viewportOffset: 0 });
    const lines = renderFrame(state, DIMS_80x24);

    const ESC_PATTERN = /\x1b\[[0-9;]*m/g;
    // Find the non-cursor row whose ANSI-stripped content includes the flag label
    const mcRow = lines.find(l => l.replace(ESC_PATTERN, '').includes('Max concurrent'));
    expect(mcRow).toBeDefined();

    // The deviating value must be rendered with bold (ESC[1m), not cyan (ESC[36m).
    expect(mcRow!).toContain('\x1b[1m');      // bold — deviation signal
    expect(mcRow!).not.toContain('\x1b[36m'); // NOT cyan — cyan = focus only
  });
});
