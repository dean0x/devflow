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

  // ── Guard 6: D10 publication visibility gate ─────────────────────────────

  it('D10: ## Publication gate (D10) section exists', () => {
    expect(
      content,
      'git.md is missing "## Publication gate (D10)" section — silent removal breaks the visibility-gated posting contract',
    ).toContain('## Publication gate (D10)');
  });

  it('D10: gh repo view --json visibility probe command is present', () => {
    expect(
      content,
      'D10: missing "gh repo view --json visibility" — the visibility probe is the sole mechanism for determining FULL vs STUB mode',
    ).toContain('gh repo view --json visibility');
  });

  it('D10: PRIVATE, INTERNAL, and PUBLIC visibility values are all named in the gate logic', () => {
    // All three canonical GitHub visibility values must appear; removing one silently disables a gate branch
    expect(content, 'D10: PRIVATE not documented').toContain('PRIVATE');
    expect(content, 'D10: INTERNAL not documented').toContain('INTERNAL');
    expect(content, 'D10: PUBLIC not documented').toContain('PUBLIC');
  });

  it('D10: fail-closed rule "treat as PUBLIC" is present', () => {
    expect(
      content,
      'D10: missing "treat as PUBLIC" fail-closed rule — any probe error must default to STUB (not FULL)',
    ).toContain('treat as PUBLIC');
  });

  it('D10: stub-withheld sentence is present', () => {
    expect(
      content,
      'D10: missing "Full summary withheld (public repository)." — changing this line alters the stub template seen by PR reviewers',
    ).toContain('Full summary withheld (public repository).');
  });

  it('D10: review-summary dedup marker appears ≥2× in post-review-summary (full mode + stub template)', () => {
    const sec = extractOpSection(content, 'post-review-summary');
    const matches = sec.match(/devflow:review-summary cycle:/g);
    expect(
      matches,
      'post-review-summary: "devflow:review-summary cycle:" must appear ≥2 times (full body + stub template)',
    ).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('D10: resolution-summary dedup marker appears ≥2× in post-resolution-summary (full mode + stub template)', () => {
    const sec = extractOpSection(content, 'post-resolution-summary');
    const matches = sec.match(/devflow:resolution-summary ts:/g);
    expect(
      matches,
      'post-resolution-summary: "devflow:resolution-summary ts:" must appear ≥2 times (full body + stub template)',
    ).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('D10: REVIEW_PUBLICATION is documented with all three values: auto, full, off', () => {
    expect(content, 'D10: REVIEW_PUBLICATION not documented').toContain('REVIEW_PUBLICATION');
    expect(content, 'D10: "auto" value not documented').toContain('auto');
    expect(content, 'D10: "full" value not documented').toContain('full');
    expect(content, 'D10: "off" value not documented').toContain('off');
  });

  it('D10: publication output enum line is present in git.md', () => {
    expect(
      content,
      'D10: missing publication output enum line — removing it breaks the caller\'s ability to parse publication status',
    ).toContain('**Publication**: FULL (private repo) | FULL (config override) | STUB (public repository) | SKIPPED (publication disabled)');
  });

  it('D10: gh repo view appears ONLY in post-review-summary and post-resolution-summary (scope boundary, non-vacuous)', () => {
    // Negative scope guard: extract all ## Operation: sections; only the two summary ops may probe visibility
    const opNames = (content.match(/## Operation: (\S+)/g) ?? []).map(m => m.replace('## Operation: ', ''));
    expect(
      opNames.length,
      `corpus is only ${opNames.length} ops — expected > 2 for a non-vacuous scope check (PF-018)`,
    ).toBeGreaterThan(2);

    const ghRepoViewOps: string[] = [];
    for (const op of opNames) {
      const sec = extractOpSection(content, op);
      if (sec.includes('gh repo view')) ghRepoViewOps.push(op);
    }
    expect(
      ghRepoViewOps.sort(),
      'D10 scope violation: gh repo view must appear ONLY in post-review-summary and post-resolution-summary',
    ).toEqual(['post-resolution-summary', 'post-review-summary']);
  });

  // ── Guard 7: D11 comment-sink scrub ─────────────────────────────────────

  it('D11: ## Comment-sink scrub (D11) section exists', () => {
    expect(
      content,
      'git.md is missing "## Comment-sink scrub (D11)" section — silent removal disables unconditional secret redaction',
    ).toContain('## Comment-sink scrub (D11)');
  });

  it('D11: redact-secrets.cjs script path with DEVFLOW_DIR prefix is present', () => {
    expect(content, 'D11: redact-secrets.cjs not referenced').toContain('redact-secrets.cjs');
    expect(
      content,
      'D11: ${DEVFLOW_DIR:-$HOME/.devflow}/scripts/ prefix not present — changing the install path silently breaks the scrubber invocation',
    ).toContain('${DEVFLOW_DIR:-$HOME/.devflow}/scripts/');
  });

  it('D11: DO NOT POST and TRACEABILITY: DEGRADED (redaction unavailable) are present', () => {
    expect(content, 'D11: "DO NOT POST" directive missing').toContain('DO NOT POST');
    expect(
      content,
      'D11: "TRACEABILITY: DEGRADED (redaction unavailable)" missing — callers need this exact string to detect scrubber failure',
    ).toContain('TRACEABILITY: DEGRADED (redaction unavailable)');
  });

  it('D11: no-pipeline clause is present (&&-chain discipline, never pipelines)', () => {
    // A pipeline swallows scrubber crashes (fail-open); the &&-chain is the fail-closed mechanism
    expect(
      content,
      'D11: "never pipelines" discipline clause missing — without it, pipeline exits mask scrubber failures',
    ).toContain('never pipelines');
  });

  it('D11: every posting op (--body-file or -F body=@) references D11 (forward guard, ≥8 ops)', () => {
    // Non-vacuous: assert ≥ 8 posting ops exist AND each one references D11 (PF-018)
    const opNames = (content.match(/## Operation: (\S+)/g) ?? []).map(m => m.replace('## Operation: ', ''));

    const postingOps: string[] = [];
    const postingOpsWithoutD11: string[] = [];

    for (const op of opNames) {
      const sec = extractOpSection(content, op);
      if (sec.includes('--body-file') || sec.includes('-F body=@')) {
        postingOps.push(op);
        if (!sec.includes('D11')) postingOpsWithoutD11.push(op);
      }
    }

    expect(
      postingOps.length,
      `D11 forward guard: expected ≥ 8 posting ops, found ${postingOps.length}: [${postingOps.join(', ')}]`,
    ).toBeGreaterThanOrEqual(8);
    expect(
      postingOpsWithoutD11,
      `D11 forward guard: posting ops missing D11 reference: [${postingOpsWithoutD11.join(', ')}]`,
    ).toHaveLength(0);
  });

  it('D11: erasure guidance — rotation (/rotat/i) and edit-history retention are documented', () => {
    expect(content, 'D11: rotation guidance (/rotat/i) missing — a found live secret requires rotation, not just deletion').toMatch(/rotat/i);
    expect(content, 'D11: "edit history" retention note missing — GitHub retains edit history; deletion is not remediation').toContain('edit history');
  });
});
