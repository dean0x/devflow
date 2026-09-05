---
feature: resolve-pipeline
name: Resolve Pipeline (Triage → Fix → Verify)
description: "Use when modifying /resolve or /code-review convergence logic, adding or changing Triage disposition rules (including DUPLICATE collapsing), adjusting Code-agent operating modes (issue-fix/validation-fix), touching the resolution-summary.md parser contract, changing the Verification Gate retry loop, understanding how DIFF_FILES flows from git validate-branch into blast-radius triage, or working on traceability operations (fetch-review-threads, resolve-review-threads, post-resolution-summary, check-merge-readiness, THREAD_MAP). Keywords: resolve, triage, disposition matrix, blast-radius, FIX_NOW, FIX_SEPARATE, TECH_DEBT, FALSE_POSITIVE, BY_DESIGN, ESCALATED, DUPLICATE, duplicate-grouping, duplicates-collapse, duplicate_of, resolution-summary, convergence parser, DIFF_FILES, issue-fix, validation-fix, Verification Gate, manage-debt, COMPLIANCE_SKILL_INSTALLED, TRACEABILITY DEGRADED, fetch-review-threads, THREAD_MAP, post-resolution-summary, Third-Party Threads, check-merge-readiness, ext-N, D7, D9, PF-024."
category: architecture
directories: [src/assets/commands/resolve.mds, src/assets/agents/triage.md, src/assets/agents/code.md, src/core/plugins.ts, src/assets/commands/code-review.mds]
created: 2026-07-08
updated: 2026-08-28
---

# Resolve Pipeline (Triage → Fix → Verify)

## Overview

`/resolve` implements "no agent grades its own homework": a dedicated Triage agent (opus) classifies every review issue independently before Code agents touch any code. The key architectural insight is **separation of judgment from execution** — the Triage agent assigns verdicts using blast-radius scope, the Code agent fixes only what it is told to fix with `OPERATION: issue-fix`, and a Validate agent (haiku) independently verifies correctness before any commit reaches remote.

PR #288 added a traceability layer: compliance-gated phases (1b, 9b-1, 9c) fetch external review threads, resolve them post-push, and check merge readiness. Phase 9b-2 posts a resolution comment to the PR unconditionally when a PR is known — regardless of compliance installation.

PR #307 added a seventh verdict bucket — **DUPLICATE** — and a pre-pass that collapses same-defect issues before the blast-radius matrix runs. This de-skews the `fp_ratio` convergence formula and eliminates duplicate debt tickets without any change to the code-review.mds parser.

The pipeline was restructured in PR #253 to replace the former single `Resolver` agent (which both judged and fixed) with the Triage + Code-agent-as-fixer split. The retired `resolver` agent file is removed from installs by the registry-diff orphan sweep on `devflow init`.

## System Context

`/resolve` is a multi-phase orchestration command. It consumes review artifacts produced by `/code-review` or `/bug-analysis`, and its output (`resolution-summary.md`) feeds back into `/code-review`'s convergence parser on subsequent review cycles. Both directions of this coupling have byte-stable format contracts.

Agents in the pipeline:

| Agent | Model | Role |
|-------|-------|------|
| Git | haiku | validate-branch, fetch-review-threads, resolve-review-threads, post-review-summary, post-resolution-summary, check-merge-readiness, manage-debt, check-ci-status |
| Triage | **opus** | blast-radius judgment — never edits code |
| Code | sonnet | issue-fix, validation-fix, alignment-fix, qa-fix modes |
| Simplify | sonnet | refine changed code after fixes |
| Validate | **haiku** | build/typecheck/lint/test gate |

Plugin registry (`DEVFLOW_PLUGINS` in `plugins.ts`) and its tests (`tests/registry-integrity.test.ts`) must stay consistent: `agents: [git, triage, code, simplify, validate]`.

## Component Architecture

### Phase Sequence

```
Phase 0   Worktree Discovery & Pre-Flight
  Step 0a  git worktree list → filter resolvable
  Step 0b  Git agent (validate-branch) per worktree [parallel] ← DIFF_FILES
  Step 0c  Target latest review directory per worktree
  Step 0d  Load DECISIONS_CONTEXT + FEATURE_KNOWLEDGE
           Resolve COMPLIANCE_SKILL_INSTALLED via compliance_gate() — plain boolean
           (true/false, never "(none)"). One file-existence check, reused for all phases.
Phase 1   Orchestrator parses issues → ISSUES (with reviewer_confidence %)
Phase 1b  Git agent (fetch-review-threads) → THREAD_MAP  [compliance-gated]
Phase 2   Single global Triage agent → verdict ledger (one verdict per issue, none vanish)
          Duplicate pre-pass fires FIRST; matrix runs on group primaries only.
          DUPLICATE is a valid bucket; missing duplicate_of or a chained DUPLICATE = Triage failure.
Phase 3   Batch FIX_NOW issues → BATCHES (same-file sequential, distinct-file parallel, max 5/batch)
          DUPLICATE issues are NEVER dispatched — they inherit the primary's outcome.
Phase 4   Code × N (OPERATION: issue-fix, PUSH: false) → CODE_AGENT_RESULTS
Phase 5   Write resolution-summary.md ← compaction safety; Tracked = "(pending)"
          Includes new additive Statistics row "| Duplicates Collapsed | {n} |"
          and new additive section "## Duplicates". DUPLICATE issues appear ONLY in ## Duplicates.
Phase 6   Simplify (only if fixes were made)
Phase 7   Validate gate (haiku) + Code validation-fix loop ≤ 2 + SINGLE push
Phase 8   CI Status Gate (conditional — skipped if no fixes or Phase 7 FAILED)
Phase 9   manage-debt (FIX_SEPARATE + TECH_DEBT → backfill Tracked = #N)  [SEQUENTIAL]
          DUPLICATE issues NEVER create their own debt tickets — covered by the primary's ticket.
Phase 9b  Thread Resolution + Resolution Comment
  Step 9b-1  Git agent (resolve-review-threads)  [compliance-gated; D9 gate applies]
             ext-{N} matching a DUPLICATE → use primary's verdict/verification status (caller-side mapping)
  Step 9b-2  Git agent (post-resolution-summary)  [ALWAYS-ON when PR known]
Phase 9c  Git agent (check-merge-readiness)  [compliance-gated, report-only]
Phase 10  Display results
```

**Phase 5 write-early rationale**: `resolution-summary.md` is written immediately after Phase 4 while all Code agent outputs are still in context. Later phases (Simplify, Validate, CI gate, manage-debt, thread resolution) can all trigger context compaction. Writing early avoids losing the record. `Tracked` cells are initially `(pending)` and backfilled after Phase 9.

**Phase 7 push timing**: The single `git push` fires at the END of Phase 7, whether the gate PASSED or FAILED. This ensures the branch is always visible on remote before CI, debt management, or thread resolution runs. Code agents (Phase 4) and validation-fix Code agents (Phase 7 loop) both receive `PUSH: false`; the orchestrator owns the push.

**Compliance gate** (`compliance_gate()` partial from `_partials/_compliance.mds`): Sets `COMPLIANCE_SKILL_INSTALLED = true` if `~/.claude/skills/devflow:compliance/SKILL.md` exists, `false` otherwise — plain boolean, never `(none)`. When `COMPLIANCE_SKILL_INSTALLED` is false, phases 1b, 9b-1, and 9c are skipped; Phase 9b-2 (post-resolution-summary) still runs if a PR is known.

### DIFF_FILES Flow

Git agent's `validate-branch` operation emits a `### Diff Scope` block containing newline-separated filenames from `git diff {base}...HEAD --name-only`. The orchestrator extracts this into `DIFF_FILES` and passes it to the Triage agent. If the block is absent (bug-analysis edge case), `DIFF_FILES` is set to empty string `""`.

`DIFF_FILES` is not a flag — it's the primary input that drives the FIX_NOW vs FIX_SEPARATE boundary in the Triage agent's blast-radius matrix.

### Traceability Layer (Compliance-Gated)

`COMPLIANCE_SKILL_INSTALLED` is resolved once per run in Step 0d via the `compliance_gate()` partial — a single file-existence read, no subprocess. The result is reused across all phases that gate on it.

**Phase 1b — fetch-review-threads**: Before Triage, the Git agent fetches unresolved external (non-devflow-authored) review threads from the PR via `OPERATION: fetch-review-threads`. Returns a `THREAD_MAP` of `ext-{N}` records (one per external thread). If `TRACEABILITY: DEGRADED` → record reason, set `THREAD_MAP = empty`, continue.

**Phase 9b-1 — resolve-review-threads** (compliance-gated, runs after Phase 9 backfill): Prepares THREAD_MAP with verdicts from Triage/Code results by matching `ext-{N}` to issues by file:line correlation. Unmatched threads default to ESCALATED (human review required). Then spawns Git agent with `OPERATION: resolve-review-threads`.

**DUPLICATE in THREAD_MAP**: If a matched issue has verdict DUPLICATE, the orchestrator uses the **primary's** verdict and verification status for the thread reply — the DUPLICATE verdict is never exposed to the thread author. This is a caller-side mapping; git.md contracts are unchanged (applies PF-024).

**D9 gate (single authority in git.md `## Operation: resolve-review-threads`):**
- `resolveReviewThread` mutation is called **ONLY when `VERIFICATION_STATUS == PASS` AND verdict `FIXED` AND `commit_sha` non-empty**
- `FALSE_POSITIVE` and `BY_DESIGN`: **reply-only** — devflow supplies cited evidence but does not call `resolveReviewThread`; the thread author closes their own thread
- `ESCALATED`, `FAILED`, and `SKIPPED` statuses: always reply-only

When VERIFICATION_STATUS is FAILED or SKIPPED, the agent replies to every thread without resolving any. If `TRACEABILITY: DEGRADED` → warn, record in `## Third-Party Threads`, continue to 9b-2.

**Phase 9b-2 — post-resolution-summary** (ALWAYS-ON): Spawns Git agent with `OPERATION: post-resolution-summary` whenever a PR is known, regardless of `COMPLIANCE_SKILL_INSTALLED`. Posts a consolidated PR comment with `<!-- devflow:resolution-summary ts:{TS} -->` marker — skipped if already posted. If `TRACEABILITY: DEGRADED` → warn, continue. Updates `## Third-Party Threads` section in resolution-summary.md.

**Phase 9c — check-merge-readiness** (compliance-gated, report-only): Spawns Git agent with `OPERATION: check-merge-readiness`. Returns READY / NOT_READY / DEGRADED / CI-pending as distinct states. Reported in Phase 10 output but **never blocks** the pipeline.

**TRACEABILITY: DEGRADED contract**: Any of no-PR, no-gh-auth, no-remote causes the Git agent to return `TRACEABILITY: DEGRADED ({reason})`. All traceability operations skip-and-continue on DEGRADED — they never fail the pipeline.

## Duplicate Grouping Pre-Pass

The pre-pass is a relation between issues that runs **before** the blast-radius matrix and selects which issues the matrix runs on. It is not a matrix row — it is a pre-filter.

**Algorithm** (from `triage.md`):

1. **Group by same defect**: cluster issues sharing the same root cause — typically the same or adjacent file:line reported by different review foci, or the same logical error in different phrasings.
2. **Select primary**: designate the most specific and complete report as primary. In a mixed security/non-security group, **the security member is always primary** — security findings are never collapsed into non-security primaries.
3. **Security gate propagates to the whole group**: if ANY member is a security finding, the group's primary passes through the Security Gate (→ FIX_NOW or ESCALATED only), regardless of how many non-security members are in the group.
4. **Non-primary members**: receive verdict **DUPLICATE** with `duplicate_of: <primary-id>`. The `duplicate_of` reference must point to a **non-DUPLICATE** issue — chaining is prohibited (makes outcome inheritance unresolvable).
5. **Single-member groups**: each issue is its own primary; the matrix runs directly on it.
6. **Inheritance**: a DUPLICATE inherits its primary's final outcome (FIX_NOW → fixed by the Code agents that fix the primary; FALSE_POSITIVE → excluded from False Positives section/count; etc.).

**Ledger output** (triage.md `### DUPLICATE` bucket):
```
### DUPLICATE
| Issue ID | Duplicate Of | File:Line | Reason |
|----------|-------------|-----------|--------|
| {id} | {primary-id} | {file}:{line} | {same defect as {primary-id}, reported by {focus}} |
```

Summary tally gains `- DUPLICATE: {n}`.

## Triage Blast-Radius Disposition Matrix

**First-match-wins. Apply in exact order. Matrix runs on group primaries only (after the pre-pass).**

| Priority | Verdict | Condition | Evidence Required |
|----------|---------|-----------|-------------------|
| 0 | SECURITY GATE | Any security finding | Overrides everything; → FIX_NOW or ESCALATED only |
| 1 | FALSE_POSITIVE | Review agent factually wrong | Cited grep/file:line proving the issue does not exist |
| 2 | BY_DESIGN | Code is intentional | Cited ADR or inline comment/doc |
| 3 | FIX_NOW | File in DIFF_FILES, OR isolated Standard fix, OR security/correctness in touched path | Risk tier: Standard or Careful |
| 4 | FIX_SEPARATE | Valid but exceeds diff blast radius | Must become tracked manage-debt ticket |
| 5 | TECH_DEBT | LAST RESORT — complete architectural overhaul only | Not "touches many files" or "changes public API" |

**ESCALATED**: Security issues that cannot be dismissed or deferred — surfaced in `## Escalations`, never routed to manage-debt. This is not a matrix position; it is the second branch of the Security Gate.

**DUPLICATE**: Assigned by the pre-pass to non-primary group members. Never a matrix output — the matrix never produces this verdict.

**Empty DIFF_FILES** (bug-analysis edge case): clause 3 degrades conservatively — Standard/isolated → FIX_NOW still applies, but the "file in DIFF_FILES" path is unavailable. Security gate is unaffected.

**Risk tiers for FIX_NOW:**
- **Standard**: null checks, validation, error handling, docs, type annotations, isolated security fixes — Code agent fixes directly
- **Careful**: public API, shared state, >3 files, core logic, multi-service interface, auth flow — Code agent uses understand → plan → test → implement → verify → commit protocol

## Code Agent Operating Modes

The Code agent has five modes selected by the `OPERATION` input:

| Mode | Who triggers | Key constraints |
|------|-------------|-----------------|
| `implement` (default) | /implement orchestrator | Full implementation with plan |
| `issue-fix` | /resolve orchestrator | Pre-classified issues only; PUSH: false; no re-litigating |
| `validation-fix` | /resolve Phase 7 gate and /implement Phase 3 | Fix validation failures only, no other changes; PUSH: false |
| `alignment-fix` | /implement Phase 7 Evaluate agent | Fix misalignments only, no other changes |
| `qa-fix` | /implement Phase 8 Test agent | Fix QA failures only, no other changes |

**issue-fix mode rules:**
- Receives pre-classified FIX_NOW issues — never re-litigates Triage dispositions
- DUPLICATE issues are never dispatched; they inherit the primary's outcome
- Same-file issues → one commit (never two Code agents editing the same file concurrently)
- Regression fix without a failing-then-passing regression test = INCOMPLETE → report BLOCKED, do not commit
- Returns: `{status, commitShas, unresolved}` + `## Verification` block

**Batching rule**: Same-file issues → one Code agent, sequential. Distinct-file issues → parallel Code agents. Maximum 5 issues per batch (generalized from the dynamic-build concurrency rule).

## Parser Coupling: resolution-summary.md ↔ /code-review

**This contract is UNCHANGED for the convergence parser.** The byte-stable format for the convergence parser has not been modified by the DUPLICATE addition. Do not alter labels, column order, or Statistics row names without updating the convergence parser in code-review.mds.

The `/code-review` convergence detection reads `resolution-summary.md` to compute `fp_ratio` for multi-cycle reviews.

**Byte-stable elements** (must not be renamed or restructured):

The Statistics table rows — these are the literal unpadded row labels the convergence parser matches:
```
| Fixed | {n} |
| False Positive | {n} |
| Deferred | {n} |
```

The section headings and their column layouts:
```
## Fixed Issues
| Issue | File:Line | Commit |

## False Positives
| Issue | File:Line | Reasoning |
```

**fp_ratio formula**: `fp_count / (fp_count + fixed_count + deferred_count)`
- `Deferred` row = FIX_SEPARATE + TECH_DEBT combined
- By Design and Escalated are **excluded from the denominator**
- DUPLICATE issues are **excluded from all three terms** — all Statistics rows that the parser reads count UNIQUE (non-DUPLICATE) issues only, so collapsed duplicates do not inflate fp_ratio
- fp_ratio > 0.7 AND CYCLE_NUMBER >= 3 → convergence warning emitted

**Counting semantics** (resolution-summary.md note):
- `Total Issues` counts every triaged issue **including** collapsed duplicates
- Every row **between** `Total Issues` and `Duplicates Collapsed` counts UNIQUE (non-DUPLICATE) issues only
- `Total Issues` therefore equals the sum of the rows below it

**Safe additions** (new elements that do not break the convergence parser):
- `## Escalations`, `## Blocked`, `## By Design`, `## Third-Party Threads` sections
- `| Duplicates Collapsed | {n} |` Statistics row (additive; code-review.mds parser unchanged)
- `## Duplicates` section with `| Issue | Duplicate Of | File:Line |` columns (additive)

**Unsafe changes**: Renaming `Fixed` → `Resolved`, splitting `Deferred` into two rows, changing `False Positive` to `False Positives`, restructuring the Statistics table format.

**Section exclusivity for DUPLICATE**: DUPLICATE issues appear **only** in `## Duplicates` — never in `## Fixed Issues`, `## False Positives`, `## By Design`, `## Fix Separately`, `## Deferred to Tech Debt`, `## Escalations`, or `## Blocked`. A duplicate of a FALSE_POSITIVE primary leaves only the primary in the `False Positive` Statistics row and `## False Positives` section; the duplicate appears in `## Duplicates` only. This is what keeps manage-debt from creating tickets for duplicates.

## Code-Review Phase 3: Sequential Synthesis + Comment

`/code-review` Phase 3 runs two steps **sequentially per worktree** (step 3b cannot start until step 3a completes):

**Step 3a — Synthesize agent**: Writes `review-summary.md` to the timestamped review directory. Must complete before 3b.

**Step 3b — Git agent (post-review-summary)**: Posts a consolidated PR comment after Synthesize completes. Uses `OPERATION: post-review-summary`.

**D7 dedup key — full cycle+timestamp pair**: The marker is `<!-- devflow:review-summary cycle:{N} ts:{REVIEW_TIMESTAMP} -->`. Dedup is keyed on the **pair**:
- A re-review within the same cycle (different REVIEW_TIMESTAMP) → posts its own comment
- A true re-run of the exact same review (same REVIEW_TIMESTAMP) → deduplicates silently

The caller spawn in code-review.mds passes `REVIEW_TIMESTAMP: {timestamp}` as an input — it does **not** restate the marker literal. The marker format is owned by and defined in the `post-review-summary` operation in git.md (avoids PF-024). `tests/build-mds.test.ts §15` asserts that the compiled code-review.md contains `REVIEW_TIMESTAMP` in the post-review-summary spawn.

**COMPLIANCE_SKILL_INSTALLED ordering in /code-review is load-bearing**: The compliance check happens at Step 0b, explicitly **before** Step 0c spawns the Git agent (`ensure-pr-ready`). The `COMPLIANCE` value is passed to the Git agent in that spawn. Resolving it later (e.g. during Phase 1) would leave the ensure-pr-ready agent without the traceability context it needs to configure PR conventions.

**comment-pr op retired**: The former `comment-pr` Git agent operation is no longer used. All PR commenting goes through `post-review-summary` (Phase 3b in /code-review) or `post-resolution-summary` (Phase 9b-2 in /resolve).

## plan.mds ensure-traceable-issue Guard

`/plan` Phase 14 spawns the Git agent with `OPERATION: ensure-traceable-issue` to create or enrich a GitHub issue for the plan. The spawn is **guarded**:
- When `COMPLIANCE_SKILL_INSTALLED` is **true**: issue linking is **mandatory** (DEGRADED states exempt with a warning in the final summary) — spawn proceeds unconditionally
- When `COMPLIANCE_SKILL_INSTALLED` is **false**: issue linking is optional — an `AskUserQuestion` prompt asks the user before the spawn; if the user declines, the spawn is skipped entirely

## Triage Agent Contract

The Triage agent (opus) is the sole judgment agent. Key constraints in `triage.md`:

- Skills preloaded in frontmatter: `devflow:security`, `devflow:worktree-support`, `devflow:apply-decisions`, `devflow:apply-feature-knowledge`
- **Never instructed to invoke skills via body text** (avoids PF-002 re-entrancy issue)
- Reads 30-line context around each reported file:line to verify issues
- **Runs the Duplicate Grouping Pre-Pass first** — groups same-defect issues, elects primaries (security member is always primary in mixed groups), then runs the matrix on primaries only
- For FALSE_POSITIVE: must provide grep output or file:line citation — opinion is not evidence
- For BY_DESIGN: must cite an ADR or inline comment/doc — gut feeling is not a citation
- For ESCALATED: security findings with ambiguous context go here rather than FALSE_POSITIVE
- For DUPLICATE: `duplicate_of` must reference a non-DUPLICATE issue — never chained
- Output is a verdict ledger grouped by disposition (7 buckets including DUPLICATE) with a Summary section

**Triage output is consumed by the orchestrator, not by Code agents.** The Triage agent never spawns sub-agents.

## Verification Gate (Phase 7)

The Validate agent (haiku) runs build + typecheck + lint + tests against `FILES_CHANGED` from Code agent outputs. On FAIL:

```
validation_retry_count = 0
FAIL → spawn Code agent (OPERATION: validation-fix, PUSH: false)
     → increment validation_retry_count
     → re-validate
     → if retry_count > 2: record FAILED in ## Verification; skip CI gate; proceed
```

Maximum 2 fix attempts. After 2 failures, the FAILED status is recorded in `resolution-summary.md` with a blocking callout — never silently passed.

The single `git push` runs after the Verification Gate regardless of PASS or FAIL outcome, so the branch is always visible on remote before Phase 9b thread resolution runs.

## Test Guards

The following test files provide static content guards that fail loudly when load-bearing literals are silently changed (avoids PF-018). Phase-0 added seven new files (`tests/seams/command-agent-input.test.ts`, `tests/goldens/git-agent-golden.test.ts`, `tests/goldens/github-status-lines.test.ts`, `tests/guards/agent-source-resolver.test.ts`, `tests/guards/retired-wording.test.ts`, `tests/guards/numeric-floor-manifest.test.ts`, `tests/guards/extended-references.test.ts`) alongside the four core guard files listed below:

**`tests/git-agent.test.ts`** (source-file guards, no build required):
- Guard 0: file non-vacuousness
- Guard 1: required operation sections (`## Operation: {name}`) exist for all 17 operations (15 original + `fetch-issue` and `fetch-issues-batch` added in Phase 0)
- Guard 2: numeric bounds — 60000-char caps for post-review-summary, post-resolution-summary, post-wave-report, and manage-debt; ≤50 threads bound for resolve-review-threads; ≤50 issues bound for backlink-shipped-issues and fetch-issues-batch; ≤2-page / 100-thread bound for fetch-review-threads; learn-conventions branch/tag/PR scan bounds
- Guard 3: D9 gate — pins the exact "ONLY when VERIFICATION_STATUS == PASS AND verdict == FIXED AND commit_sha non-empty" sentence; also pins FALSE_POSITIVE and BY_DESIGN as reply-only
- Guard 4: D4 rate-limit backpressure clauses (STOP trigger, THROTTLED report, `X-RateLimit-Remaining < 10` full-stop threshold, `< 50` backpressure threshold)
- Guard 5: Dedup marker formats — `devflow:review-summary cycle:{N} ts:` pair, `devflow:resolution-summary ts:`

**`tests/registry-integrity.test.ts` — Guard 6** (build-gated):
- **Forward check**: every `OPERATION: X` inside a Git-agent spawn block (`Agent(subagent_type="Git")`) in any compiled command must have a matching `## Operation: X` heading in git.md
- **Reverse check**: every `## Operation: X` in git.md must be referenced by name in at least one compiled command, OR appear in `INTERNAL_OPS`
- `INTERNAL_OPS` allowlist: `learn-conventions` only (invoked internally by setup-task, not from commands directly). `fetch-issues-batch` was removed from INTERNAL_OPS in Phase 0 — it is now wired live from `plan.mds` (AC-0.11, SG-11)
- Fail-loud: asserts `dist/commands/` exists before checking — a guard that silently skips on a missing build artifact is not a guard

**`tests/build-mds.test.ts §15`** (build-gated, Phase D traceability ops):
- Asserts that compiled `code-review.md` contains `post-review-summary` reference
- Asserts that compiled `code-review.md` passes `REVIEW_TIMESTAMP` to the post-review-summary spawn (I44 cycle+ts dedup) — the old guard that pinned the marker literal in the compiled command was dropped; callers pass inputs, operations own their output format (avoids PF-024)
- Every `beforeAll` block in §15 asserts the build exits 0 before the file-content checks run
- Every scan loop asserts `scanned > 0` to prevent vacuous passes

**`tests/build-mds.test.ts §16b`** (build-gated, DUPLICATE verdict guards — consumer side):
- Pins `DUPLICATE` as a named verdict bucket in compiled `resolve.md` (avoids PF-024 spawn↔op seam)
- Pins `duplicate_of` reference attribute in compiled `resolve.md` — the per-entry attribute Triage must supply for every DUPLICATE verdict
- Pins `| Duplicates Collapsed | ` Statistics row label — additive extension; existing parser labels unchanged
- Pins `## Duplicates` section heading in compiled `resolve.md` — additive, safe per ADR-006

**`tests/resolve/duplicate-verdict.test.ts`** (source-file guards — producer side):
- Guards the duplicate grouping pre-pass ordering: `## Duplicate Grouping Pre-Pass` must appear before `## Blast-Radius Disposition Matrix` in `triage.md`
- Guards chaining prohibition: pre-pass section must contain "must reference a non-DUPLICATE issue"
- Guards security-primary election: pre-pass section must contain "the security member is always the primary" and "Security Gate"
- Guards matrix scope: pre-pass section must contain "primary only"
- Guards DUPLICATE ledger bucket: `### DUPLICATE` heading and `Duplicate Of` column must appear in triage.md Output section
- Guards summary tally: `- DUPLICATE: {n}` must appear in triage.md Output section
- Guards two-sided PF-024 seam: both `triage.md` and `resolve.mds` must contain `DUPLICATE` and `duplicate_of`
- Guards section exclusivity: `resolve.mds` must contain "DUPLICATE issues are listed **only** in `## Duplicates`"

## Anti-Patterns

- **Routing ESCALATED issues to manage-debt**: Security escalations that require human review must appear in `## Escalations` with a display callout. manage-debt would bury them in a ticket backlog with no visibility.
- **Re-litigating Triage verdicts in Code agent**: The `issue-fix` mode receives pre-classified FIX_NOW issues. The Code agent does not assess whether the issues are real — it fixes what it is told.
- **Invoking skills in Triage agent via body instructions**: The Triage agent's skills are loaded via frontmatter. Adding `Skill(...)` calls in the Triage agent's body instructions causes re-entrancy (PF-002).
- **Using TECH_DEBT for "touches many files"**: TECH_DEBT is last resort for complete architectural overhauls only. Multi-file changes with clear blast radius → FIX_NOW/Careful or FIX_SEPARATE.
- **Pushing before Verification Gate**: Code agents run with `PUSH: false`. The orchestrator owns the single push in Phase 7. Pushing before validation means unvalidated commits can reach remote.
- **Writing resolution-summary.md late**: If written after Phase 6 or later, context compaction during Simplify/Validate can lose the result data. Phase 5 write-early is not optional.
- **Blocking on traceability operations**: Phases 1b, 9b-1, 9b-2, and 9c are all skip-and-continue on `TRACEABILITY: DEGRADED`. Never treat DEGRADED as a pipeline failure.
- **Caller spawn blocks restating marker literals**: Callers (resolve.mds, code-review.mds) pass operation inputs only — they do not restate the marker string that the operation writes internally. The operation owns what it writes (avoids PF-024).
- **Calling resolveReviewThread for FALSE_POSITIVE or BY_DESIGN**: D9 gate is FIXED-only. Thread authors close their own threads after seeing devflow's evidence reply.
- **Chaining duplicate_of references**: `duplicate_of` must reference a non-DUPLICATE issue. Chaining (DUPLICATE A → DUPLICATE B → primary C) makes outcome inheritance unresolvable and is treated as a Triage failure.
- **Listing DUPLICATE issues in outcome sections**: DUPLICATE issues belong exclusively in `## Duplicates`. Placing them in `## Fixed Issues`, `## False Positives`, or any other outcome section causes the Statistics rows and section bodies to disagree, and manage-debt would create spurious debt tickets.
- **Dispatching DUPLICATE issues to Code agents**: DUPLICATE issues inherit their primary's outcome. Only non-DUPLICATE FIX_NOW issues are batched and dispatched in Phase 3.
- **Exposing DUPLICATE verdict to thread authors in Phase 9b-1**: The DUPLICATE verdict must be mapped to the primary's verdict and verification status before the git.md operation is called. git.md contracts are unchanged — the mapping is caller-side.

## Gotchas

- **DIFF_FILES is an empty string, not absent**: When the `### Diff Scope` block is missing from Git agent output (bug-analysis edge case), `DIFF_FILES` is set to `""`, not omitted. The Triage matrix degrades accordingly — do not treat empty string as "all files in scope."

- **Verdict ledger completeness**: Every issue from Phase 1 must appear in the Triage agent output. The pipeline validates that no issue vanishes. DUPLICATE is a valid bucket — a DUPLICATE entry with a missing `duplicate_of`, or one whose `duplicate_of` references another DUPLICATE, is treated as a Triage failure (retry-then-abort, same as a vanished id).

- **resolution-summary.md is written multiple times**: Phase 5 writes the initial version with `Tracked = (pending)`. Phase 7 rewrites `## Verification`. Phase 9 backfills `Tracked` cells. Phase 9b updates `## Third-Party Threads`. Any phase that overwrites the file wholesale destroys Phase 5's compaction safety — always patch specific sections.

- **manage-debt runs sequentially across worktrees**: In multi-worktree mode, manage-debt cannot run in parallel — GitHub API conflicts arise when creating issues concurrently. Even though other phases (pre-flight, Code agent batches) run in parallel, Phase 9 is always sequential.

- **COMPLIANCE_SKILL_INSTALLED is a plain boolean**: `compliance_gate()` sets it to `true` or `false` — never `(none)`. Guard sites in resolve.mds and code-review.mds check `if COMPLIANCE_SKILL_INSTALLED is false`, not `if (none)`.

- **post-resolution-summary (9b-2) is ALWAYS-ON**: Unlike Phase 9b-1, step 9b-2 runs whenever a PR is known, regardless of `COMPLIANCE_SKILL_INSTALLED`. It posts the resolution summary comment to the PR with `<!-- devflow:resolution-summary ts:{TS} -->` dedup. Compliance installation gates only thread-resolution (9b-1) and merge-readiness (9c).

- **D7 dedup is cycle+timestamp, not cycle alone**: A same-cycle re-review (different timestamp) posts a new comment. Only an exact same-timestamp re-run deduplicates. The REVIEW_TIMESTAMP input to the post-review-summary spawn is load-bearing for this contract.

- **Unmatched ext-{N} records default to ESCALATED**: External review threads from Phase 1b that cannot be matched to a Triage verdict by file:line correlation are classified as ESCALATED in Phase 9b-1, not silently dropped.

- **DUPLICATE ext-{N} thread matching is caller-side**: When a thread matches a DUPLICATE issue, the orchestrator maps to the primary's verdict and verification status before calling the git.md operation. The mapping is transparent to git.md — its contracts are unchanged.

- **`--review {timestamp}` not supported in multi-worktree mode**: The `--review` flag only works in single-worktree flow.

- **Legacy flat layout**: If no timestamped subdirectories exist but flat `*.md` files are present in the branch review directory, the command reads them directly (backwards-compatible).

- **Bug-analysis fallback**: If all reviews are resolved (have `resolution-summary.md`), the command falls back to the latest unresolved bug-analysis directory. Reviews take priority.

## Key Files

- `src/assets/commands/resolve.mds` — MDS source for /resolve orchestration command (phases 0-10 + 1b, 9b, 9c); compiled to `dist/commands/`
- `src/assets/agents/triage.md` — Triage agent (opus): duplicate grouping pre-pass, blast-radius disposition matrix, evidence rules, verdict ledger format (7 buckets including DUPLICATE)
- `src/assets/agents/code.md` — Code agent: `issue-fix`, `validation-fix`, `alignment-fix`, `qa-fix` modes documented in Mode sections
- `src/assets/agents/git.md` — Git agent: all traceability operations (validate-branch, fetch-review-threads, resolve-review-threads, post-review-summary, post-resolution-summary, check-merge-readiness, manage-debt, check-ci-status); D7/D8/D9 decision markers defined here
- `src/assets/commands/_partials/_compliance.mds` — `compliance_gate()` partial: sets `COMPLIANCE_SKILL_INSTALLED` as plain boolean
- `src/core/plugins.ts` — DEVFLOW_PLUGINS entry for devflow-resolve: agents registry `[git, triage, code, simplify, validate, knowledge]`
- `src/assets/commands/code-review.mds` — Contains convergence parser (fp_ratio), Phase 3 sequential synthesis+comment pattern, Step 0b COMPLIANCE_SKILL_INSTALLED resolution, REVIEW_TIMESTAMP spawn input
- `tests/git-agent.test.ts` — Static content guards for git.md: ops, bounds, D9 gate, D4 rate-limit, dedup markers (PF-018)
- `tests/registry-integrity.test.ts` — Guard 6: forward+reverse OPERATION: ↔ ## Operation: contract with INTERNAL_OPS allowlist (build-gated)
- `tests/build-mds.test.ts` — §15: REVIEW_TIMESTAMP input assertion; §16: resolve.md traceability ops; §16b: DUPLICATE verdict guards (consumer side — DUPLICATE bucket, duplicate_of, Duplicates Collapsed row, ## Duplicates section); all beforeAll blocks assert exit-0 + non-empty corpus
- `tests/resolve/duplicate-verdict.test.ts` — DUPLICATE producer-side guards: pre-pass ordering, chaining prohibition, security-primary election, ledger bucket/column, two-sided PF-024 enum seam, section exclusivity

## Related

- ADR-006 (Triage judges / Code fixes split; resolution-summary schema strictly additive over the convergence parser) — applies to the new ## Duplicates section and Duplicates Collapsed row (additive, parser-safe)
- PF-024 (spawn↔op seams: enum domains must match both sides) — DUPLICATE verdict seam is pinned by duplicate-verdict.test.ts (producer) and build-mds.test.ts §16b (consumer); DUPLICATE→primary mapping in Phase 9b-1 is caller-side so git.md contracts are unchanged
- PF-018 (real-path tests): git-agent.test.ts guard suite reads the source file directly for bounds and literal contracts
- PF-019 (verdict-not-evidence): Triage agent must provide cited evidence (grep/file:line/ADR) not just verdicts; D9 propagates evidence through resolve-review-threads reply composition
- PF-020 (parallel Code-agent staging): same-file Code agent batches must be sequential; distinct-file batches parallel
- ADR-003 (leave-the-end-state): Resolver retired with zero tombstones; its installed file is pruned by the registry-diff orphan sweep
- PF-002 (skill re-entrancy): Triage agent skills are loaded via frontmatter — never body-instructed via `Skill()` calls
- PF-003 (no bare rm in agent instructions): Agent shell operations must use safe-delete patterns
- Feature knowledge: `dynamic-workflow-engine` — the max-5-per-batch concurrency rule was generalized from the dynamic-build pipeline to /resolve Phase 3
- Feature knowledge: `compliance-feature` — source of COMPLIANCE_SKILL_INSTALLED, compliance_gate() partial, traceability Git operations, and TRACEABILITY: DEGRADED contract
