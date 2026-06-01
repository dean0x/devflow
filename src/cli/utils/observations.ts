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

