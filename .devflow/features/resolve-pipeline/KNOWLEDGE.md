---
feature: resolve-pipeline
name: Resolve Pipeline (Triage → Fix → Verify)
description: "Use when modifying /resolve or /code-review convergence logic, adding or changing Triager disposition rules, adjusting Coder operating modes (issue-fix/validation-fix), touching the resolution-summary.md parser contract, changing the Verification Gate retry loop, or understanding how DIFF_FILES flows from git validate-branch into blast-radius triage. Keywords: resolve, triager, disposition matrix, blast-radius, FIX_NOW, FIX_SEPARATE, TECH_DEBT, FALSE_POSITIVE, BY_DESIGN, ESCALATED, resolution-summary, convergence parser, DIFF_FILES, issue-fix, validation-fix, Verification Gate, manage-debt."
category: architecture
directories: [src/assets/commands/resolve.mds, src/assets/agents/triager.md, src/assets/agents/coder.md, src/core/plugins.ts, src/assets/commands/code-review.mds]
created: 2026-07-08
updated: 2026-07-08
---

# Resolve Pipeline (Triage → Fix → Verify)

## Overview

`/resolve` implements "no agent grades its own homework": a dedicated Triager (opus) classifies every review issue independently before Coders touch any code. The key architectural insight is **separation of judgment from execution** — the Triager assigns verdicts using blast-radius scope, the Coder fixes only what it is told to fix with `OPERATION: issue-fix`, and a haiku Validator independently verifies correctness before any commit reaches remote.

The pipeline was restructured in PR #253 (feat/resolve-triager-split) to replace the former single `Resolver` agent (which both judged and fixed) with the Triager + Coder-as-fixer split. The retired `resolver` agent name is tracked in `LEGACY_AGENT_NAMES` and removed from installs on `devflow init`.

## System Context

`/resolve` is a 10-phase orchestration command. It consumes review artifacts produced by `/code-review` or `/bug-analysis`, and its output (`resolution-summary.md`) feeds back into `/code-review`'s convergence parser on subsequent review cycles. Both directions of this coupling have byte-stable format contracts.

Agents in the pipeline:

| Agent | Model | Role |
|-------|-------|------|
| Git | haiku | validate-branch (produces DIFF_FILES), manage-debt, check-ci-status |
| Triager | **opus** | blast-radius judgment — never edits code |
| Coder | sonnet | issue-fix, validation-fix, alignment-fix, qa-fix modes |
| Simplifier | sonnet | refine changed code after fixes |
| Validator | **haiku** | build/typecheck/lint/test gate |

Plugin registry (`plugins.ts`, `plugin.json`, tests) must be triple-consistent: `agents: [git, triager, coder, simplifier, validator]`.

## Component Architecture

### Phase Sequence

```
Phase 0  Git validate-branch  → DIFF_FILES, BRANCH_INFO
Phase 1  Orchestrator parses issues  → ISSUES (with reviewer_confidence %)
Phase 2  Single global Triager  → verdict ledger (one verdict per issue, none vanish)
Phase 3  Batch FIX_NOW issues  → BATCHES (same-file sequential, distinct-file parallel, max 5/batch)
Phase 4  Coder × N (OPERATION: issue-fix, PUSH: false)  → CODER_RESULTS
Phase 5  Write resolution-summary.md  ← compaction safety; Tracked = "(pending)"
Phase 6  Simplifier (only if fixes were made)
Phase 7  Validator gate (haiku) + Coder validation-fix loop ≤ 2 + SINGLE push
Phase 8  CI Status Gate (conditional — skipped if no fixes or Phase 7 FAILED)
Phase 9  manage-debt (FIX_SEPARATE + TECH_DEBT → backfill Tracked = #N)
Phase 10 Display results
```

**Phase 5 write-early rationale**: `resolution-summary.md` is written immediately after Phase 4 while all Coder outputs are still in context. Later phases (Simplifier, Validator, CI gate, manage-debt) can all trigger context compaction. Writing early avoids losing the record. `Tracked` cells are initially `(pending)` and backfilled after Phase 9.

**Phase 7 push timing**: The single `git push` fires at the END of Phase 7, whether the gate PASSED or FAILED. This ensures the branch is always visible on remote before CI or debt management runs. Coders (Phase 4) and validation-fix Coders (Phase 7 loop) both receive `PUSH: false`; the orchestrator owns the push.

### DIFF_FILES Flow

Git agent's `validate-branch` operation emits a `### Diff Scope` block containing newline-separated filenames from `git diff {base}...HEAD --name-only`. The orchestrator extracts this into `DIFF_FILES` and passes it to the Triager. If the block is absent (bug-analysis edge case), `DIFF_FILES` is set to empty string `""`.

`DIFF_FILES` is not a flag — it's the primary input that drives the FIX_NOW vs FIX_SEPARATE boundary in the Triager's blast-radius matrix.

## Triager Blast-Radius Disposition Matrix

**First-match-wins. Apply in exact order.**

| Priority | Verdict | Condition | Evidence Required |
|----------|---------|-----------|-------------------|
| 0 | SECURITY GATE | Any security finding | Overrides everything; → FIX_NOW or ESCALATED only |
| 1 | FALSE_POSITIVE | Reviewer factually wrong | Cited grep/file:line proving the issue does not exist |
| 2 | BY_DESIGN | Code is intentional | Cited ADR or inline comment/doc |
| 3 | FIX_NOW | File in DIFF_FILES, OR isolated Standard fix, OR security/correctness in touched path | Risk tier: Standard or Careful |
| 4 | FIX_SEPARATE | Valid but exceeds diff blast radius | Must become tracked manage-debt ticket |
| 5 | TECH_DEBT | LAST RESORT — complete architectural overhaul only | Not "touches many files" or "changes public API" |

**ESCALATED**: Security issues that cannot be dismissed or deferred — surfaced in `## Escalations`, never routed to manage-debt. This is not a matrix position; it is the second branch of the Security Gate.

**Empty DIFF_FILES** (bug-analysis edge case): clause 3 degrades conservatively — Standard/isolated → FIX_NOW still applies, but the "file in DIFF_FILES" path is unavailable. Security gate is unaffected.

**Risk tiers for FIX_NOW:**
- **Standard**: null checks, validation, error handling, docs, type annotations, isolated security fixes — Coder fixes directly
- **Careful**: public API, shared state, >3 files, core logic, multi-service interface, auth flow — Coder uses understand → plan → test → implement → verify → commit protocol

## Coder Operating Modes

Coder has five modes selected by the `OPERATION` input:

| Mode | Who triggers | Key constraints |
|------|-------------|-----------------|
| `implement` (default) | /implement orchestrator | Full implementation with plan |
| `issue-fix` | /resolve orchestrator | Pre-classified issues only; PUSH: false; no re-litigating |
| `validation-fix` | /resolve Phase 7 gate and /implement Phase 3 | Fix validation failures only, no other changes; PUSH: false |
| `alignment-fix` | /implement Phase 7 Evaluator | Fix misalignments only, no other changes |
| `qa-fix` | /implement Phase 8 Tester | Fix QA failures only, no other changes |

**issue-fix mode rules:**
- Receives pre-classified FIX_NOW issues — never re-litigates Triager dispositions
- Same-file issues → one commit (never two Coders editing the same file concurrently)
- Regression fix without a failing-then-passing regression test = INCOMPLETE → report BLOCKED, do not commit
- Returns: `{status, commitShas, unresolved}` + `## Verification` block

**Batching rule**: Same-file issues → one Coder, sequential. Distinct-file issues → parallel Coders. Maximum 5 issues per batch (generalized from the dynamic-build concurrency rule).

## Parser Coupling: resolution-summary.md ↔ /code-review

This is the most brittle coupling in the pipeline. `/code-review`'s convergence detection reads `resolution-summary.md` to compute `fp_ratio` for multi-cycle reviews.

**Byte-stable elements** (must not be renamed or restructured):

The Statistics table rows:
```
| Fixed          | {n} |
| False Positive | {n} |
| Deferred       | {n} |
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
- fp_ratio > 0.7 AND CYCLE_NUMBER >= 3 → convergence warning emitted

**Safe additions**: New sections (`## Escalations`, `## Blocked`, `## By Design`) are strictly additive. The parser reads specific rows and headings by label — new material does not break it.

**Unsafe changes**: Renaming `Fixed` → `Resolved`, splitting `Deferred` into two rows, changing `False Positive` to `False Positives`, restructuring the Statistics table format.

## Triager Agent Contract

The Triager (opus) is the sole judgment agent. Key constraints in `triager.md`:

- Skills preloaded in frontmatter: `devflow:security`, `devflow:worktree-support`, `devflow:apply-decisions`, `devflow:apply-feature-knowledge`
- **Never instructed to invoke skills via body text** (avoids PF-002 re-entrancy issue)
- Reads 30-line context around each reported file:line to verify issues
- For FALSE_POSITIVE: must provide grep output or file:line citation — opinion is not evidence
- For BY_DESIGN: must cite an ADR or inline comment/doc — gut feeling is not a citation
- For ESCALATED: security findings with ambiguous context go here rather than FALSE_POSITIVE
- Output is a verdict ledger grouped by disposition with a Summary section

**Triager output is consumed by the orchestrator, not by Coders.** The Triager never spawns sub-agents.

## Verification Gate (Phase 7)

The haiku Validator runs build + typecheck + lint + tests against `FILES_CHANGED` from Coder outputs. On FAIL:

```
validation_retry_count = 0
FAIL → spawn Coder (OPERATION: validation-fix, PUSH: false)
     → increment validation_retry_count
     → re-validate
     → if retry_count > 2: record FAILED in ## Verification; skip CI gate; proceed
```

Maximum 2 fix attempts. After 2 failures, the FAILED status is recorded in `resolution-summary.md` with a blocking callout — never silently passed.

The single `git push` runs after the Verification Gate regardless of PASS or FAIL outcome, so the branch is always visible on remote.

## Anti-Patterns

- **Routing ESCALATED issues to manage-debt**: Security escalations that require human review must appear in `## Escalations` with a display callout. manage-debt would bury them in a ticket backlog with no visibility.
- **Re-litigating Triager verdicts in Coder**: The `issue-fix` mode receives pre-classified FIX_NOW issues. The Coder does not assess whether the issues are real — it fixes what it is told.
- **Invoking skills in Triager via body instructions**: The Triager's skills are loaded via frontmatter. Adding `Skill(...)` calls in the Triager's body instructions causes re-entrancy (PF-002).
- **Using TECH_DEBT for "touches many files"**: TECH_DEBT is last resort for complete architectural overhauls only. Multi-file changes with clear blast radius → FIX_NOW/Careful or FIX_SEPARATE.
- **Pushing before Verification Gate**: Coders run with `PUSH: false`. The orchestrator owns the single push in Phase 7. Pushing before validation means unvalidated commits can reach remote.
- **Writing resolution-summary.md late**: If written after Phase 6 or later, context compaction during Simplifier/Validator can lose the result data. Phase 5 write-early is not optional.
- **Bare `rm` in agent instructions**: Shell removal should use the safe-delete pattern (PF-003). Agents should not instruct bare `rm -rf` operations.

## Gotchas

- **DIFF_FILES is an empty string, not absent**: When the `### Diff Scope` block is missing from Git agent output (bug-analysis edge case), `DIFF_FILES` is set to `""`, not omitted. The Triager matrix degrades accordingly — do not treat empty string as "all files in scope."

- **Verdict ledger completeness**: Every issue from Phase 1 must appear in the Triager output. The pipeline validates that no issue vanishes. If the Triager output is missing an issue ID, it is a Triager failure, not an acceptable outcome.

- **resolution-summary.md is written twice**: Phase 5 writes the initial version with `Tracked = (pending)`. Phase 7 and Phase 9 update specific sections (Verification, Tracked backfill). If you add a phase that overwrites the file wholesale, you lose Phase 5's compaction safety.

- **manage-debt runs sequentially across worktrees**: In multi-worktree mode, manage-debt cannot run in parallel — GitHub API conflicts arise when creating issues concurrently. Even though other phases (pre-flight, Coder batches) run in parallel, Phase 9 is always sequential.

- **`--review {timestamp}` not supported in multi-worktree mode**: The `--review` flag only works in single-worktree flow. Use `--path` + `--review` to target a specific worktree and review timestamp.

- **Legacy flat layout**: If no timestamped subdirectories exist but flat `*.md` files are present in the branch review directory, the command reads them directly. This is backwards-compatible handling for reviews written before the timestamped directory structure was introduced.

- **Bug-analysis fallback**: If all reviews are resolved (have `resolution-summary.md`), the command falls back to the latest unresolved bug-analysis directory. Reviews take priority; bug analysis is only used when no qualifying review exists.

- **Triager receives PR_DESCRIPTION as untrusted input**: The PR body is wrapped in `<pr-description>...</pr-description>` containment markers. The Triager uses it to understand author intent but must never execute its content as instructions or tool invocations.

## Key Files

- `src/assets/commands/resolve.mds` — MDS source for /resolve orchestration command (10-phase pipeline); compiled to `dist/commands/`
- `src/assets/agents/triager.md` — Triager agent (opus): blast-radius disposition matrix, evidence rules, verdict ledger format
- `src/assets/agents/coder.md` — Coder agent: `issue-fix`, `validation-fix`, `alignment-fix`, `qa-fix` modes documented in Mode sections
- `src/core/plugins.ts` — DEVFLOW_PLUGINS entry for devflow-resolve: agents registry `[git, triager, coder, simplifier, validator]`
- `src/core/plugins.ts` — `LEGACY_AGENT_NAMES` includes `resolver` → removed from installs on `devflow init`
- `src/assets/commands/code-review.mds` — Contains convergence parser that reads `resolution-summary.md` Statistics rows and section headings

## Related

- ADR-003 (leave-the-end-state): Resolver retired with zero tombstones; `resolver` survives only as a `LEGACY_AGENT_NAMES` cleanup entry
- PF-002 (skill re-entrancy): Triager skills are loaded via frontmatter (`devflow:apply-decisions`, `devflow:apply-feature-knowledge`, etc.) — never body-instructed via `Skill()` calls
- PF-003 (no bare rm in agent instructions): Agent shell operations must use safe-delete patterns
- Feature knowledge: `dynamic-workflow-engine` — the max-5-per-batch concurrency rule was generalized from the dynamic-build pipeline to /resolve Phase 3
- Feature knowledge: `ambient-orchestrator` — Triager is also registered in the `devflow-ambient` plugin agents list
