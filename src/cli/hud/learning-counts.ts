/**
 * @devflow-design-decision D15
 * Soft cap + HUD attention counter, not auto-pruning.
 * We cannot reliably detect "irrelevance" without human judgment.
 * The soft cap + attention counter shifts the decision to the user at the point where it matters.
 */

import * as fs from 'node:fs';
import type { LearningCountsData } from './types.js';
import { getLearningLogPath, getDecisionsLogPath } from '../utils/project-paths.js';

/** Canonical list of valid observation types — drives both the guard and the switch. */
const VALID_OBSERVATION_TYPES = ['workflow', 'procedural', 'decision', 'pitfall'] as const;
type ObservationType = typeof VALID_OBSERVATION_TYPES[number];

interface RawObservation {
  type: ObservationType;
  status: string;
  mayBeStale?: boolean;
}

/** Returns true when v is undefined, or a boolean. Rejects any other value. */
function isOptBool(v: unknown): boolean {
  return v === undefined || typeof v === 'boolean';
}

function isRawObservation(val: unknown): val is RawObservation {
  if (typeof val !== 'object' || val === null) return false;
  const o = val as Record<string, unknown>;

  // Phase 1: required fields
  if (typeof o.type !== 'string' || typeof o.status !== 'string') return false;
  if (!(VALID_OBSERVATION_TYPES as readonly string[]).includes(o.type)) return false;

  // Phase 2: optional boolean flags
  return isOptBool(o.mayBeStale);
}

/**
 * Parse a JSONL file and accumulate valid observations into counts.
 * Returns true if at least one valid observation was parsed; false if file was missing or empty.
 */
function parseLogInto(logPath: string, counts: LearningCountsData): boolean {
  let content: string;
  try {
    content = fs.readFileSync(logPath, 'utf-8');
  } catch {
    return false;
  }

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
    if (parsed.mayBeStale) {
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
      default: {
        const _exhaustive: never = parsed.type;
        throw new Error(`unknown observation type: ${_exhaustive}`);
      }
    }
  }

  return parsedAny;
}

/**
 * Read .devflow/learning/learning-log.jsonl and .devflow/decisions/decisions-log.jsonl, merge counts by type + attention flags.
 * Returns null if neither log exists or neither can be parsed (graceful fallback).
 * Only counts entries with status === 'created'.
 *
 * learning-log.jsonl: workflow + procedural observations (written by `devflow learn`)
 * decisions-log.jsonl: decision + pitfall observations (written by `devflow decisions`)
 */
export function getLearningCounts(cwd: string): LearningCountsData | null {
  const counts: LearningCountsData = {
    workflows: 0,
    procedural: 0,
    decisions: 0,
    pitfalls: 0,
    needReview: 0,
  };

  const learningParsed = parseLogInto(getLearningLogPath(cwd), counts);
  const decisionsParsed = parseLogInto(getDecisionsLogPath(cwd), counts);

  // Return null only if neither file yielded any valid observations
  if (!learningParsed && !decisionsParsed) return null;

  return counts;
}
