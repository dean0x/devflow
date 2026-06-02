# Testing Review Report

**Branch**: feat/init-flow-simplification -> main
**Date**: 2026-06-01_1857
**PR**: #232

## Summary of Coverage Assessment

The new pure helpers are well-covered as behavior-focused unit tests (applies ADR-011 — two-step selection, combined non-empty validation, bounded re-prompt max 3):

- **`partitionSelectablePlugins`** (8 cases in `tests/plugins.test.ts`): workflow bucketing, language bucketing, exclusion of all 3 EXCLUDED plugins, total coverage (workflow+language = selectable count), disjointness, no-mutation, ordering preservation, and empty-input. Strong — asserts observable output (bucket membership, counts, order), not internals.
- **`combineSelection`** (5 cases) + **`shouldRetry`** (4 cases) in `tests/init-logic.test.ts`: workflow-only, language-only, both-buckets, both-empty rejection, ordering; retry true/false across accepted, attempts-remaining, ceiling-reached, and beyond-ceiling. Covers the edge cases called out in the focus brief (empty buckets / out-of-attempts).
- **`WORKFLOW_ORDER`** (4 cases): contains `/bug-analysis`, `/bug-analysis` after `/self-review`, forward regression guard (every workflow command present), reverse regression guard (every entry is a real command), no duplicates. The `/bug-analysis` regression guard requested in the PR description is present and correct.

All 116 tests across the two files pass (`vitest run`). Suite is behavior-focused, no spying on internals, no flaky patterns, AAA structure throughout.

Per Cross-Cycle Awareness: the two prior false positives (independent EXCLUDED test-oracle re-declaration at `plugins.test.ts:310`; precondition assert for both-empty buckets) are NOT re-raised — both remain valid intentional choices and current code has not re-introduced the underlying concern.

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None at >=80% confidence. The selection-loop orchestration (`init.ts:349-395`) is intentionally thin glue over the now-tested pure helpers; the residual untested surface (`p.multiselect` calls, `p.isCancel` branches, `process.exit(0)`) requires DI/extraction of the @clack prompts, which would be over-extraction inconsistent with the prior-cycle FP ruling. Not blocking.

## Pre-existing Issues (Not Blocking)

None relevant to testing focus.

## Suggestions (Lower Confidence)

- **`combineSelection` lacks an immutability assertion on inputs** - `tests/init-logic.test.ts:79` (Confidence: 65%) — The function spreads both args into a new array (correct, non-mutating), and `partitionSelectablePlugins` has an explicit no-mutation test, but `combineSelection` has no parallel assertion that `workflowSelected`/`languageSelected` are left untouched. Low value since the spread is obviously pure, but it would make the immutability contract symmetric across the two new pure helpers.

- **No test exercises the empty-bucket → loop-skip interaction end-to-end** - `init.ts:352-381` (Confidence: 62%) — The loop's `if (workflowChoices.length > 0)` / `if (languageChoices.length > 0)` guards (the language-only and workflow-only paths through the *real loop*, plus the both-empty-bucket guard) are covered only indirectly via `partitionSelectablePlugins([])` + the `combineSelection`/`shouldRetry` units. The guards themselves are simple and the helpers are tested, so the risk is low; a focused harness would only matter if the loop's branch wiring later drifts. The `isCancel` exit paths (`init.ts:361,376`) are likewise unverified — acceptable given they are thin `process.exit(0)` glue.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Testing Score**: 9
**Recommendation**: APPROVED
