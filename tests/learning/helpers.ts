// tests/learning/helpers.ts
// Shared test utilities for the self-learning test suite.
// All learning tests that invoke json-helper.cjs via execSync import from here.

import * as path from 'path';
import * as url from 'url';
import { execSync } from 'child_process';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const JSON_HELPER = path.resolve(__dirname, '../../scripts/hooks/json-helper.cjs');

/**
 * Run json-helper.cjs with the given CLI args string and return stdout.
 * Throws on non-zero exit.
 */
export function runHelper(args: string, input?: string): string {
  return execSync(`node "${JSON_HELPER}" ${args}`, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Minimal shape shared by all four observation types stored in learning-log.jsonl.
 * Tests can spread-override individual fields.
 */
export interface LogEntry {
  id: string;
  type: string;
  pattern: string;
  confidence: number;
  observations: number;
  first_seen: string;
  last_seen: string;
  status: string;
  evidence: string[];
  details: string;
  quality_ok?: boolean;
  artifact_path?: string;
  /** D17: Set by render-ready when a knowledge file hits the hard ceiling (100 entries). */
  softCapExceeded?: boolean;
  deprecated_at?: string;
  needsReview?: boolean;
  mayBeStale?: boolean;
  staleReason?: string;
}

/**
 * djb2 hash — matches the contentHash() implementation in json-helper.cjs.
 * Exported so all test files can share a single copy (T3: eliminates duplicate
 * inline definitions in reconcile.test.ts and any future test files).
 */
export function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16);
}

/**
 * Return a base log entry for the given id and type.
 * Suitable as a starting point for any test fixture.
 */
export function baseEntry(id: string, type = 'workflow', status = 'created'): LogEntry {
  const now = new Date().toISOString();
  return {
    id,
    type,
    pattern: 'test pattern',
    confidence: 0.95,
    observations: 3,
    first_seen: now,
    last_seen: now,
    status,
    evidence: ['evidence item 1', 'evidence item 2'],
    details: 'step 1; step 2',
    quality_ok: true,
  };
}
