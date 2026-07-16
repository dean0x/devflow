/**
 * @file observations.ts
 *
 * Core observation type, type guard, parsing, and pure formatting.
 * No I/O, no UI dependencies — pure data module.
 */

/**
 * D201: Canonical status vocabulary for rendered decisions.md / pitfalls.md entries.
 *
 * Derived from an `as const` literal array so the union type, the runtime set,
 * and the VALID_DECISIONS_STATUSES guard below are always in sync — no manual
 * duplication. `Retired` is the output of the `retire-anchor` op and MUST be
 * present; `Unknown` was never produced by any operation and has been removed.
 *
 * Defined here (pure data module) so both observation-io.ts and learning.ts
 * can import without creating a utility→command circular dependency.
 * Re-exported through src/cli/commands/learning.ts for external consumers.
 * Consumed by LedgerRow (this file) and LearningObservation.decisions_status (this file).
 */
export const DECISIONS_ENTRY_STATUSES = [
  'Accepted', 'Active', 'Deprecated', 'Superseded', 'Retired',
] as const;

export type DecisionsEntryStatus = (typeof DECISIONS_ENTRY_STATUSES)[number];

/**
 * Learning observation stored in learning-log.jsonl (one JSON object per line).
 * v2 extends type to include 'decision' and 'pitfall'.
 *
 * Ledger fields (added for decisions-ledger.jsonl — all optional for backward compat):
 *   anchor_id       — assigned once when an observation is promoted to an ADR/PF entry
 *                     (e.g. "ADR-016"). Never recomputed or reused. Lives in the
 *                     anchored ledger (decisions-ledger.jsonl); not set on raw log rows.
 *   date            — ISO date string (YYYY-MM-DD) for the decision entry. Decisions only;
 *                     pitfalls have no date field (byte-compat contract).
 *   decisions_status — Rendered status of the ADR/PF entry in decisions.md/pitfalls.md.
 *                     Distinct from `status` (observation lifecycle). Omitted = active.
 *   amendments      — Ordered list of amendment notes appended to an ADR entry.
 *   raw_body        — Verbatim .md body for entries migrated from an existing decisions.md.
 *                     When present, the renderer emits this string verbatim instead of
 *                     re-formatting from `details`. New entries never set this field.
 */
export interface LearningObservation {
  id: string;
  type: 'workflow' | 'procedural' | 'decision' | 'pitfall';
  pattern: string;
  confidence: number;
  observations: number;
  first_seen: string;
  last_seen: string;
  status: 'observing' | 'ready' | 'created' | 'deprecated';
  evidence: string[];
  details: string;
  artifact_path?: string;
  /** Set by staleness checker (D16) when code refs in artifact file are missing */
  mayBeStale?: boolean;
  staleReason?: string;
  quality_ok?: boolean;
  // --- Ledger fields (Phase 2: decisions-ledger.jsonl schema extension) ---
  /** Stable anchor ID once promoted to ADR/PF (e.g. "ADR-016"). */
  anchor_id?: string;
  /** Decision date (YYYY-MM-DD). Decisions only; pitfalls omit this field. */
  date?: string;
  /** Rendered entry status — distinct from observation lifecycle `status`. */
  decisions_status?: DecisionsEntryStatus;
  /** Ordered amendment notes appended to an ADR entry. */
  amendments?: { date: string; note: string }[];
  /** Verbatim .md body for migrated entries — emitted as-is by the renderer. */
  raw_body?: string;
}

/**
 * D202: Projected shape of a committed decisions-ledger.jsonl row.
 *
 * This is distinct from LearningObservation — it represents the anchored ledger
 * row written by `assign-anchor` / `retire-anchor` / the migration, NOT the raw
 * log observation. Key distinctions:
 *   - `id` is required (obs ID, may be synthetic: `obs_migrated_{anchor}`)
 *   - `anchor_id` is required (set once by assign-anchor, never recomputed)
 *   - `decisions_status` is typed against DecisionsEntryStatus (no loose string)
 *   - Observation-lifecycle fields (`confidence`, `observations`, `evidence`, etc.)
 *     are optional — they are present for enriched rows but absent for synthesized rows
 *   - `[key: string]: unknown` index signature preserves round-trip JSON safety for
 *     fields added by future ops (the renderer and migration always spread-merge rows)
 *
 * Home: observations.ts (pure data module, no I/O) so decisions-ledger-migration.ts
 * and any future ledger consumers can import without circular deps.
 */
export interface LedgerRow {
  /** Observation ID (may be synthetic: `obs_migrated_{anchor}` for no-Source entries). */
  id: string;
  /** Entry type — determines which .md file the entry is rendered into. */
  type: string;
  /** Short summary / title of the decision or pitfall. */
  pattern: string;
  /** Full description; parsed into sections by the format helpers. */
  details: string;
  /** Stable anchor ID (e.g. 'ADR-016'). Set once by assign-anchor, never recomputed. */
  anchor_id: string;
  /** Rendered entry status in decisions.md / pitfalls.md. Typed to prevent illegal values. */
  decisions_status: DecisionsEntryStatus;
  /** Decision date (YYYY-MM-DD). Decisions only; pitfalls omit this field. */
  date?: string;
  /** Verbatim .md body for migrated entries — emitted as-is by the renderer. */
  raw_body?: string;
  /** Ordered amendment notes appended to an ADR entry. */
  amendments?: { date: string; note: string }[];
  /** Index signature preserves unknown fields across JSON round-trips (spread-merge safety). */
  [key: string]: unknown;
}

/** Valid values for the decisions_status optional field — derived from DECISIONS_ENTRY_STATUSES. */
const VALID_DECISIONS_STATUSES = new Set<string>(DECISIONS_ENTRY_STATUSES);

/**
 * Type guard for validating raw JSON as a LearningObservation.
 * Accepts all 4 types (v2: decision + pitfall added) and all statuses including deprecated.
 * New optional fields (anchor_id, date, decisions_status, amendments, raw_body) are
 * validated when present but their absence never causes rejection — backward compatible.
 */
export function isLearningObservation(obj: unknown): obj is LearningObservation {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;

  // Required fields
  if (!(typeof o.id === 'string' && o.id.length > 0)) return false;
  if (!(o.type === 'workflow' || o.type === 'procedural' || o.type === 'decision' || o.type === 'pitfall')) return false;
  if (!(typeof o.pattern === 'string' && o.pattern.length > 0)) return false;
  if (typeof o.confidence !== 'number') return false;
  if (typeof o.observations !== 'number') return false;
  if (typeof o.first_seen !== 'string') return false;
  if (typeof o.last_seen !== 'string') return false;
  if (!(o.status === 'observing' || o.status === 'ready' || o.status === 'created' || o.status === 'deprecated')) return false;
  if (!Array.isArray(o.evidence)) return false;
  if (typeof o.details !== 'string') return false;

  // Optional ledger fields: validate type when present, reject if wrong type
  if (o.anchor_id !== undefined && typeof o.anchor_id !== 'string') return false;
  if (o.date !== undefined && typeof o.date !== 'string') return false;
  if (o.decisions_status !== undefined && !VALID_DECISIONS_STATUSES.has(o.decisions_status as string)) return false;
  if (o.amendments !== undefined) {
    if (!Array.isArray(o.amendments)) return false;
    for (const a of o.amendments as unknown[]) {
      if (typeof a !== 'object' || a === null) return false;
      const am = a as Record<string, unknown>;
      if (typeof am.date !== 'string' || typeof am.note !== 'string') return false;
    }
  }
  if (o.raw_body !== undefined && typeof o.raw_body !== 'string') return false;

  return true;
}

/**
 * Parse a JSONL learning log into typed observations.
 * Skips empty and malformed lines.
 */
export function parseLearningLog(logContent: string): LearningObservation[] {
  const observations: LearningObservation[] = [];

  for (const line of logContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isLearningObservation(parsed)) {
        observations.push(parsed);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return observations;
}

/**
 * Parse a JSONL log and return valid observations plus the count of invalid entries.
 * Centralises the raw-line-count + parse pattern used by --status, --list, and --purge.
 */
export function loadAndCountObservations(logContent: string): {
  observations: LearningObservation[];
  invalidCount: number;
} {
  const rawLines = logContent.split('\n').filter(l => l.trim()).length;
  const observations = parseLearningLog(logContent);
  return { observations, invalidCount: rawLines - observations.length };
}

