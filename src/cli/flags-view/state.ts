/**
 * Pure keypress reducer for the devflow flags TUI.
 *
 * applies ADR-013: CLI-layer view module; consumes src/core/ imports only.
 * applies ADR-016: one syntax, one semantic — value vocabulary.
 * avoids PF-014: pure functions only — no process.exit(), no I/O.
 * avoids PF-017: generic shell in tui/terminal.ts; this module is pure logic.
 *
 * viewMode GLUE RULE: view-mode's neutralValue ('default') maps to null in the TUI.
 * `buildFlagRows` maps record value 'default' → null; `collectFlagRecord` maps
 * null → 'default' (via neutralValueOf). Number 0 is ACTIVE — null ≠ 0.
 *
 * Strict number parsing: leading/trailing whitespace and leading zeros are
 * invalid ('007' → error, ' 8' → error). This rejects pathological inputs
 * before they reach coerceFlagValue (applies PF-023).
 *
 * Buffer hard cap: BUFFER_MAX_LEN = 64 chars (paste-flood guard).
 *
 * allowUnset semantics:
 *   - boolean: false — no null stop, 'u' is noop
 *   - enum/number/string: true — 'u' sets null; enum with neutralValue includes
 *     null in the cycle as the first stop (round-trips through collectFlagRecord).
 */

import {
  FLAG_REGISTRY,
  findFlag,
  defaultValueOf,
  coerceFlagValue,
  parseFlagValueInput,
  type ClaudeCodeFlag,
  type FlagsRecord,
  type FlagsRecordValue,
} from '../../core/flags.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Hard cap on edit buffer length — protects against paste floods. */
export const BUFFER_MAX_LEN = 64;

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single row in the flags TUI. Immutable by convention. */
export interface FlagRow {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  /** Discriminant for cycling vs text-editing behaviour. */
  readonly kind: 'boolean' | 'enum' | 'number' | 'string';
  /**
   * Ordered cycle stops for space/left/right cycling.
   * Empty for text rows (number/string) — those use text edit mode instead.
   * boolean: [true, false]
   * enum with neutralValue: [null, ...non-neutral values]
   * enum without neutralValue: [...values as FlagsRecordValue[]]
   */
  readonly stops: readonly FlagsRecordValue[];
  /**
   * True when 'u' may set this row to null.
   * false for boolean (boolean neutral is false, not null).
   * true for all enum/number/string rows.
   */
  readonly allowUnset: boolean;
  /** Current value (mutable session value — changes on keypress). */
  readonly configuredValue: FlagsRecordValue;
  /**
   * Value at row construction — used for dirty detection.
   * configuredValue !== originalValue → row is dirty.
   */
  readonly originalValue: FlagsRecordValue;
  /** Devflow default value in TUI coordinates (null for neutralValue mappings). */
  readonly devflowDefault: FlagsRecordValue;
  /** Whether this flag is in the recommended section. */
  readonly recommended: boolean;
}

/** Text edit state while a number/string row is being edited. */
export interface EditState {
  readonly buffer: string;
  readonly caret: number;
  readonly error: string | null;
}

export type FlagsIntent = 'none' | 'save' | 'cancel' | 'abort';

/** Full TUI state — immutable by convention. */
export interface FlagsViewState {
  readonly rows: readonly FlagRow[];
  readonly cursor: number;
  readonly viewportOffset: number;
  readonly viewportHeight: number;
  /** Non-null while a text row is being edited. */
  readonly editing: EditState | null;
}

export interface ReduceResult {
  readonly state: FlagsViewState;
  readonly intent: FlagsIntent;
}

// ─── Viewport helpers ─────────────────────────────────────────────────────────

/** Adjust viewport offset so cursor stays visible. */
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

// ─── Value mapping ────────────────────────────────────────────────────────────

/**
 * Map a record value to a TUI value.
 * viewMode GLUE: enum neutralValue → null in TUI.
 */
function recordToTui(flag: ClaudeCodeFlag, v: FlagsRecordValue): FlagsRecordValue {
  if (v === null) return null;
  if (flag.kind === 'enum' && flag.neutralValue !== undefined) {
    if (v === flag.neutralValue) return null;
  }
  return v;
}

/**
 * Map a TUI value back to a record value.
 * viewMode GLUE: null → neutralValue for enum flags that have one.
 */
function tuiToRecord(flag: ClaudeCodeFlag, v: FlagsRecordValue): FlagsRecordValue {
  if (v === null && flag.kind === 'enum' && flag.neutralValue !== undefined) {
    return flag.neutralValue;
  }
  return v;
}

// ─── Row building ─────────────────────────────────────────────────────────────

/** Compute the cycle stops for a flag in TUI coordinates. */
function buildStops(flag: ClaudeCodeFlag): readonly FlagsRecordValue[] {
  switch (flag.kind) {
    case 'boolean':
      return [true, false];
    case 'enum': {
      if (flag.neutralValue !== undefined) {
        // null is the TUI representation of neutralValue
        const nonNeutral = (flag.values as readonly string[]).filter(
          v => v !== flag.neutralValue,
        );
        return [null, ...nonNeutral];
      }
      // No neutralValue: cycle over the declared values
      return [...flag.values] as FlagsRecordValue[];
    }
    case 'number':
    case 'string':
      return []; // text edit mode
  }
}

/** Compute the devflow default in TUI coordinates. */
function buildDevflowDefault(flag: ClaudeCodeFlag): FlagsRecordValue {
  const base = defaultValueOf(flag); // single default-rule source (CONS-M2)
  if (flag.kind === 'boolean') return base;
  if (base === null) return null; // undefined defaultValue → null
  // Apply the same neutralValue mapping used for record values
  return recordToTui(flag, base);
}

/** Build the initial TUI value for a row from a FlagsRecord. */
function buildConfiguredValue(flag: ClaudeCodeFlag, record: FlagsRecord): FlagsRecordValue {
  const id = flag.id;
  if (!(id in record)) {
    // Key absent from record — fall back to devflow default
    return buildDevflowDefault(flag);
  }
  const raw = record[id];
  return recordToTui(flag, raw);
}

/**
 * Build the FlagRow array from the registry and an existing record.
 *
 * Row order matches FLAG_REGISTRY order.
 * viewMode GLUE: record value 'default' → configuredValue null.
 * devflowDefault for view-mode = null (maps from neutralValue 'default').
 */
export function buildFlagRows(
  registry: typeof FLAG_REGISTRY,
  record: FlagsRecord,
): FlagRow[] {
  return registry.map((flag): FlagRow => {
    const stops = buildStops(flag);
    const allowUnset = flag.kind !== 'boolean';
    const devflowDefault = buildDevflowDefault(flag);
    const configuredValue = buildConfiguredValue(flag, record);

    return {
      id: flag.id,
      label: flag.label,
      hint: flag.hint,
      kind: flag.kind,
      stops,
      allowUnset,
      configuredValue,
      originalValue: configuredValue,
      devflowDefault,
      recommended: flag.recommended,
    };
  });
}

/**
 * Collect the current TUI row values back into a FlagsRecord.
 *
 * viewMode GLUE: null → neutralValue (e.g. 'default') for enum flags with neutralValue.
 * All other null values pass through as null.
 */
export function collectFlagRecord(rows: readonly FlagRow[]): FlagsRecord {
  const record: FlagsRecord = {};
  for (const row of rows) {
    const flag = findFlag(row.id); // O(1) via FLAG_REGISTRY_MAP (PERF-L3)
    if (flag) {
      record[row.id] = tuiToRecord(flag, row.configuredValue);
    } else {
      // Unknown flag — pass through as-is
      record[row.id] = row.configuredValue;
    }
  }
  return record;
}

// ─── Cycle helpers ────────────────────────────────────────────────────────────

function cycleForward(stops: readonly FlagsRecordValue[], current: FlagsRecordValue): FlagsRecordValue {
  const idx = stops.findIndex(s => Object.is(s, current));
  if (idx === -1) return stops[0];
  return stops[(idx + 1) % stops.length];
}

function cycleBackward(stops: readonly FlagsRecordValue[], current: FlagsRecordValue): FlagsRecordValue {
  const idx = stops.findIndex(s => Object.is(s, current));
  if (idx === -1) return stops[stops.length - 1];
  return stops[(idx - 1 + stops.length) % stops.length];
}

/** Update a single row in the rows array (all other rows unchanged). */
function updateRow(
  rows: readonly FlagRow[],
  cursor: number,
  patch: Partial<FlagRow>,
): readonly FlagRow[] {
  return rows.map((r, i) => (i === cursor ? { ...r, ...patch } : r));
}

// ─── Edit mode helpers ────────────────────────────────────────────────────────

/** Format a value as an edit buffer string. */
function valueToBuffer(value: FlagsRecordValue): string {
  if (value === null) return '';
  return String(value);
}

/** Enter edit mode for the current row — pre-fill buffer with current value. */
function enterEdit(state: FlagsViewState): FlagsViewState {
  const row = state.rows[state.cursor];
  if (row.stops.length !== 0) return state; // not a text row
  const buffer = valueToBuffer(row.configuredValue);
  return {
    ...state,
    editing: { buffer, caret: buffer.length, error: null },
  };
}

/**
 * Commit the current edit buffer for a text row.
 *
 * Contract:
 *   - Empty buffer + allowUnset → commit null (unset)
 *   - Empty buffer + !allowUnset → error "Value is required"
 *   - For number/string flags: delegate to parseFlagValueInput (applies PF-023 —
 *     strict grammar enforced at the core sink, not per-caller). Error messages
 *     distinguish format failures (padded/hex/leading-zeros) from bounds failures.
 *   - parseFlagValueInput returns null on invalid input → stay editing + error
 */
function commitEdit(state: FlagsViewState): FlagsViewState {
  const { editing, rows, cursor } = state;
  if (!editing) return state;

  const row = rows[cursor];
  const flagDef = findFlag(row.id); // O(1) via FLAG_REGISTRY_MAP (PERF-L3)
  if (!flagDef || flagDef.kind === 'boolean' || flagDef.kind === 'enum') return state;

  const buf = editing.buffer;

  // Empty buffer
  if (buf === '') {
    if (row.allowUnset) {
      // Commit as null (unset)
      return {
        ...state,
        editing: null,
        rows: updateRow(rows, cursor, { configuredValue: null }),
      };
    } else {
      return {
        ...state,
        editing: { ...editing, error: 'Value is required' },
      };
    }
  }

  // Number flag: parseFlagValueInput enforces strict decimal grammar (avoids PF-023).
  // Provide specific error messages to distinguish format from bounds failures.
  if (flagDef.kind === 'number') {
    if (buf !== buf.trim()) {
      return { ...state, editing: { ...editing, error: 'No leading or trailing spaces allowed' } };
    }
    if (/^[+-]?0\d/.test(buf)) {
      return { ...state, editing: { ...editing, error: 'Leading zeros are not allowed (e.g. use 7, not 007)' } };
    }
    const coerced = parseFlagValueInput(flagDef, buf);
    if (coerced === null) {
      const parts: string[] = [];
      if (flagDef.min !== undefined) parts.push(`min ${flagDef.min}`);
      if (flagDef.max !== undefined) parts.push(`max ${flagDef.max}`);
      if (flagDef.integer) parts.push('must be an integer');
      return {
        ...state,
        editing: { ...editing, error: parts.length ? `Invalid value (${parts.join(', ')})` : 'Must be a valid number' },
      };
    }
    return {
      ...state,
      editing: null,
      rows: updateRow(rows, cursor, { configuredValue: coerced }),
    };
  }

  // String flag: coerceFlagValue handles maxLength and control-char rejection.
  // At this point flagDef.kind is 'string' (boolean and enum are guarded above,
  // number returned in its own branch).
  const coerced = coerceFlagValue(flagDef, buf);
  if (coerced === null) {
    const msg = flagDef.maxLength !== undefined ? `Max ${flagDef.maxLength} characters` : 'Invalid value';
    return { ...state, editing: { ...editing, error: msg } };
  }
  return {
    ...state,
    editing: null,
    rows: updateRow(rows, cursor, { configuredValue: coerced }),
  };
}

/**
 * ASCII control characters (C0 + DEL). These must never enter the edit buffer:
 *   - coerceFlagValue rejects any string containing them, so a buffer holding one
 *     can only ever fail to commit — and the failure message would name length,
 *     not the real cause.
 *   - renderBuffer strips them for display, so the rendered string and the buffer
 *     would have different lengths and the caret would land on the wrong character.
 * normalizeKey passes ctrl-modified keys through as their raw control byte
 * (e.g. ctrl-a → \x01), so this is reachable by ordinary typing, not just hostile input.
 */
const CONTROL_CHAR = /[\x00-\x1f\x7f]/;

/** Insert a printable character at the caret position (bounded by BUFFER_MAX_LEN). */
function insertChar(editing: EditState, char: string): EditState {
  if (editing.buffer.length >= BUFFER_MAX_LEN) return editing;
  if (CONTROL_CHAR.test(char)) return editing; // never buffer an uncommittable char
  const { buffer, caret } = editing;
  const next = buffer.slice(0, caret) + char + buffer.slice(caret);
  return { buffer: next, caret: caret + 1, error: null };
}

/** Handle a key while in edit mode. Returns the new state. */
function reduceEditMode(state: FlagsViewState, key: string): FlagsViewState {
  const editing = state.editing!;

  switch (key) {
    case 'enter':
      return commitEdit(state);

    case 'escape':
      // Discard edit — restore without changing configuredValue
      return { ...state, editing: null };

    case 'backspace': {
      if (editing.caret === 0) return { ...state, editing: { ...editing, error: null } };
      const buf = editing.buffer;
      const next = buf.slice(0, editing.caret - 1) + buf.slice(editing.caret);
      return {
        ...state,
        editing: { buffer: next, caret: editing.caret - 1, error: null },
      };
    }

    case 'delete': {
      const buf = editing.buffer;
      if (editing.caret >= buf.length) return { ...state, editing: { ...editing, error: null } };
      const next = buf.slice(0, editing.caret) + buf.slice(editing.caret + 1);
      return {
        ...state,
        editing: { buffer: next, caret: editing.caret, error: null },
      };
    }

    case 'home':
      return { ...state, editing: { ...editing, caret: 0, error: null } };

    case 'end':
      return {
        ...state,
        editing: { ...editing, caret: editing.buffer.length, error: null },
      };

    case 'left': {
      const next = Math.max(0, editing.caret - 1);
      return { ...state, editing: { ...editing, caret: next, error: null } };
    }

    case 'right': {
      const next = Math.min(editing.buffer.length, editing.caret + 1);
      return { ...state, editing: { ...editing, caret: next, error: null } };
    }

    // up/down: ignored while editing; j/k intentionally NOT listed here so they
    // insert literally (spec: literal q d u j k — default-model and spellcheck
    // may contain 'j'/'k' as part of a command or path).
    case 'up':
    case 'down':
      return state;

    // normalizeKey maps the space bar to the NAME 'space', not to ' '. Without this
    // case the default branch below drops it (5 chars, not 1), so a space could never
    // be typed — silently. spellcheck's whole purpose is to hold a shell command
    // ("aspell list"), and default-model likewise; both were unenterable as multi-word
    // values, with no error and no visual cue that the key had been ignored.
    case 'space':
      return { ...state, editing: insertChar(editing, ' ') };

    default: {
      // Printable character: single char, not ctrl
      if (key.length === 1) {
        return { ...state, editing: insertChar(editing, key) };
      }
      return state;
    }
  }
}

/**
 * Apply a new viewport height (terminal resize) and re-clamp the scroll offset.
 *
 * adjustViewport otherwise only runs on up/down, so a resize alone changed the
 * height without moving the offset: shrinking a tall terminal with the cursor
 * below the new fold left the cursor outside the visible slice, and renderFrame
 * draws the `❯` marker only for rows inside that slice — so the selection marker
 * vanished entirely until the user pressed an arrow key.
 *
 * Pure — returns a new state.
 */
export function resizeViewport(state: FlagsViewState, viewportHeight: number): FlagsViewState {
  return {
    ...state,
    viewportHeight,
    viewportOffset: adjustViewport(
      state.cursor,
      state.viewportOffset,
      viewportHeight,
      state.rows.length,
    ),
  };
}

// ─── reduce ───────────────────────────────────────────────────────────────────

/**
 * Pure keypress reducer.
 *
 * Key dispatch:
 *   Editing mode (editing !== null): all keys handled by reduceEditMode.
 *     - enter → commitEdit
 *     - escape → discard edit (exit edit mode, value unchanged)
 *     - backspace/delete/home/end/left/right → buffer manipulation
 *     - up/down/j/k → noop (navigation suppressed while editing)
 *     - single char → insertChar (bounded at BUFFER_MAX_LEN)
 *
 *   Browse mode (editing === null):
 *     - up/k, down/j → navigate, adjust viewport
 *     - space: text row → enterEdit; cycling row → cycleForward
 *     - left → cycleBackward (cycling rows only; noop on text rows)
 *     - right → cycleForward (cycling rows only; noop on text rows)
 *     - enter: text row → enterEdit; cycling row → save intent
 *     - e: text row → enterEdit; cycling row → noop
 *     - d → set devflowDefault
 *     - u → setNull (allowUnset only; noop for boolean)
 *     - escape/q → cancel intent
 *     - ctrl-c → abort intent
 */
export function reduce(state: FlagsViewState, key: string): ReduceResult {
  const n = state.rows.length;

  // Delegate to edit mode handler.
  // ctrl-c is handled BEFORE delegating: reduceEditMode has no case for it, so it
  // would fall through to 'none' and be swallowed. Raw mode suppresses the SIGINT
  // that would otherwise rescue the user, so ctrl-c was completely dead while
  // editing — the only way out was to discover escape first.
  if (state.editing !== null) {
    if (key === 'ctrl-c') return { state, intent: 'abort' };
    const next = reduceEditMode(state, key);
    return { state: next, intent: 'none' };
  }

  // Browse mode
  switch (key) {
    case 'up':
    case 'k': {
      if (n === 0) return { state, intent: 'none' };
      const newCursor = Math.max(0, state.cursor - 1);
      const newOffset = adjustViewport(newCursor, state.viewportOffset, state.viewportHeight, n);
      if (newCursor === state.cursor && newOffset === state.viewportOffset) {
        return { state, intent: 'none' };
      }
      return {
        state: { ...state, cursor: newCursor, viewportOffset: newOffset },
        intent: 'none',
      };
    }

    case 'down':
    case 'j': {
      if (n === 0) return { state, intent: 'none' };
      const newCursor = Math.min(n - 1, state.cursor + 1);
      const newOffset = adjustViewport(newCursor, state.viewportOffset, state.viewportHeight, n);
      if (newCursor === state.cursor && newOffset === state.viewportOffset) {
        return { state, intent: 'none' };
      }
      return {
        state: { ...state, cursor: newCursor, viewportOffset: newOffset },
        intent: 'none',
      };
    }

    case 'space': {
      if (n === 0) return { state, intent: 'none' };
      const row = state.rows[state.cursor];
      if (row.stops.length === 0) {
        // Text row: enter edit mode
        return { state: enterEdit(state), intent: 'none' };
      }
      // Cycling row: advance forward
      const next = cycleForward(row.stops, row.configuredValue);
      return {
        state: { ...state, rows: updateRow(state.rows, state.cursor, { configuredValue: next }) },
        intent: 'none',
      };
    }

    case 'left': {
      if (n === 0) return { state, intent: 'none' };
      const row = state.rows[state.cursor];
      if (row.stops.length === 0) return { state, intent: 'none' }; // text row noop
      const next = cycleBackward(row.stops, row.configuredValue);
      return {
        state: { ...state, rows: updateRow(state.rows, state.cursor, { configuredValue: next }) },
        intent: 'none',
      };
    }

    case 'right': {
      if (n === 0) return { state, intent: 'none' };
      const row = state.rows[state.cursor];
      if (row.stops.length === 0) return { state, intent: 'none' }; // text row noop
      const next = cycleForward(row.stops, row.configuredValue);
      return {
        state: { ...state, rows: updateRow(state.rows, state.cursor, { configuredValue: next }) },
        intent: 'none',
      };
    }

    case 'enter': {
      if (n === 0) return { state, intent: 'save' };
      const row = state.rows[state.cursor];
      if (row.stops.length === 0) {
        // Text row: enter edit mode
        return { state: enterEdit(state), intent: 'none' };
      }
      // Non-text row: save
      return { state, intent: 'save' };
    }

    case 'e': {
      if (n === 0) return { state, intent: 'none' };
      const row = state.rows[state.cursor];
      if (row.stops.length === 0) {
        return { state: enterEdit(state), intent: 'none' };
      }
      return { state, intent: 'none' }; // noop on cycling rows
    }

    case 'd': {
      if (n === 0) return { state, intent: 'none' };
      const row = state.rows[state.cursor];
      return {
        state: {
          ...state,
          rows: updateRow(state.rows, state.cursor, { configuredValue: row.devflowDefault }),
        },
        intent: 'none',
      };
    }

    case 'u': {
      if (n === 0) return { state, intent: 'none' };
      const row = state.rows[state.cursor];
      if (!row.allowUnset) return { state, intent: 'none' };
      return {
        state: {
          ...state,
          rows: updateRow(state.rows, state.cursor, { configuredValue: null }),
        },
        intent: 'none',
      };
    }

    case 'escape':
    case 'q':
      return { state, intent: 'cancel' };

    case 'ctrl-c':
      return { state, intent: 'abort' };

    default:
      return { state, intent: 'none' };
  }
}
