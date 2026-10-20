---
feature: resolve-pipeline
name: Resolve Pipeline (Triage → Fix → Verify)
description: "Use when changing /resolve triage, DUPLICATE collapsing, Code-family bodies, issue-fix mode, the resolution-summary.md parser, Verification Gate, thread resolution or base resolver. Keywords: resolve, FIX_NOW, BASE_REF."
category: architecture
directories: [src/assets/commands/resolve.mds, src/assets/agents/triage.mds, src/assets/agents/code.mds, src/assets/agents/fix.mds, src/assets/agents/refactor.mds, src/assets/agents/_partials/_code.mds, src/assets/commands/implement.mds, src/core/plugins.ts, src/assets/commands/code-review.mds, src/assets/scripts/resolve-base.cjs, src/assets/mds/git/]
created: 2026-07-08
updated: 2026-10-20
---

# Resolve Pipeline (Triage → Fix → Verify)

## Rules

- **KB-INV-1** No agent grades its own homework: Triage (opus) judges and never edits code, Code fixes only the FIX_NOW issues it is given and never re-litigates, Fix repairs only the failures a gate lists, Validate (haiku) verifies before any push.
- **KB-INV-2** Every Phase 1 issue lands in exactly one verdict bucket; a vanished id, or a DUPLICATE whose `duplicate_of` is missing or names another DUPLICATE, is a Triage failure (retry once, then abort).
- **KB-INV-3** The duplicate pre-pass runs first and the matrix sees group primaries only; the security member is always primary and the Security Gate covers its group.
- **KB-INV-4** The parser contract is byte-stable: the `Fixed`, `False Positive`, `Deferred` row labels and the `## Fixed Issues` / `## False Positives` layouts never change; additions only.
- **KB-INV-5** Statistics rows between `Total Issues` and `Duplicates Collapsed` count unique (non-DUPLICATE) issues, so duplicates never inflate `fp_ratio`.
- **KB-INV-6** FALSE_POSITIVE needs a cited grep or file:line; BY_DESIGN needs a read decision stated in words, or an inline comment/doc.
- **KB-INV-7** Code and Fix run `PUSH: false`; the orchestrator pushes in Phase 7 only once the gate has run (PASSED or FAILED), so unvalidated commits never reach the remote, and FAILED gets a blocking callout, never a silent pass.
- **KB-INV-8** Threads resolve by the D9 gate alone (PASS + FIXED + non-empty `commit_sha`); all else is reply-only, FALSE_POSITIVE and BY_DESIGN included, and an unmatched `ext-{N}` thread is ESCALATED.
- **KB-INV-9** Phases 1b and 9b-1 need `EVIDENCE_POLICY` required, 9c needs `REQUIRE_NON_AUTHOR_APPROVAL`, 9b-2 runs whenever a PR is known; /resolve has no compliance gate.
- **KB-INV-10** Spawn↔op enums match on both sides: the DUPLICATE verdict is pinned by `tests/resolve/duplicate-verdict.test.ts` (producer) and `tests/build-mds.test.ts` §16b (consumer).
- **KB-INV-11** Same-file issues go to one Code agent in one commit, sequentially; only distinct-file batches run in parallel, within the Phase 3 batch cap.
- **KB-INV-12** `settings_resolve()` expands once, in Step 0d, ahead of its consumers; `DECISIONS_CONTEXT` reaches only Triage and the Code-family spawns, as a slice of the index, never whole (`tests/decisions/decisions-{seam,slice}.test.ts`).
- **KB-INV-13** `issue-fix` is spawned on Code, `validation-fix` and `ci-fix` on Fix, each opening with `OPERATION: <mode>`; the worktree's `COMPLIANCE_DIRECTIVE` rides each on a line of its own, empty when that worktree's lens is off (no agent takes a compliance input).
- **KB-INV-14** Steps 9b-0, 9b-3 and 9c run `verify-evidence.cjs` inline through Bash; a `TARGET_DIR_REL` reaching the shell matches `^[A-Za-z0-9._/-]+$` (a fork author picks the branch name), a `{pr_number}` is digits only, else the run counts as failed.
- **KB-INV-15** The Code-family tail (`_code.mds`) carries Read-once and one quiet-output line byte-equal to `validate.md`'s, outside `## Running commands`; `tests/guards/code-read-economy.test.ts` holds both, and `CODE_FAMILY_SHARED_OUTPUT_LINE` admits that line to Code, Fix and Refactor only.
- **KB-INV-16** /implement splits by one rule (`SPLIT_FRAGMENTS`; no plan is SINGLE) and passes `{branch_diff}` (`git diff --name-only --diff-filter=d {BASE_REF}...HEAD`) as `FILES_CHANGED` to Polish, Harden, Evaluate, Validate and Test, never the Code agent's list; a non-zero diff exit stops the run, and an empty list counts only with exit 0.
- **KB-INV-17** A failed or malformed read of `resolve-levels.md` applies no row in any worktree, keeps every worktree's `GATE_LEVEL` and says `level reference unreadable: no level rows applied`; no level touches the Triage security gate, ESCALATED, the Verification Gate, the CI gate or the compliance directive, and Global Triage, Batch FIX_NOW, Fix and Manage Debt never take `skip` (a row or Rules bullet that breaks this is malformed).
- **KB-INV-18** `BASE_REF` comes from `resolve-base.cjs` once, before any branch diff, and every base name is checked against `STRICT_NAME_RE` (each prompt copy equal, held by `tests/guards/base-ref-guard.test.ts`); the Base Resolver Contract section holds the rest.
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
- **KB-AP-12** Never write `rm -f` or `rm -rf` in agent instructions: the deny-list blocks them; name a flagless `rm <path>` or `unlink <path>`.
- **KB-AP-13** Never edit one curation arm and forget its pair: an item rewritten rather than removed needs both arms, and arms cannot nest.
- **KB-AP-14** Never spawn the Git agent for `update-pr-evidence` or `check-merge-readiness` from /resolve: the script owns both end to end (markers, grammar, scrub), and a spawn only adds a model's turns.
- **KB-AP-15** Never grow `resolve.md` past its byte ceilings (`command-resolve-max`, `command-resolve-curation-off-max`) or reword a line the frozen status-lines fixture samples: new text is paid for by condensing.
- **KB-AP-16** Never add a line to a Code-family body without cutting one: `CODE_BODY_MAX_BYTES`, `FIX_BODY_MAX_BYTES` and `REFACTOR_BODY_MAX_BYTES` have zero headroom, and the cut duplicate rules do not return.

## Overview

`/resolve` keeps judgment apart from execution, so no agent grades its own homework: a dedicated Triage agent (opus) classifies every review issue before any Code agent touches code. Triage assigns verdicts by blast radius, the Code agent fixes only what it is told (`OPERATION: issue-fix`), and a Validate agent (haiku) verifies before any commit reaches the remote. This split replaced a single `Resolver` agent, which `devflow init` prunes.

A traceability layer (Phases 1b, 9b, 9c) fetches external review threads, resolves them after the push and checks merge readiness. A seventh verdict, **DUPLICATE**, plus a pre-pass that collapses same-defect issues before the matrix, de-skews the `fp_ratio` convergence formula and prevents duplicate debt tickets without changing the code-review.mds parser.

## System Context

`/resolve` consumes review artifacts from `/code-review` or `/bug-analysis`; its `resolution-summary.md` feeds `/code-review`'s convergence parser on later cycles, both byte-stable contracts.

| Agent | Model | Role |
|-------|-------|------|
| Git | haiku | validate-branch, fetch-review-threads, resolve-review-threads, post-resolution-summary, manage-debt |
| Script | none | `verify-evidence.cjs` inline through Bash: `verify --stale-out` (9b-0), `publish` (9b-3), `readiness` (9c) |
| Triage | **opus** | blast-radius judgment, never edits code |
| Code, Fix, Polish | sonnet | issue-fix; validation-fix and ci-fix; refine changed code after fixes |
| Validate | **haiku** | build/typecheck/lint/test gate |
| Test | sonnet | Step 9b-0 only: re-verify stale test-plan items, at most one spawn per cycle |

The `devflow-resolve` entry of `DEVFLOW_PLUGINS` (`plugins.ts`) declares the agents of the table above (every row but Script) plus `knowledge`; `tests/registry-integrity.test.ts` keeps registry and sources consistent. `update-pr-evidence` (9b-3) and `check-merge-readiness` (9c) stay defined Git operations whose steps are the same script run.

## Component Architecture

### Phase Sequence

```
Phase 0   Pre-flight: 0a worktree discovery; 0b Git validate-branch per worktree [parallel] → DIFF_FILES;
          0c latest review directory; 0d settings, DECISIONS_CONTEXT, FEATURE_KNOWLEDGE, evidence policy,
          publication mode, compliance lens, gate level, RESOLUTION_TS
Phase 1   Parse issues → ISSUES (with reviewer_confidence %)
Phase 1b  Git fetch-review-threads → THREAD_MAP  [EVIDENCE_POLICY required]
Phase 2   One global Triage agent → verdict ledger, one verdict per issue; duplicate pre-pass first
Phase 3   Batch FIX_NOW (same-file sequential, distinct-file parallel in one message, max 5 per batch; KB-INV-11); DUPLICATEs never dispatched
Phase 4   Code × N (issue-fix, PUSH: false) → CODE_AGENT_RESULTS
Phase 5   Write resolution-summary.md, Tracked = "(pending)"  ← compaction safety
Phase 6   Polish (only if fixes were made, and only at `full`)
Phase 7   Validate gate + Fix validation-fix loop + push
Phase 8   CI Status Gate [skipped if no fixes, Phase 7 FAILED or fork_no_push]: push, ci-wait.cjs, Fix
          ci-fix on FAILING (at most 3 waits + 2 fixes per worktree)
Phase 9   Git manage-debt (FIX_SEPARATE + TECH_DEBT → backfill Tracked = #N)  [SEQUENTIAL]
Phase 9b  9b-0 verify-evidence.cjs → at most one Test agent on stale TPs  [only after this run's push];
          9b-1 Git resolve-review-threads  [EVIDENCE_POLICY required, THREAD_MAP non-empty]; 9b-2 Git post-resolution-summary
          [ALWAYS-ON when a PR is known]; 9b-3 verify-evidence.cjs publish, inline  [only when the head moved]
Phase 9c  verify-evidence.cjs readiness, inline  [REQUIRE_NON_AUTHOR_APPROVAL true, report-only]
Phase 10  Display results
```

An empty FIX_NOW list skips Phases 3-4 and 6-8 but still writes the summary and runs 9, 9b, 9c and 10; its route reads "skip to Phase 5, then run Phases 9, 9b, 9c and 10", pinned word for word, so it names no pushing phase. An all-false-positive run takes this route, so the one edge row that reports "No issues to resolve" (`No issues parsed`) names the parse-time case only.

**Phase 5 writes early**: `resolution-summary.md` is written right after Phase 4, while the Code outputs are in context, because later phases can each trigger compaction. `Tracked` starts as `(pending)` (or `(pending — TRACEABILITY: DEGRADED ({reason}))` when manage-debt degrades) and is backfilled after Phase 9. Later phases patch sections only: Phase 7 `## Verification`, Phase 9 `Tracked`, Phase 9b `## Third-Party Threads`.

**Push timing**: Phase 7 pushes at its end, PASSED or FAILED, so the branch is on the remote before CI, debt management or thread resolution. Phase 8 pushes again (a no-op unless the head moved, never forced, no retry) and after each ci-fix; a failed push records `TRACEABILITY: DEGRADED (ci push failed)` and stops the wait.

**Fork PRs**: when `validate-branch` returns `TRACEABILITY: DEGRADED (cannot push to fork)`, `fork_no_push` is set: Phase 7 skips the push, Phase 8 and 9b-0 and 9b-3 are skipped (the head did not move), 9b-1 drops FIXED entries and records them DEGRADED in `## Third-Party Threads` (their commits never reached the PR), and 9b-2 still posts.

**`RESOLUTION_TS`** is minted once per run in Step 0d. Phase 5 writes it as the summary's `**Date**:` and 9b-2 passes it, so the local file and the posted dedup marker agree; a retry of this run stays deduplicated while the next /resolve on the same PR posts.

**Settings and decisions**: `resolve.mds` alias-imports `_partials/_settings.mds` and expands `settings_resolve()` once in Step 0d, ahead of the decisions load, publication gate and compliance lens. Those partials import nothing from it and refer to "the line resolved above", so `REVIEW_PUBLICATION`, `COMPLIANCE_FRAMEWORKS` and `GATE_LEVEL` are still read per worktree. `compliance_inject()` builds each worktree's `COMPLIANCE_DIRECTIVE` (KB-INV-13). `DECISIONS_CONTEXT` (KB-INV-12): `decisions_load()` Step 2 has the main model copy the index lines that touch the work, one shared slice for sibling spawns; it exists only in the curation-on build (`decisions_gate()` sets `(none)` under `CURATION=off`).

**Gate level** (KB-INV-17): the settings line carries `GATE_LEVEL` per worktree. Step 0d's `**Gate level.**` block reads `resolve-levels.md` once per run when any worktree is `standard` or `lean`, and applies each row to the phase it names: a worktree reads the column of its own level, but Global Triage, one spawn for all worktrees, takes the cell of the strictest level in the run (`full` strictest, then `standard`, `lean`). The reference holds the fixed grammar and one row, `| 6 Polish | skip | skip |`, so Phase 6 Polish runs at `full` only (its cleanup is one bullet of `rules/quality.md`). The grammar bars `skip` on the phases KB-INV-17 names (no row leaves a FIX_NOW security finding unfixed, a FIX_SEPARATE item unticketed or the CI gate dropped) and gives a spawnless phase (Batch FIX_NOW) only `-`. A skipped phase does not stop the run; its `**Produces:**` names read `SKIPPED` (nothing later reads `POLISH_RESULT`). Phase 10 shows `**Gate level**: {GATE_LEVEL, with any level note}` after `Total Issues`; Phase 5 writes `**Gate level**: {GATE_LEVEL}` into each worktree's summary header after `**Command**: /resolve`; the convergence parser reads neither. /implement has the matching block at the start of Phase 3.

### Review Directory Targeting

Step 0c takes, per worktree, the newest of the 10 most recent timestamped directories under `.devflow/docs/reviews/{branch-slug}/` that holds `review-summary.md`; one already holding `resolution-summary.md` is resolved. `--review {timestamp}` picks one directly, in single-worktree flow only (pair `--path` with it to target a worktree). With no timestamped subdirectories, flat `*.md` files there are read directly (legacy layout). When every review is resolved, it falls back to the latest unresolved bug-analysis directory (same scan limit); reviews take priority. Phase 1 skips `review-summary.md`, `resolution-summary.md`, `bug-analysis-summary.md` and `static-findings.md`. `tests/resolve/bug-analysis-fallback.test.ts` pins priority, exclusions and scan limit.

### DIFF_FILES Flow

`validate-branch` emits a `### Diff Scope` block from `git diff --name-only {base_ref}...HEAD` (BLOCKED when `base_ref` is `none` or the diff exits non-zero); the orchestrator extracts it into `DIFF_FILES` for Triage, or `""` when the block is absent (the bug-analysis edge case). It drives the FIX_NOW vs FIX_SEPARATE boundary in the matrix.

### Base Resolver Contract

`resolve-base.cjs` prints one status line per run (`BASE_REF=… REASON=… NOTE=…`) in `local` mode (no PR: /implement Phase 1 and its re-validation without a PR) or `pr` mode (`ensure-pr-ready` 5a, which takes the default branch as the name when gh shows no PR applies (`origin/HEAD`, then `main`, then `master` checked the same way as `main`, as `validate-branch` 6 does); `validate-branch` 6; and re-validation when gh returned a PR). What no single file shows:
- **One reason-to-fix table** serves `ensure-pr-ready` 5b, `validate-branch` 6 and /implement's fresh-base step: no-merge-base, no-ref or timeout, resolver-unavailable (re-run, then `devflow init`) and invalid-name (the allowed set, never the name). The `reason-fix-table` rule of `tests/guards/base-ref-guard.test.ts` holds the three copies equal, so edit them together.
- **An unanswered local git call** (timeout, signal kill, git that will not start) is `resolver-unavailable` at every call site. `LOCAL_TIMEOUT_MS` (30 s per local call) and `RUN_BUDGET_MS` (100 s per run, under the 120 s Bash limit) are exported and pinned by `tests/evidence/resolve-base-process.test.ts`.
- **One run per /implement**: Phase 9 passes the Phase 1 `BASE_REF` to `ensure-pr-ready`, which skips its own resolver run and 5b when it is 40 or 64 lowercase hex and the PR's base name equals `BASE_BRANCH`, else runs `pr` mode.
- **Stored heads**: /code-review and /bug-analysis use the stored review head only when it is 40 or 64 lowercase hex, else they take the full-range path.
- **Name classes**: `STRICT_NAME_RE` is the one class; the helper in `dynamic-build.mds` has a `BRANCH_NAME` class that is its single deliberate variant, less the `origin/` refusal.

### Traceability Layer (Evidence-Policy-Gated)

`EVIDENCE_POLICY` is resolved once per run by the `evidence_policy()` partial; these phases key on it (or on `REQUIRE_NON_AUTHOR_APPROVAL`), never on compliance.

- **1b fetch-review-threads**: before Triage, Git returns a `THREAD_MAP` of `ext-{N}` records, one per unresolved external (non-devflow) thread. DEGRADED → record the reason, empty map, continue.
- **9b-1 resolve-review-threads** (after the Phase 9 backfill): each `ext-{N}` is matched to an issue verdict (FIXED, FALSE_POSITIVE, BY_DESIGN, ESCALATED) by file:line correlation, with `commit_sha` added for FIXED; unmatched threads are ESCALATED (human review), never dropped. A match on a DUPLICATE uses the **primary's** verdict and verification status, so the thread author never sees DUPLICATE. Results go into `## Third-Party Threads` before 9b-2, which posts that file.
- **D9 gate** (single authority: the `resolve-review-threads` reference under `references/pr/`, not `git.md`): `resolveReviewThread` runs **only when `VERIFICATION_STATUS == PASS` AND verdict `FIXED` AND `commit_sha` non-empty**. FALSE_POSITIVE and BY_DESIGN are reply-only (devflow supplies cited evidence, the thread author closes the thread); ESCALATED, FAILED and SKIPPED are always reply-only.
- **9b-2 post-resolution-summary** (always-on): one consolidated PR comment keyed on `<!-- devflow:resolution-summary ts:{TS} -->`, skipped when already posted, with `REVIEW_PUBLICATION` passed through (visibility-gated: counts-only STUB on public or unknown repos).
- **9b-3 update-pr-evidence** is `verify-evidence.cjs publish` with `--evidence` (dropped when 9b-0 appended no claim) and `--publication` set to the mode 9b-2 reported, inline through Bash with `timeout: 180000`. `EVIDENCE_REFRESH` is its stdout (the `## PR Evidence` block, then any `TRACEABILITY: DEGRADED` lines); exit 2, empty stdout or any other exit reads `TRACEABILITY: DEGRADED (evidence unavailable)`. It never blocks.
- **9c check-merge-readiness** is `verify-evidence.cjs readiness --require-non-author-approval true`, inline with the same timeout. Stdout is the `## Merge Readiness` block (READY / NOT_READY / DEGRADED on exit 2), reported in Phase 10; `NOT_READY (CI pending)` is the expected state after a push, and empty stdout or any other exit reads `TRACEABILITY: DEGRADED (readiness unavailable)`. **Never blocking.**
- **TRACEABILITY: DEGRADED**: no-PR, no-gh-auth or no-remote makes the Git agent (or, for 9b-3 and 9c, the script) report it with a reason; every traceability operation then skips and continues.

## Duplicate Grouping Pre-Pass

A pre-filter, not a matrix row: it runs **before** the blast-radius matrix and selects which issues the matrix sees (`triage.mds`).

1. **Group by same defect**: same root cause, typically the same or adjacent file:line reported by different review foci, or one error phrased differently.
2. **Select primary**: the most specific and complete report; in a mixed group the security member is always primary, so security findings are never collapsed into non-security primaries.
3. **Security Gate for the whole group**: if any member is a security finding the primary goes through the Security Gate (FIX_NOW or ESCALATED only).
4. **Non-primary members** get **DUPLICATE** with `duplicate_of: <primary-id>`, naming a non-DUPLICATE issue (no chaining).
5. **Single-member groups** are their own primary and go straight to the matrix. A DUPLICATE inherits its primary's final outcome (FIX_NOW → fixed with the primary; FALSE_POSITIVE → excluded from the False Positives section and count).

The ledger gains a `### DUPLICATE` table (`Issue ID | Duplicate Of | File:Line | Reason`) and a `- DUPLICATE: {n}` Summary tally.

## Triage Blast-Radius Disposition Matrix

**First match wins, in exact order, on group primaries only.**

| Priority | Verdict | Condition | Evidence Required |
|----------|---------|-----------|-------------------|
| 0 | SECURITY GATE | Any security finding | Overrides everything; → FIX_NOW or ESCALATED only |
| 1 | FALSE_POSITIVE | Review agent factually wrong | Cited grep/file:line proving the issue does not exist |
| 2 | BY_DESIGN | Code is intentional | An ADR whose body was read, stated in words (curation on only), or an inline comment/doc |
| 3 | FIX_NOW | File in DIFF_FILES, OR isolated Standard fix, OR security/correctness in a touched path | Risk tier Standard or Careful |
| 4 | FIX_SEPARATE | Valid but exceeds the diff blast radius | Must become a tracked manage-debt ticket |
| 5 | TECH_DEBT | LAST RESORT: complete architectural overhaul only | Not "touches many files" or "changes public API" |

- **Security Gate**: a soft rationale ("local CLI threat model", "minor risk") never defers or dismisses a security finding. FALSE_POSITIVE needs hard cited evidence that the vulnerability does not exist; ambiguous context → ESCALATED.
- **ESCALATED** is the gate's second branch, not a matrix position: surfaced in `## Escalations`, never sent to manage-debt. **DUPLICATE** comes from the pre-pass and is never a matrix output.
- **Terminal catch-all**: a valid issue matching no clause is FIX_NOW when the fix stays within the branch's purpose, else FIX_SEPARATE. **Compliance findings** are often policy-level and default to FIX_SEPARATE or TECH_DEBT unless code-local and inside the diff's blast radius.
- **Empty DIFF_FILES**: clause 3 degrades conservatively (Standard/isolated → FIX_NOW, else FIX_SEPARATE); the Security Gate is unaffected.
- **Risk tiers** (FIX_NOW): **Standard** (null checks, validation, error handling, docs, types, tests, logging, isolated security fixes) is fixed directly; **Careful** (public API, shared state, core logic, auth flow, many files) goes understand → plan → test → implement → verify → commit.

## Code Family Operating Modes

The Code family is three agents, Code, Fix and Refactor, whose text is the shared `src/assets/agents/_partials/_code.mds` plus each host's own mode sections and preloads. A spawn names the variant that owns its mode (KB-INV-13); `CODE_OPERATIONS` in `tests/helpers.ts` is the one map of which variant owns which mode. Fix has no default mode, and an unknown mode returns BLOCKED on every variant. /resolve spawns these three:

| Agent | Mode | Who triggers | Key constraints |
|-------|------|-------------|-----------------|
| Code | `issue-fix` | /resolve orchestrator | Pre-classified issues only; PUSH: false; no re-litigating |
| Fix | `validation-fix` | /resolve Phase 7 gate and /implement Phase 6 | Fix validation failures only; PUSH: false |
| Fix | `ci-fix` | /resolve Phase 8 and the /implement Phase 10 CI gate, on FAILING | Fix only the checks named in `CI_FAILURES` (names only, Fix fetches the logs itself); PUSH: false |

The rest serve other commands: Code `implement` (default; /implement), Fix `alignment-fix` (Phase 5 misalignments) and `qa-fix` (Phase 7 Test failures), and Refactor `edit` (a mechanical rename or move).

**issue-fix rules**: pre-classified FIX_NOW issues only, never re-litigated (KB-INV-1, KB-AP-8); same-file issues → one commit; a regression fix without a failing-then-passing regression test is INCOMPLETE → report BLOCKED, do not commit; self-verification is compile plus the regression test only (Phase 7 is the one full run); returns `{status, commitShas, unresolved}` plus a `## Verification` block.

**Shared tail**: the `tail()` of `_code.mds` holds `## Running commands`, then `## Principles` (Read once, never re-reading an unchanged file; small, focused changes; fail honestly), one quiet-output line (page large files, cap output, count matches before printing), `## Output` and `## Boundaries`. That line is byte-equal to `validate.md`'s and outside `## Running commands`, whose bytes `running-commands-parity.test.ts` owns.

**/implement split** (`implement.mds`, worded again in the `synthesize/planning.md` reference): SEQUENTIAL_CODE_AGENTS past its file and step thresholds, each phase within its own (`SPLIT_FRAGMENTS` pins the numbers), else one Code agent. The Phase 3 intro defines `{branch_diff}` once, and each later spawn runs it again: the Code agent's list misses the Polish, Harden and fix commits, and the filter keeps deleted paths out of the Harden and Evaluate reads. `implement-revalidate.md` carries the same name check on a `BASE_BRANCH` read from the PR base, else the default branch. `tests/evidence/implement-flow.test.ts` pins the `{branch_diff}` command, the Phase 3-7 `**Requires:**` lines that name `BASE_REF`, and the name check.

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
- **Counting**: `Total Issues` counts every triaged issue including collapsed duplicates; every row between it and `Duplicates Collapsed` counts unique issues only, so `Total Issues` equals the sum of the rows below it.
- **Safe additions**: `## Escalations`, `## Blocked`, `## By Design`, `## Third-Party Threads`, the `**Gate level**:` header line, the `| Duplicates Collapsed | {n} |` row, `## Duplicates` (`| Issue | Duplicate Of | File:Line |`), and in the curation-on build `## Decisions Citations`. **Unsafe**: renaming a label above (`Fixed` → `Resolved`), splitting `Deferred`, restructuring the Statistics table.
- **Section exclusivity**: a DUPLICATE appears **only** in `## Duplicates`, never in `## Fixed Issues`, `## False Positives`, `## By Design`, `## Fix Separately`, `## Deferred to Tech Debt`, `## Escalations` or `## Blocked`. This also keeps manage-debt from ticketing duplicates: the primary's ticket covers them.

## Code-Review Phase 3: Sequential Synthesis + Comment

Per worktree, step 3b waits for 3a: **3a** is the Synthesize agent writing `review-summary.md` into the timestamped review directory; **3b** is the Git agent (`OPERATION: post-review-summary`) posting a consolidated PR comment.

**D7 dedup key is the cycle+timestamp pair**, marker `<!-- devflow:review-summary cycle:{N} ts:{REVIEW_TIMESTAMP} -->`: a same-cycle re-review (different REVIEW_TIMESTAMP) posts its own comment; an exact re-run deduplicates silently. The caller spawn passes `REVIEW_TIMESTAMP: {timestamp}` and does not restate the marker, whose format the PR-host mechanics (`references/pr/`) own and git.md must not restate.

**Resolution order in /code-review is load-bearing**: Step 0b resolves the compliance lens and Step 0b-ii the evidence policy, both before Step 0c spawns the Git agent (`ensure-pr-ready`), which takes `APPLY_CONVENTIONS` from the policy. The lens gates only the compliance Review focus in Phase 1 and never reaches the Git agent.

All PR commenting goes through `post-review-summary` (/code-review Phase 3b) or `post-resolution-summary` (/resolve Phase 9b-2); there is no `comment-pr` operation.

## plan.mds ensure-traceable-issue Guard

`/plan` Phase 14 spawns the Git agent with `OPERATION: ensure-traceable-issue` to create or enrich the plan's tracker issue, guarded by `EVIDENCE_POLICY`. Under **`required`** linking is mandatory (DEGRADED states exempt, with a warning in the final summary); under **`standard`** an `AskUserQuestion` asks first and the spawn is skipped if the user declines.

## Triage Agent Contract

Triage (opus, tools Read/Grep/Glob/Bash) is the sole judgment agent and spawns no sub-agents: its tool list has no spawn tool.

- **Skills** preload from frontmatter (`devflow:worktree-support`, `devflow:apply-feature-knowledge`; `devflow:apply-decisions` in the curation-on build only); the security-finding rule is inline in the body. **`FEATURE_KNOWLEDGE`** is per KB: the Rules bullets most relevant to the issues, the KB path and a heading index (sections are read on demand).
- Reads 30 lines around each reported file:line, runs the pre-pass first, then the matrix on primaries only.
- Output is a verdict ledger over the seven verdicts plus a Summary. The report cap exempts the whole ledger (returned inline in full) because /resolve checks every issue id against it. It goes to the orchestrator, not to Code agents.

## Curation Variants

`resolve.mds`, `triage.mds` and the Code hosts (`code.mds`, `fix.mds`) carry whole-line `<!-- curation:on -->` / `<!-- curation:off -->` / `<!-- curation:end -->` arms; the build compiles each host twice (curation-on in `dist/commands/` or `dist/agents/`, curation-off under `dist/curation-off/`), and install and the curation toggle pick one from the machine's curation switch. The curation-off /resolve drops the decisions load and every `DECISIONS_CONTEXT` use (Produces/Requires, the Triage and Code-family spawns), the apply-decisions instruction, the Reasoning-column collection sentence and the `## Decisions Citations` section; Triage drops the apply-decisions preload and responsibility and the ADR route to BY_DESIGN, leaving the inline comment/doc.

Items rewritten rather than removed (Step 0d's heading and Produces, the Phase 2 and 4 Requires, the `ci-fix` step 6) exist in both arms (KB-AP-13). `tests/curation/curation-variants-arms.test.ts` checks each variant against an independent resolution of the compiled host.

## Verification Gate (Phase 7)

Validate (haiku) runs build, typecheck, lint and tests (`VALIDATION_SCOPE: full`) against the Code outputs' `FILES_CHANGED`; with no fixes it is SKIPPED. On FAIL a Fix agent runs `validation-fix` (`PUSH: false`) and the gate re-validates, at most two attempts (`validation_retry_count`);; past that VERIFICATION_STATUS is FAILED and a blocking callout goes into `## Verification`. Route after push, pinned word for word: PASS continues to Phase 8; FAILED or SKIPPED skip it and continue with Phase 9 and the later phases in order.

## Test Guards

Static guards fail loudly when a literal changes. Wider families: `tests/seams/command-agent-input.test.ts` (spawn-key seam), `tests/goldens/{git-agent-golden,github-status-lines}.test.ts`, `tests/guards/{agent-source-resolver,retired-wording,numeric-floor-manifest,extended-references}.test.ts`.

**`tests/git-agent.test.ts`** (build-gated) reads the Git agent body plus the compiled `devflow:git` references: the body declares no operation, and each operation's one reference carries its `## Operation:` heading, contract and steps (`gitOperationReferenceCorpus`; `gitAgentSinkCorpus` is the union over providers). Guards 0-2 hold non-vacuousness, a reference per `REQUIRED_OPS` entry and the numeric bounds; Guard 3 the D9 sentence (KB-INV-8), Guard 8 the same fragment in `resolve.mds` and compiled `resolve.md`; Guard 4 the D4 rate-limit clauses; Guard 5 the dedup marker forms, which live only in the PR-host references.

**`tests/registry-integrity.test.ts` Guard 6** (build-gated): every `OPERATION: X` in a Git-agent spawn of a compiled command has a row in git.md's `## Operations` table, and every row is named in a compiled command or listed in `INTERNAL_OPS`; `check-merge-readiness` meets the reverse check only by its name in resolve.md's prose.

**`tests/build-mds.test.ts`** (build-gated): §15 compiled code-review.md references `post-review-summary`, passes `REVIEW_TIMESTAMP` and has no `comment-pr`; §16 compiled resolve.md carries the traceability ops and the KB-INV-9 gating; §16b (DUPLICATE, consumer) pins the bucket, `duplicate_of`, the `| Duplicates Collapsed | ` row and the `## Duplicates` heading. **`tests/resolve/duplicate-verdict.test.ts`** (producer) guards the pre-pass order, the chaining prohibition, security-primary election, the "primary only" matrix scope, the `### DUPLICATE` table and tally, and the section-exclusivity sentence.

**`tests/guards/code-read-economy.test.ts`** (build-gated) holds, in the compiled Code, Fix and Refactor bodies (`CODE_AGENT_TYPES`), the Read-once marker (`READ_ONCE_FRAGMENTS`) and the quiet-output line, each outside `## Running commands`, plus the split wording (`SPLIT_FRAGMENTS`) in the planning reference and compiled `/implement`. `collectFullSuiteBriefDefects` fails any Code-family spawn in compiled `/implement` and `/resolve` that asks for the full suite (a Validate spawn may). Green proves wording, not obedience. `core-rules-digest.test.ts` admits only `CODE_FAMILY_SHARED_OUTPUT_LINE` as a digest line in those bodies, and `code-operation.test.ts` holds the body ceilings.

**The inline evidence scripts** are pinned by `tests/evidence/resolve-refresh.test.ts` (Phase 9b order, the inline call shape, no Git spawn; it also keeps unique the resolve.mds lines the frozen status-lines fixture samples by first match), `update-pr-evidence.test.ts` (`publish` under the `gh` fake in `pr-shim.ts`, scrub before post) and `merge-readiness-script.test.ts` with `merge-readiness.test.ts` (the ladder). `tests/guards/command-size.test.ts` holds the command byte ceilings.

## Anti-Patterns

- **KB-AP-1, KB-AP-3**: a debt backlog buries an escalation with no visibility; a misused TECH_DEBT hides work that is FIX_NOW/Careful (clear blast radius) or FIX_SEPARATE.
- **KB-AP-2**: a body `Skill(...)` re-enters a skill already preloaded; output containing its guard string (for example `already running`) is a Triage failure in the completeness check (retry once, then abort).
- **KB-AP-4, KB-AP-5, KB-AP-6**: a summary written after Phase 6 can lose its data to compaction; Phases 1b, 9b-1, 9b-2 and 9c all skip and continue on DEGRADED; callers (resolve.mds, code-review.mds) pass operation inputs only.
- **KB-AP-7, KB-AP-8**: only non-DUPLICATE FIX_NOW issues are batched in Phase 3, and the thread mapping happens before the Git operation is called, so the operation contract stays unchanged.

## Gotchas

- **KB-AP-9, KB-AP-10**: in multi-worktree mode pre-flight and Code batches run in parallel but Phase 9 is always sequential; `DIFF_FILES` is `""`, not omitted, when the `### Diff Scope` block is missing.
- **KB-INV-9**: the compliance lens is not a /resolve gate. /code-review and /plan gate their compliance agent on `COMPLIANCE_ACTIVE` (`true` unless `COMPLIANCE_FRAMEWORKS` is `off`); /resolve only builds a per-worktree `COMPLIANCE_DIRECTIVE`.
- **KB-AP-12**: the Recommended deny-list blocks `rm`'s flag spellings (`rm -f`, `rm -rf` and compounds containing them), not a flagless `rm <path>` or `unlink <path>`. Keep cleanup failure-tolerant, and after a denial retry once in a narrower form before reporting a leftover.
- **KB-AP-15**: besides condensing a line the command already states, a rare branch can move to a reference (D-CMD-REF-HAND).

## Key Files

- `src/assets/commands/resolve.mds` — /resolve orchestration (Phases 0-10 plus 1b, 9b, 9c)
- `src/assets/agents/triage.mds` — Triage agent (opus): pre-pass, matrix, evidence rules, ledger format
- `src/assets/agents/code.mds`, `fix.mds`, `refactor.mds` — the Code-family hosts (`issue-fix`; `validation-fix`, `ci-fix`; `edit`) with their own mode sections; `src/assets/agents/_partials/_code.mds` holds the shared text and tail
- `src/assets/commands/implement.mds` — /implement: the split rule, the fresh-base step and the `git diff` `FILES_CHANGED` for the gate agents
- `src/assets/agents/git.mds` — Git agent; each operation loads one reference. Contracts and steps live in `src/assets/mds/git/` (`_ops*.mds`, with the base-resolver steps of `ensure-pr-ready` and `validate-branch`; `_pr.mds`), PR-host mechanics and the D9 gate in `references/pr/`, the marker legend in `references/decision-markers.md`
- `src/assets/commands/_partials/_settings.mds`, `_compliance.mds` — `settings_resolve()`; `compliance_frameworks()` (/resolve) and `compliance_gate()` (adds `COMPLIANCE_ACTIVE`; /code-review and /plan)
- `src/assets/scripts/verify-evidence.cjs` — the evidence script /resolve runs inline (`verify --stale-out`, `publish`, `readiness`)
- `src/assets/scripts/resolve-base.cjs` — the base resolver for branch diffs (Base Resolver Contract): /implement runs it inline (per `implement-revalidate.md`) and hands `BASE_REF` to `ensure-pr-ready`; the Git agent otherwise runs it in `pr` mode; /code-review and /bug-analysis read `base_ref` from `ensure-pr-ready`
- `src/core/plugins.ts` — the `devflow-resolve` entry of `DEVFLOW_PLUGINS`
- `src/assets/commands/code-review.mds` — convergence parser (Step 0e-ii), Phase 3 synthesis, Step 0b compliance lens, `REVIEW_TIMESTAMP` input

## Related

- `.devflow/features/dynamic-workflow-engine/KNOWLEDGE.md` — the dynamic-build pipeline the Phase 3 batch cap came from
- `.devflow/features/compliance-feature/KNOWLEDGE.md` — the settings-line compliance lens, the traceability Git operations and the `TRACEABILITY: DEGRADED` contract
- `.devflow/features/feature-knowledge-system/KNOWLEDGE.md` — how `FEATURE_KNOWLEDGE` reaches Triage and the issue-fix spawns, and how the curation variants build
- `.devflow/features/curation-capture-system/KNOWLEDGE.md` — `decisions_load()` and the `DECISIONS_CONTEXT` index
- `.devflow/features/test-harness-prompt-install/KNOWLEDGE.md` — the level guards that pin the Gate level block, report lines and short routes
- `.devflow/features/test-harness/KNOWLEDGE.md` — the helpers (`resolveAgentSource`, `extractOpSectionFromCorpus`) and guard suites behind Test Guards
- `.devflow/features/test-harness-goldens-budgets/KNOWLEDGE.md` — the frozen status-lines fixture and the command byte ceilings
- `.devflow/features/tracker-references/KNOWLEDGE.md` — Git-agent operation mechanics and the reference files the markers live in
- `src/assets/commands/plan.mds` — Phase 14 `ensure-traceable-issue` guard
