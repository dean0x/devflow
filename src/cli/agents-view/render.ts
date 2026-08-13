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
 *   MODEL   : 32
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
import { type ExternalModelCatalog } from '../../core/model-discovery.js';

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

/** Non-viewport fixed lines in a rendered frame (see layout comment above). */
export const FIXED_ROWS = 9;
const MIN_VIEWPORT = 1;

// ---------------------------------------------------------------------------
// Viewport height (exported so terminal.ts and agents.ts share one definition)
// ---------------------------------------------------------------------------

/** Return the number of data rows the terminal can display given its height. */
export function computeViewportHeight(termRows: number): number {
  return Math.max(MIN_VIEWPORT, termRows - FIXED_ROWS);
}

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
 *
 * Alias resolution (AC-F2): when catalog is known and configuredModel is an alias
 * (aliasToId maps it to a different canonical id), show "alias (canonical-id)".
 * Canonical ids render bare. Neither exceeds COL_MODEL = 32.
 *
 * Off-cycle pin (AC-F4): when configuredModel is absent from modelCycle
 * (retired/unavailable model), show "model (unavailable)".
 *
 * Dormant model: proxy off, saved external model → "default (hint) model saved".
 */
function renderModelCell(
  row: AgentRow,
  isCursor: boolean,
  isActive: boolean,
  maxWidth: number,
  catalog: ExternalModelCatalog,
  modelCycle: readonly string[],
): string {
  const dirty = isDirtyModel(row);

  let valueStr: string;

  if (row.configuredModel === 'default') {
    const hint = dim(`(${row.shippedDefault})`);
    valueStr = `default ${hint}`;
    if (row.dormantModel !== null) {
      // Dormant: show saved model name as dim annotation
      valueStr += ` ${dim(`${row.dormantModel} saved`)}`;
    }
  } else if (!modelCycle.includes(row.configuredModel)) {
    // Off-cycle pin: model was saved but is no longer in the discovered catalog.
    // The per-row effective cycle (state.ts cycleField) includes it for reachability,
    // but it renders as unavailable to signal the user should update it.
    valueStr = `${row.configuredModel} (unavailable)`;
  } else if (catalog.known) {
    const resolvedId = catalog.aliasToId.get(row.configuredModel);
    if (resolvedId !== undefined && resolvedId !== row.configuredModel) {
      // Alias: show "alias (canonical-id)" — e.g. "sol (gpt-5.6-sol)"
      valueStr = `${row.configuredModel} (${resolvedId})`;
    } else {
      // Canonical id or no alias resolution: show bare
      valueStr = row.configuredModel;
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
  const value = row.configuredEffort;

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
    catalog,
    modelCycle,
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
      renderModelCell(row, isCursor, isCursor && activeField === 'model', modelW, catalog, modelCycle),
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
