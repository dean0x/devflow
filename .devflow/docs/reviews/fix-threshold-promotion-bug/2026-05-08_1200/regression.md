# Regression Review Report

**Branch**: fix-threshold-promotion-bug -> main
**Date**: 2026-05-08

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`devflow learn --review` help text still says "at capacity"** - `src/cli/commands/learn.ts:482` (Confidence: 65%) -- The `--review` option description reads "Interactively review flagged observations (stale, missing, at capacity)" but the capacity review mode has been moved to `devflow decisions --review`. The "at capacity" text may confuse users who expect to find capacity review under `learn --review`. However, the `softCapExceeded` flag can still appear on workflow/procedural observations, so the description is technically not wrong -- it just may be misleading now that the full capacity review UI lives elsewhere.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED

## Analysis Details

### Changes Reviewed

This PR makes two primary changes:

1. **Fix: Immediate promotion for decision/pitfall observations** -- Decision and pitfall observations now promote to `ready` status on first creation when `quality_ok=true`. Previously, new entries always started at `status: 'observing'` with `confidence: 0.33` (INITIAL_CONFIDENCE), which meant even with `required=1` and `spread=0` thresholds, the entry would never reach the `promote=0.65` threshold without a second reinforcement. The fix sets initial confidence to `calculateConfidence(1, type)` (= 0.95 for types with `required=1`) and checks promotion immediately after entry creation. This fix is applied in both `process-observations` and `merge-observation` code paths in `json-helper.cjs`.

2. **Refactor: Port capacity review from `learn --review` to `decisions --review`** -- The capacity review mode (deprecate least-used ADR/PF entries) is moved from `devflow learn --review` to `devflow decisions --review`, which is its natural home since it operates on decisions/pitfalls exclusively. `learn --review` is simplified to go straight to the observations-flagged review without a mode picker. `decisions --review` gains a two-mode picker (observations vs capacity).

### Regression Checklist

- [x] **No exports removed without deprecation** -- `isCountActiveResult` was removed from `learn.ts` but a local copy was added to `decisions.ts` where it is now used. The function was never exported from `learn.ts`. No consumer breakage.
- [x] **Return types backward compatible** -- No public API return types changed.
- [x] **Default values unchanged** -- INITIAL_CONFIDENCE (0.33) is unchanged for workflow/procedural types. Decision/pitfall types now get `calculateConfidence(1, type)` = 0.95 instead of 0.33, but this is the intentional bug fix.
- [x] **Side effects preserved** -- Lock acquisition patterns, file writes, logging all preserved.
- [x] **All consumers of changed code updated** -- Both `process-observations` and `merge-observation` in `json-helper.cjs` have been updated with the same immediate-type promotion logic. Consistent behavior across both entry paths.
- [x] **Migration complete across codebase** -- Capacity review code fully removed from `learn.ts`, fully added to `decisions.ts`. No partial migration.
- [x] **CLI options preserved** -- `learn --review` still exists but simplified (no mode picker). `decisions --review` gained capacity mode. No option removed.
- [x] **Commit messages match implementation** -- Each of the 6 commits accurately describes its changes. applies ADR-001 (no migration code needed -- this is a clean code relocation, not a rename requiring backward compat).
- [x] **Breaking changes documented** -- CLAUDE.md updated with new `devflow decisions --review` documentation.

### Specific Regression Checks

1. **Workflow/procedural observations unaffected** -- New entry path: `isImmediateType` is false for workflow/procedural, so they still get `INITIAL_CONFIDENCE = 0.33` and skip the immediate promotion check. Verified by test cases `workflow unaffected` and `procedural unaffected`.

2. **Existing entry update path unchanged** -- The `if (existing)` branch in `process-observations` is untouched. Existing observations still use `calculateConfidence(newCount, type)` and the standard threshold+spread check.

3. **Lock handling consistent** -- `decisions --review` observations mode uses `.decisions.lock` (matching the decisions pipeline). `learn --review` uses `.learning.lock` (matching the learning pipeline). No deadlock risk.

4. **Notification file paths correct** -- `decisions --review` capacity mode writes to `.decisions-notifications.json` (correct for decisions pipeline). `learn --dismiss-capacity` reads from `.learning-notifications.json` (correct for learning pipeline).

5. **Test coverage** -- 8 new test cases cover: immediate promotion for decisions, immediate promotion for pitfalls, quality_ok=false blocks promotion, workflow/procedural unaffected, merge-observation immediate promotion, capacity review filtering logic, 7-day protection, sort order. All 65 tests pass. avoids PF-001 (no migration code added -- clean relocation of capacity review code).

6. **TypeScript compilation** -- `npm run build:cli` succeeds with no errors. All imports (`updateDecisionsStatus`, `execFileSync`, `writeFileAtomicExclusive`, `NotificationFileEntry`, `isNotificationMap`) verified present.
