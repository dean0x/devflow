# Testing Review Report

**Branch**: fix/threshold-promotion-bug -> main
**Date**: 2026-05-08

## Issues in Your Changes (BLOCKING)

### HIGH

**New D28 notification tests replicate inline logic instead of calling the actual production code** - `tests/decisions/cli-subcommands.test.ts:505-565`
**Confidence**: 85%
- Problem: The three new tests in the `capacity review notification clearing (D28)` describe block (lines 505-565) manually re-implement the notification clearing logic inline (`if (activeCount < 50 && notifications[notifKey]) { ... }`) rather than importing and calling the actual function from `decisions.ts`. This means the tests validate a copy-pasted version of the logic, not the production code itself. If the production code diverges from this inlined replica, the tests will still pass even when the real behavior is broken. This is the same anti-pattern that the PR itself is fixing in the `filterEligibleEntries` and `sortByLeastUsed` tests (where inline logic was replaced with calls to the extracted functions).
- Fix: Extract the notification clearing logic from the `--review capacity` handler (around `decisions.ts:882-898`) into a named exported function (e.g., `clearCapacityNotificationsIfBelowThreshold`), then call that function from the tests instead of duplicating the `if` condition inline. This follows the same pattern the PR already established with `filterEligibleEntries` and `sortByLeastUsed`.

### MEDIUM

**First capacity mode test still uses inline logic instead of `filterEligibleEntries`** - `tests/decisions/cli-subcommands.test.ts:436-455`
**Confidence**: 90%
- Problem: The test `excludes deprecated and superseded entries from eligible list` at line 436 still uses an inline `allEntries.filter(e => e.status !== 'Deprecated' && e.status !== 'Superseded')` rather than calling the exported `filterEligibleEntries` function. This is inconsistent with the other two tests in the same describe block which were updated to call `filterEligibleEntries` and `sortByLeastUsed`. Note that `filterEligibleEntries` applies the 7-day protection window filter but does NOT filter by Deprecated/Superseded status -- that filtering happens earlier in the command handler (line 769). So this test is testing different logic than `filterEligibleEntries`, but the inconsistency is worth noting: either the Deprecated/Superseded filter should also be extracted (for testability) or this test's comment should clarify it is deliberately testing the status-filtering step that precedes `filterEligibleEntries`.
- Fix: Either extract the status filter into a named function and test it directly, or update the test comment to clarify it intentionally tests the pre-filter step (lines 768-769 of decisions.ts) that is separate from `filterEligibleEntries`.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**No unit tests for `tryImmediatePromotion` helper in isolation** - `scripts/hooks/json-helper.cjs:515-524`
**Confidence**: 82%
- Problem: The newly extracted `tryImmediatePromotion` function in `json-helper.cjs` (lines 515-524) is a pure function with clear behavior (check threshold, check quality_ok, check spread, mutate status). The existing integration tests in `tests/learning/thresholds.test.ts` and `tests/learning/merge-observation.test.ts` exercise the promotion path indirectly through `process-observations` and `merge-observation` CLI operations, which do cover the extracted helper. However, there is no direct unit test for `tryImmediatePromotion` itself that validates edge cases like: (a) entry with `quality_ok=false` should NOT promote, (b) entry with confidence below threshold should NOT promote, (c) entry with invalid `first_seen` date (NaN) should NOT promote. The refactoring from inline to helper is behavior-preserving, so the existing integration tests do validate the happy path, but the helper now has a clear contract worth testing directly.
- Fix: Add unit tests for `tryImmediatePromotion` by either: (1) exporting it from `json-helper.cjs` via `module.exports` for direct testing, or (2) adding targeted integration tests via `process-observations` / `merge-observation` that exercise the edge cases (quality_ok=false, confidence below threshold, invalid date).

## Pre-existing Issues (Not Blocking)

No critical pre-existing testing issues found in the reviewed files.

## Suggestions (Lower Confidence)

- **Boundary value test for exactly 7-day-old entries in `filterEligibleEntries`** - `tests/decisions/cli-subcommands.test.ts:457` (Confidence: 70%) -- The test covers entries at 3 days (excluded), 10 days (included), today (excluded), and null (included), but does not test the exact boundary of exactly 7 days ago, which is the threshold. An entry created exactly 7 days ago should be eligible (the comparison is `<=`), but this edge case is not verified.

- **`acquireMkdirLock` default timeout may be too long for interactive `--review` UX** - `src/cli/commands/decisions.ts:646` (Confidence: 65%) -- The `acquireMkdirLock` call in the `--review observations` handler uses the default 30-second timeout. For an interactive CLI command, 30 seconds of blocking with no feedback could appear as a hang. The previous code used a single `mkdir` attempt (fail-fast). Consider either reducing the timeout for interactive contexts or adding a spinner/message during the wait.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The PR correctly extracts `filterEligibleEntries` and `sortByLeastUsed` into testable functions and updates two of three existing tests to call them directly -- a clear improvement. However, the same pattern was not followed for the new D28 notification clearing tests, which inline a replica of the production logic instead of testing it through the actual code path. The `tryImmediatePromotion` refactoring in json-helper.cjs is behavior-preserving and adequately covered by existing integration tests, though direct unit tests for the helper's edge cases would strengthen confidence.
