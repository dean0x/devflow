/**
 * Pure TUI frame renderer for the devflow flags view.
 *
 * applies ADR-013: CLI-layer view module; zero fs/tty imports.
 * avoids PF-014: pure function, no process.exit(), no I/O.
 *
 * Layout (FIXED_ROWS = 10, viewport = state.viewportHeight — single owner):
 *   1  Title "  Devflow Flags"
 *   2  Set / modified summary
 *   3  Column header "  FLAG  VALUE" (scaled; offsets match data-row label/value)
 *   4  Scroll-up indicator "  ↑ N more" (blank if none)
 *   5+ Viewport rows (one per visible flag)
 *  -5  Scroll-down indicator "  ↓ N more" (blank if none)
 *  -4  (blank)
 *  -3  Hint line 1 (flag description/hint for selected flag)
 *  -2  Hint line 2 (error message while editing, else edit keybindings)
 *  -1  Unsaved count line (blank when 0)
 *   0  Keybinding footer
 *
 * Data row columns (chars at the 80-col reference width — total 77):
 *   PREFIX  : 2  (cursor mark "❯ " or "  ")
 *   LABEL   : 27 (flag label, padded / truncated; scaled by cols/80 at other widths)
 *   DIRTY   : 2  ("● " when dirty, else "  ")
 *   VALUE   : 46 (formatted value or edit buffer; scaled by cols/80 at other widths)
 *
 * Edit buffer rendering:
 *   Text before caret + inverse(charAtCaret|' ') + text after caret
 *   inverse() = ESC[7m ... ESC[0m (reverse video)
 */

import {
  bold,
  dim,
  yellow,
  cyan,
  gray,
  green,
  red,
  inverse,
} from '../../core/ansi.js';
import { padToVisible, truncateVisible, sanitizeCell } from '../tui/cells.js';
import type { FlagsViewState, FlagRow } from './state.js';
import { FLAG_REGISTRY } from '../../core/flags.js';
import type { RenderDims } from '../tui/terminal.js';

// ─── Layout constants ─────────────────────────────────────────────────────────

/** Non-viewport fixed lines in a rendered frame (see layout comment above). */
export const FIXED_ROWS = 10;
const MIN_VIEWPORT = 1;

const COL_LABEL = 27;    // flag label
const COL_VALUE = 46;    // value or edit buffer

// Pre-built flag description map
const FLAG_HINT_MAP = new Map<string, string>(FLAG_REGISTRY.map(f => [f.id, f.hint]));

// ─── computeViewportHeight ────────────────────────────────────────────────────

/** Return the number of data rows the terminal can display given its height. */
export function computeViewportHeight(termRows: number): number {
  return Math.max(MIN_VIEWPORT, termRows - FIXED_ROWS);
}

// ─── Value formatting ─────────────────────────────────────────────────────────

/**
 * Format a row's configuredValue for display.
 *
 * Value vocabulary (one syntax, one semantic — applies ADR-016's amendment lesson):
 *   null → dim 'unset'; boolean → green 'enabled' / yellow 'disabled';
 *   non-boolean at devflow default → plain string;
 *   non-boolean deviating from devflow default → bold string.
 *
 * Colour vocabulary (one colour, one semantic — applies ADR-016's amendment lesson):
 *   cyan   = focus indicator (chevron wrapper ‹ › on the cursor row only)
 *   yellow = dirty indicator (unconditional ●) and boolean 'disabled'
 *   green  = boolean 'enabled'
 *   bold   = non-boolean value deviating from devflow default
 *
 * disk-sourced values are routed through sanitizeCell to prevent TAB/LF
 * layout breaks inside the fixed-width TUI cell (avoids PF-023).
 */
function formatValue(row: FlagRow): string {
  const v = row.configuredValue;
  if (v === null) return dim('unset');
  if (typeof v === 'boolean') return v ? green('enabled') : yellow('disabled');
  // Non-boolean: sanitize; bold signals deviation (cyan is reserved for focus)
  const str = sanitizeCell(String(v));
  if (!Object.is(v, row.devflowDefault)) return bold(str);
  return str;
}

// ─── Edit buffer rendering ────────────────────────────────────────────────────

/**
 * Render the edit buffer with an inverse-video caret marker, windowed to budget.
 *
 * Caret semantics: the caret is BETWEEN characters (text cursor position).
 *   - caret = 0: inverse on buf[0] (or space for empty buffer)
 *   - caret = n < len: inverse on buf[n]
 *   - caret = len: inverse on a trailing space (end of string)
 *
 * When the plain buffer length exceeds `budget`, the buffer is windowed so the
 * caret stays at or near the right edge of the visible region. The inverse()
 * marker is inserted AFTER windowing, so it always survives the size constraint.
 * (Before this fix, renderRow called truncateVisible on the styled output, which
 * stripped ANSI including the inverse escape whenever the buffer exceeded budget.)
 */
function renderBuffer(buffer: string, caret: number, budget: number): string {
  const safe = buffer.replace(/[\x00-\x1f\x7f]/g, ''); // strip control chars from display
  const safeLen = safe.length;

  if (safeLen === 0) {
    // Empty buffer: show inverse on a blank space
    return inverse(' ');
  }

  // Clamp caret to [0, safeLen]; safeLen means "trailing space" (past last char).
  const clampedCaret = Math.max(0, Math.min(caret, safeLen));

  // Window the buffer to fit within budget visible chars, keeping caret visible.
  // The window follows the caret: push it as far right as possible so the caret
  // is at or near the right edge.
  let windowStart = 0;
  if (safeLen > budget) {
    // Position caret at the rightmost slot; clamp so the window stays in bounds.
    windowStart = Math.min(
      Math.max(0, clampedCaret - budget + 1),
      Math.max(0, safeLen - budget),
    );
  }

  const windowed = safe.slice(windowStart, windowStart + budget);
  const windowedCaret = clampedCaret - windowStart;

  if (windowedCaret <= 0) {
    return inverse(windowed[0]) + windowed.slice(1);
  }
  if (windowedCaret >= windowed.length) {
    return windowed + inverse(' ');
  }
  return windowed.slice(0, windowedCaret) + inverse(windowed[windowedCaret]) + windowed.slice(windowedCaret + 1);
}

// ─── Row renderer ─────────────────────────────────────────────────────────────

/**
 * Render a single data row.
 * Column widths are passed in from renderFrame so the header and rows share one binding.
 */
function renderRow(
  row: FlagRow,
  isCursor: boolean,
  isEditing: boolean,
  editBuffer: string,
  editCaret: number,
  labelW: number,
  valueW: number,
): string {
  const prefix = isCursor ? '❯ ' : '  ';

  const isDirty = row.configuredValue !== row.originalValue;
  // Dirty dot is yellow unconditionally — dirtiness must be readable on every row,
  // not only the cursor row.
  const dirtyDot = isDirty ? yellow('● ') : '  ';

  // Sanitize label (registry literal; sanitizeCell prevents TAB/LF layout breaks).
  const rawLabel = sanitizeCell(row.label);
  const labelCell = padToVisible(
    isCursor ? bold(truncateVisible(rawLabel, labelW)) : truncateVisible(rawLabel, labelW),
    labelW,
  );

  // Chevrons (cyan ‹ ›) mark the focused control / live edit buffer.
  // Colour vocabulary: cyan = focus only; deviation uses bold (see formatValue).
  // The chevrons take 4 visible chars (‹ + space + space + ›); budget accordingly.
  //
  // Composition rule: colour AFTER measuring — each styled segment is self-contained
  // so an inner RESET (e.g. from green('enabled')) does not kill the outer cyan.
  //   cyan('‹ ') + <styled-or-plain content> + cyan(' ›')
  // rather than cyan(`‹ ${content} ›`), which terminates the outer cyan at the
  // inner RESET, leaving the closing chevron unstyled (applies ADR-016 amendment lesson).
  const chevronBudget = valueW - 4;
  let valueCell: string;
  if (isCursor && isEditing) {
    // Live edit buffer: renderBuffer windows to chevronBudget and inserts the
    // inverse() caret AFTER windowing, so the caret always survives (ARCH-M7b fix).
    const bufStr = renderBuffer(editBuffer, editCaret, chevronBudget);
    valueCell = cyan('‹ ') + bufStr + cyan(' ›');
  } else if (isCursor) {
    // Focused control: truncateVisible is safe here — it fires on plain text only
    // when the value exceeds budget; the chevrons are in their own cyan segments.
    const fmtVal = formatValue(row);
    valueCell = cyan('‹ ') + truncateVisible(fmtVal, chevronBudget) + cyan(' ›');
  } else {
    const fmtVal = formatValue(row);
    valueCell = truncateVisible(fmtVal, valueW);
  }

  return `${prefix}${labelCell}${dirtyDot}${valueCell}`;
}

// ─── renderFrame ─────────────────────────────────────────────────────────────

/**
 * Render a complete flags TUI frame as an array of strings (one per terminal line).
 * No newlines within strings. Safe at any dims (narrows gracefully).
 */
export function renderFrame(
  state: FlagsViewState,
  dims: RenderDims,
): string[] {
  const { rows, cursor, viewportOffset, editing } = state;
  // state.viewportHeight is the single owner — clamped to a MIN so tests that
  // set viewportHeight explicitly render exactly that many data rows.
  const viewportHeight = Math.max(MIN_VIEWPORT, state.viewportHeight);
  const totalRows = rows.length;

  // ── Column widths (hoisted here so header and rows share one binding) ──────
  const scale = Math.min(1, dims.cols / 80);
  const labelW = Math.max(8, Math.floor(COL_LABEL * scale));
  const valueW = Math.max(8, Math.floor(COL_VALUE * scale));

  // ── Determine visible row range ───────────────────────────────────────────
  const lastVisible = Math.min(totalRows - 1, viewportOffset + viewportHeight - 1);
  const visibleRows = rows.slice(viewportOffset, lastVisible + 1);
  const rowsAbove = viewportOffset;
  const rowsBelow = Math.max(0, totalRows - (lastVisible + 1));

  // ── Title line ────────────────────────────────────────────────────────────
  const titleLine = bold('  Devflow Flags');

  // ── Set / modified summary ────────────────────────────────────────────────
  const totalSet = rows.filter(r => r.configuredValue !== null).length;
  const totalDirty = rows.filter(r => r.configuredValue !== r.originalValue).length;
  let summaryLine = dim(`  ${totalSet} active flags`);
  if (totalDirty > 0) {
    summaryLine += dim(` · `) + yellow(`${totalDirty} modified`);
  }

  // ── Column header (uses same labelW/valueW as rows so offsets are identical) ──
  const colHeader =
    '  ' +
    padToVisible(gray('FLAG'), labelW) +
    '  ' +
    gray('VALUE');

  // ── Scroll indicators ─────────────────────────────────────────────────────
  const upIndicator = rowsAbove > 0 ? dim(`  ↑ ${rowsAbove} more`) : '';
  const downIndicator = rowsBelow > 0 ? dim(`  ↓ ${rowsBelow} more`) : '';

  // ── Rendered data rows ────────────────────────────────────────────────────
  const renderedRows: string[] = visibleRows.map((row, relIdx) => {
    const absIdx = viewportOffset + relIdx;
    const isCursor = absIdx === cursor;
    const isEditing = isCursor && editing !== null;
    return renderRow(
      row,
      isCursor,
      isEditing,
      editing?.buffer ?? '',
      editing?.caret ?? 0,
      labelW,
      valueW,
    );
  });

  // ── Hint zone ─────────────────────────────────────────────────────────────
  const selectedRow = rows[cursor];
  const selectedHint = selectedRow ? (FLAG_HINT_MAP.get(selectedRow.id) ?? '') : '';
  const hintLine1 = selectedHint
    ? dim(truncateVisible(`  ${selectedHint}`, dims.cols))
    : '';

  let hintLine2: string;
  if (editing !== null) {
    if (editing.error) {
      hintLine2 = red(truncateVisible(`  ✕ ${editing.error}`, dims.cols));
    } else {
      hintLine2 = dim('  enter confirm   esc cancel edit   backspace delete');
    }
  } else {
    hintLine2 = dim('  space/←→ cycle   e edit   d default   u unset   enter save   esc cancel');
  }

  // ── Unsaved changes ───────────────────────────────────────────────────────
  // Reuse totalDirty computed above — avoids a duplicate full-array scan (PERF-L2).
  const unsavedLine =
    totalDirty > 0
      ? `  ${yellow(`${totalDirty} unsaved change${totalDirty === 1 ? '' : 's'}`)}`
      : '';

  // ── Keybinding footer ─────────────────────────────────────────────────────
  const footerText = dim(
    truncateVisible('  ↑↓/jk move   enter save   esc/q cancel   ctrl-c abort', dims.cols),
  );

  // ── Assemble ──────────────────────────────────────────────────────────────
  const out: string[] = [
    titleLine,
    summaryLine,
    colHeader,
    upIndicator,
    ...renderedRows,
    downIndicator,
    '',
    hintLine1,
    hintLine2,
    unsavedLine,
    footerText,
  ];

  return out;
}

