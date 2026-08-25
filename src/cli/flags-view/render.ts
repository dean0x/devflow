/**
 * Pure TUI frame renderer for the devflow flags view.
 *
 * applies ADR-013: CLI-layer view module; zero fs/tty imports.
 * avoids PF-014: pure function, no process.exit(), no I/O.
 *
 * Layout (FIXED_ROWS = 10, viewport = dims.rows - 10):
 *   1  Title "  Devflow Flags"
 *   2  Set / modified summary
 *   3  Column header "    FLAG  VALUE"
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

const COL_PREFIX = 2;    // "❯ " or "  "
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
 * ADR-016 vocabulary:
 *   null            → dim 'unset'   (key absent / deliberately unset)
 *   boolean         → green 'enabled' / yellow 'disabled'
 *   non-boolean at devflow default → plain string
 *   non-boolean deviating from devflow default → cyan string
 *
 * disk-sourced values are routed through sanitizeCell to prevent TAB/LF
 * layout breaks inside the fixed-width TUI cell (PF-023).
 */
function formatValue(row: FlagRow): string {
  const v = row.configuredValue;
  if (v === null) return dim('unset');
  if (typeof v === 'boolean') return v ? green('enabled') : yellow('disabled');
  // Non-boolean: sanitize then colour by deviation
  const str = sanitizeCell(String(v));
  if (!Object.is(v, row.devflowDefault)) return cyan(str);
  return str;
}

// ─── Edit buffer rendering ────────────────────────────────────────────────────

/**
 * Render the edit buffer with an inverse-video caret marker.
 *
 * Caret semantics: the caret is BETWEEN characters (text cursor position).
 *   - caret = 0: inverse on buf[0] (or space for empty buffer)
 *   - caret = n < len: inverse on buf[n]
 *   - caret = len: inverse on a trailing space (end of string)
 */
function renderBuffer(buffer: string, caret: number): string {
  const safe = buffer.replace(/[\x00-\x1f\x7f]/g, ''); // strip control chars from display
  const safeLen = safe.length;

  if (safeLen === 0) {
    // Empty buffer: show inverse on a blank space
    return inverse(' ');
  }

  if (caret <= 0) {
    return inverse(safe[0]) + safe.slice(1);
  }

  if (caret >= safeLen) {
    return safe + inverse(' ');
  }

  return safe.slice(0, caret) + inverse(safe[caret]) + safe.slice(caret + 1);
}

// ─── Row renderer ─────────────────────────────────────────────────────────────

/**
 * Render a single data row.
 * Column widths at 80-col reference: see file-header table (total 77 visible chars).
 */
function renderRow(
  row: FlagRow,
  isCursor: boolean,
  isEditing: boolean,
  editBuffer: string,
  editCaret: number,
  cols: number,
): string {
  const scale = Math.min(1, cols / 80);
  const labelW = Math.max(8, Math.floor(COL_LABEL * scale));
  const valueW = Math.max(8, Math.floor(COL_VALUE * scale));

  const prefix = isCursor ? '❯ ' : '  ';

  const isDirty = row.configuredValue !== row.originalValue;
  // ADR-016: dirty dot is yellow UNCONDITIONALLY (not just on cursor)
  const dirtyDot = isDirty ? yellow('● ') : '  ';

  // Sanitize label (user-defined registry label is trusted, but sanitize for safety)
  const rawLabel = row.label;
  const labelCell = padToVisible(
    isCursor ? bold(truncateVisible(rawLabel, labelW)) : truncateVisible(rawLabel, labelW),
    labelW,
  );

  // ADR-016: chevrons mark the focused control / live edit buffer (cyan ‹ › wrapping).
  // The chevrons take 4 visible chars (‹ + space + space + ›); budget accordingly.
  const chevronBudget = valueW - 4;
  let valueCell: string;
  if (isCursor && isEditing) {
    // Live edit buffer: cyan ‹ buffer ›
    const bufStr = renderBuffer(editBuffer, editCaret);
    valueCell = cyan(`‹ ${truncateVisible(bufStr, chevronBudget)} ›`);
  } else if (isCursor) {
    // Focused control: cyan ‹ value ›
    const fmtVal = formatValue(row);
    valueCell = cyan(`‹ ${truncateVisible(fmtVal, chevronBudget)} ›`);
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
  const viewportHeight = computeViewportHeight(dims.rows);
  const totalRows = rows.length;

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

  // ── Column header ─────────────────────────────────────────────────────────
  const colHeader =
    '    ' +
    padToVisible(gray('FLAG'), COL_LABEL) +
    '   ' +
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
      dims.cols,
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
  const unsaved = rows.filter(r => r.configuredValue !== r.originalValue).length;
  const unsavedLine =
    unsaved > 0
      ? `  ${yellow(`${unsaved} unsaved change${unsaved === 1 ? '' : 's'}`)}`
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

