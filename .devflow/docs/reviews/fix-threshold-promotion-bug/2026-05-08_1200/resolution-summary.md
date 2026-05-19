# Resolution Summary

**Branch**: fix/threshold-promotion-bug -> main
**Date**: 2026-05-08_1200
**Review**: .docs/reviews/fix-threshold-promotion-bug/2026-05-08_1200
**Command**: /resolve

## Decisions Citations

- applies ADR-001 — batch-A (no migration shims for promotion helper extraction), batch-B (clean break on lock/format fixes)

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 10 |
| Fixed | 6 |
| False Positive | 2 |
| Deferred | 2 |
| Blocked | 0 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| Duplicated promotion logic → extracted `tryImmediatePromotion()` | json-helper.cjs:1014-1041,1752-1778 | 8d89a20 |
| Lock inconsistency → replaced bare fs.mkdir with acquireMkdirLock | decisions.ts:586-594 | 80113ca |
| Inline filter/sort → extracted `filterEligibleEntries`, `sortByLeastUsed` | decisions.ts:748-799 | 80113ca |
| Inconsistent type-label formatting → generic capitalization | decisions.ts:603 | 80113ca |
| Missing notification clearing tests → 3 tests added | decisions.ts:843-881 | 80113ca |
| Inline reason formatting → imported `formatStaleReason` from learn.ts | decisions.ts:603-608 | 80113ca |

## False Positives
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| Capacity review outer lock | decisions.ts:827-841 | Would deadlock — `updateDecisionsStatus` already acquires `.decisions.lock` internally via `acquireMkdirLock`. Adding outer lock on same path = permanent deadlock. Per-call locking is the correct granularity. |
| `isCountActiveResult` duplicated | decisions.ts:31-39 | Function was already removed from learn.ts in this PR. The local copy in decisions.ts is the sole instance. No duplication exists. |

## Deferred to Tech Debt
| Issue | File:Line | Risk Factor | GitHub Issue |
|-------|-----------|-------------|--------------|
| learn.ts shared module architecture | learn.ts (whole file) | Pre-existing coupling — 15+ exports consumed by decisions.ts. Requires bulk move to shared utility module. | #204 |
| learn.ts monolithic handler | learn.ts (whole file) | Pre-existing — 673-line handler with 11 branches. Pure refactoring, no behavioral changes. | #207 |
