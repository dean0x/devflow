# Consistency Review Report

**Branch**: feat-223-review-pipeline-convergence-detection -> main
**Date**: 2026-05-20

## Issues in Your Changes (BLOCKING)

### HIGH

**Convergence warning text inconsistent across orchestration surfaces** - `shared/skills/review:orch/SKILL.md:76`, `plugins/devflow-code-review/commands/code-review.md:110`, `plugins/devflow-code-review/commands/code-review-teams.md:110`
**Confidence**: 92%
- Problem: The convergence warning message uses different wording and cycle numbering across the three orchestration surfaces:
  - `code-review.md` and `code-review-teams.md`: `"Convergence: {ratio}% false positives in cycle {N-1}. Options: Merge / Review anyway / Stop"`
  - `review:orch/SKILL.md`: `"Convergence: {ratio}% false positives at cycle {N}. Consider merging or manual inspection."`
  The cycle variable differs (`{N-1}` vs `{N}`) and the action options are completely different. While `review:orch` is non-interactive (intentionally different from the AskUserQuestion-based command variant), the cycle number reference should be semantically consistent. `{N-1}` refers to the prior cycle that had high FP, while `{N}` refers to the current cycle being started — these convey different information.
- Fix: Align on one cycle numbering convention. Since `CYCLE_NUMBER` is computed as `count + 1` (the current cycle), `{N-1}` in the command files correctly refers to the cycle whose resolution had high FP. The `review:orch` should use the same `{N-1}` reference or explicitly say "prior cycle" to match semantics:
  ```markdown
  "Convergence: {ratio}% false positives in prior cycle ({N-1}). Consider merging or manual inspection."
  ```

**PRIOR_RESOLUTIONS reviewer instruction wording inconsistent across surfaces** - `plugins/devflow-code-review/commands/code-review.md:201`, `plugins/devflow-code-review/commands/code-review-teams.md:203`, `shared/skills/review:orch/SKILL.md:143`
**Confidence**: 88%
- Problem: The instruction given to reviewers about how to use PRIOR_RESOLUTIONS differs across the three orchestration surfaces:
  - `code-review.md`: `"Compare findings against prior resolutions. See Cross-Cycle Awareness in your instructions."`
  - `code-review-teams.md`: `"If PRIOR_RESOLUTIONS is not (none), check Cross-Cycle Awareness in reviewer.md."`
  - `review:orch/SKILL.md`: `"Compare findings against prior resolutions. (none) when absent."` (no reference to Cross-Cycle Awareness)
  The teams variant is the most precise (conditions on non-none, names the target file). The review:orch variant omits the Cross-Cycle Awareness reference entirely, meaning ambient-mode reviewers may not know to follow the structured parsing steps in that section.
- Fix: Align all three to the teams variant pattern:
  ```
  If PRIOR_RESOLUTIONS is not (none), follow Cross-Cycle Awareness in reviewer.md.
  ```

### MEDIUM

**Synthesizer Input section does not document CYCLE_NUMBER or PRIOR_RESOLUTIONS** - `shared/agents/synthesizer.md:17-21`
**Confidence**: 90%
- Problem: The synthesizer's `## Input` section lists Mode, Agent outputs, Output path, and Research outputs — but the new review-mode process step 4b references both `CYCLE_NUMBER` and `PRIOR_RESOLUTIONS` without either being documented as an input. The orchestration surfaces pass `CYCLE_NUMBER` to the synthesizer (confirmed in `code-review.md:235`, `code-review-teams.md:297`, `review:orch/SKILL.md:152`) but the synthesizer has no input declaration for it. Every other agent (reviewer, resolver) documents its optional inputs.
- Fix: Add review-mode inputs to the Input section:
  ```markdown
  - **CYCLE_NUMBER** (review mode): Current review cycle number. `1` on first review. Used for convergence reporting.
  - **PRIOR_RESOLUTIONS** (review mode, optional): Prior resolution-summary.md content for cross-reference. `(none)` when absent.
  ```

**Non-standard step numbering `4b.` in synthesizer review mode** - `shared/agents/synthesizer.md:241`
**Confidence**: 85%
- Problem: The new review-mode process step uses `4b.` numbering, which is unique in the entire codebase. All other numbered lists in agents and skills use sequential integers (1, 2, 3, 4, 5...). This breaks the established numbering convention.
- Fix: Renumber to use a standard sequential integer. Insert as step 5 and bump subsequent steps:
  ```markdown
  5. If CYCLE_NUMBER provided (>1): cross-reference findings against PRIOR_RESOLUTIONS to note recurring vs new issues
  6. Categorize issues into 3 buckets (from devflow:review-methodology)
  7. Count by severity (CRITICAL, HIGH, MEDIUM, LOW)
  8. Determine merge recommendation based on blocking issues
  ```

**CONVERGENCE_ACTION declared but never consumed** - `plugins/devflow-code-review/commands/code-review.md:99`, `plugins/devflow-code-review/commands/code-review-teams.md:99`
**Confidence**: 90%
- Problem: Step 0d-ii declares `**Produces:** CYCLE_NUMBER, CONVERGENCE_ACTION` in both command files, but `CONVERGENCE_ACTION` is never referenced by any downstream phase (`Requires:` annotations, reviewer prompts, or synthesizer invocations). It is a dead variable declaration, violating the convention that every `Produces` variable should appear in at least one downstream `Requires` or invocation.
- Fix: Either remove `CONVERGENCE_ACTION` from the Produces annotation (since the convergence action is handled inline via AskUserQuestion in Step 0d-ii itself), or document its consumption in Phase 2's `Requires:` if it is intended to gate Phase 2 execution.

**Unidirectional sync note between command variants** - `plugins/devflow-code-review/commands/code-review-teams.md:115`
**Confidence**: 82%
- Problem: `code-review-teams.md` has `NOTE: Convergence logic mirrored in code-review.md -- changes must sync.` but `code-review.md` has no reciprocal note. A developer modifying `code-review.md` would not see a reminder to sync with the teams variant.
- Fix: Add a matching note to `code-review.md` after Step 0d-ii:
  ```markdown
  NOTE: Convergence logic mirrored in code-review-teams.md -- changes must sync.
  ```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Missing semicolons in test file** - `tests/review/convergence-detection.test.ts` (Confidence: 60%) -- The new test file omits trailing semicolons while the majority of test files in the project use them. However, 3 other recent test files also omit semicolons (the decisions test files), so this may be an emerging convention shift. Not flagging as blocking since there is no linter enforcement.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 3 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The convergence feature is well-structured and correctly propagated across all three orchestration surfaces with good test coverage (39 passing cross-cutting tests). However, the wording inconsistencies across surfaces (cycle numbering, reviewer instruction phrasing, missing Cross-Cycle Awareness reference in review:orch) risk confusing agent behavior during real review cycles. The dead `CONVERGENCE_ACTION` variable and undocumented synthesizer inputs are lower priority but should be cleaned up for convention compliance.
