/**
 * Static content guards for src/assets/agents/git.md.
 *
 * Pin the Git agent's safety-critical literals so silent edits fail loud (PF-018).
 * These guards read the source file directly — no build step required.
 *
 * Guard 6 in registry-integrity.test.ts performs forward/reverse OPERATION-name
 * checking between compiled commands and git.md (build-gated). These guards cover
 * what Guard 6 does not: the specific traceability operations that must exist,
 * load-bearing numeric bounds, the D9 resolution gate, D4 rate-limit backpressure
 * clauses, and dedup marker formats.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';

const GIT_AGENT_PATH = path.resolve(import.meta.dirname, '../src/assets/agents/git.md');

/**
 * Extract the content of a named operation section from git.md.
 * Returns text from "## Operation: {name}" to the next top-level "## " heading or EOF.
 */
function extractOpSection(content: string, opName: string): string {
  const marker = `## Operation: ${opName}`;
  const start = content.indexOf(marker);
  if (start === -1) return '';
  const nextSection = content.indexOf('\n## ', start + marker.length);
  return nextSection === -1 ? content.slice(start) : content.slice(start, nextSection);
}

describe('git agent — static content guards (PF-018)', () => {
  let content: string;

  beforeAll(async () => {
    content = await fs.readFile(GIT_AGENT_PATH, 'utf-8');
  });

  // ── Guard 0: Non-vacuousness ────────────────────────────────────────────────

  it('file is non-empty', () => {
    expect(content.length, 'src/assets/agents/git.md is empty').toBeGreaterThan(0);
  });

  // ── Guard 1: Required traceability operation sections exist ─────────────────
  //
  // Guard 6 in registry-integrity.test.ts cross-checks OPERATION: names in
  // compiled commands against ## Operation: headings in git.md (build-gated).
  // This guard checks the source file directly without requiring a build, and
  // asserts a specific enumerated set of traceability operations.

  const REQUIRED_OPS: readonly string[] = [
    'learn-conventions',
    'fetch-review-threads',
    'resolve-review-threads',
    'ensure-traceable-issue',
    'check-merge-readiness',
    'post-review-summary',
    'post-resolution-summary',
    'backlink-shipped-issues',
    'post-wave-report',
    'gather-release-evidence',
    'setup-task',
    'validate-branch',
    'check-ci-status',
    'manage-debt',
    'create-release',
  ];

  for (const op of REQUIRED_OPS) {
    it(`operation section exists: ## Operation: ${op}`, () => {
      expect(
        content,
        `git.md is missing "## Operation: ${op}" — silent removal breaks the traceability contract`,
      ).toContain(`## Operation: ${op}`);
    });
  }

  // ── Guard 2: Load-bearing numeric bounds ────────────────────────────────────

  it('post-review-summary: 60000-char comment cap is present', () => {
    const sec = extractOpSection(content, 'post-review-summary');
    expect(
      sec,
      'post-review-summary: missing 60000-char cap — GitHub rejects > 65536 chars; 4xx silent-skip would hide the failure',
    ).toContain('60000');
  });

  it('post-resolution-summary: 60000-char comment cap is present', () => {
    const sec = extractOpSection(content, 'post-resolution-summary');
    expect(
      sec,
      'post-resolution-summary: missing 60000-char cap',
    ).toContain('60000');
  });

  it('post-wave-report: 60000-char comment cap is present', () => {
    const sec = extractOpSection(content, 'post-wave-report');
    expect(
      sec,
      'post-wave-report: missing 60000-char cap',
    ).toContain('60000');
  });

  it('backlink-shipped-issues: ≤50 issues processing bound is present', () => {
    const sec = extractOpSection(content, 'backlink-shipped-issues');
    expect(
      sec,
      'backlink-shipped-issues: missing ≤50 issues bound — unbounded posting violates D4 rate contract',
    ).toMatch(/≤50/);
  });

  it('resolve-review-threads: ≤50 threads processing bound is present', () => {
    const sec = extractOpSection(content, 'resolve-review-threads');
    expect(
      sec,
      'resolve-review-threads: missing ≤50 threads bound — unbounded mutation calls violate the GitHub rate contract',
    ).toMatch(/≤50/);
  });

  it('fetch-review-threads: ≤2-page / 100-thread GraphQL bound is present', () => {
    const sec = extractOpSection(content, 'fetch-review-threads');
    expect(
      sec,
      'fetch-review-threads: missing ≤2-page / 100-thread GraphQL bound — unbounded pagination can exhaust rate limits',
    ).toMatch(/2 pages of 50|100 max|≤2 pages/);
  });

  it('learn-conventions: branch scan bound (head -50) is present', () => {
    const sec = extractOpSection(content, 'learn-conventions');
    expect(
      sec,
      'learn-conventions: missing branch scan bound "head -50"',
    ).toContain('head -50');
  });

  it('learn-conventions: tag scan bound (head -20) is present', () => {
    const sec = extractOpSection(content, 'learn-conventions');
    expect(
      sec,
      'learn-conventions: missing tag scan bound "head -20"',
    ).toContain('head -20');
  });

  it('learn-conventions: merged-PR scan bound (--limit 30) is present', () => {
    const sec = extractOpSection(content, 'learn-conventions');
    expect(
      sec,
      'learn-conventions: missing merged-PR scan bound "--limit 30"',
    ).toContain('--limit 30');
  });

  it('learn-conventions: rev-list --max-count=200 integration-branch bound is present', () => {
    const sec = extractOpSection(content, 'learn-conventions');
    expect(
      sec,
      'learn-conventions: missing "--max-count=200" rev-list bound for integration-branch candidate scoring',
    ).toContain('--max-count=200');
  });

  // ── Guard 3: D9 resolution gate ─────────────────────────────────────────────

  it('D9: resolveReviewThread requires VERIFICATION_STATUS == PASS AND verdict FIXED AND commit_sha non-empty', () => {
    const sec = extractOpSection(content, 'resolve-review-threads');
    expect(
      sec,
      'D9 gate: must state "ONLY when VERIFICATION_STATUS == PASS AND verdict == FIXED AND commit_sha non-empty" — this is the single authority for thread resolution',
    ).toContain('ONLY when VERIFICATION_STATUS == PASS AND verdict == FIXED AND commit_sha non-empty');
  });

  it('D9: FALSE_POSITIVE verdict is reply-only (no resolveReviewThread)', () => {
    const sec = extractOpSection(content, 'resolve-review-threads');
    expect(
      sec,
      'D9 gate: FALSE_POSITIVE must be reply-only — reviewers retain control over closing their own threads',
    ).toMatch(/FALSE_POSITIVE.*reply.only/s);
  });

  it('D9: BY_DESIGN verdict is reply-only (no resolveReviewThread)', () => {
    const sec = extractOpSection(content, 'resolve-review-threads');
    expect(
      sec,
      'D9 gate: BY_DESIGN must be reply-only — reviewers retain control over closing their own threads',
    ).toMatch(/BY_DESIGN.*reply.only/s);
  });

  // ── Guard 4: D4 rate-limit backpressure clauses ─────────────────────────────

  it('D4: secondary rate limit triggers STOP', () => {
    expect(
      content,
      'D4: secondary rate limit must trigger STOP — "never continue into an active rate limit" is a safety invariant that protects GitHub\'s penalty window',
    ).toMatch(/[Ss]econdary rate limit.*STOP/s);
  });

  it('D4: secondary rate limit triggers THROTTLED report', () => {
    expect(
      content,
      'D4: secondary rate limit must produce a THROTTLED report — callers need the remaining-items count',
    ).toContain('THROTTLED');
  });

  it('D4: X-RateLimit-Remaining < 10 is the full-STOP threshold', () => {
    expect(
      content,
      'D4: X-RateLimit-Remaining < 10 must be the exact STOP boundary — changing this threshold silently widens the penalty window',
    ).toMatch(/X-RateLimit-Remaining[^<\n]*<\s*10/);
  });

  it('D4: X-RateLimit-Remaining < 50 is the backpressure threshold (1s → 3s delay)', () => {
    expect(
      content,
      'D4: X-RateLimit-Remaining < 50 backpressure threshold must be present — raises inter-op delay from 1s to 3s; removing it silently disables backpressure',
    ).toMatch(/remaining < 50|X-RateLimit-Remaining[^<\n]*<\s*50/);
  });

  // ── Guard 5: Dedup marker formats ───────────────────────────────────────────

  it('review-summary dedup marker uses cycle:{N} ts: pair form', () => {
    const sec = extractOpSection(content, 'post-review-summary');
    expect(
      sec,
      'review-summary dedup: missing "devflow:review-summary cycle:{N} ts:" marker pair — changing either token breaks idempotency for existing comments',
    ).toMatch(/devflow:review-summary cycle:[^ ]+ ts:/);
  });

  it('resolution-summary dedup marker uses ts: form', () => {
    const sec = extractOpSection(content, 'post-resolution-summary');
    expect(
      sec,
      'resolution-summary dedup: missing "devflow:resolution-summary ts:" marker — changing this format breaks idempotency for existing comments',
    ).toContain('devflow:resolution-summary ts:');
  });
});
