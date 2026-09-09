/**
 * Static content guards for the Git agent.
 *
 * Pin the Git agent's safety-critical literals so silent edits fail loud (PF-018).
 * The agent is read through resolveAgentSource, which is dist-preferred: since
 * Phase 1 that means the compiled dist/agents/git.md, the artifact that ships.
 *
 * Guard 6 in registry-integrity.test.ts performs forward/reverse OPERATION-name
 * checking between compiled commands and git.md (build-gated). These guards cover
 * what Guard 6 does not: the specific traceability operations that must exist,
 * load-bearing numeric bounds, the D9 resolution gate, D4 rate-limit backpressure
 * clauses, and dedup marker formats.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { resolveAgentSource, gitAgentSinkCorpus, extractOpSectionFromCorpus, loadFile, requireDistFile, type CorpusEntry } from './helpers.js';

// Dist-preferred resolver — Phase 1 needs zero test edits here when git.md → git.mds
const GIT_AGENT_SOURCE = resolveAgentSource('git');
const GIT_AGENT_PATH = GIT_AGENT_SOURCE.path;

/**
 * Extract the content of a named operation section from a corpus.
 * Thin wrapper around extractOpSectionFromCorpus — kept so callers stay readable.
 * Use mode: 'sole' for single-authority lookups (seam test forward direction),
 * mode: 'union' for sink-class guards (D11 forward/reverse).
 */
function extractOpSection(corpus: CorpusEntry[], opName: string, mode: 'union' | 'sole'): string {
  return extractOpSectionFromCorpus(corpus, opName, { mode }).content;
}

/**
 * Collect conventions-commit placement violations from a corpus.
 *
 * Pins (PF-030, PF-058):
 *   (a) setup-task step 4b commits `.devflow/conventions.md` after branch creation — sole mode;
 *       git.md is the single authority. The section is truncated at `## Task Setup:` (inside the
 *       output code fence), but all three pinned literals sit in the process steps before the fence.
 *   (b) learn-conventions contains NO `commit --only` — the commit has moved to setup-task step 4b
 *       (ADR-003: end state only; the old **Commit (non-blocking):** block must not reappear).
 *   (c) fetch-issues-batch reports `NOT_FOUND ({refs})` and strips #-prefixed refs before parsing.
 *   (d) fetch-issue strips #-prefixed refs in step 1 before the numeric/text branch.
 *
 * All four ops use sole-mode extraction (git.md is the single contract authority for each).
 * Missing op = violation, never a silent pass (PF-018).
 */
function collectConventionsCommitPlacementViolations(corpus: CorpusEntry[]): string[] {
  const violations: string[] = [];

  if (corpus.length === 0) {
    violations.push('corpus is empty — cannot verify any operation');
    return violations;
  }

  // Helper: extract a sole-mode section; a missing op is a violation, not an unhandled throw.
  function getSection(opName: string): string | null {
    try {
      return extractOpSectionFromCorpus(corpus, opName, { mode: 'sole' }).content;
    } catch {
      violations.push(`operation '${opName}' not found in corpus — cannot verify placement`);
      return null;
    }
  }

  // ── (a) setup-task ─────────────────────────────────────────────────────────
  // sole mode: git.md is the single authority for setup-task.
  const setupTask = getSection('setup-task');
  if (setupTask !== null) {
    if (!setupTask.includes('commit --only -- .devflow/conventions.md')) {
      violations.push(
        'setup-task: missing "commit --only -- .devflow/conventions.md" — ' +
        'conventions commit must happen in setup-task step 4b, not inside learn-conventions (PF-030)',
      );
    }
    if (!setupTask.includes('CONVENTIONS_COMMIT: skipped (no branch)')) {
      violations.push(
        'setup-task: missing "CONVENTIONS_COMMIT: skipped (no branch)" — ' +
        'step 4b must guard against a detached/base HEAD before committing',
      );
    }
    // 4b. step must appear AFTER the git checkout -b line.
    // Scoped to this extracted section: ensure-pr-ready has its own unrelated 4b. at git.md:~113,
    // but that section is never included when extracting setup-task (sole mode).
    const lines = setupTask.split('\n');
    const checkoutIdx = lines.findIndex(l => l.includes('git checkout -b "$DEVFLOW_BRANCH"'));
    const step4bIdx = lines.findIndex(l => /^\s*4b\./.test(l));
    if (step4bIdx === -1) {
      violations.push(
        'setup-task: "4b." step is absent — conventions commit step must be present in setup-task, ' +
        'immediately after the git checkout -b step (PF-030)',
      );
    } else if (checkoutIdx === -1) {
      violations.push(
        'setup-task: "git checkout -b \\"$DEVFLOW_BRANCH\\"" line not found — ' +
        'cannot verify that 4b. appears after branch creation',
      );
    } else if (step4bIdx <= checkoutIdx) {
      violations.push(
        'setup-task: "4b." step appears at or before the git checkout -b line — ' +
        'conventions commit must happen AFTER branch creation so it lands on the feature branch',
      );
    }
  }

  // ── (b) learn-conventions ──────────────────────────────────────────────────
  // File-scoped slicing (not extractOpSectionFromCorpus): the output block's
  // ## Conventions Learned heading causes extractOpSectionFromCorpus to truncate
  // before the post-output **Commit boundary:** area, which is where a misplaced
  // commit --only would live. Slicing from ## Operation: learn-conventions to
  // the next ## Operation: covers the full section including the post-output area.
  {
    const marker = '## Operation: learn-conventions';
    const matchingSections: string[] = [];
    for (const entry of corpus) {
      const start = entry.content.indexOf(marker);
      if (start === -1) continue;
      const nextOp = entry.content.indexOf('\n## Operation:', start + marker.length);
      matchingSections.push(nextOp === -1 ? entry.content.slice(start) : entry.content.slice(start, nextOp));
    }
    if (matchingSections.length === 0) {
      violations.push("operation 'learn-conventions' not found in corpus — cannot verify placement");
    } else {
      const learnConventions = matchingSections.join('\n');
      if (learnConventions.includes('commit --only')) {
        violations.push(
          'learn-conventions: contains "commit --only" — the conventions commit must not be inside ' +
          'learn-conventions; it belongs in setup-task step 4b so it lands on the feature branch (PF-030)',
        );
      }
    }
  }

  // ── (c) fetch-issues-batch ─────────────────────────────────────────────────
  // sole mode: git.md is the single authority.
  // Both pins sit in the process steps before the ## Issues Batch output heading.
  const fetchBatch = getSection('fetch-issues-batch');
  if (fetchBatch !== null) {
    if (!fetchBatch.includes('NOT_FOUND ({refs})')) {
      violations.push(
        'fetch-issues-batch: missing "NOT_FOUND ({refs})" — null GraphQL aliases must be reported, ' +
        'never silently dropped; the batch must never abort on a single missing ref (PF-058)',
      );
    }
    if (!fetchBatch.includes('Strip a leading `#`')) {
      violations.push(
        'fetch-issues-batch: missing "Strip a leading `#`" — #-prefixed references must be normalised ' +
        'before parsing so #42 takes the numeric path, not the search path',
      );
    }
  }

  // ── (d) fetch-issue ────────────────────────────────────────────────────────
  // sole mode: git.md is the single authority.
  // Section is truncated at ## Issue #{number}: inside the output code fence,
  // but step 1 (the strip step) is before the output block.
  const fetchIssue = getSection('fetch-issue');
  if (fetchIssue !== null) {
    if (!fetchIssue.includes('Strip a leading `#`')) {
      violations.push(
        'fetch-issue: missing "Strip a leading `#`" in step 1 — #-prefixed references must be ' +
        'normalised before the numeric/text branch so #42 fetches directly, not as a search term',
      );
    }
  }

  return violations;
}

describe('git agent — static content guards (PF-018)', () => {
  // Single-file corpus for operations that have exactly one authority file
  let content: string;
  let soleCorpus: CorpusEntry[];

  beforeAll(() => {
    content = GIT_AGENT_SOURCE.content;
    soleCorpus = [{ path: GIT_AGENT_PATH, content }];
  });

  // ── Guard 0: Non-vacuousness ────────────────────────────────────────────────

  it('file is non-empty', () => {
    expect(content.length, `${GIT_AGENT_PATH} is empty`).toBeGreaterThan(0);
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
    // Wired live from plan.mds Gate 0 (single-issue and multi-issue fetch paths) — AC-0.11
    'fetch-issue',
    'fetch-issues-batch',
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
    const sec = extractOpSection(soleCorpus, 'post-review-summary', 'sole');
    expect(
      sec,
      'post-review-summary: missing 60000-char cap — GitHub rejects > 65536 chars; 4xx silent-skip would hide the failure',
    ).toContain('60000');
  });

  it('post-resolution-summary: 60000-char comment cap is present', () => {
    const sec = extractOpSection(soleCorpus, 'post-resolution-summary', 'sole');
    expect(
      sec,
      'post-resolution-summary: missing 60000-char cap',
    ).toContain('60000');
  });

  it('post-wave-report: 60000-char comment cap is present', () => {
    const sec = extractOpSection(soleCorpus, 'post-wave-report', 'sole');
    expect(
      sec,
      'post-wave-report: missing 60000-char cap',
    ).toContain('60000');
  });

  it('manage-debt: 60000-char archive threshold is present (AC-0.12)', () => {
    // Union corpus: the pin follows the text when Phase 2 moves manage-debt
    // mechanics into compiled reference files under dist/skills/git/references/.
    // Floor must stay ≥ 60000 — reducing the threshold silently allows oversized
    // archives that exceed GitHub's comment limit.
    const sec = extractOpSection(gitAgentSinkCorpus(), 'manage-debt', 'union');
    expect(
      sec,
      'manage-debt: missing 60000-char archive threshold — must be pinned before Phase 2 moves the mechanics',
    ).toContain('60000');
  });

  it('backlink-shipped-issues: ≤50 issues processing bound is present', () => {
    const sec = extractOpSection(soleCorpus, 'backlink-shipped-issues', 'sole');
    expect(
      sec,
      'backlink-shipped-issues: missing ≤50 issues bound — unbounded posting violates D4 rate contract',
    ).toMatch(/≤50/);
  });

  it('resolve-review-threads: ≤50 threads processing bound is present', () => {
    const sec = extractOpSection(soleCorpus, 'resolve-review-threads', 'sole');
    expect(
      sec,
      'resolve-review-threads: missing ≤50 threads bound — unbounded mutation calls violate the GitHub rate contract',
    ).toMatch(/≤50/);
  });

  // AC-0.3 named these three assertions as Guard 2's pinning test for
  // fetch-issues-batch, but they were never written: the only occurrences of
  // ≤50 / TRUNCATED / "## Issues Batch" under tests/ were inside the golden
  // fixtures, which are data. The golden pins them transitively via whole-file
  // byte equality; these give the bound its own named failure instead.

  it('fetch-issues-batch: ≤50 issues processing bound is present (AC-0.3)', () => {
    const sec = extractOpSection(soleCorpus, 'fetch-issues-batch', 'sole');
    expect(
      sec,
      'fetch-issues-batch: missing 50-issue bound — an unbounded batch fetch can exhaust the GraphQL rate budget',
    ).toMatch(/at most 50|≤50|first 50/);
  });

  it('fetch-issues-batch: TRUNCATED ({n} not processed) overflow report is present (AC-0.3)', () => {
    const sec = extractOpSection(soleCorpus, 'fetch-issues-batch', 'sole');
    expect(
      sec,
      'fetch-issues-batch: missing "TRUNCATED ({n} not processed)" — without it a truncated batch ' +
      'is reported as complete and the caller plans against issues that were never fetched',
    ).toContain('TRUNCATED ({n} not processed)');
  });

  it('fetch-issues-batch: "## Issues Batch ({n} issues)" output header is present (AC-0.3)', () => {
    // Whole-file scope on purpose. extractOpSectionFromCorpus ends a section at
    // the next `\n## `, and this header is itself a `## ` line inside the op's
    // Output template — so the extractor cuts the section immediately before it
    // and an op-scoped assertion can never see it.
    expect(
      content,
      'git.md: missing "## Issues Batch ({n} issues)" output header — plan.mds Gate 0 ' +
      'parses the batch response by this heading',
    ).toContain('## Issues Batch ({n} issues)');
  });

  it('fetch-issues-batch: issues are fetched in a single GraphQL query, not N REST calls [DR-07]', () => {
    const sec = extractOpSection(soleCorpus, 'fetch-issues-batch', 'sole');
    expect(
      sec,
      'fetch-issues-batch: missing the single-GraphQL-query mechanic — a per-issue loop reintroduces ' +
      'the N-call rate exposure the A1 rewrite removed',
    ).toContain('gh api graphql');
    expect(
      sec,
      'fetch-issues-batch: the "single" GraphQL query wording is load-bearing [DR-07]',
    ).toMatch(/\*\*single\*\* GraphQL query|single GraphQL query/);
  });

  it('fetch-review-threads: ≤2-page / 100-thread GraphQL bound is present', () => {
    const sec = extractOpSection(soleCorpus, 'fetch-review-threads', 'sole');
    expect(
      sec,
      'fetch-review-threads: missing ≤2-page / 100-thread GraphQL bound — unbounded pagination can exhaust rate limits',
    ).toMatch(/2 pages of 50|100 max|≤2 pages/);
  });

  it('learn-conventions: branch scan bound (head -50) is present', () => {
    const sec = extractOpSection(soleCorpus, 'learn-conventions', 'sole');
    expect(
      sec,
      'learn-conventions: missing branch scan bound "head -50"',
    ).toContain('head -50');
  });

  it('learn-conventions: tag scan bound (head -20) is present', () => {
    const sec = extractOpSection(soleCorpus, 'learn-conventions', 'sole');
    expect(
      sec,
      'learn-conventions: missing tag scan bound "head -20"',
    ).toContain('head -20');
  });

  it('learn-conventions: merged-PR scan bound (--limit 30) is present', () => {
    const sec = extractOpSection(soleCorpus, 'learn-conventions', 'sole');
    expect(
      sec,
      'learn-conventions: missing merged-PR scan bound "--limit 30"',
    ).toContain('--limit 30');
  });

  it('learn-conventions: rev-list --max-count=200 integration-branch bound is present', () => {
    const sec = extractOpSection(soleCorpus, 'learn-conventions', 'sole');
    expect(
      sec,
      'learn-conventions: missing "--max-count=200" rev-list bound for integration-branch candidate scoring',
    ).toContain('--max-count=200');
  });

  // ── Guard 3: D9 resolution gate ─────────────────────────────────────────────

  it('D9: resolveReviewThread requires VERIFICATION_STATUS == PASS AND verdict FIXED AND commit_sha non-empty', () => {
    const sec = extractOpSection(soleCorpus, 'resolve-review-threads', 'sole');
    expect(
      sec,
      'D9 gate: must state "ONLY when VERIFICATION_STATUS == PASS AND verdict == FIXED AND commit_sha non-empty" — this is the single authority for thread resolution',
    ).toContain('ONLY when VERIFICATION_STATUS == PASS AND verdict == FIXED AND commit_sha non-empty');
  });

  it('D9: FALSE_POSITIVE verdict is reply-only (no resolveReviewThread)', () => {
    const sec = extractOpSection(soleCorpus, 'resolve-review-threads', 'sole');
    expect(
      sec,
      'D9 gate: FALSE_POSITIVE must be reply-only — reviewers retain control over closing their own threads',
    ).toMatch(/FALSE_POSITIVE.*reply.only/s);
  });

  it('D9: BY_DESIGN verdict is reply-only (no resolveReviewThread)', () => {
    const sec = extractOpSection(soleCorpus, 'resolve-review-threads', 'sole');
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
    const sec = extractOpSection(soleCorpus, 'post-review-summary', 'sole');
    expect(
      sec,
      'review-summary dedup: missing "devflow:review-summary cycle:{N} ts:" marker pair — changing either token breaks idempotency for existing comments',
    ).toMatch(/devflow:review-summary cycle:[^ ]+ ts:/);
  });

  it('resolution-summary dedup marker uses ts: form', () => {
    const sec = extractOpSection(soleCorpus, 'post-resolution-summary', 'sole');
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
    const sec = extractOpSection(soleCorpus, 'post-review-summary', 'sole');
    const matches = sec.match(/devflow:review-summary cycle:/g);
    expect(
      matches,
      'post-review-summary: "devflow:review-summary cycle:" must appear ≥2 times (full body + stub template)',
    ).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('D10: resolution-summary dedup marker appears ≥2× in post-resolution-summary (full mode + stub template)', () => {
    const sec = extractOpSection(soleCorpus, 'post-resolution-summary', 'sole');
    const matches = sec.match(/devflow:resolution-summary ts:/g);
    expect(
      matches,
      'post-resolution-summary: "devflow:resolution-summary ts:" must appear ≥2 times (full body + stub template)',
    ).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('D10: REVIEW_PUBLICATION is documented with all three values: auto, full, off', () => {
    const sec = extractOpSection(soleCorpus, 'post-review-summary', 'sole');
    expect(sec, 'D10: REVIEW_PUBLICATION not documented in post-review-summary').toContain('REVIEW_PUBLICATION');
    expect(sec, 'D10: `off` → SKIPPED resolution step not present').toContain('`off` → report');
    expect(sec, 'D10: `full` → mode FULL resolution step not present').toContain('`full` → mode FULL, skip probe');
    expect(sec, 'D10: `auto` → probe resolution step not present').toContain('`auto` or absent/unrecognised → probe');
  });

  it('D10: publication output enum line is present in git.md', () => {
    expect(
      content,
      'D10: missing publication output enum line — removing it breaks the caller\'s ability to parse publication status',
    ).toContain('**Publication**: FULL (private repo) | FULL (config override) | STUB (public repository) | OFF (publication disabled by config)');
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
      const sec = extractOpSection(soleCorpus, op, 'sole');
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
    // Sink corpus = git.md ∪ dist/skills/git/references/*.md (ENOENT-tolerant on dist).
    // Mode 'union' — a posting op's D11 reference may live in a moved mechanics file
    // (Phase 2+); unioning ensures the floor never silently drops below 8 [DR-18, AC-0.8].
    const sinkCorpus = gitAgentSinkCorpus();
    const opNames = (content.match(/## Operation: (\S+)/g) ?? []).map(m => m.replace('## Operation: ', ''));

    const postingOps: string[] = [];
    const postingOpsWithoutD11: string[] = [];

    for (const op of opNames) {
      const sec = extractOpSection(sinkCorpus, op, 'union');
      if (sec.includes('--body-file') || sec.includes('-F body=@')) {
        postingOps.push(op);
        if (!sec.includes('Comment-sink scrub (D11)')) postingOpsWithoutD11.push(op);
      }
    }

    expect(
      postingOps.length,
      `D11 forward guard: expected ≥ 8 posting ops, found ${postingOps.length}: [${postingOps.join(', ')}]`,
    ).toBeGreaterThanOrEqual(8);
    expect(
      postingOpsWithoutD11,
      `D11 forward guard: posting ops missing Comment-sink scrub (D11) named reference: [${postingOpsWithoutD11.join(', ')}]`,
    ).toHaveLength(0);
  });

  it('D11: every op that references the Comment-sink scrub also has a posting call (reverse guard)', () => {
    // Ensures the named reference is never orphaned — every D11 reference must pair with an actual posting.
    // Sink corpus = git.md ∪ dist/skills/git/references/*.md (ENOENT-tolerant on dist).
    // Mode 'union' — same rationale as forward guard [DR-18].
    const sinkCorpus = gitAgentSinkCorpus();
    const opNames = (content.match(/## Operation: (\S+)/g) ?? []).map(m => m.replace('## Operation: ', ''));
    expect(
      opNames.length,
      `reverse guard is vacuous: found ${opNames.length} ops (expected > 0)`,
    ).toBeGreaterThan(0);

    const d11OpsWithoutPost: string[] = [];
    for (const op of opNames) {
      const sec = extractOpSection(sinkCorpus, op, 'union');
      if (sec.includes('Comment-sink scrub (D11)')) {
        if (!sec.includes('--body-file') && !sec.includes('-F body=@') && !sec.includes('--notes-file')) {
          d11OpsWithoutPost.push(op);
        }
      }
    }
    expect(
      d11OpsWithoutPost,
      `D11 reverse guard: ops referencing Comment-sink scrub without a posting call: [${d11OpsWithoutPost.join(', ')}]`,
    ).toHaveLength(0);
  });

  it('D11: no gh call passes a body inline — every body reaches GitHub through a scrubbed file (bypass guard)', () => {
    // The forward guard above only inspects ops that ALREADY use --body-file, so it is
    // blind to a bypass: `gh pr create --body "…"` posts an unscrubbed body and would
    // never be visited. This guard is the reverse check — it fails on any inline body
    // form anywhere in the sink corpus, which is exactly how a new sink escapes D11 (PF-023).
    // Sink corpus = git.md ∪ dist/skills/git/references/*.md (ENOENT-tolerant on dist) [AC-0.8].
    const sinkCorpus = gitAgentSinkCorpus();
    const sinkContent = sinkCorpus.map(e => e.content).join('\n');
    const INLINE_BODY_RE = /gh (?:pr|issue) [a-z-]+[^`\n]*--body[ "]|-f body=/g;
    const offenders = sinkContent.match(INLINE_BODY_RE) ?? [];
    expect(
      offenders,
      `D11 bypass: inline body form(s) found — route the body through the scrubber and post with --body-file / -F body=@: ${offenders.join(' | ')}`,
    ).toHaveLength(0);

    // Non-vacuous: the pattern must actually match the shape it is guarding against.
    expect(
      'gh pr create --title "x" --body "unscrubbed"'.match(INLINE_BODY_RE),
      'bypass guard regex no longer matches a known-bad inline body form — the guard is inert',
    ).not.toBeNull();
  });

  it('D11: ensure-pr-ready scrubs the PR body it creates (gh pr create is a publication sink)', () => {
    const sec = extractOpSection(soleCorpus, 'ensure-pr-ready', 'sole');
    // extractOpSection throws when the anchor is absent — sec.length is always > 0 here (not a guard).
    expect(
      sec,
      'ensure-pr-ready: gh pr create must post --body-file "$DEVFLOW_BODY" — a PR body is published at repo visibility like any comment',
    ).toContain('gh pr create … --body-file "$DEVFLOW_BODY"');
    expect(
      sec,
      'ensure-pr-ready: PR creation must reference the Comment-sink scrub (D11)',
    ).toContain('Comment-sink scrub (D11)');
  });

  it('D11: erasure guidance — rotation (/rotat/i) and edit-history retention are documented', () => {
    expect(content, 'D11: rotation guidance (/rotat/i) missing — a found live secret requires rotation, not just deletion').toMatch(/rotat/i);
    expect(content, 'D11: "edit history" retention note missing — GitHub retains edit history; deletion is not remediation').toContain('edit history');
  });

  // ── Guard 8: D9 caller guard (AC-0.5) ──────────────────────────────────────

  it('D9: resolve.mds and dist/commands/resolve.md carry the D9 rule literal from git.md (AC-0.5)', () => {
    // The seam test deliberately ignores D9: lines (DECISION_ANNOTATION_KEYS), so this
    // guard is the only cross-file pin for the D9 caller-contract.
    // Authoritative source: resolve-review-threads op section ~git.md:681 (NOT the
    // operations-table row near line 96, which has different casing and backtick-quoted terms).
    const sec = extractOpSection(soleCorpus, 'resolve-review-threads', 'sole');
    // Unique fragment: line 681 uses 'ONLY' (uppercase) and 'verdict == FIXED' (with ==),
    // whereas line 96 uses 'only' (lowercase) and 'verdict `FIXED`' (backtick-quoted, no ==).
    const D9_RULE_FRAGMENT = 'ONLY when VERIFICATION_STATUS == PASS AND verdict == FIXED AND commit_sha non-empty';
    expect(
      sec,
      'git.md resolve-review-threads section must contain the authoritative D9 rule fragment',
    ).toContain(D9_RULE_FRAGMENT);
    // RED proof: any string lacking this exact fragment would fail the assertions below.
    const resolveMds = loadFile('src/assets/commands/resolve.mds');
    expect(
      resolveMds,
      'resolve.mds must carry the D9 rule fragment from git.md (seam test ignores D9: lines)',
    ).toContain(D9_RULE_FRAGMENT);
    const resolveDist = requireDistFile('resolve.md');
    expect(
      resolveDist,
      'dist/commands/resolve.md must carry the D9 rule fragment from git.md',
    ).toContain(D9_RULE_FRAGMENT);
  });

  // ── Guard 9: D4 degradation clauses (AC-0.6) ───────────────────────────────

  it('manage-debt: **Degradation (D4):** clause and (pending — TRACEABILITY: DEGRADED site present (AC-0.6a)', () => {
    const sec = extractOpSection(soleCorpus, 'manage-debt', 'sole');
    expect(
      sec,
      'manage-debt: **Degradation (D4):** clause missing — every remote op must degrade gracefully',
    ).toContain('**Degradation (D4):**');
    expect(
      sec,
      'manage-debt: (pending — TRACEABILITY: DEGRADED site missing — caller must see the degraded state',
    ).toContain('(pending — TRACEABILITY: DEGRADED');
  });

  it('every REQUIRED_OP with remote I/O carries **Degradation (D4):** (AC-0.6b)', () => {
    // "Does remote I/O": the op set is derived from REQUIRED_OPS, but the 12 remote-I/O
    // indicators below are an explicit list (not derived from op text).
    // D4 scope: all ops that call gh CLI or a remote tracker (posting, mutation, or read-only fetch).
    // G1 added D4 to fetch-issue (~:268) and fetch-issues-batch (~:314) — both fetch remotely via gh.
    const remoteOps: string[] = [];
    const missingD4: string[] = [];
    for (const op of REQUIRED_OPS) {
      const sec = extractOpSection(soleCorpus, op, 'sole');
      // Remote I/O indicators: body-file posting, git push, explicit gh subcommands
      // that write state, plus read-only API calls (gh api, gh issue view/list, GraphQL,
      // and backtick-quoted `gh` which appears in D4 lines of fetch-issue/fetch-issues-batch).
      const doesRemoteIO =
        sec.includes('--body-file') ||
        sec.includes('-F body=@') ||
        sec.includes('git push') ||
        sec.includes('gh pr merge') ||
        sec.includes('gh pr comment') ||
        sec.includes('gh issue comment') ||
        sec.includes('gh release create') ||
        sec.includes('gh pr review') ||
        sec.includes('gh api') ||
        sec.includes('gh issue view') ||
        sec.includes('gh issue list') ||
        /graphql/i.test(sec) ||
        sec.includes('`gh`');
      if (!doesRemoteIO) continue;
      // D4 evidence: either the formal `**Degradation (D4):**` label or an inline
      // TRACEABILITY: DEGRADED site (ops that carry the degradation concept but use
      // the inline form rather than a separate labelled clause — e.g. setup-task,
      // create-release in git.md@5fc76aa).
      const hasD4Evidence = sec.includes('**Degradation (D4):**') || sec.includes('TRACEABILITY: DEGRADED');
      remoteOps.push(op);
      if (!hasD4Evidence) missingD4.push(op);
    }
    // Non-vacuity: fetch-issue and fetch-issues-batch must be detected as remote-I/O.
    expect(
      remoteOps,
      'non-vacuity: fetch-issue must be detected as remote-I/O (backtick-quoted `gh` in its D4 line)',
    ).toContain('fetch-issue');
    expect(
      remoteOps,
      'non-vacuity: fetch-issues-batch must be detected as remote-I/O (gh api graphql in Process)',
    ).toContain('fetch-issues-batch');
    expect(
      remoteOps.length,
      'no REQUIRED_OPS detected as remote-I/O — guard is vacuous (PF-018)',
    ).toBeGreaterThan(0);
    expect(
      missingD4,
      `REQUIRED_OPS with remote I/O missing **Degradation (D4):** clause: [${missingD4.join(', ')}]`,
    ).toHaveLength(0);
  });

  it('resolve.mds and dist/commands/resolve.md have 4 (pending sites each naming DEGRADED on the same line (AC-0.6c)', () => {
    // The four sites in resolve.mds (lines 244, 354, 501, 541) all mention TRACEABILITY: DEGRADED
    // on the same line — either directly or as the "or" alternative. AC-0.6 pins the count at 4.
    // If A1 reports 5 sites, assert the true number and note the AC says 4.
    function pendingLines(content: string): string[] {
      return content.split('\n').filter(l => l.includes('(pending'));
    }
    function linesWithoutDegraded(lines: string[]): string[] {
      return lines.filter(l => !l.includes('DEGRADED'));
    }
    const resolveMds = loadFile('src/assets/commands/resolve.mds');
    const mdsLines = pendingLines(resolveMds);
    expect(mdsLines.length, 'resolve.mds: expected 4 (pending sites (AC-0.6)').toBe(4);
    expect(
      linesWithoutDegraded(mdsLines),
      'resolve.mds: every (pending line must name DEGRADED on the same line',
    ).toHaveLength(0);
    const resolveDist = requireDistFile('resolve.md');
    const distLines = pendingLines(resolveDist);
    expect(distLines.length, 'dist/commands/resolve.md: expected 4 (pending sites (AC-0.6)').toBe(4);
    expect(
      linesWithoutDegraded(distLines),
      'dist/commands/resolve.md: every (pending line must name DEGRADED on the same line',
    ).toHaveLength(0);
  });

  // ── Guard 10: Containment guard (AC-0.10) ──────────────────────────────────
  // AC-0.10 mechanisation record (P0-S11): "every op Output block rendering a remote-sourced field"
  // is split into two independent assertions — one per containment class (Principle 8):
  //
  //   (a) <untrusted-issue-body>: setup-task, fetch-issue, fetch-issues-batch wrap issue bodies.
  //       Non-vacuity proof: on main, <untrusted-issue-body> appears ZERO times → floor 3 fails.
  //       The prior combined predicate (<untrusted-issue-body> OR <external-thread>) scored 3 on
  //       main from the pre-existing <external-thread> ops, making the issue-body detection vacuous.
  //
  //   (b) <external-thread>: fetch-review-threads, post-resolution-summary, post-wave-report.
  //       Pre-existing on main (stabilisation assertion, named-set ensures no silent op drift).
  //
  // FILE-SCOPED: extractOpSectionFromCorpus ends a section at the next \n## , which truncates
  // ops whose Output template contains ## headings (e.g. fetch-issues-batch). Per-op slicing over
  // the full file avoids truncation (AC-0.3 uses the same approach at tests/git-agent.test.ts:~161).

  it('containment (AC-0.10): ops rendering remote-sourced fields wrap them in containment tags (file-scoped)', () => {
    const opNames = (content.match(/## Operation: (\S+)/g) ?? []).map(m => m.replace('## Operation: ', ''));

    // ── (a) Issue-body containment ────────────────────────────────────────────
    // Predicate: <untrusted-issue-body> ONLY.
    // Named set: ensures an unrelated op cannot satisfy the floor by accident.
    // Non-vacuity: on main's git.md, 0 ops have <untrusted-issue-body> → the floor-3 assertion below FAILS.
    const EXPECTED_ISSUE_BODY_OPS = ['setup-task', 'fetch-issue', 'fetch-issues-batch'];
    const opsWithUntrustedIssueBody = opNames.filter(op => {
      const opStart = content.indexOf(`## Operation: ${op}`);
      const nextOp = content.indexOf('\n## Operation: ', opStart + 1);
      const slice = nextOp === -1 ? content.slice(opStart) : content.slice(opStart, nextOp);
      return slice.includes('<untrusted-issue-body>');
    });
    for (const expectedOp of EXPECTED_ISSUE_BODY_OPS) {
      expect(
        opsWithUntrustedIssueBody,
        `containment (issue-body): expected '${expectedOp}' to wrap issue content in <untrusted-issue-body>`,
      ).toContain(expectedOp);
    }
    expect(
      opsWithUntrustedIssueBody.length,
      `containment (issue-body): expected >= 3 ops with <untrusted-issue-body>; found [${opsWithUntrustedIssueBody.join(', ')}]`,
    ).toBeGreaterThanOrEqual(3);

    // ── (b) External-thread containment ──────────────────────────────────────
    // Predicate: <external-thread> ONLY.
    // Named set: stabilises the set; any silent removal of an expected op is loud.
    // These three ops pre-existed on main; the assertion existed there too — its non-vacuity
    // is proved by the named-set: removing <external-thread> from any listed op fails toContain.
    const EXPECTED_EXTERNAL_THREAD_OPS = ['fetch-review-threads', 'post-resolution-summary', 'post-wave-report'];
    const opsWithExternalThread = opNames.filter(op => {
      const opStart = content.indexOf(`## Operation: ${op}`);
      const nextOp = content.indexOf('\n## Operation: ', opStart + 1);
      const slice = nextOp === -1 ? content.slice(opStart) : content.slice(opStart, nextOp);
      return slice.includes('<external-thread>');
    });
    for (const expectedOp of EXPECTED_EXTERNAL_THREAD_OPS) {
      expect(
        opsWithExternalThread,
        `containment (external-thread): expected '${expectedOp}' to carry <external-thread> in its section`,
      ).toContain(expectedOp);
    }
    expect(
      opsWithExternalThread.length,
      `containment (external-thread): expected >= 3 ops with <external-thread>; found [${opsWithExternalThread.join(', ')}]`,
    ).toBeGreaterThanOrEqual(3);

    // Negative arm: summary/reply ops must not interpolate remote body placeholders.
    const SUMMARY_OPS = ['post-review-summary', 'post-resolution-summary', 'post-wave-report'];
    for (const op of SUMMARY_OPS) {
      const opStart = content.indexOf(`## Operation: ${op}`);
      const nextOp = content.indexOf('\n## Operation: ', opStart + 1);
      const slice = nextOp === -1 ? content.slice(opStart) : content.slice(opStart, nextOp);
      // {body} / {description} / {title} as MDS template placeholders (curly-brace form)
      // would echo remote origin content verbatim. Shell vars ($DEVFLOW_BODY) are safe.
      expect(
        /\{body\}|\{description\}|\{title\}/.test(slice),
        `${op}: must not interpolate remote body fields ({body}/{description}/{title}) in its Output template`,
      ).toBe(false);
    }
  });

  // ── Guard 11: D11 matchCount + known-bad probe (M9, AC-0.8) ────────────────

  it('D11: extractOpSectionFromCorpus matchCount is surfaced for union calls (non-vacuous, AC-0.8)', () => {
    // The extractOpSection wrapper in this file discards matchCount — this test calls
    // extractOpSectionFromCorpus directly to assert the matchCount contract [DR-18].
    // Exact expectation: count how many sink-corpus files contain the anchor independently,
    // then assert matchCount equals that count (exact count, not an unfalsifiable >= 1).
    const sinkCorpus = gitAgentSinkCorpus();
    const expectedMatchCount = sinkCorpus.filter(
      e => e.content.includes('## Operation: post-review-summary'),
    ).length;
    expect(
      expectedMatchCount,
      'expected matchCount must be > 0 — otherwise the union guard would be vacuous (PF-018)',
    ).toBeGreaterThan(0);
    const { content: sec, matchCount } = extractOpSectionFromCorpus(
      sinkCorpus, 'post-review-summary', { mode: 'union' },
    );
    expect(
      matchCount,
      `union matchCount for post-review-summary must be exactly ${expectedMatchCount} — computed independently from the corpus`,
    ).toBe(expectedMatchCount);
    expect(sec.length, 'union result content must be non-empty').toBeGreaterThan(0);
  });

  it('D11: forward guard rejects a posting op without Comment-sink scrub reference (known-bad, AC-0.8)', () => {
    // Known-bad synthetic corpus: a posting op (--body-file) with no D11 reference.
    // Calls extractOpSectionFromCorpus (the real collection path) — not an inline re-implementation.
    const syntheticOp = 'post-fake-summary';
    const syntheticContent =
      `## Operation: ${syntheticOp}\n` +
      `**Process:**\ngh pr comment 1 --body-file "$DEVFLOW_BODY"\n`;
    const syntheticCorpus = [{ path: '/fake/git.md', content: syntheticContent }];
    const { content: sec } = extractOpSectionFromCorpus(syntheticCorpus, syntheticOp, { mode: 'union' });
    // Verify the detection logic: posting present, D11 absent — the forward guard would flag this.
    expect(sec.includes('--body-file') || sec.includes('-F body=@'), 'posting must be detected').toBe(true);
    expect(sec.includes('Comment-sink scrub (D11)'), 'D11 reference must be absent in the known-bad').toBe(false);
  });

  // ── Guard 12: Conventions-commit placement and batch NOT_FOUND rule (PF-030, PF-058) ──
  //
  // Pins the contracts introduced in commit ae62d0a:
  //   (a) setup-task step 4b commits .devflow/conventions.md on the feature branch,
  //       immediately after git checkout -b — so the commit never lands on BASE_BRANCH.
  //   (b) learn-conventions is a commit boundary only — no commit --only inside it.
  //   (c) fetch-issues-batch drops (not aborts on) null GraphQL aliases → NOT_FOUND ({refs}).
  //   (d) fetch-issue and fetch-issues-batch both strip a leading # from their ref inputs.
  //
  // Named collector + known-bad probe (H10, PF-043): proves detection is live.

  it('conventions-commit placement and batch NOT_FOUND rule: live corpus has no violations', () => {
    const violations = collectConventionsCommitPlacementViolations(gitAgentSinkCorpus());
    expect(
      violations,
      `conventions-commit placement: live guard found violations:\n${violations.map(v => `  • ${v}`).join('\n')}`,
    ).toEqual([]);
  });

  it('conventions-commit placement: known-bad synthetic corpus triggers violations (H10, PF-043)', () => {
    // PF-043: synthetic corpus built from real git.md content (copy + targeted mutation),
    // never hand-authored. PF-018: calls the same named collector as the live guard.
    //
    // Mutation 1: remove setup-task's 4b step block.
    //   Search from the setup-task marker so ensure-pr-ready's unrelated 4b. (git.md:~113)
    //   is not mistakenly targeted.
    // Mutation 2: replace learn-conventions' **Commit boundary:** one-liner with an old-style
    //   **Commit (non-blocking):** block containing commit --only, reproducing the pre-ae62d0a shape.
    const realContent = resolveAgentSource('git').content;

    // Mutation 1: delete the 4b block from setup-task.
    const setupTaskMarker = '## Operation: setup-task';
    const setupTaskStart = realContent.indexOf(setupTaskMarker);
    if (setupTaskStart === -1) throw new Error('probe: ## Operation: setup-task not found in git.md');
    const step4bStart = realContent.indexOf('\n4b. ', setupTaskStart);
    const step5Start = realContent.indexOf('\n5. Return setup summary', step4bStart);
    if (step4bStart === -1 || step5Start === -1) {
      throw new Error('probe: could not locate 4b./5. boundaries in setup-task for mutation');
    }
    let mutated = realContent.slice(0, step4bStart) + realContent.slice(step5Start);

    // Mutation 2: replace the **Commit boundary:** one-liner with an old-style block.
    const commitBoundaryAnchor = '\n**Commit boundary:**';
    const cbIdx = mutated.indexOf(commitBoundaryAnchor);
    if (cbIdx === -1) throw new Error('probe: "**Commit boundary:**" not found after mutation 1');
    const cbLineEnd = mutated.indexOf('\n', cbIdx + 1);
    const oldStyleBlock =
      '\n**Commit (non-blocking):** Run only if learn-conventions returned `**Status**: WRITTEN`.\n' +
      '```bash\n' +
      'git commit --only -- .devflow/conventions.md -m "docs(devflow): record project conventions"\n' +
      '```\n';
    mutated =
      mutated.slice(0, cbIdx) +
      oldStyleBlock +
      (cbLineEnd === -1 ? '' : mutated.slice(cbLineEnd));

    const syntheticCorpus: CorpusEntry[] = [{ path: '/synthetic/git.md', content: mutated }];
    const violations = collectConventionsCommitPlacementViolations(syntheticCorpus);

    expect(
      violations.length,
      `probe must detect >= 2 violations on the known-bad corpus; got: ${JSON.stringify(violations)}`,
    ).toBeGreaterThan(1);
    expect(
      violations.some(v => v.startsWith('setup-task:')),
      `probe must name 'setup-task' in at least one violation; got: ${JSON.stringify(violations)}`,
    ).toBe(true);
    expect(
      violations.some(v => v.startsWith('learn-conventions:')),
      `probe must name 'learn-conventions' in at least one violation; got: ${JSON.stringify(violations)}`,
    ).toBe(true);
  });
});
