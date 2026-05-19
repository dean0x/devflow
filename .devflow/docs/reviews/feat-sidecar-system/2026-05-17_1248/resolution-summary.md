# Resolution Summary

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17_1248
**Review**: .docs/reviews/feat-sidecar-system/2026-05-17_1248
**Command**: /resolve

## Decisions Citations

- applies ADR-001 — batch-3, issue-1 (session-start-memory sentinel removal)
- applies ADR-001 — batch-3, issue-4 (pre-compact-memory sentinel replacement)

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 20 |
| Fixed | 18 |
| False Positive | 2 |
| Deferred | 0 |
| Blocked | 0 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| CRITICAL: Add artifact reinforcement scan | sidecar-evaluate (new section) | a38af59 |
| CRITICAL: Empty "[]" outputs empty stdout | transcript-filter.cjs:194-205 | 2eab8a6 |
| HIGH: Add timestamp to learning/decisions markers | sidecar-evaluate:178,260 | a38af59 |
| HIGH: Session ID dedup grep -qxF | sidecar-evaluate:137 | a38af59 |
| HIGH: Knowledge throttle marker updated | sidecar-evaluate:309-323 | a38af59 |
| HIGH: Clean .retries on successful dispatch | sidecar-dispatch:151-158 | 2eab8a6 |
| HIGH: Sanitize retry count (tr -dc 0-9) | sidecar-dispatch:103-107 | 2eab8a6 |
| HIGH: Check feature enabled at dispatch time | sidecar-dispatch:31-41,133-140 | 2eab8a6 |
| HIGH: Guard stale-retry loop with compgen | sidecar-dispatch:82-122 | 2eab8a6 |
| HIGH: Comment explaining sentinel removal (ADR-001) | session-start-memory:21-26 | 7a09b95 |
| HIGH: Cache devflow_log_dir after first call | log-paths:5-12 | 7a09b95 |
| HIGH: Separate decisions scanner from memory gate | sidecar-capture:42-47 | 7a09b95 |
| HIGH: pre-compact-memory uses sidecar config | pre-compact-memory:24 | 7a09b95 |
| MEDIUM: Replace wc -l with [ -s ] for queue check | sidecar-capture:83-86 | 7a09b95 |
| HIGH: Fix --enable "already enabled" message | memory.ts:325 | fd5ac5b |
| MEDIUM: Update JSDoc to list 5 hooks | memory.ts:69 | fd5ac5b |
| HIGH: Remove conditional log assertions (8 tests) | shell-hooks.test.ts | b5c38e7 |
| MEDIUM: Replace catch(e: any) with unknown | shell-hooks.test.ts:1824 | b5c38e7 |

## False Positives
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| Decisions sentinel check removed | sidecar-evaluate:207-210 | Already fixed in prior commit 5415c98 — comment explaining design already present |
| init.ts/memory.ts config write race | init.ts:1139 | Not a race — init uses atomic writeConfig for all 4 features; this is intentionally different from per-feature updateFeature. Added clarifying comment. |

## Deferred to Tech Debt
(none)

## Blocked
(none)
