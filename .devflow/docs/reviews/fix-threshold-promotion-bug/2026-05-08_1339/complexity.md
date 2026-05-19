# Complexity Review Report

**Branch**: fix/threshold-promotion-bug -> main
**Date**: 2026-05-08

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### HIGH

**Monolithic action handler in decisions.ts** - `src/cli/commands/decisions.ts:217`
**Confidence**: 90%
- Problem: The `.action()` handler spans approximately 780 lines (lines 217-997), containing 11 branched subcommands (`--enable`, `--disable`, `--status`, `--list`, `--configure`, `--clear`, `--reset`, `--review` with two nested modes, `--dismiss-capacity`, `--run-background`) all inlined within a single closure. Cyclomatic complexity is very high (estimated >30), and nesting reaches 4-5 levels in the `--review capacity` and `--review observations` modes. This is well above the CRITICAL threshold of >200 lines and complexity >20.
- Fix: Extract each `if (options.X)` block into its own named function (e.g., `handleStatus()`, `handleReview()`, `handleCapacity()`, `handleRunBackground()`). The PR's extraction of `filterEligibleEntries` and `sortByLeastUsed` is a step in the right direction but does not address the root structural issue.

### MEDIUM

**json-helper.cjs file length exceeds critical threshold** - `scripts/hooks/json-helper.cjs`
**Confidence**: 85%
- Problem: The file is 1935 lines long (critical threshold: >500). The `if (require.main === module)` block contains a single massive switch statement with 25+ cases. While the `tryImmediatePromotion` extraction helps, the overall file remains a single-module monolith.
- Fix: The existing pattern of extracting domain modules (e.g., `lib/sidecar-ops.cjs`) is the right approach. The `render-ready`, `reconcile-manifest`, `merge-observation`, and `decisions-append` cases could be extracted into a `lib/decisions-ops.cjs` module.

**Inline promotion logic in process-observations still duplicated** - `scripts/hooks/json-helper.cjs:1021-1030`
**Confidence**: 82%
- Problem: The promotion check for *existing* entries (lines 1021-1030) duplicates the same threshold+confidence+spread logic that `tryImmediatePromotion` encapsulates, but with a minor difference (guards `existing.status !== 'created'` and uses `existing.first_seen ? ... : 0` instead of direct `new Date()`). The refactor extracted the helper for new entries but left the structurally identical logic for existing entries inline. This creates a subtle maintenance risk: if the promotion algorithm changes, two code paths must be updated.
- Fix: Extend `tryImmediatePromotion` (or create a shared `checkPromotion`) to accept an optional `skipIfCreated` flag, unifying both paths.

## Suggestions (Lower Confidence)

- **Notification clearing logic duplicated between test and production** - `tests/decisions/cli-subcommands.test.ts:520-527` (Confidence: 65%) -- The D28 notification clearing tests replicate the production logic inline rather than calling the production code. If the logic changes, tests and production can silently diverge. Consider extracting the clearing logic into a named, exported function and testing that directly.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 1 | 2 | 0 |

**Complexity Score**: 7/10
**Recommendation**: APPROVED

The PR is a net positive for complexity: it extracts `tryImmediatePromotion` from two inline duplications in `json-helper.cjs`, extracts `filterEligibleEntries` and `sortByLeastUsed` from inline logic in the capacity review handler, exports `acquireMkdirLock` and `formatStaleReason` for reuse across modules, introduces the `DecisionsEntry` type to replace an anonymous inline type, and updates tests to call the exported helpers instead of duplicating logic. All changes reduce duplication and improve testability without increasing nesting or cyclomatic complexity. The pre-existing issues (monolithic action handler, massive json-helper.cjs) predate this PR and are informational only.
