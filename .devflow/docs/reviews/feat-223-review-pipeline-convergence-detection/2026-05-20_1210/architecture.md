# Architecture Review Report

**Branch**: feat-223-review-pipeline-convergence-detection -> main
**Date**: 2026-05-20_1210

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent convergence warning behavior across orchestration surfaces** - `plugins/devflow-code-review/commands/code-review.md:108`, `plugins/devflow-code-review/commands/code-review-teams.md:108`, `shared/skills/review:orch/SKILL.md:74`
**Confidence**: 85%
- Problem: The three orchestration surfaces implement the convergence warning with different thresholds and behavior. `code-review.md` and `code-review-teams.md` both use `fp_ratio > 0.7 AND CYCLE_NUMBER >= 3`, but the teams variant warns with "cycle {N-1}" while the non-teams variant does not specify N-1 vs N. `review:orch/SKILL.md` uses the same threshold but says "at cycle {N}" (not N-1). The teams variant produces `CONVERGENCE_ACTION` in its Step 0d-ii outputs, but neither `code-review.md` nor `review:orch` produce this variable. The teams variant also uses `AskUserQuestion` (interactive) while `review:orch` explicitly documents non-interactive behavior (correct for ambient mode), but `code-review.md` also uses `AskUserQuestion` which matches teams but was not previously present. These subtle divergences create a brittle contract — the "NOTE: Convergence logic mirrored in code-review.md — changes must sync" comment in teams acknowledges the duplication risk but does not prevent it.
- Fix: Extract the convergence assessment algorithm into a shared reference (e.g., a section in `review-methodology` skill or a new `references/convergence.md` file) that all three surfaces reference. Define the canonical variable names (`CYCLE_NUMBER`, `CONVERGENCE_ACTION`) and behavior (interactive vs non-interactive) as surface-specific overrides of the shared algorithm. This follows the existing `shared/skills/` single-source-of-truth pattern (applies ADR-001 — clean break philosophy; no backward compat needed).

**Synthesizer step 4b numbering breaks sequential contract** - `shared/agents/synthesizer.md:241`
**Confidence**: 88%
- Problem: The new convergence cross-referencing step is inserted as "4b" between steps 4 and 5 in the Process list. This is not a valid Markdown ordered list item and breaks the sequential numbering convention used by every other agent in the codebase. More importantly, it conflates two concerns in one step: (a) cross-referencing against prior resolutions and (b) noting recurring vs new issues. The "Process" list is the synthesizer's execution contract — agents parse these numbered steps as a procedure. A non-numeric step risks being silently skipped by the model.
- Fix: Renumber the steps properly. Insert as step 5 (renumbering subsequent steps to 6, 7, 8) or split into "5. Cross-reference findings against PRIOR_RESOLUTIONS" and "6. Note recurring vs new issues in output". The condition `(>1)` should be explicit: `If CYCLE_NUMBER > 1 and PRIOR_RESOLUTIONS is not (none)`.

### MEDIUM

**PRIOR_RESOLUTIONS passed as raw content creates unbounded context inflation** - `plugins/devflow-code-review/commands/code-review.md:200`, `shared/skills/review:orch/SKILL.md:143`
**Confidence**: 82%
- Problem: The resolution-summary.md content is read in full and passed to every reviewer agent as `PRIOR_RESOLUTIONS`. Resolution summaries can grow large (especially after multiple cycles with many findings). Passing the full content to 8-19 parallel reviewer agents multiplies this context cost. The PR description already established a pattern of fetching content lazily (via `gh pr view`), and the decisions system uses a compact index with on-demand Read. PRIOR_RESOLUTIONS bypasses both patterns — it is neither indexed nor size-bounded.
- Fix: Follow the established `DECISIONS_CONTEXT` pattern: pass a compact summary of prior resolutions (e.g., "N false positives, M fixed, K deferred" with a file path) and let each reviewer Read the full file on demand. Alternatively, extract only the False Positives and Fixed Issues tables (which are what the reviewer's Cross-Cycle Awareness section actually parses) rather than the entire resolution-summary.md.

**CONVERGENCE_ACTION variable produced but never consumed** - `plugins/devflow-code-review/commands/code-review-teams.md:99`
**Confidence**: 85%
- Problem: Step 0d-ii in the teams command Produces `CONVERGENCE_ACTION`, but no subsequent phase declares it in its Requires annotations. The variable is implicitly consumed via the `AskUserQuestion` flow (Merge/Review anyway/Stop), but Phase 1 and Phase 2 do not gate on it. If the user selects "Merge" or "Stop", the instruction says "skip Phase 2 onward" — but this is a prose instruction within Step 0d-ii, not a formal gate in the phase dependency graph. The non-teams `code-review.md` has the same implicit skip but does not even declare `CONVERGENCE_ACTION` in Produces.
- Fix: Either (a) add `CONVERGENCE_ACTION` to the non-teams command's Step 0d-ii Produces for parity, and add a conditional gate at the top of Phase 1 ("If CONVERGENCE_ACTION is Merge or Stop: skip to Phase 4"), or (b) remove `CONVERGENCE_ACTION` from the teams Produces and keep the skip as inline prose (simpler, but less formal).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Reviewer self-verification step creates recursive agent work risk** - `shared/agents/reviewer.md:73-76`
**Confidence**: 80%
- Problem: The new self-verification step (step 9) instructs the reviewer to "Read the actual code at the flagged file:line (30 lines context)" for every finding at 80%+ confidence. This is sound for false-positive reduction, but it adds N Read calls per reviewer (where N = number of findings). With 8-19 parallel reviewers each performing their own verification reads, this compounds the I/O and context cost. The step also implicitly relies on the reviewer already having the file in context from the diff — the 30-line Read may be redundant when the diff already showed those lines.
- Fix: Add a clause: "If the flagged lines are already visible in the diff output, skip the Read — the diff is sufficient for verification." This preserves the false-positive reduction benefit while avoiding redundant reads.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Convergence threshold as magic number** - `plugins/devflow-code-review/commands/code-review.md:108` (Confidence: 70%) — The 0.7 FP ratio threshold and cycle count of 3 are hardcoded across three files. If these need tuning, all three surfaces must be updated. Consider extracting to a named constant or documenting the rationale for these specific values.

- **Missing Produces annotation on Phase 2b** - `shared/skills/review:orch/SKILL.md:63` (Confidence: 65%) — Phase 2b Produces `PRIOR_RESOLUTIONS, CYCLE_NUMBER` but Phase 5 Requires list does not explicitly mention `CYCLE_NUMBER` (it was added to Phase 6 Synthesis, which is correct). The dependency chain is Phase 2b -> Phase 5 (PRIOR_RESOLUTIONS) and Phase 2b -> Phase 6 (CYCLE_NUMBER), but this two-phase fan-out is not documented.

- **Test file imports from sibling directory** - `tests/review/convergence-detection.test.ts:2` (Confidence: 65%) — The test imports `loadFile` and `extractSection` from `../decisions/helpers`, coupling the review test directory to the decisions test directory. If the helpers are general-purpose, they could live in a shared `tests/helpers.ts` module.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The convergence detection feature is well-conceived and addresses a real problem (false-positive loops in multi-cycle reviews). The three-surface consistency is maintained through tests (Group 6 cross-cutting tests), and the edge cases are well-documented. The main architectural concern is the triplication of convergence logic across three orchestration surfaces without a shared reference — the cross-reference comment in teams acknowledges this but does not solve it. The unbounded PRIOR_RESOLUTIONS context is a secondary concern that diverges from the established compact-index pattern used by DECISIONS_CONTEXT. The synthesizer step numbering is a straightforward fix. Overall, the design is sound with targeted improvements needed.
