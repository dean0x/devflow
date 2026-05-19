# Testing Review Report

**Branch**: fix-threshold-promotion-bug -> main
**Date**: 2026-05-08

## PR Summary (Testing Perspective)

This PR fixes a threshold/promotion bug where decision and pitfall observation types should promote to `ready` on their first observation (when `quality_ok=true`), since their `required=1` and `spread=0`. The production changes span `json-helper.cjs` (immediate-type promotion in `process-observations` and `merge-observation` ops), `decisions.ts` (capacity review mode ported from `learn.ts`), and `learn.ts` (simplified `--review` to observations-only after capacity mode migration). Four test files are modified to cover the new behaviors.

## Issues in Your Changes (BLOCKING)

### HIGH

**Tests for capacity review logic in `cli-subcommands.test.ts` replicate inline logic rather than testing the production code** - `tests/decisions/cli-subcommands.test.ts:430-515`
**Confidence**: 85%
- Problem: The capacity review tests (`decisions --review capacity mode logic` describe block) re-implement the filtering, protection window, and sorting logic inline within the test rather than importing and invoking the actual production functions from `decisions.ts`. Each test creates local data structures and applies its own `filter`/`sort` calls that mirror the production code. If the production code diverges from these inline copies (e.g., a developer changes the sort order in `decisions.ts` but not in the test), the tests would still pass while the production code is broken. This violates the testing iron law: tests should validate behavior, not replicate implementation.
- Fix: Extract the filtering logic (status exclusion, 7-day protection, least-used sort) from the `decisions.ts` `--review capacity` handler into named, exported pure functions (e.g., `filterEligibleEntries`, `sortByLeastUsed`). Import and call those functions in the tests instead of duplicating the logic. This is the same pattern already used for `parseLearningLog`, `loadAndCountObservations`, and `updateDecisionsStatus` in the learning tests. Example:

```typescript
// In decisions.ts — extract from the inline handler:
export function filterEligibleEntries(
  entries: CapacityEntry[],
  protectionDays: number = 7,
): CapacityEntry[] {
  const cutoff = new Date(Date.now() - protectionDays * 86400000)
    .toISOString().slice(0, 10);
  return entries.filter(e => !e.createdDate || e.createdDate <= cutoff);
}

// In cli-subcommands.test.ts:
import { filterEligibleEntries } from '../../src/cli/commands/decisions.js';

it('excludes entries created within 7-day protection window', () => {
  const entries = [ /* ... */ ];
  const eligible = filterEligibleEntries(entries);
  expect(eligible).toHaveLength(2);
});
```

**Several tests in `cli-subcommands.test.ts` also replicate inline logic for filtering/list/status/purge** - `tests/decisions/cli-subcommands.test.ts:114-157, 163-208, 254-272`
**Confidence**: 82%
- Problem: The `decisions --list filtering logic`, `decisions --status count logic`, and `decisions --purge type filtering` describe blocks similarly inline the `Array.filter` expressions rather than testing the production command's actual filter paths. For example, the list filtering test manually applies `all.filter(o => o.type === 'decision' || o.type === 'pitfall')` instead of calling through the production list handler. While the simpler filters (type checks) are less likely to drift than the capacity sort, the pattern still creates a maintenance risk for the same reason.
- Fix: For these simpler cases, the minimal fix is to extract and export the type-filtering predicate from `decisions.ts` (e.g., `isDecisionOrPitfall`) and use it in both production and test code. Even a single shared constant/predicate eliminates the drift risk.

### MEDIUM

**`learn --review simplified` tests duplicate the same filtering logic already tested in `observation attention flags detection`** - `tests/learning/review-command.test.ts:390-419`
**Confidence**: 83%
- Problem: The two new tests in `learn --review simplified (no mode picker)` apply the exact same `obs.filter(o => o.mayBeStale || o.needsReview || o.softCapExceeded)` expression that is already tested in the `observation attention flags detection` describe block at lines 213-257 of the same file. This is redundant testing of the same inline expression, not testing different production code paths.
- Fix: Either (a) remove the duplicate tests since the behavior is already covered, or (b) if the intent is to verify the simplified handler path specifically, extract the filter into a named function in `learn.ts` and test that function directly. Option (a) is simpler and preferred.

**Missing test for `decisions.ts` capacity review markdown parsing logic** - `src/cli/commands/decisions.ts:700-741`
**Confidence**: 80%
- Problem: The capacity review handler in `decisions.ts` contains a regex-based markdown parser (lines 700-741) that extracts `ADR-NNN`/`PF-NNN` headings, their Status, and Date fields from decisions.md/pitfalls.md files. This parsing logic is non-trivial (regex with named groups, section slicing, multi-field extraction) and has no direct test. The `count-active` tests in `review-command.test.ts:301-354` validate the json-helper.cjs `count-active` op, but that uses a different counting implementation. The inline regex parser in `decisions.ts` could have edge case bugs (e.g., entries with no Date field, entries with Status in an unexpected position) that would go undetected.
- Fix: Extract the markdown entry parsing into a testable function:

```typescript
export function parseDecisionsEntries(
  content: string,
  type: 'decision' | 'pitfall',
): Array<{ id: string; pattern: string; status: string; createdDate: string | null }> {
  // ... regex logic currently at lines 709-741
}
```
Then add tests covering edge cases: entries missing Date, entries missing Status, multiple entries in one file, empty file.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`today` variable declared but unused in 7-day protection test** - `tests/decisions/cli-subcommands.test.ts:453`
**Confidence**: 92%
- Problem: The test declares `const today = ...` on line 453 but it is never used in any assertion or data setup (the `today` entry uses the literal `today` variable but `ADR-003` already covers that case with `createdDate: today`). However, this is borderline since `today` IS used on line 461 as `createdDate: today` for `ADR-003`. Upon closer inspection this is fine -- the variable is used. Disregard.
- Fix: N/A (false alarm on closer inspection).

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`cli-subcommands.test.ts` imports `parseLearningLog` and `loadAndCountObservations` from `learn.ts` but only uses them for decisions-specific testing** - `tests/decisions/cli-subcommands.test.ts:75-79`
**Confidence**: 80%
- Problem: The test file imports functions from `learn.ts` to test decisions behavior. While functionally correct (the functions are shared), this creates a coupling where changes to `learn.ts` exports could break decisions tests in non-obvious ways. The `decisions.ts` module already re-exports what it needs from `learn.ts`.
- Fix: Consider re-exporting `parseLearningLog` and `loadAndCountObservations` from `decisions.ts` (or a shared utility) and importing from there in the decisions tests.

## Suggestions (Lower Confidence)

- **No test for `quality_ok=false` path in merge-observation immediate promotion** - `tests/learning/merge-observation.test.ts:306-341` (Confidence: 70%) -- The new `merge-observation -- immediate type promotion on new entry` describe block only tests the `quality_ok=true` path for decisions. A `quality_ok=false` case would verify that decisions do NOT promote on first merge when quality is low, mirroring the `decision stays observing when quality_ok=false` test in `thresholds.test.ts`.

- **No test for pitfall type in merge-observation immediate promotion** - `tests/learning/merge-observation.test.ts:306-341` (Confidence: 65%) -- Only `decision` type is tested for immediate promotion via merge-observation. A parallel `pitfall` test would increase confidence that both immediate types promote correctly through the merge path.

- **Capacity review notification clearing logic (D28) in `decisions.ts:843-881` has no test** - (Confidence: 72%) -- The post-deprecation notification clearing logic that reads `.decisions-notifications.json`, invokes `count-active` via `execFileSync`, and conditionally clears notifications when count < 50 is not tested. This is a multi-step side-effect chain that could silently break.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Testing Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The new tests cover the core threshold/promotion bug fix well (5 new tests in `thresholds.test.ts` for immediate promotion, 1 in `merge-observation.test.ts`). The `json-helper.cjs` changes are exercised through integration tests via `runHelper`. However, the capacity review tests ported to `cli-subcommands.test.ts` replicate production logic inline rather than testing the actual production code -- a pattern that creates drift risk and violates test-behavior coupling principles. Extracting the filtering/sorting logic into testable functions would significantly improve confidence.
