# Consistency Review Report

**Branch**: fix/threshold-promotion-bug -> main
**Date**: 2026-05-08

## Issues in Your Changes (BLOCKING)

### HIGH

**Incomplete refactoring: promotion logic not consolidated in `process-observations` existing-entry path** - `scripts/hooks/json-helper.cjs:1017-1030`
**Confidence**: 85%
- Problem: The `tryImmediatePromotion` helper was extracted and applied to new-entry creation in both `process-observations` (line 1054) and `merge-observation` (line 1784), but the **existing-entry** promotion block in `process-observations` (lines 1017-1030) still uses inline promotion logic that is nearly identical. The inline block has two semantic differences from the helper: (1) a `status !== 'created'` guard, and (2) a `existing.first_seen ? ... : 0` fallback vs the helper's `new Date(entry.first_seen).getTime()` without fallback. While the `status !== 'created'` guard is intentionally excluded from `tryImmediatePromotion` (per its JSDoc: "Does NOT guard against 'created' status"), having two near-identical promotion code paths violates the DRY principle that motivated this refactoring PR.
- Fix: Consider extracting a second helper (e.g., `tryPromoteExisting(entry)`) that includes the `status !== 'created'` guard and the `first_seen` fallback, or parameterize `tryImmediatePromotion` with an option like `{ guardCreated: true }`. This would make all three promotion sites use shared logic.

### MEDIUM

**New D28 notification-clearing tests replicate inline logic instead of testing extracted function** - `tests/decisions/cli-subcommands.test.ts:505-565`
**Confidence**: 82%
- Problem: The three new `capacity review notification clearing (D28)` tests replicate the inline notification-clearing logic (`if (activeCount < 50 && notifications[notifKey]) { ... }`) directly in each test body, rather than testing an exported function. This is the exact anti-pattern this PR fixes elsewhere -- the `filterEligibleEntries` and `sortByLeastUsed` tests were updated to call the real extracted functions, but the notification-clearing logic was not extracted. This creates an inconsistency within the same PR: two helper extractions are properly tested via the real function, while the notification-clearing tests continue the pattern of duplicated inline logic.
- Fix: Extract the notification-clearing loop (decisions.ts lines 893-897) into a small exported helper (e.g., `clearBelowThresholdNotifications(notifications, counts, threshold)`), export it from `decisions.ts`, and call it from both the production code and the test.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`merge-observation` existing-entry path lacks promotion logic present in `process-observations`** - `scripts/hooks/json-helper.cjs:1723-1757`
**Confidence**: 80%
- Problem: When `merge-observation` merges into an existing entry, it updates `observations`, `evidence`, `confidence`, `last_seen`, and `quality_ok` but never attempts promotion (checking whether the entry should transition from `observing` to `ready`). By contrast, `process-observations` does attempt promotion for existing entries (lines 1021-1030). If an observation's confidence crosses the promotion threshold through a merge-observation call, the entry will stay in `observing` status until the next `process-observations` run. This may be intentional (merge-observation is a single-entry D14 operation vs batch processing), but the inconsistency between the two code paths is worth noting.

## Suggestions (Lower Confidence)

- **`isCountActiveResult` guard duplicated between `decisions.ts` and `learn.ts`** - `src/cli/commands/decisions.ts:38` (Confidence: 65%) -- The comment at line 37 explicitly says "(Local copy -- decisions.ts does not import from learn.ts for this guard.)" but this creates a maintenance risk if the guard shape changes. Consider moving it to a shared utility.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR successfully improves consistency in several areas: extracting `tryImmediatePromotion` to DRY up two call sites, exporting `acquireMkdirLock` and `formatStaleReason` from `learn.ts` to eliminate inline reimplementations in `decisions.ts`, extracting `filterEligibleEntries` and `sortByLeastUsed` as testable functions with proper `DecisionsEntry` type, and aligning the `typeLabel` formatting with the learn.ts pattern. However, the refactoring is incomplete -- the existing-entry promotion path in `process-observations` was not consolidated, and the new D28 tests add fresh instances of the inline-logic-in-tests pattern that this PR otherwise removes.
