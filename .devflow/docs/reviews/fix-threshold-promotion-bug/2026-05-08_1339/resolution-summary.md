# Resolution Summary

**Branch**: fix/threshold-promotion-bug -> main
**Date**: 2026-05-08
**Review**: .docs/reviews/fix-threshold-promotion-bug/2026-05-08_1339
**Command**: /resolve

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 8 |
| Fixed | 6 |
| False Positive | 2 |
| Deferred | 0 |
| Blocked | 0 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| Incomplete promotion refactoring — existing-entry path consolidated via `tryImmediatePromotion` opts | json-helper.cjs:1017 | 8f1400a |
| `DecisionsEntry.status` narrowed to literal union | decisions.ts:139 | d809e65 |
| `DecisionsEntry.file` narrowed to `'decisions' \| 'pitfalls'` | decisions.ts:137 | d809e65 |
| `acquireMkdirLock` async version hardened with EEXIST check | learn.ts:333 | d809e65 |
| `clearCapacityNotifications` extracted as exported function | decisions.ts:882 | d809e65 |
| D28 notification tests updated to call `clearCapacityNotifications` | cli-subcommands.test.ts:505 | aecb17e |
| Lock release asymmetry documented with inline comment | decisions.ts:729 | d809e65 |
| First capacity test clarified with comment citing production code location | cli-subcommands.test.ts:436 | aecb17e |
| Redundant `?? 0` removed from `clearCapacityNotifications` | decisions.ts | 5884ba4 |

## False Positives
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| No unit tests for `tryImmediatePromotion` | json-helper.cjs:515 | `tests/learning/thresholds.test.ts` already covers all claimed edge cases: quality_ok=false (line 287), decision promotes on first observation (line 245), pitfall promotes (line 267), workflow stays observing (line 307), spread not satisfied (line 152). |
| `merge-observation` existing-entry path lacks promotion logic | json-helper.cjs:1723 | Intentional by design: merge-observation is reinforcement-only (D14 — evidence accumulation). Promotion is exclusively the responsibility of process-observations. |

## Deferred to Tech Debt
_(none)_

## Blocked
_(none)_

## Commits Created
- `8f1400a` refactor(json-helper): unify promotion logic via tryImmediatePromotion opts
- `d809e65` fix(decisions): harden types, lock error handling, extract notification helper
- `aecb17e` test(decisions): use clearCapacityNotifications in D28 tests; clarify inline status filter
- `5884ba4` refactor(decisions): remove redundant nullish coalescing in clearCapacityNotifications
