/**
 * Pure TUI frame renderer for the devflow agents view.
 *
 * applies ADR-013: CLI-layer view module; zero fs/tty imports.
 * avoids PF-014: pure function, no process.exit(), no I/O.
 *
 * Layout (fixed lines = 9, viewport = dims.rows - 9):
 *   1  Title "  Devflow Agents" + right "proxy: enabled|disabled"
 *   2  (blank)
 *   3  Column header "    AGENT  MODEL  EFFORT"
 *   4  Scroll-up indicator "  ↑ N more" (blank if none)
 *   5+ Viewport rows
 *  -3  Scroll-down indicator "  ↓ N more" (blank if none)
 *  -2  (blank)
 *  -1  Unsaved count "  N unsaved changes" (blank if 0)
 *   0  Keybinding footer
 *
 * Columns (chars):
 *   PREFIX  :  2  (cursor mark "❯ " or "  ")
 *   AGENT   : 20
 *   MODEL   : 24
 *   EFFORT  : 14
 */

import {
  bold,
  dim,
  green,
  yellow,
  cyan,
  gray,
  truncate,
  stripAnsi,
} from '../../hud/colors.js';
import {
  isDirtyModel,
  isDirtyEffort,
  unsavedCount,
  type AgentRow,
  type AgentsViewState,
} from './state.js';

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const FIXED_ROWS = 9; // non-viewport lines (see layout comment above)
const MIN_VIEWPORT = 1;

const COL_AGENT = 20;
const COL_MODEL = 32;
const COL_EFFORT = 14;

// ---------------------------------------------------------------------------
// Cell renderers (pure, return styled string)
// ---------------------------------------------------------------------------

function padToVisible(s: string, width: number): string {
  // Pad by visible length (strip ANSI, then pad with spaces).
  const visible = stripAnsi(s);
  const padding = Math.max(0, width - visible.length);
  return s + ' '.repeat(padding);
}

function truncateVisible(s: string, maxWidth: number): string {
  const raw = stripAnsi(s);
  if (raw.length <= maxWidth) return s;
  // Re-truncate the unstyled version and rebuild — simpler than ANSI-aware slice.
  return truncate(raw, maxWidth);
}

/**
 * Render the model cell for a given row, considering cursor/active/dirty state.
 */
function renderModelCell(
  row: AgentRow,
  isCursor: boolean,
  isActive: boolean,
  maxWidth: number,
): string {
  const dirty = isDirtyModel(row);

  let valueStr: string;

  if (row.configuredModel === 'default') {
    const hint = dim(`(${row.shippedDefault})`);
    valueStr = `default ${hint}`;
    if (row.dormantModel !== null) {
      // Dormant: show saved GPT name as dim annotation
      valueStr += ` ${dim(`${row.dormantModel} saved`)}`;
    }
  } else {
    valueStr = row.configuredModel;
  }

  let cell: string;
  if (isCursor && isActive) {
    // Active field on cursor row: wrap in ‹ ›, put ● after value if dirty
    const inner = dirty ? `${valueStr} ●` : valueStr;
    cell = cyan(`‹ ${inner} ›`);
  } else if (isCursor && dirty) {
    cell = `● ${valueStr}`;
  } else {
    cell = valueStr;
  }

  return truncateVisible(cell, maxWidth);
}

/**
 * Render the effort cell for a given row, considering cursor/active/dirty state.
 */
function renderEffortCell(
  row: AgentRow,
  isCursor: boolean,
  isActive: boolean,
  maxWidth: number,
): string {
  const dirty = isDirtyEffort(row);
  const value = row.configuredEffort === 'default'
    ? `default`
    : row.configuredEffort;

  let cell: string;
  if (isCursor && isActive) {
    const inner = dirty ? `${value} ●` : value;
    cell = cyan(`‹ ${inner} ›`);
  } else if (isCursor && dirty) {
    cell = `● ${value}`;
  } else {
    cell = value;
  }

  return truncateVisible(cell, maxWidth);
}

// ---------------------------------------------------------------------------
// renderFrame
// ---------------------------------------------------------------------------

export interface RenderDims {
  readonly rows: number;
  readonly cols: number;
}

/**
 * Render a complete TUI frame as an array of strings (one per terminal line).
 * No newlines within strings. Safe at any dims (narrows gracefully).
 */
export function renderFrame(
  state: AgentsViewState,
  dims: RenderDims,
): string[] {
  const {
    rows,
    cursor,
    activeField,
    viewportOffset,
    proxyEnabled,
  } = state;

  const viewportHeight = Math.max(
    MIN_VIEWPORT,
    dims.rows - FIXED_ROWS,
  );

  // Column widths — shrink gracefully at narrow terminals.
  const totalContent = 2 + COL_AGENT + COL_MODEL + COL_EFFORT; // prefix + 3 cols
  const scale = Math.min(1, dims.cols / Math.max(totalContent, 1));
  const agentW = Math.max(6, Math.floor(COL_AGENT * scale));
  const modelW = Math.max(8, Math.floor(COL_MODEL * scale));
  const effortW = Math.max(7, Math.floor(COL_EFFORT * scale));

  // ---------------------------------------------------------------------------
  // 1. Title line
  // ---------------------------------------------------------------------------

  const proxyLabel = proxyEnabled
    ? `proxy: ${green('enabled')}`
    : `proxy: ${yellow('disabled')}`;
  const title = bold('  Devflow Agents');
  const titleVisible = stripAnsi(title);
  const proxyVisible = stripAnsi(proxyLabel);
  const gap = Math.max(1, dims.cols - titleVisible.length - proxyVisible.length);
  const titleLine = `${title}${' '.repeat(gap)}${proxyLabel}`;

  // ---------------------------------------------------------------------------
  // 2. Column header
  // ---------------------------------------------------------------------------

  const colHeader =
    `    ` +
    padToVisible(gray('AGENT'), agentW) +
    padToVisible(gray('MODEL'), modelW) +
    gray('EFFORT');

  // ---------------------------------------------------------------------------
  // 3. Determine visible row range
  // ---------------------------------------------------------------------------

  const totalRows = rows.length;
  const lastVisible = Math.min(totalRows - 1, viewportOffset + viewportHeight - 1);
  const visibleRows = rows.slice(viewportOffset, lastVisible + 1);

  const rowsAbove = viewportOffset;
  const rowsBelow = Math.max(0, totalRows - (lastVisible + 1));

  // ---------------------------------------------------------------------------
  // 4. Render visible rows
  // ---------------------------------------------------------------------------

  const renderedRows: string[] = visibleRows.map((row, relIdx) => {
    const absIdx = viewportOffset + relIdx;
    const isCursor = absIdx === cursor;

    const prefix = isCursor ? '❯ ' : '  ';
    const nameCell = padToVisible(
      isCursor ? bold(truncateVisible(row.name, agentW)) : truncateVisible(row.name, agentW),
      agentW,
    );
    const modelCell = padToVisible(
      renderModelCell(row, isCursor, isCursor && activeField === 'model', modelW),
      modelW,
    );
    const effortCell = renderEffortCell(
      row,
      isCursor,
      isCursor && activeField === 'effort',
      effortW,
    );

    return `${prefix}${nameCell}${modelCell}${effortCell}`;
  });

  // ---------------------------------------------------------------------------
  // 5. Scroll indicators
  // ---------------------------------------------------------------------------

  const upIndicator =
    rowsAbove > 0
      ? dim(`  ↑ ${rowsAbove} more`)
      : '';

  const downIndicator =
    rowsBelow > 0
      ? dim(`  ↓ ${rowsBelow} more`)
      : '';

  // ---------------------------------------------------------------------------
  // 6. Footer
  // ---------------------------------------------------------------------------

  const count = unsavedCount(rows);
  const unsavedLine =
    count > 0
      ? `  ${yellow(`${count} unsaved change${count === 1 ? '' : 's'}`)}`
      : '';

  const keybindingsLine = dim(
    '  ↑↓ agent   tab field   ←→/space cycle   d default   enter save   esc cancel',
  );
  const proxyHintLine = !proxyEnabled
    ? dim('  devflow proxy --enable to activate GPT models')
    : '';

  // ---------------------------------------------------------------------------
  // Assemble
  // ---------------------------------------------------------------------------

  const out: string[] = [
    titleLine,
    '',
    colHeader,
    upIndicator,
    ...renderedRows,
    downIndicator,
    '',
    unsavedLine,
    keybindingsLine,
    proxyHintLine,
  ];

  return out;
}
