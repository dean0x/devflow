/**
 * @devflow-design-decision D15
 * Soft cap + HUD attention counter, not auto-pruning.
 * We cannot reliably detect "irrelevance" without human judgment.
 * The soft cap + attention counter shifts the decision to the user at the point where it matters.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { LearningCountsData } from './types.js';

type ObservationType = 'workflow' | 'procedural' | 'decision' | 'pitfall';

interface RawObservation {
  type: ObservationType;
  status: string;
  mayBeStale?: boolean;
  needsReview?: boolean;
  softCapExceeded?: boolean;
}

function isRawObservation(val: unknown): val is RawObservation {
  if (typeof val !== 'object' || val === null) return false;
  const o = val as Record<string, unknown>;
  return (
    typeof o.type === 'string' &&
    typeof o.status === 'string' &&
    ['workflow', 'procedural', 'decision', 'pitfall'].includes(o.type)
  );
}

/**
 * Read .memory/learning-log.jsonl and return counts by type + attention flags.
 * Returns null if the log does not exist or cannot be parsed (graceful fallback).
 * Only counts entries with status === 'created'.
 */
export function getLearningCounts(cwd: string): LearningCountsData | null {
  const logPath = path.join(cwd, '.memory', 'learning-log.jsonl');

  let content: string;
  try {
    content = fs.readFileSync(logPath, 'utf-8');
  } catch {
    return null;
  }

  const counts: LearningCountsData = {
    workflows: 0,
    procedural: 0,
    decisions: 0,
    pitfalls: 0,
    needReview: 0,
  };

  let parsedAny = false;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Skip malformed lines — graceful
      continue;
    }

    if (!isRawObservation(parsed)) continue;
    parsedAny = true;

    // Count attention flags regardless of status
    if (parsed.mayBeStale || parsed.needsReview || parsed.softCapExceeded) {
      counts.needReview++;
    }

    // Only count 'created' entries in type totals
    if (parsed.status !== 'created') continue;

    switch (parsed.type) {
      case 'workflow':
        counts.workflows++;
        break;
      case 'procedural':
        counts.procedural++;
        break;
      case 'decision':
        counts.decisions++;
        break;
      case 'pitfall':
        counts.pitfalls++;
        break;
    }
  }

  if (!parsedAny) return null;

  return counts;
}
