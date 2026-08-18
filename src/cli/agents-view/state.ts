/**
 * Pure keypress reducer for the devflow agents TUI.
 *
 * applies ADR-013: CLI-layer view module; consumes src/core/ imports only.
 * avoids PF-014: pure functions only — no process.exit(), no I/O.
 *
 * Model cycle (proxy ON):  default → haiku → sonnet → opus → fable →
 *                          <picker names in registry order> → default
 *                          Picker names: all aliases for each model; canonical id iff
 *                          the model has no aliases (zero-maintenance, catalog-driven).
 * Model cycle (proxy OFF): default → haiku → sonnet → opus → fable → default
 * Effort cycle:            default → low → medium → high → xhigh → max → default
 *
 * Dormancy semantics (plan D5 / Phase 1):
 *   When proxy is off and a row's saved model is a GPT model, configuredModel
 *   starts as 'default' and the saved GPT name is kept in dormantModel for
 *   display annotation and untouched-preservation on save.
 *
 * Off-cycle pin semantics (Phase D):
 *   When proxy is on and a row's saved model is absent from the discovered
 *   selectableNames (retired model), offCyclePin holds the saved model.
 *   The per-row effective cycle is [...modelCycle, offCyclePin], so the
 *   pin is always reachable after a full cycle without pressing 'd'.
 *
 * Dirty detection: current !== original (touch-then-revert → not dirty).
 *
 * Performance (AC-P6): modelCycle is built ONCE in buildTuiState and stored
 * on the state — never reallocated per keypress. The reducer receives it as
 * state.modelCycle and threads it through without reconstructing.
 */

import { EFFORT_LEVELS, type EffortLevel } from '../../core/agent-models.js';
import {
  CLAUDE_MODEL_ALIASES,
  isDormantExternalModel,
  classifyAgentState,
  type AgentState,
} from '../../core/external-models.js';
import { type ExternalModel, type ExternalModelCatalog } from '../../core/model-discovery.js';

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
  readonly configuredEffort: EffortLevel | 'default';
  /** Effort value at state init — used for dirty detection. */
  readonly originalEffort: EffortLevel | 'default';
  /**
   * Non-null only when: savedModel is an external model AND proxy is off.
   * Holds the saved model name for display annotation and
   * byte-identical preservation on save if the field was not touched.
   */
  readonly dormantModel: string | null;
  /**
   * Non-null only when: proxy is on AND the saved model is absent from the
   * main modelCycle (e.g. a retired canonical id). The per-row effective
   * cycle is always [...modelCycle, offCyclePin] so the pin stays reachable
   * after a full forward+backward navigation. Render shows '(unavailable)'.
   */
  readonly offCyclePin: string | null;
  /** True when the agent's .md file is present in the install directory. */
  readonly installed: boolean;
  /** True when the agent name exists in the plugin registry. False for orphan rows. */
  readonly inRegistry: boolean;
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
  /**
   * Discovered model catalog — built once at TUI startup, startup-constant.
   * {known:false} when the cache is empty or discovery was unavailable.
   * On the proxy-off path the cache-based catalog is used; see selectCatalog().
   */
  readonly catalog: ExternalModelCatalog;
  /**
   * Prebuilt flat cycle for all rows: ['default', ...claude, ...external].
   * Built once in buildTuiState; never reallocated per keypress (AC-P6).
   * Per-row effective cycle may splice in offCyclePin when non-null.
   */
  readonly modelCycle: readonly string[];
}

export type Intent = 'none' | 'save' | 'cancel';

export interface ReduceResult {
  readonly state: AgentsViewState;
  readonly intent: Intent;
}

// ---------------------------------------------------------------------------
// Cycle builders (pure)
// ---------------------------------------------------------------------------

/**
 * Extract the picker name list from a model list.
 *
 * Zero-maintenance rule (Fix 1):
 *   - For each model IN REGISTRY ORDER: contribute ALL of its aliases.
 *   - Contribute the canonical ID if and only if the model has NO aliases.
 *
 * This means:
 *   gpt-5.6-sol  [aliases: ['sol']]   → 'sol'
 *   gpt-5.5      [aliases: []]        → 'gpt-5.5'
 *   gpt-x        [aliases: ['a','b']] → 'a', 'b'
 *
 * When a currently-alias-less model gains an alias in a future subswitch
 * release, it automatically renders as that alias with no code change.
 *
 * NOTE: catalog.selectableNames is NOT used here — it doubles as the --set
 * validation allowlist (includes both aliases and canonical ids). Narrowing
 * it would reject `devflow agents --set coder --model gpt-5.6-sol`.
 *
 * Pure function, no I/O.
 */
export function pickerNames(models: readonly ExternalModel[]): readonly string[] {
  const names: string[] = [];
  for (const model of models) {
    if (model.aliases.length > 0) {
      for (const alias of model.aliases) {
        names.push(alias);
      }
    } else {
      names.push(model.id);
    }
  }
  return names;
}

/**
 * Build a map from every stored identifier (alias or canonical id) to the
 * picker name that represents it in the TUI cycle.
 *
 * Used by buildRow to normalize a stored canonical id to its alias on read,
 * e.g. 'gpt-5.6-sol' → 'sol', so the value stays in-cycle and does not
 * appear as an off-cycle pin. NEVER rewrites the value on disk — only for
 * display.
 *
 * Returns an empty map when the catalog is unknown.
 *
 * Pure function, no I/O.
 */
export function buildPickerNameMap(
  catalog: ExternalModelCatalog,
): ReadonlyMap<string, string> {
  if (!catalog.known) return new Map<string, string>();
  const map = new Map<string, string>();
  for (const model of catalog.models) {
    if (model.aliases.length > 0) {
      // Canonical id → first alias (the picker representative)
      map.set(model.id, model.aliases[0]);
      // Each alias → itself (identity, already a picker name)
      for (const alias of model.aliases) {
        map.set(alias, alias);
      }
    } else {
      // No aliases: canonical id IS the picker name
      map.set(model.id, model.id);
    }
  }
  return map;
}

/**
 * Build the model cycle from a discovered catalog.
 * Exported so agents.ts can call it once and store the result in state.
 *
 * Cycle order (catalog known):
 *   default → haiku → sonnet → opus → fable →
 *   <picker names in registry order> → (wraps)
 *
 * Picker names are alias-only (canonical id only when no aliases exist),
 * produced by pickerNames(). catalog.selectableNames is NOT used here —
 * it is the --set validation allowlist, not the TUI picker subset.
 *
 * Cycle order (catalog unknown):
 *   default → haiku → sonnet → opus → fable → (wraps)
 *
 * Dormancy (proxy off + GPT model saved) does not shrink the cycle — external
 * models remain selectable so users can inspect and change dormant mappings.
 * The catalog itself controls what is in the cycle; see selectCatalog() in
 * agents.ts for how the proxy-off path supplies the cache-based catalog.
 */
export function buildModelCycle(
  catalog: ExternalModelCatalog,
): readonly string[] {
  const base: readonly string[] = ['default', ...CLAUDE_MODEL_ALIASES];
  if (!catalog.known) return base;
  return [...base, ...pickerNames(catalog.models)];
}

const EFFORT_CYCLE: readonly string[] = ['default', ...EFFORT_LEVELS];

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

/**
 * True when `model` is not present in `cycle`.
 * Named predicate for intent visibility at every call site.
 */
export function isOffCycle(cycle: readonly string[], model: string): boolean {
  return !cycle.includes(model);
}

// ---------------------------------------------------------------------------
// Dirty helpers (pure, exported for render and tests)
// ---------------------------------------------------------------------------

export function isDirtyModel(row: AgentRow): boolean {
  // Suppress dirty when the selected model matches the saved dormant GPT model —
  // cycling back to that value is not a change from the persisted mapping entry.
  if (row.dormantModel !== null && row.configuredModel === row.dormantModel) return false;
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

/**
 * Classify the live state of a TUI row for display in the STATE column.
 *
 * Single source of truth — delegates to classifyAgentState, so the TUI STATE
 * column and `--list`'s STATE column share one vocabulary and cannot drift.
 *
 * The classified value is the model this row WILL persist, which is what makes
 * the dormancy marker track the KEYPRESS rather than the last save:
 *   - dirty row      → configuredModel (the in-session selection)
 *   - untouched row  → dormantModel when set, else configuredModel
 *
 * The untouched branch exists because mergeTuiRowsIntoMapping writes nothing
 * for a clean row: its persisted value survives as-is, and for a dormant row
 * that value lives in dormantModel (configuredModel falls back to 'default'
 * while the proxy is off). Keying on dormantModel unconditionally would pin
 * the marker to the pre-edit value — cycling a dormant row onto a live Claude
 * model would keep showing 'saved-inactive' even though 'opus' is what gets
 * written. Mirroring the merge rule keeps display and persistence in lockstep.
 *
 * Pure function, no I/O.
 */
export function rowState(row: AgentRow, proxyEnabled: boolean): AgentState {
  const persistedModel = isDirtyModel(row)
    ? row.configuredModel
    : (row.dormantModel ?? row.configuredModel);
  return classifyAgentState(
    persistedModel,
    proxyEnabled,
    row.installed,
    row.inRegistry,
  );
}

// ---------------------------------------------------------------------------
// Row and field helpers (pure) — single-row update and cycle direction
// ---------------------------------------------------------------------------

/**
 * Return a new rows array with the row at `cursor` replaced by `newRow`.
 * All other rows are returned by reference (no unnecessary copies).
 */
function replaceRow(
  rows: readonly AgentRow[],
  cursor: number,
  newRow: AgentRow,
): readonly AgentRow[] {
  return rows.map((r, i) => (i === cursor ? newRow : r));
}

/**
 * Return a new AgentRow with the named field cycled one step in the given direction.
 *
 * Model cycle uses the prebuilt state.modelCycle (no allocation per call for normal
 * rows). Off-cycle pin recovery: if row.offCyclePin is non-null, the effective cycle
 * for this row is [...modelCycle, offCyclePin], keeping the retired model reachable
 * after a full forward+backward navigation (AC-F4).
 *
 * Pure: no I/O, no side effects.
 */
function cycleField(
  row: AgentRow,
  field: 'model' | 'effort',
  dir: 'forward' | 'backward',
  modelCycle: readonly string[],
): AgentRow {
  if (field === 'model') {
    // Build effective cycle: splice off-cycle pin at the end if present.
    // This is the ≤ 1 array allocation case (AC-P6): only allocates when offCyclePin != null.
    const effectiveCycle: readonly string[] =
      row.offCyclePin !== null && isOffCycle(modelCycle, row.offCyclePin)
        ? [...modelCycle, row.offCyclePin]
        : modelCycle;

    // cycleNext/cyclePrev handle the case where configuredModel is not in effectiveCycle
    // by falling back to cycle[0] / cycle[last]. This is correct for the off-cycle case
    // where configuredModel IS in effectiveCycle (we splice it in above).
    const next =
      dir === 'forward'
        ? cycleNext(effectiveCycle, row.configuredModel)
        : cyclePrev(effectiveCycle, row.configuredModel);
    return { ...row, configuredModel: next };
  } else {
    const next =
      dir === 'forward'
        ? cycleNext(EFFORT_CYCLE, row.configuredEffort)
        : cyclePrev(EFFORT_CYCLE, row.configuredEffort);
    // Sound narrowing: EFFORT_CYCLE is ['default', ...EFFORT_LEVELS], so next
    // is always EffortLevel | 'default'. cycleNext/cyclePrev return string
    // because their signature is intentionally generic (also used for model cycles).
    return { ...row, configuredEffort: next as EffortLevel | 'default' };
  }
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
  savedEffort?: EffortLevel;
  proxyEnabled: boolean;
  /**
   * Prebuilt model cycle for off-cycle pin detection.
   * Optional: omit (or pass []) to disable off-cycle detection.
   */
  modelCycle?: readonly string[];
  /**
   * Map from stored identifier (alias or canonical id) to picker name.
   * Built by buildPickerNameMap(catalog). When provided, normalizes a stored
   * canonical id (e.g. 'gpt-5.6-sol') to its alias ('sol') so the configured
   * model stays in-cycle and does not appear as an off-cycle pin.
   * NEVER writes the normalized value back to disk.
   * Optional: omit on the proxy-off / cache-miss path where normalization
   * has no effect (canonical ids not in the picker cycle become off-cycle pins
   * which is the correct behavior when the catalog is unknown).
   */
  pickerNameMap?: ReadonlyMap<string, string>;
  /**
   * Whether the agent .md file is present in the install directory.
   * Required — tsc enumerates every construction site so each caller must decide
   * the correct value. True for installed agents, false for not-installed agents.
   * Provided by buildTuiState via readInstalledAgentNames.
   */
  installed: boolean;
  /**
   * Whether this agent name exists in the plugin registry.
   * Required — tsc enumerates every construction site so each caller must decide
   * the correct value. True for normal registry rows, false for orphan rows
   * (keys in agent-models.json not present in the registry).
   */
  inRegistry: boolean;
}

/**
 * Build an AgentRow from initial mapping state.
 *
 * Handles dormancy: if savedModel is an external model and proxy is off,
 * configuredModel starts as 'default' and dormantModel holds the saved model.
 *
 * Handles off-cycle pin: if proxy is on, savedModel is configured, but is
 * absent from modelCycle (retired/unavailable model), offCyclePin is set so
 * the model remains reachable in the per-row effective cycle.
 */
export function buildRow(input: InitRowInput): AgentRow {
  const dormant = isDormantExternalModel(input.savedModel, input.proxyEnabled);
  const cycle = input.modelCycle ?? [];

  // Normalize stored canonical id to picker name (Fix 1: in-memory only, never
  // written back to disk). E.g. 'gpt-5.6-sol' → 'sol' when pickerNameMap is known.
  // This keeps the value in-cycle so it does not become a spurious off-cycle pin.
  const normalizedSavedModel =
    input.savedModel !== undefined && input.pickerNameMap !== undefined
      ? (input.pickerNameMap.get(input.savedModel) ?? input.savedModel)
      : input.savedModel;

  const configuredModel = dormant ? 'default' : (normalizedSavedModel ?? 'default');
  const configuredEffort = input.savedEffort ?? 'default';

  // Off-cycle pin detection: proxy on, model configured but absent from cycle.
  // Use the normalized model for cycle lookup — the saved model (pre-norm) for
  // the pin value so the original identifier is preserved on display.
  const offCyclePin =
    !dormant &&
    normalizedSavedModel !== undefined &&
    normalizedSavedModel !== 'default' &&
    cycle.length > 0 &&
    isOffCycle(cycle, normalizedSavedModel)
      ? normalizedSavedModel
      : null;

  return {
    name: input.name,
    shippedDefault: input.shippedDefault,
    configuredModel,
    originalModel: configuredModel,
    configuredEffort,
    originalEffort: configuredEffort,
    dormantModel: dormant ? (input.savedModel ?? null) : null,
    offCyclePin,
    installed: input.installed,
    inRegistry: input.inRegistry,
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
 *
 * Performance: modelCycle is read from state (prebuilt, startup-constant);
 * catalog and modelCycle references are threaded unchanged through every
 * non-cycle reduce path (AC-P6: Object.is(s1.modelCycle, s2.modelCycle)).
 */
export function reduce(state: AgentsViewState, key: string): ReduceResult {
  const { rows, cursor, activeField, viewportOffset, viewportHeight, modelCycle } =
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
      const newRow = cycleField(rows[cursor], activeField, 'forward', modelCycle);
      return {
        state: { ...state, rows: replaceRow(rows, cursor, newRow) },
        intent: 'none',
      };
    }

    case 'left': {
      if (n === 0) return { state, intent: 'none' };
      const newRow = cycleField(rows[cursor], activeField, 'backward', modelCycle);
      return {
        state: { ...state, rows: replaceRow(rows, cursor, newRow) },
        intent: 'none',
      };
    }

    case 'd': {
      if (n === 0) return { state, intent: 'none' };
      const row = rows[cursor];
      const newRow: AgentRow =
        activeField === 'model'
          ? { ...row, configuredModel: 'default' }
          : { ...row, configuredEffort: 'default' };
      return {
        state: { ...state, rows: replaceRow(rows, cursor, newRow) },
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
