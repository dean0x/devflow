# Regression Review Report

**Branch**: fix/threshold-promotion-bug -> main
**Date**: 2026-05-08
**Commits**: 8d89a20..80113ca (2 commits)

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

(none)

## Analysis Details

### 1. tryImmediatePromotion extraction (json-helper.cjs)

Two inline promotion blocks (in `process-observations` and `merge-observation` switch cases) were extracted into a shared `tryImmediatePromotion(entry)` function. Verified character-for-character behavioral equivalence:

- Both old inline blocks and the new function use the same THRESHOLDS lookup, confidence check, quality_ok gate, first_seen date parsing, spread calculation, and status assignment.
- The `isImmediateType` guard (`obs.type === 'decision' || obs.type === 'pitfall'`) remains at both call sites, so the function is never called for workflow/procedural types. No regression.
- The new function mutates the entry in place, matching the old inline behavior.

### 2. Lock acquisition change (decisions.ts --review observations)

Old behavior: one-shot `await fs.mkdir(decisionsLockDir)` that failed immediately if the lock directory existed.

New behavior: `await acquireMkdirLock(decisionsLockDir)` which retries for up to 30 seconds with 100ms polling and stale lock recovery (removes locks older than 60 seconds).

This is a deliberate improvement (hardening), not a regression. The old one-shot approach could fail spuriously if a background decisions agent held the lock momentarily. The `lockAcquired` guard removal in the `finally` block is safe because control flow guarantees the `finally` is only reached after successful acquisition (early return on line 647-649 if lock fails).

### 3. Type label refactoring (decisions.ts --review observations)

Old: `obs.type === 'decision' ? 'Decision' : 'Pitfall'`
New: `obs.type.charAt(0).toUpperCase() + obs.type.slice(1)`

Since the `flagged` list is pre-filtered to only `decision` and `pitfall` types (line 637), the generic capitalize produces identical output: `'Decision'` and `'Pitfall'`. No regression.

### 4. formatStaleReason extraction

Old: inline reason-building code duplicated between learn.ts and decisions.ts.
New: `formatStaleReason` from learn.ts (now exported) is reused in decisions.ts.

The function body is identical to the old inline code. No regression.

### 5. filterEligibleEntries and sortByLeastUsed extraction

Both functions are exact copies of the inline logic they replaced. Tests that previously validated inline logic now test the extracted functions directly. All 20 tests pass.

### 6. Export additions (learn.ts)

`acquireMkdirLock` and `formatStaleReason` changed from module-private to exported. Adding exports is backward-compatible -- no existing consumers break.

### 7. New test coverage (D28 notification clearing)

Three new tests added for capacity review notification clearing logic. These test inline logic replication (not the exported functions), but validate the D28 contract. No regression concern.

### 8. Intent vs Reality check

- Commit 8d89a20 (`refactor(json-helper): extract tryImmediatePromotion helper`): accurately describes extracting inline promotion logic into a named function. Verified.
- Commit 80113ca (`fix(decisions): harden lock acquisition, extract helpers, improve consistency`): accurately describes the lock hardening, helper extraction, and consistency improvements. Verified.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 10/10
**Recommendation**: APPROVED
