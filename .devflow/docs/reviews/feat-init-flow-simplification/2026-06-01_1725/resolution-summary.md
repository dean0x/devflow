# Resolution Summary

**Branch**: feat/init-flow-simplification -> main
**Date**: 2026-06-01_1725
**Review**: .devflow/docs/reviews/feat-init-flow-simplification/2026-06-01_1725
**Command**: /resolve

## Decisions Citations

- applies ADR-008 — batch-1, issue-3 (deterministic CLI plumbing logic)
- avoids PF-005 — batch-1, issue-3 (verified @clack types before removing casts)
- avoids PF-007 — batch-1 (edited src/cli source only, not installed copies)

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 9 |
| Fixed | 7 |
| False Positive | 2 |
| Deferred | 0 |
| Blocked | 0 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| Extract pure `combineSelection`/`shouldRetry` from interactive loop + 10 unit tests | src/cli/commands/init.ts:322-373, tests/init-logic.test.ts | 2de84c5 |
| Add reverse WORKFLOW_ORDER regression guard (every ORDER entry maps to a real registry command) | tests/plugins.test.ts:400-412 | 2de84c5 |
| Remove redundant `as string[]` casts (isCancel already narrows) | src/cli/commands/init.ts:342,357 | 2de84c5 |
| Loop clarity refactor — separate "got selection" from "out of attempts" via `isLastAttempt` | src/cli/commands/init.ts:367-372 | 2de84c5 |
| Clarifying comment on `language` bucket predicate (commands.length === 0 implicit contract) | src/cli/plugins.ts:729 | 2de84c5 |
| Reorder `pluginHints` so `self-review` precedes `bug-analysis` (matches WORKFLOW_ORDER) | src/cli/commands/init.ts:283-302 | 2de84c5 |
| Extract shared `toChoice` helper, dedupe workflow/language `.map` bodies | src/cli/commands/init.ts:306-316 | 2de84c5 |

## False Positives
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| Test re-declares EXCLUDED set instead of importing | tests/plugins.test.ts:310 | Intentional independent test oracle. Exporting the internal `EXCLUDED` Set solely for tests would leak a private implementation detail; drift risk is low, independence value higher. Won't fix. |
| Add precondition assert for both-empty buckets | src/cli/commands/init.ts (loop) | Noise over value — the loop only runs inside the isTTY branch where buckets are non-empty in practice; the degenerate case is already covered by `combineSelection` return type and `shouldRetry` tests. Won't fix. |

## Deferred to Tech Debt
None.

## Blocked
None.

## Notes
All 9 reviewers returned APPROVED / APPROVED_WITH_CONDITIONS with zero blocking issues. The 3 should-fix items (≥80% confidence) and 4 low-confidence suggestions were resolved directly; 2 suggestions were validated as won't-fix with reasoning. Full suite: 1528 passed, 0 failed. Build clean under strict TypeScript.
