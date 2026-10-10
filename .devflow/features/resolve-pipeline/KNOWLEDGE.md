---
feature: resolve-pipeline
name: Resolve Pipeline (Triage → Fix → Verify)
description: "Use when changing /resolve triage, DUPLICATE collapsing, Code issue-fix mode, the resolution-summary.md parser contract, the Verification Gate or thread resolution. Keywords: resolve, triage, FIX_NOW."
category: architecture
directories: [src/assets/commands/resolve.mds, src/assets/agents/triage.mds, src/assets/agents/code.mds, src/core/plugins.ts, src/assets/commands/code-review.mds]
created: 2026-07-08
updated: 2026-10-10
---

# Resolve Pipeline (Triage → Fix → Verify)

## Rules

- **KB-INV-1** No agent grades its own homework: Triage (opus) judges and never edits code, Code fixes only the FIX_NOW issues it is given and never re-litigates, Validate (haiku) verifies before any push.
- **KB-INV-2** Every Phase 1 issue lands in exactly one verdict bucket; a vanished id, or a DUPLICATE whose `duplicate_of` is missing or names another DUPLICATE, is a Triage failure (retry once, then abort).
- **KB-INV-3** The duplicate pre-pass runs first and the matrix sees group primaries only; the security member is always primary and the Security Gate covers its group.
- **KB-INV-4** The parser contract is byte-stable: the `Fixed`, `False Positive`, `Deferred` row labels and the `## Fixed Issues` / `## False Positives` layouts never change; additions only.
- **KB-INV-5** Statistics rows between `Total Issues` and `Duplicates Collapsed` count unique (non-DUPLICATE) issues, so duplicates never inflate `fp_ratio`.
- **KB-INV-6** FALSE_POSITIVE needs a cited grep or file:line; BY_DESIGN needs a read decision stated in words, or an inline comment/doc.
- **KB-INV-7** Code agents run `PUSH: false`; the orchestrator pushes in Phase 7 only once the gate has run (PASSED or FAILED), so unvalidated commits never reach the remote, and a FAILED gate gets a blocking callout, never a silent pass.
- **KB-INV-8** Threads resolve by the D9 gate alone (PASS + FIXED + non-empty `commit_sha`); all else is reply-only, FALSE_POSITIVE and BY_DESIGN included, and an unmatched `ext-{N}` thread is ESCALATED.
- **KB-INV-9** Phases 1b and 9b-1 need `EVIDENCE_POLICY` required, 9c needs `REQUIRE_NON_AUTHOR_APPROVAL`, 9b-2 runs whenever a PR is known; /resolve has no compliance gate.
- **KB-INV-10** Spawn↔op enums match on both sides: the DUPLICATE verdict is pinned by `tests/resolve/duplicate-verdict.test.ts` (producer) and `tests/build-mds.test.ts` §16b (consumer).
- **KB-INV-11** Same-file issues go to one Code agent in one commit, sequentially; only distinct-file batches run in parallel, within the Phase 3 batch cap.
- **KB-INV-12** `settings_resolve()` expands once, in Step 0d, ahead of its consumers; `DECISIONS_CONTEXT` reaches only Triage and the Code spawns (`tests/decisions/decisions-seam.test.ts`).
- **KB-AP-1** Never route ESCALATED security issues to manage-debt: they belong in `## Escalations` with a display callout.
- **KB-AP-2** Never body-instruct `Skill(...)` in Triage: its skills preload from frontmatter and a re-invocation trips the re-entrancy guard.
- **KB-AP-3** Never use TECH_DEBT for "touches many files" or "changes public API": that is FIX_NOW/Careful or FIX_SEPARATE.
- **KB-AP-4** Never write `resolution-summary.md` later than Phase 5 or overwrite it wholesale: patch sections, or compaction loses the record.
- **KB-AP-5** Never treat `TRACEABILITY: DEGRADED` as a pipeline failure: record the reason and continue.
- **KB-AP-6** Never restate a marker literal in a caller spawn: pass the input (`REVIEW_TIMESTAMP`, `RESOLUTION_TS`); the operation owns the marker it writes.
- **KB-AP-7** Never list a DUPLICATE outside `## Duplicates`: Statistics and bodies would disagree and manage-debt would open spurious tickets.
- **KB-AP-8** Never dispatch a DUPLICATE to a Code agent or show it to a thread author: it inherits its primary's outcome, mapped caller-side in Phase 9b-1.
- **KB-AP-9** Never run manage-debt in parallel across worktrees: concurrent issue creation conflicts on the GitHub API.
- **KB-AP-10** Never read an empty `DIFF_FILES` as "all files in scope": it is `""` and the matrix degrades conservatively.
- **KB-AP-11** Never dedup review-summary on the cycle alone: the key is the cycle+timestamp pair, so `REVIEW_TIMESTAMP` is a load-bearing spawn input.
- **KB-AP-12** Never write a flagged `rm` in agent instructions: the deny-list blocks `rm -f` and `rm -rf`; name a flagless `rm <path>` or `unlink <path>`.
- **KB-AP-13** Never edit one learning arm and forget its pair: an item rewritten rather than removed needs both arms, and arms cannot nest.

## Overview

`/resolve` implements "no agent grades its own homework": a dedicated Triage agent (opus) classifies every review issue before any Code agent touches code. The point is **separation of judgment from execution**: Triage assigns verdicts by blast radius, the Code agent fixes only what it is told (`OPERATION: issue-fix`), and a Validate agent (haiku) verifies before any commit reaches the remote. This split replaced a single `Resolver` agent that both judged and fixed; its installed file is pruned by the registry-diff orphan sweep on `devflow init`, with no tombstone in the sources.

A traceability layer (Phases 1b, 9b, 9c) fetches external review threads, resolves them after the push and checks merge readiness, gated on the evidence policy and non-author approval, never on compliance. A seventh verdict, **DUPLICATE**, plus a pre-pass that collapses same-defect issues before the matrix, de-skews the `fp_ratio` convergence formula and prevents duplicate debt tickets without changing the code-review.mds parser.

## System Context

`/resolve` consumes review artifacts from `/code-review` or `/bug-analysis`; its `resolution-summary.md` feeds `/code-review`'s convergence parser on later cycles. Both directions are byte-stable contracts.

| Agent | Model | Role |
|-------|-------|------|
| Git | haiku | validate-branch, fetch-review-threads, resolve-review-threads, post-resolution-summary, check-merge-readiness (reads CI as check-ci-status), manage-debt, update-pr-evidence |
| Triage | **opus** | blast-radius judgment, never edits code |
| Code | sonnet | issue-fix, validation-fix, ci-fix modes |
| Simplify | sonnet | refine changed code after fixes |
| Validate | **haiku** | build/typecheck/lint/test gate |
| Test | sonnet | Step 9b-0 only: re-verify stale test-plan items, at most one spawn per cycle |

The `devflow-resolve` entry of `DEVFLOW_PLUGINS` (`plugins.ts`) declares `agents: [git, triage, code, simplify, validate, test, knowledge]`; `tests/registry-integrity.test.ts` keeps registry and sources consistent.

## Component Architecture

### Phase Sequence

```
Phase 0   Pre-flight: 0a worktree discovery; 0b Git validate-branch per worktree [parallel] → DIFF_FILES;
          0c target the latest review directory; 0d settings, DECISIONS_CONTEXT, FEATURE_KNOWLEDGE (and
          _RULES), evidence policy, publication mode, compliance lens and RESOLUTION_TS
Phase 1   Parse issues → ISSUES (with reviewer_confidence %)
Phase 1b  Git fetch-review-threads → THREAD_MAP  [EVIDENCE_POLICY required]
Phase 2   One global Triage agent → verdict ledger, one verdict per issue; duplicate pre-pass first
Phase 3   Batch FIX_NOW (same-file sequential, distinct-file parallel, max 5 per batch); DUPLICATEs never dispatched
Phase 4   Code × N (issue-fix, PUSH: false) → CODE_AGENT_RESULTS
Phase 5   Write resolution-summary.md, Tracked = "(pending)"  ← compaction safety
Phase 6   Simplify (only if fixes were made)
Phase 7   Validate gate + Code validation-fix loop + push
Phase 8   CI Status Gate [skipped if no fixes, Phase 7 FAILED or fork_no_push]: push, ci-wait.cjs, Code
          ci-fix on FAILING (at most 3 waits + 2 fixes per worktree)
Phase 9   Git manage-debt (FIX_SEPARATE + TECH_DEBT → backfill Tracked = #N)  [SEQUENTIAL]
Phase 9b  9b-0 verify-evidence.cjs → at most one Test agent on stale TPs  [only after this run's push];
          9b-1 Git resolve-review-threads  [EVIDENCE_POLICY required, THREAD_MAP non-empty]; 9b-2 Git post-resolution-summary
          [ALWAYS-ON when a PR is known]; 9b-3 Git update-pr-evidence  [only when the head moved]
Phase 9c  Git check-merge-readiness  [REQUIRE_NON_AUTHOR_APPROVAL true, report-only]
Phase 10  Display results
```

An empty FIX_NOW list skips Phases 3-4 and 6-8 but still writes the summary and runs 9, 9b, 9c and 10.

**Phase 5 writes early**: `resolution-summary.md` is written right after Phase 4 while the Code outputs are in context, because Simplify, Validate, the CI gate, manage-debt and thread resolution can each trigger compaction. `Tracked` starts as `(pending)` (or `(pending — TRACEABILITY: DEGRADED ({reason}))` when manage-debt degrades) and is backfilled after Phase 9. Later phases patch sections only: Phase 7 `## Verification`, Phase 9 `Tracked`, Phase 9b `## Third-Party Threads`.

**Push timing**: Phase 7 pushes at its end, PASSED or FAILED, so the branch is on the remote before CI, debt management or thread resolution; Code agents (Phase 4, validation-fix, ci-fix) all take `PUSH: false`. Phase 8 pushes again (a no-op unless the head moved, never forced, no retry) and after each ci-fix; a failed push records `TRACEABILITY: DEGRADED (ci push failed)` and stops the wait.

**Fork PRs**: when `validate-branch` returns `TRACEABILITY: DEGRADED (cannot push to fork)`, `fork_no_push` is set: Phase 7 skips the push, Phase 8 is skipped, 9b-1 drops FIXED entries and records them DEGRADED in `## Third-Party Threads` (their commits never reached the PR), 9b-2 still posts, and 9b-0 and 9b-3 are skipped because the head did not move.

**`RESOLUTION_TS`** is minted once per run (`date -u`) in Step 0d for every worktree. Phase 5 writes it as the summary's `**Date**:` and 9b-2 passes it, so the local file and the posted dedup marker agree; a retry of this run stays deduplicated while the next /resolve on the same PR posts.

**Settings and decisions**: `resolve.mds` alias-imports `_partials/_settings.mds` and expands `settings_resolve()` once in Step 0d, ahead of the decisions load, publication gate and compliance lens. Those partials import nothing from it and refer to "the line resolved above", so `REVIEW_PUBLICATION` and `COMPLIANCE_FRAMEWORKS` are still read per worktree. `COMPLIANCE_FRAMEWORKS` (`compliance_frameworks()` from `_partials/_compliance.mds`, alias-imported) goes to every Code spawn (issue-fix, validation-fix, ci-fix), which loads the compliance skill only when it is not `off`. `DECISIONS_CONTEXT` goes to Triage and those Code spawns only, exists only in the learning-on build, and `decisions_gate()` sets it to `(none)` when the settings line says `LEARNING=off`.

### Review Directory Targeting

Step 0c takes, per worktree, the newest of the 10 most recent timestamped directories under `.devflow/docs/reviews/{branch-slug}/` that holds `review-summary.md`; one already holding `resolution-summary.md` is resolved. `--review {timestamp}` picks one directly but works only in single-worktree flow (pair `--path` with it to target a worktree). With no timestamped subdirectories, flat `*.md` files there are read directly (legacy layout). When every review is resolved, the command falls back to the latest unresolved bug-analysis directory (a focus report present, no `resolution-summary.md`, same 10-directory scan limit); reviews take priority. Phase 1 skips `review-summary.md`, `resolution-summary.md`, `bug-analysis-summary.md` and `static-findings.md`. `tests/resolve/bug-analysis-fallback.test.ts` pins priority, exclusions and scan limit.

### DIFF_FILES Flow

`validate-branch` emits a `### Diff Scope` block of filenames from `git diff {base}...HEAD --name-only`; the orchestrator extracts it into `DIFF_FILES` for Triage, or `""` when the block is absent (the bug-analysis edge case). It drives the FIX_NOW vs FIX_SEPARATE boundary in the matrix; it is an input, not a flag.

### Traceability Layer (Evidence-Policy-Gated)

`EVIDENCE_POLICY` is resolved once per run by the `evidence_policy()` partial; these phases key on it (or on `REQUIRE_NON_AUTHOR_APPROVAL`), never on compliance.

- **1b fetch-review-threads**: before Triage, Git returns a `THREAD_MAP` of `ext-{N}` records, one per unresolved external (non-devflow-authored) thread. DEGRADED → record the reason, empty map, continue.
- **9b-1 resolve-review-threads** (after the Phase 9 backfill): each `ext-{N}` is matched to an issue verdict (FIXED, FALSE_POSITIVE, BY_DESIGN, ESCALATED) by file:line correlation, with `commit_sha` added for FIXED; unmatched threads are ESCALATED (human review), never dropped. A match on a DUPLICATE uses the **primary's** verdict and verification status, so the thread author never sees DUPLICATE (the Git agent's verdict set has none and git.md contracts are unchanged). Results go into `## Third-Party Threads` before 9b-2, which posts that file.
- **D9 gate** (single authority: git.md `## Operation: resolve-review-threads`): `resolveReviewThread` runs **only when `VERIFICATION_STATUS == PASS` AND verdict `FIXED` AND `commit_sha` non-empty**. FALSE_POSITIVE and BY_DESIGN are reply-only (devflow supplies cited evidence, the thread author closes the thread); ESCALATED, FAILED and SKIPPED are always reply-only, so with VERIFICATION_STATUS FAILED or SKIPPED every thread gets a reply and none is resolved.
- **9b-2 post-resolution-summary** (always-on): one consolidated PR comment keyed on `<!-- devflow:resolution-summary ts:{TS} -->`, skipped when already posted, with `REVIEW_PUBLICATION` passed through (visibility-gated: counts-only STUB on public or unknown repos). **9b-3 update-pr-evidence** reuses the mode 9b-2 reported and never blocks.
- **9c check-merge-readiness** returns READY / NOT_READY / DEGRADED / CI-pending as distinct states, reported in Phase 10, **never blocking**.
- **TRACEABILITY: DEGRADED**: no-PR, no-gh-auth or no-remote makes the Git agent return `TRACEABILITY: DEGRADED ({reason})`; every traceability operation then skips and continues.

## Duplicate Grouping Pre-Pass

A pre-filter, not a matrix row: it runs **before** the blast-radius matrix and selects which issues the matrix sees (`triage.mds`).

1. **Group by same defect**: same root cause, typically the same or adjacent file:line reported by different review foci, or one logical error phrased differently.
2. **Select primary**: the most specific and complete report; in a mixed security/non-security group the security member is always primary, so security findings are never collapsed into non-security primaries.
3. **Security Gate for the whole group**: if any member is a security finding the primary goes through the Security Gate (FIX_NOW or ESCALATED only), however many non-security members there are.
4. **Non-primary members** get **DUPLICATE** with `duplicate_of: <primary-id>`, naming a non-DUPLICATE issue (no chaining).
5. **Single-member groups** are their own primary and go straight to the matrix.
6. **Inheritance**: a DUPLICATE inherits its primary's final outcome (FIX_NOW → fixed by the Code agents that fix the primary; FALSE_POSITIVE → excluded from the False Positives section and count).

The ledger gains a `### DUPLICATE` table (`Issue ID | Duplicate Of | File:Line | Reason`, the reason reading "same defect as {primary-id}, reported by {focus}") and a `- DUPLICATE: {n}` Summary tally.

## Triage Blast-Radius Disposition Matrix

**First match wins, in exact order, on group primaries only.**

| Priority | Verdict | Condition | Evidence Required |
|----------|---------|-----------|-------------------|
| 0 | SECURITY GATE | Any security finding | Overrides everything; → FIX_NOW or ESCALATED only |
| 1 | FALSE_POSITIVE | Review agent factually wrong | Cited grep/file:line proving the issue does not exist |
| 2 | BY_DESIGN | Code is intentional | An ADR whose body was read, stated in words (learning on only), or an inline comment/doc |
| 3 | FIX_NOW | File in DIFF_FILES, OR isolated Standard fix, OR security/correctness in a touched path | Risk tier Standard or Careful |
| 4 | FIX_SEPARATE | Valid but exceeds the diff blast radius | Must become a tracked manage-debt ticket |
| 5 | TECH_DEBT | LAST RESORT: complete architectural overhaul only | Not "touches many files" or "changes public API" |

- **Security Gate**: a soft rationale ("local CLI threat model", "below confidence threshold", "minor risk") never defers or dismisses a security finding. FALSE_POSITIVE needs hard cited evidence that the vulnerability does not exist; ambiguous context → ESCALATED.
- **ESCALATED** is the gate's second branch, not a matrix position: surfaced in `## Escalations`, never sent to manage-debt. **DUPLICATE** comes from the pre-pass and is never a matrix output.
- **Terminal catch-all**: a valid issue matching no clause is FIX_NOW when the fix stays within the branch's purpose, else FIX_SEPARATE. **Compliance findings** are often policy/architecture-level and default to FIX_SEPARATE or TECH_DEBT unless code-local and inside the diff's blast radius.
- **Empty DIFF_FILES**: clause 3 degrades conservatively (Standard/isolated → FIX_NOW, else FIX_SEPARATE); the Security Gate is unaffected.
- **Risk tiers** (FIX_NOW): **Standard** (null checks, validation, error handling, docs, type annotations, tests, logging, isolated security fixes) is fixed directly; **Careful** (public API, shared state, more than 3 files, core logic, multi-service interface, auth flow) uses understand → plan → test → implement → verify → commit.

## Code Agent Operating Modes

The Code agent selects its mode from `OPERATION`, the first prompt line of every spawn. /resolve spawns these three:

| Mode | Who triggers | Key constraints |
|------|-------------|-----------------|
| `issue-fix` | /resolve orchestrator | Pre-classified issues only; PUSH: false; no re-litigating |
| `validation-fix` | /resolve Phase 7 gate and /implement Phase 3 | Fix validation failures only; PUSH: false |
| `ci-fix` | /resolve Phase 8 and the /implement CI gate, on FAILING | Fix only the checks named in `CI_FAILURES` (names only, the Code agent fetches logs itself); PUSH: false |

The rest serve /implement: `implement` (default, full implementation with plan), `alignment-fix` (Phase 7 Evaluate misalignments only), `qa-fix` (Phase 8 Test failures only), `pr-create` (open the PR) and `edit` (a mechanical rename or move).

**issue-fix rules**: pre-classified FIX_NOW issues only, never re-litigated; DUPLICATEs are never dispatched; same-file issues → one commit; a regression fix without a failing-then-passing regression test is INCOMPLETE → report BLOCKED, do not commit; self-verification is compile plus the fix's regression test only, since the Phase 7 gate is the single authoritative full run; returns `{status, commitShas, unresolved}` plus a `## Verification` block.

**Batching**: same-file issues → one Code agent, sequential (never two Code agents on one file at once); distinct-file issues → parallel Code agents in one message; at most 5 issues per batch (generalized from the dynamic-build concurrency rule).

## Parser Coupling: resolution-summary.md ↔ /code-review

`/code-review` Step 0e-ii reads `resolution-summary.md` to compute `fp_ratio` for multi-cycle reviews. **Do not alter labels, column order or Statistics row names without updating that parser in code-review.mds**; the DUPLICATE additions left it unchanged. `tests/resolve/convergence-detection.test.ts` pins the unsafe-to-rename literals.

**Byte-stable elements**: the unpadded Statistics rows the parser matches, and two section layouts:
```
| Fixed | {n} |
| False Positive | {n} |
| Deferred | {n} |

## Fixed Issues
| Issue | File:Line | Commit |

## False Positives
| Issue | File:Line | Reasoning |
```

- **fp_ratio** = `fp_count / (fp_count + fixed_count + deferred_count)`; the `Deferred` row is FIX_SEPARATE + TECH_DEBT combined; By Design and Escalated sit outside the denominator. `fp_ratio > 0.7` with `CYCLE_NUMBER >= 3` emits a convergence warning that never blocks; a zero denominator or parse failure gives `fp_ratio = 0`.
- **Counting**: `Total Issues` counts every triaged issue including collapsed duplicates; every row between `Total Issues` and `Duplicates Collapsed` counts unique issues only, so `Total Issues` equals the sum of the rows below it.
- **Safe additions**: `## Escalations`, `## Blocked`, `## By Design`, `## Third-Party Threads`, the `| Duplicates Collapsed | {n} |` row, `## Duplicates` (`| Issue | Duplicate Of | File:Line |`), and in the learning-on build `## Decisions Citations`. **Unsafe**: renaming `Fixed` → `Resolved`, splitting `Deferred` into two rows, `False Positive` → `False Positives`, restructuring the Statistics table.
- **Section exclusivity**: a DUPLICATE appears **only** in `## Duplicates`, never in `## Fixed Issues`, `## False Positives`, `## By Design`, `## Fix Separately`, `## Deferred to Tech Debt`, `## Escalations` or `## Blocked`. A duplicate of a FALSE_POSITIVE primary leaves only the primary in the `False Positive` row and section. This also keeps manage-debt from ticketing duplicates: the primary's ticket covers them.

## Code-Review Phase 3: Sequential Synthesis + Comment

Per worktree, step 3b waits for 3a: **3a** is the Synthesize agent writing `review-summary.md` into the timestamped review directory; **3b** is the Git agent (`OPERATION: post-review-summary`) posting a consolidated PR comment.

**D7 dedup key is the cycle+timestamp pair**, marker `<!-- devflow:review-summary cycle:{N} ts:{REVIEW_TIMESTAMP} -->`: a same-cycle re-review (different REVIEW_TIMESTAMP) posts its own comment; an exact re-run (same REVIEW_TIMESTAMP) deduplicates silently. The caller spawn in code-review.mds passes `REVIEW_TIMESTAMP: {timestamp}` and does not restate the marker; its format is owned by the operation's PR-host mechanics (`references/pr/`), which git.md itself must not restate. `tests/build-mds.test.ts` §15 asserts compiled code-review.md passes `REVIEW_TIMESTAMP` to that spawn.

**Resolution order in /code-review is load-bearing**: Step 0b resolves the compliance lens (`COMPLIANCE_ACTIVE`, `COMPLIANCE_FRAMEWORKS`) from the settings line and Step 0b-ii the evidence policy, both before Step 0c spawns the Git agent (`ensure-pr-ready`), which takes `APPLY_CONVENTIONS` from the policy. The lens gates only the compliance Review focus in Phase 1 and never reaches the Git agent.

All PR commenting goes through `post-review-summary` (/code-review Phase 3b) or `post-resolution-summary` (/resolve Phase 9b-2); there is no `comment-pr` operation.

## plan.mds ensure-traceable-issue Guard

`/plan` Phase 14 spawns the Git agent with `OPERATION: ensure-traceable-issue` to create or enrich the plan's tracker issue, guarded by `EVIDENCE_POLICY`. Under **`required`** linking is mandatory (DEGRADED states exempt, with a warning in the final summary) and the spawn proceeds unconditionally. Under **`standard`** it is optional: an `AskUserQuestion` asks first and the spawn is skipped if the user declines.

## Triage Agent Contract

Triage (opus, tools Read/Grep/Glob/Bash) is the sole judgment agent; `triage.mds` compiles with a learning-off variant.

- **Skills** preloaded in frontmatter: `devflow:security`, `devflow:worktree-support`, `devflow:apply-feature-knowledge`, and `devflow:apply-decisions` in the learning-on build only. Never invoke them from body text.
- **`FEATURE_KNOWLEDGE`** is per KB: the Rules bullets most relevant to the issues, the KB path and a heading index (sections are read on demand).
- Reads 30 lines around each reported file:line, runs the pre-pass first, then the matrix on primaries only. Evidence per verdict is in the matrix table; BY_DESIGN's ADR route is absent from the learning-off build, leaving the inline comment/doc.
- Output is a verdict ledger over ESCALATED, FIX_NOW, FALSE_POSITIVE, BY_DESIGN, FIX_SEPARATE, TECH_DEBT and DUPLICATE, plus a Summary. The report cap exempts the whole ledger (returned inline in full) because /resolve checks every issue id against it. It goes to the orchestrator, not to Code agents, and Triage never spawns sub-agents.

## Learning Variants

`resolve.mds`, `triage.mds` and `code.mds` carry whole-line `<!-- learning:on -->` / `<!-- learning:off -->` / `<!-- learning:end -->` arms. The build compiles each host twice: the learning-on file in `dist/commands/` or `dist/agents/`, and a learning-off file under `dist/learning-off/`; install and the learning toggle pick one from the machine's learning switch. The learning-off /resolve drops Step 0d's decisions load (the heading becomes "Load Project Context"), `DECISIONS_CONTEXT` in Produces/Requires and the Triage and Code spawns, the apply-decisions instruction, the Reasoning-column collection sentence and the `## Decisions Citations` section of resolution-summary.md; Triage drops the apply-decisions preload, the Apply Decisions responsibility (later numbers become on/off pairs) and the ADR route to BY_DESIGN.

Items rewritten rather than removed (Step 0d's heading and Produces, the Phase 2 and 4 Requires, the `ci-fix` step 6) exist in both arms and must be edited together. `tests/learning/learning-variants-arms.test.ts` checks each variant against an independent resolution of the compiled host.

## Verification Gate (Phase 7)

Validate (haiku) runs build, typecheck, lint and tests (`VALIDATION_SCOPE: full`) against `FILES_CHANGED` from the Code outputs; with no fixes it is SKIPPED. On FAIL, `validation_retry_count` is incremented and, while it is at most 2, a Code agent runs `validation-fix` (`PUSH: false`) and the gate re-validates. Past two attempts VERIFICATION_STATUS is FAILED: a blocking callout goes into `## Verification`, Phase 8 is skipped and the pipeline proceeds. PASS continues to Phase 8; FAILED and SKIPPED go straight to Phase 9. The push runs after the gate in every case.

## Test Guards

Static guards fail loudly when a load-bearing literal changes. Wider seam and guard family: `tests/seams/command-agent-input.test.ts` (spawn-key seam: forward, reverse, producers), `tests/goldens/git-agent-golden.test.ts`, `tests/goldens/github-status-lines.test.ts`, `tests/guards/agent-source-resolver.test.ts`, `tests/guards/retired-wording.test.ts`, `tests/guards/numeric-floor-manifest.test.ts`, `tests/guards/extended-references.test.ts`.

**`tests/git-agent.test.ts`** (no build) reads the Git agent source plus the reference files its operations load, a sink corpus. `extractOpSectionFromCorpus` cuts an operation in `union` or `sole` mode from its unfenced column-0 `## Operation:` heading to the next unfenced `## `, so a `## ` line inside an op's Output fence is payload and an op-scoped assertion sees it.
- Guard 0 non-vacuousness; Guard 1 a section for every `REQUIRED_OPS` entry (traceability ops, `fetch-issue`, `fetch-issues-batch`, `update-pr-evidence`, `associate-release`).
- Guard 2 numeric bounds: comment-length caps (post-review-summary, post-resolution-summary, post-wave-report, manage-debt), processing bounds (resolve-review-threads, backlink-shipped-issues, fetch-issues-batch, fetch-review-threads) and the learn-conventions scan bounds; fetch-issues-batch also pins `TRUNCATED ({n} not processed)`, the `## Issues Batch ({n} issues)` header and the single-GraphQL-query mechanic.
- Guard 3 the D9 sentence ("ONLY when VERIFICATION_STATUS == PASS AND verdict == FIXED AND commit_sha non-empty"), FALSE_POSITIVE and BY_DESIGN reply-only. Guard 4 D4 rate-limit clauses (secondary-limit STOP, THROTTLED report, full-stop and backpressure thresholds); 4b no provider detector literals in git.md's cross-cutting sections. Guard 5 the dedup marker forms (`devflow:review-summary cycle:{N} ts:`, `devflow:resolution-summary ts:`), which live only in the PR-host references, with a known-bad probe.

**`tests/registry-integrity.test.ts` Guard 6** (build-gated). Forward: every `OPERATION: X` in a Git-agent spawn (`Agent(subagent_type="Git")`) of a compiled command has a `## Operation: X` heading in git.md. Reverse: every such heading is named in a compiled command or listed in `INTERNAL_OPS` (`learn-conventions`, invoked by setup-task; `check-ci-status`, run only by check-merge-readiness since commands wait on CI through `ci-wait.cjs`); `fetch-issues-batch` is wired live from `plan.mds`. It fails loudly when `dist/commands/` is absent: a guard that skips on a missing build artifact is not a guard.

**`tests/build-mds.test.ts`** (build-gated; each `beforeAll` asserts the build exits 0, every scan loop `scanned > 0`): §15 compiled code-review.md references `post-review-summary`, passes `REVIEW_TIMESTAMP` (callers pass inputs and operations own their output format, so the marker-literal pin was dropped) and has no `comment-pr`; §16 compiled resolve.md carries the traceability ops and `Third-Party Threads`, keys thread steps on `EVIDENCE_POLICY` and Phase 9c on `REQUIRE_NON_AUTHOR_APPROVAL`, with no compliance gate; §16b (DUPLICATE, consumer) pins the `DUPLICATE` bucket, `duplicate_of`, the `| Duplicates Collapsed | ` row and the `## Duplicates` heading in compiled resolve.md.

**`tests/resolve/duplicate-verdict.test.ts`** (producer; reads Triage via `resolveAgentSource('triage')` plus the `resolve.mds` source) guards the pre-pass ordering before the matrix, the chaining prohibition, security-primary election, matrix scope ("primary only"), the `### DUPLICATE` heading, `Duplicate Of` column and `- DUPLICATE: {n}` tally, the `DUPLICATE` / `duplicate_of` seam between `triage.md` and `resolve.mds`, and the section-exclusivity sentence in `resolve.mds`.

## Anti-Patterns

- **KB-AP-1, KB-AP-3**: a debt backlog buries an escalation with no visibility; a misused TECH_DEBT hides work that is FIX_NOW/Careful (clear blast radius) or FIX_SEPARATE.
- **KB-AP-2**: a body `Skill(...)` re-enters a skill already preloaded; output containing its guard string (for example `already running`) is a Triage failure in the completeness check (retry once, then abort).
- **KB-AP-4, KB-AP-5, KB-AP-6**: a summary written after Phase 6 can lose the result data to compaction during Simplify or Validate; Phases 1b, 9b-1, 9b-2 and 9c all skip and continue on DEGRADED; callers (resolve.mds, code-review.mds) pass operation inputs only.
- **KB-AP-7, KB-AP-8**: only non-DUPLICATE FIX_NOW issues are batched in Phase 3, and the thread mapping happens before the git.md operation is called, so git.md contracts stay unchanged.

## Gotchas

- **KB-AP-9, KB-AP-10**: in multi-worktree mode pre-flight and Code batches run in parallel but Phase 9 is always sequential; `DIFF_FILES` is `""`, not omitted, when the `### Diff Scope` block is missing.
- **KB-INV-9**: the compliance lens is not a /resolve gate. /code-review and /plan gate their compliance agent on `COMPLIANCE_ACTIVE` (`true` unless `COMPLIANCE_FRAMEWORKS` is `off`); /resolve only passes `COMPLIANCE_FRAMEWORKS` to its Code agents. Every install carries the compliance skill, so no prompt checks for the skill file.
- **KB-AP-12**: the Recommended deny-list blocks `rm`'s flag spellings (`rm -f`, `rm -rf` and compounds containing them), not a flagless `rm <path>` or `unlink <path>`. Keep cleanup failure-tolerant, and after a denial retry once in a narrower form before reporting a leftover.

## Key Files

- `src/assets/commands/resolve.mds` — /resolve orchestration (Phases 0-10 plus 1b, 9b, 9c); compiled to `dist/commands/` and, for learning off, `dist/learning-off/commands/`
- `src/assets/agents/triage.mds` — Triage agent (opus MDS host; `dist/agents/triage.md`, `dist/learning-off/agents/`): pre-pass, matrix, evidence rules, ledger format
- `src/assets/agents/code.mds` — Code agent, an MDS generator host: a mode section per `OPERATION`
- `src/assets/agents/git.mds` (compiles to `dist/agents/git.md`) — Git agent: the traceability operations; PR-host mechanics live in the `references/pr/` files it loads, and the D7/D8/D9 legend in `references/decision-markers.md`
- `src/assets/commands/_partials/_settings.mds`, `_compliance.mds` — `settings_resolve()`; `compliance_frameworks()` (alias-imported by /resolve) and `compliance_gate()` (adds `COMPLIANCE_ACTIVE`; /code-review and /plan)
- `src/core/plugins.ts` — the `devflow-resolve` entry of `DEVFLOW_PLUGINS`
- `src/assets/commands/code-review.mds` — convergence parser (Step 0e-ii), Phase 3 synthesis + comment, Step 0b compliance lens, `REVIEW_TIMESTAMP` spawn input
- Guards (see Test Guards): `tests/git-agent.test.ts`, `tests/registry-integrity.test.ts`, `tests/build-mds.test.ts`, `tests/resolve/duplicate-verdict.test.ts`, `tests/resolve/convergence-detection.test.ts`, `tests/learning/learning-variants-arms.test.ts`

## Related

- `.devflow/features/dynamic-workflow-engine/KNOWLEDGE.md` — the Phase 3 per-batch concurrency cap was generalized from the dynamic-build pipeline
- `.devflow/features/compliance-feature/KNOWLEDGE.md` — source of the settings-line compliance lens, the compliance partial, the traceability Git operations and the `TRACEABILITY: DEGRADED` contract
- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md` — how `FEATURE_KNOWLEDGE` reaches Triage and the Code spawns (Rules plus heading index) and how the learning variants build
- `.devflow/features/learning-capture-system/KNOWLEDGE.md` — `decisions_load()` and the `DECISIONS_CONTEXT` index
- `.devflow/features/test-harness/KNOWLEDGE.md` — the helpers (`resolveAgentSource`, `extractOpSectionFromCorpus`) and guard suites behind Test Guards
- `.devflow/features/tracker-references/KNOWLEDGE.md` — Git-agent operation mechanics and the reference files the markers live in
- `src/assets/commands/plan.mds` — Phase 14 `ensure-traceable-issue` guard
