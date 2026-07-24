/**
 * Pure keypress reducer for the devflow agents TUI.
 *
 * applies ADR-013: CLI-layer view module; consumes src/core/ imports only.
 * avoids PF-014: pure functions only — no process.exit(), no I/O.
 *
 * Model cycle (proxy ON):  default → haiku → sonnet → opus → fable →
 *                          gpt-5.6-sol → gpt-5.6-terra → gpt-5.6-luna → gpt-5.5 → default
 * Model cycle (proxy OFF): default → haiku → sonnet → opus → fable → default
 * Effort cycle:            default → low → medium → high → xhigh → max → default
 *
 * Dormancy semantics (plan D5 / Phase 1):
 *   When proxy is off and a row's saved model is a GPT model, configuredModel
 *   starts as 'default' and the saved GPT name is kept in dormantModel for
 *   display annotation and untouched-preservation on save.
 *
 * Dirty detection: current !== original (touch-then-revert → not dirty).
 */

import { CLAUDE_MODEL_ALIASES, EFFORT_LEVELS } from '../../core/agent-models.js';
import { externalModelIds } from '../../core/external-models.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single row in the agents TUI. */
export interface AgentRow {
  readonly name: string;
  /** Shipped default model from source agent file (e.g., 'opus'). */
  readonly shippedDefault: string;
  /** Current session model value: 'default' | model name. */
  readonly configuredModel: string;
  /** Model value at state init — used for dirty detection. */
  readonly originalModel: string;
  /** Current session effort value: 'default' | effort level. */
  readonly configuredEffort: string;
  /** Effort value at state init — used for dirty detection. */
  readonly originalEffort: string;
  /**
   * Non-null only when: savedModel is a GPT model AND proxy is off.
   * Holds the saved GPT model name for display annotation and
   * byte-identical preservation on save if the field was not touched.
   */
  readonly dormantModel: string | null;
}

/** Full TUI state — immutable by convention. */
export interface AgentsViewState {
  readonly rows: readonly AgentRow[];
  readonly cursor: number;
  readonly activeField: 'model' | 'effort';
  /** Index of the first visible row in the viewport. */
  readonly viewportOffset: number;
  /** Number of rows the terminal viewport can display. */
  readonly viewportHeight: number;
  readonly proxyEnabled: boolean;
}

export type Intent = 'none' | 'save' | 'cancel';

export interface ReduceResult {
  readonly state: AgentsViewState;
  readonly intent: Intent;
}

// ---------------------------------------------------------------------------
// Cycle helpers (pure)
// ---------------------------------------------------------------------------

function buildModelCycle(proxyEnabled: boolean): readonly string[] {
  const base = ['default', ...(CLAUDE_MODEL_ALIASES as readonly string[])];
  return proxyEnabled ? [...base, ...externalModelIds()] : base;
}

const EFFORT_CYCLE: readonly string[] = [
  'default',
  ...(EFFORT_LEVELS as readonly string[]),
];

function cycleNext(cycle: readonly string[], current: string): string {
  const idx = cycle.indexOf(current);
  if (idx === -1) return cycle[0];
  return cycle[(idx + 1) % cycle.length];
}

function cyclePrev(cycle: readonly string[], current: string): string {
  const idx = cycle.indexOf(current);
  if (idx === -1) return cycle[cycle.length - 1];
  return cycle[(idx - 1 + cycle.length) % cycle.length];
}

// ---------------------------------------------------------------------------
// Dirty helpers (pure, exported for render and tests)
// ---------------------------------------------------------------------------

export function isDirtyModel(row: AgentRow): boolean {
  return row.configuredModel !== row.originalModel;
}

export function isDirtyEffort(row: AgentRow): boolean {
  return row.configuredEffort !== row.originalEffort;
}

/** Count of rows with any dirty field (model OR effort). */
export function unsavedCount(rows: readonly AgentRow[]): number {
  let count = 0;
  for (const row of rows) {
    if (isDirtyModel(row) || isDirtyEffort(row)) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Viewport adjustment (pure)
// ---------------------------------------------------------------------------

function adjustViewport(
  cursor: number,
  viewportOffset: number,
  viewportHeight: number,
  rowCount: number,
): number {
  if (viewportHeight <= 0 || rowCount === 0) return 0;

  let offset = viewportOffset;
  if (cursor < offset) offset = cursor;
  if (cursor >= offset + viewportHeight) offset = cursor - viewportHeight + 1;

  const maxOffset = Math.max(0, rowCount - viewportHeight);
  return Math.max(0, Math.min(offset, maxOffset));
}

// ---------------------------------------------------------------------------
// buildRow — init helper
// ---------------------------------------------------------------------------

export interface InitRowInput {
  name: string;
  shippedDefault: string;
  /** Saved model from mapping file (undefined = no entry). */
  savedModel?: string;
  /** Saved effort from mapping file (undefined = no entry). */
  savedEffort?: string;
  proxyEnabled: boolean;
}

/**
 * Build an AgentRow from initial mapping state.
 * Handles dormancy: if savedModel is a GPT model and proxy is off,
 * configuredModel starts as 'default' and dormantModel holds the saved GPT name.
 */
export function buildRow(input: InitRowInput): AgentRow {
  const gptIds = externalModelIds();
  const isGpt =
    input.savedModel !== undefined && gptIds.includes(input.savedModel);
  const dormant = isGpt && !input.proxyEnabled;

  const configuredModel = dormant ? 'default' : (input.savedModel ?? 'default');
  const configuredEffort = input.savedEffort ?? 'default';

  return {
    name: input.name,
    shippedDefault: input.shippedDefault,
    configuredModel,
    originalModel: configuredModel,
    configuredEffort,
    originalEffort: configuredEffort,
    dormantModel: dormant ? (input.savedModel ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// reduce
// ---------------------------------------------------------------------------

/**
 * Pure keypress reducer.
 *
 * Recognized key strings (normalized by terminal.ts):
 *   'up', 'down', 'left', 'right', 'k', 'j', 'tab', 'space',
 *   'd', 'enter', 'escape', 'q', 'ctrl-c'
 *
 * Unknown keys → intent 'none', state unchanged (same reference).
 */
export function reduce(state: AgentsViewState, key: string): ReduceResult {
  const { rows, cursor, activeField, viewportOffset, viewportHeight, proxyEnabled } =
    state;
  const n = rows.length;

  switch (key) {
    case 'up':
    case 'k': {
      if (n === 0) return { state, intent: 'none' };
      const newCursor = Math.max(0, cursor - 1);
      const newOffset = adjustViewport(newCursor, viewportOffset, viewportHeight, n);
      if (newCursor === cursor && newOffset === viewportOffset) return { state, intent: 'none' };
      return {
        state: { ...state, cursor: newCursor, viewportOffset: newOffset },
        intent: 'none',
      };
    }

    case 'down':
    case 'j': {
      if (n === 0) return { state, intent: 'none' };
      const newCursor = Math.min(n - 1, cursor + 1);
      const newOffset = adjustViewport(newCursor, viewportOffset, viewportHeight, n);
      if (newCursor === cursor && newOffset === viewportOffset) return { state, intent: 'none' };
      return {
        state: { ...state, cursor: newCursor, viewportOffset: newOffset },
        intent: 'none',
      };
    }

    case 'tab': {
      const newField: 'model' | 'effort' =
        activeField === 'model' ? 'effort' : 'model';
      return { state: { ...state, activeField: newField }, intent: 'none' };
    }

    case 'right':
    case 'space': {
      if (n === 0) return { state, intent: 'none' };
      const row = rows[cursor];
      if (activeField === 'model') {
        const cycle = buildModelCycle(proxyEnabled);
        // When current value is not in the cycle (dormant proxy-off case), start from 'default'.
        const effective = cycle.includes(row.configuredModel)
          ? row.configuredModel
          : 'default';
        const next = cycleNext(cycle, effective);
        const newRow: AgentRow = { ...row, configuredModel: next };
        return {
          state: {
            ...state,
            rows: rows.map((r, i) => (i === cursor ? newRow : r)),
          },
          intent: 'none',
        };
      } else {
        const next = cycleNext(EFFORT_CYCLE, row.configuredEffort);
        const newRow: AgentRow = { ...row, configuredEffort: next };
        return {
          state: {
            ...state,
            rows: rows.map((r, i) => (i === cursor ? newRow : r)),
          },
          intent: 'none',
        };
      }
    }

    case 'left': {
      if (n === 0) return { state, intent: 'none' };
      const row = rows[cursor];
      if (activeField === 'model') {
        const cycle = buildModelCycle(proxyEnabled);
        const effective = cycle.includes(row.configuredModel)
          ? row.configuredModel
          : 'default';
        const prev = cyclePrev(cycle, effective);
        const newRow: AgentRow = { ...row, configuredModel: prev };
        return {
          state: {
            ...state,
            rows: rows.map((r, i) => (i === cursor ? newRow : r)),
          },
          intent: 'none',
        };
      } else {
        const prev = cyclePrev(EFFORT_CYCLE, row.configuredEffort);
        const newRow: AgentRow = { ...row, configuredEffort: prev };
        return {
          state: {
            ...state,
            rows: rows.map((r, i) => (i === cursor ? newRow : r)),
          },
          intent: 'none',
        };
      }
    }

    case 'd': {
      if (n === 0) return { state, intent: 'none' };
      const row = rows[cursor];
      const newRow: AgentRow =
        activeField === 'model'
          ? { ...row, configuredModel: 'default' }
          : { ...row, configuredEffort: 'default' };
      return {
        state: {
          ...state,
          rows: rows.map((r, i) => (i === cursor ? newRow : r)),
        },
        intent: 'none',
      };
    }

    case 'enter': {
      return { state, intent: 'save' };
    }

    case 'escape':
    case 'q':
    case 'ctrl-c': {
      return { state, intent: 'cancel' };
    }

    default: {
      return { state, intent: 'none' };
    }
  }
}
