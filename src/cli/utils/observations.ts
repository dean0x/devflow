/**
 * @file observations.ts
 *
 * Core observation type, type guard, parsing, and pure formatting.
 * No I/O, no UI dependencies — pure data module.
 */

/**
 * Learning observation stored in learning-log.jsonl (one JSON object per line).
 * v2 extends type to include 'decision' and 'pitfall', and adds attention flags.
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
  /** Set by merge-observation when an incoming observation's details diverge
   *  significantly from the existing entry (Levenshtein ratio < 0.6). See D14. */
  needsReview?: boolean;
  /** D17: Set when decisions file hits hard ceiling (100 entries) — repurposed from 50 soft cap */
  softCapExceeded?: boolean;
  quality_ok?: boolean;
}

/**
 * Type guard for validating raw JSON as a LearningObservation.
 * Accepts all 4 types (v2: decision + pitfall added) and all statuses including deprecated.
 */
export function isLearningObservation(obj: unknown): obj is LearningObservation {
  if (typeof obj !== 'object' || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return typeof o.id === 'string' && o.id.length > 0
    && (o.type === 'workflow' || o.type === 'procedural' || o.type === 'decision' || o.type === 'pitfall')
    && typeof o.pattern === 'string' && o.pattern.length > 0
    && typeof o.confidence === 'number'
    && typeof o.observations === 'number'
    && typeof o.first_seen === 'string'
    && typeof o.last_seen === 'string'
    && (o.status === 'observing' || o.status === 'ready' || o.status === 'created' || o.status === 'deprecated')
    && Array.isArray(o.evidence)
    && typeof o.details === 'string';
}

/**
 * Parse a JSONL learning log into typed observations.
 * Skips empty and malformed lines.
 */
export function parseLearningLog(logContent: string): LearningObservation[] {
  if (!logContent.trim()) {
    return [];
  }

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

/**
 * Format a stale reason string for display.
 */
export function formatStaleReason(obs: LearningObservation): string {
  const reasons: string[] = [];
  if (obs.mayBeStale && obs.staleReason) {
    reasons.push(`stale: ${obs.staleReason}`);
  } else if (obs.mayBeStale) {
    reasons.push('may be stale');
  }
  if (obs.needsReview) reasons.push('artifact missing (deleted?)');
  if (obs.softCapExceeded) reasons.push('decisions file at capacity');
  return reasons.join(', ') || 'flagged for review';
}
