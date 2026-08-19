/**
 * Pure TUI frame renderer for the devflow agents view.
 *
 * applies ADR-013: CLI-layer view module; zero fs/tty imports.
 * avoids PF-014: pure function, no process.exit(), no I/O.
 *
 * Layout (fixed lines = 9, viewport = dims.rows - 9):
 *   1  Title "  Devflow Agents" + right "proxy: enabled|disabled"
 *   2  (blank)
 *   3  Column header "    AGENT  MODEL  EFFORT  STATE"
 *   4  Scroll-up indicator "  ↑ N more" (blank if none)
 *   5+ Viewport rows
 *  -3  Scroll-down indicator "  ↓ N more" (blank if none)
 *  -2  (blank)
 *  -1  Unsaved count "  N unsaved changes" (blank if 0)
 *   0  Keybinding footer
 *
 * Columns (chars) — total 79 ≤ 80:
 *   PREFIX  :  2  (cursor mark "❯ " or "  ")
 *   AGENT   : 18
 *   MODEL   : 32
 *   EFFORT  : 13
 *   STATE   : 14
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
  isOffCycle,
  rowState,
  type AgentRow,
  type AgentsViewState,
} from './state.js';
import { AGENT_STATE_LABELS } from '../../core/agent-state.js';

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

const COL_AGENT = 18;
const COL_MODEL = 32;
const COL_EFFORT = 13;
const COL_STATE = 14;

// ---------------------------------------------------------------------------
// Name formatter — TUI only (Fix 4)
// ---------------------------------------------------------------------------

/**
 * Title-case each hyphen-separated segment of the agent name for TUI display.
 *
 * Examples: 'code' → 'Code', 'my-custom-agent' → 'My-Custom-Agent'
 *
 * TUI-only — `--list` output uses the raw lowercase name from the registry.
 * Exactly ONE call site: the name cell in the row renderer below.
 *
 * Pure function, no I/O.
 */
export function formatAgentName(name: string): string {
  if (name.length === 0) return name;
  return name
    .split('-')
    .map(seg => (seg.length === 0 ? seg : seg[0].toUpperCase() + seg.slice(1)))
    .join('-');
}

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

/** Layout-breaking whitespace that stripAnsi deliberately preserves. */
const LAYOUT_BREAKING_WS = /[\t\n]/g;

/**
 * Sanitize an untrusted string for a fixed-width TUI cell.
 *
 * stripAnsi strips escape sequences and C0 controls but, by contract, KEEPS
 * TAB (\x09) and LF (\x0a) — correct for its own callers, wrong for a cell in
 * a fixed-width frame. Orphan row names are arbitrary JSON keys read from
 * agent-models.json, so neither is hypothetical:
 *   - LF  emits a newline inside a frame line, breaking renderFrame's
 *     one-string-per-terminal-line contract and desyncing terminal.ts's
 *     cursor arithmetic (it writes ERASE_EOL + '\n' per returned line).
 *   - TAB measures as one character in padToVisible but occupies up to eight
 *     terminal columns, so every column to its right is misaligned.
 * Both collapse to a single space; the raw key is untouched, so the save-path
 * merge still targets the real mapping key.
 */
function sanitizeCell(s: string): string {
  return stripAnsi(s).replace(LAYOUT_BREAKING_WS, ' ');
}

/** Options for renderModelCell — named to prevent silent argument transposition. */
interface RenderModelCellOptions {
  readonly row: AgentRow;
  readonly isCursor: boolean;
  /** Whether the model field is the currently active field on the cursor row. */
  readonly isActive: boolean;
  readonly maxWidth: number;
  readonly modelCycle: readonly string[];
}

/**
 * Render the model cell for a given row, considering cursor/active/dirty state.
 *
 * Three branches (Fix 1 — alias annotation removed):
 *   1. configuredModel === 'default' → "default (shippedDefault)" [+ dormant hint]
 *   2. off-cycle pin → "model (unavailable)"
 *   3. in-cycle model → bare name (aliases already rendered as picker names by buildRow)
 *
 * Off-cycle pin (AC-F4): when configuredModel is absent from modelCycle
 * (retired/unavailable model), show "model (unavailable)".
 *
 * Dormant model: proxy off, saved external model → "default (hint) model saved".
 */
function renderModelCell({
  row,
  isCursor,
  isActive,
  maxWidth,
  modelCycle,
}: RenderModelCellOptions): string {
  const dirty = isDirtyModel(row);

  // Model names come from user-controlled config and the third-party external
  // model catalog. Strip ANSI escapes at the display boundary so hostile
  // sequences cannot reach the terminal. Original values are used for cycle
  // checks; safe copies for display strings only.
  const safeConfiguredModel = stripAnsi(row.configuredModel);
  const safeShippedDefault = stripAnsi(row.shippedDefault);
  const safeDormantModel = row.dormantModel !== null ? stripAnsi(row.dormantModel) : null;

  let valueStr: string;

  if (row.configuredModel === 'default') {
    const hint = dim(`(${safeShippedDefault})`);
    valueStr = `default ${hint}`;
    if (safeDormantModel !== null) {
      // Dormant: show saved model name as dim annotation
      valueStr += ` ${dim(`${safeDormantModel} saved`)}`;
    }
  } else if (isOffCycle(modelCycle, row.configuredModel)) {
    // Off-cycle pin: model was saved but is no longer in the discovered catalog.
    // The per-row effective cycle (state.ts cycleField) includes it for reachability,
    // but it renders as unavailable to signal the user should update it.
    valueStr = `${safeConfiguredModel} (unavailable)`;
  } else {
    // In-cycle model: render bare. Aliases are already stored as picker names
    // (normalized by buildRow via buildPickerNameMap), so no annotation needed.
    valueStr = safeConfiguredModel;
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

/**
 * Render the state cell (installed/active/dormant/orphan) for a row.
 * Pure function — derives state via rowState(row, proxyEnabled).
 */
function renderStateCell(row: AgentRow, proxyEnabled: boolean, maxWidth: number): string {
  const state = rowState(row, proxyEnabled);
  let cell: string;
  switch (state) {
    case 'active':
      cell = green(AGENT_STATE_LABELS['active']);
      break;
    case 'saved-inactive':
      cell = yellow(AGENT_STATE_LABELS['saved-inactive']);
      break;
    case 'not-installed':
      cell = dim(AGENT_STATE_LABELS['not-installed']);
      break;
    case 'unknown':
      cell = dim(AGENT_STATE_LABELS['unknown']);
      break;
    default: {
      const _: never = state;
      void _;
      cell = '';
    }
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
    modelCycle,
  } = state;

  const viewportHeight = Math.max(
    MIN_VIEWPORT,
    dims.rows - FIXED_ROWS,
  );

  // Column widths — shrink gracefully at narrow terminals.
  const totalContent = 2 + COL_AGENT + COL_MODEL + COL_EFFORT + COL_STATE; // prefix + 4 cols
  const scale = Math.min(1, dims.cols / Math.max(totalContent, 1));
  const agentW = Math.max(6, Math.floor(COL_AGENT * scale));
  const modelW = Math.max(8, Math.floor(COL_MODEL * scale));
  const effortW = Math.max(7, Math.floor(COL_EFFORT * scale));
  const stateW = Math.max(5, Math.floor(COL_STATE * scale));

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
    padToVisible(gray('EFFORT'), effortW) +
    gray('STATE');

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
    // Sanitize the name — mandatory for orphan rows (arbitrary JSON keys from
    // agent-models.json may contain escape sequences, newlines or tabs injected
    // by a hostile file).
    // Exactly ONE call site for formatAgentName (Fix 4): TUI only; --list is lowercase.
    const safeName = formatAgentName(sanitizeCell(row.name));
    const nameCell = padToVisible(
      isCursor ? bold(truncateVisible(safeName, agentW)) : truncateVisible(safeName, agentW),
      agentW,
    );
    const modelCell = padToVisible(
      renderModelCell({
        row,
        isCursor,
        isActive: isCursor && activeField === 'model',
        maxWidth: modelW,
        modelCycle,
      }),
      modelW,
    );
    const effortCell = padToVisible(
      renderEffortCell(
        row,
        isCursor,
        isCursor && activeField === 'effort',
        effortW,
      ),
      effortW,
    );
    const stateCell = renderStateCell(row, proxyEnabled, stateW);

    return `${prefix}${nameCell}${modelCell}${effortCell}${stateCell}`;
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

  // Truncate to cols before applying dim so narrow terminals stay within bounds.
  // Uses the same primitive as every cell — one truncation rule per renderer.
  const keybindingsText = '  ↑↓ agent   tab field   ←→/space cycle   d default   enter save   esc cancel';
  const keybindingsLine = dim(truncateVisible(keybindingsText, dims.cols));
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
