/**
 * @file observations.ts
 *
 * Core observation type, type guard, parsing, and pure formatting.
 * No I/O, no UI dependencies — pure data module.
 */

/**
 * Status values for a rendered decisions.md / pitfalls.md entry.
 * Defined here (pure data module) so both observation-io.ts and decisions.ts
 * can import it without creating a utility→command circular dependency.
 */
export type DecisionsEntryStatus = 'Accepted' | 'Active' | 'Deprecated' | 'Superseded' | 'Unknown';

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
  decisions_status?: 'Accepted' | 'Active' | 'Deprecated' | 'Superseded' | 'Retired';
  /** Ordered amendment notes appended to an ADR entry. */
  amendments?: { date: string; note: string }[];
  /** Verbatim .md body for migrated entries — emitted as-is by the renderer. */
  raw_body?: string;
}

/** Valid values for the decisions_status optional field. */
const VALID_DECISIONS_STATUSES = new Set([
  'Accepted', 'Active', 'Deprecated', 'Superseded', 'Retired',
]);

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

