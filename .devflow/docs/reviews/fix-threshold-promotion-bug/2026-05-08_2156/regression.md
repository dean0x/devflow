# Regression Review Report

**Branch**: feat/pr-description-pipeline -> main
**Date**: 2026-05-08
**PR**: #206

## Issues in Your Changes (BLOCKING)

No blocking regression issues found.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Incomplete migration: `acquireMkdirLock` EEXIST fix not applied to local copy in `legacy-decisions-purge.ts`** - `src/cli/utils/legacy-decisions-purge.ts:64`
**Confidence**: 85%
- Problem: The EEXIST discrimination fix applied to `acquireMkdirLock` in `learn.ts:339-341` was not propagated to the duplicated local copy in `legacy-decisions-purge.ts:54-76`. The local copy still has the old bare `catch {}` that swallows all errors (ENOENT, EPERM, EACCES, etc.) and treats them as "lock held", causing silent 30-second timeout hangs on unexpected filesystem errors instead of surfacing them.
- Impact: If a filesystem error other than EEXIST occurs during migration lock acquisition (e.g., permissions error, read-only filesystem), the function will spin for 30 seconds then silently return `false` instead of throwing immediately.
- Fix: Apply the same EEXIST discrimination to the local copy:
```typescript
// src/cli/utils/legacy-decisions-purge.ts line 64
} catch (err: unknown) {
  if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
```

## Pre-existing Issues (Not Blocking)

No pre-existing regression issues found.

## Suggestions (Lower Confidence)

- **PR description vs. actual changes mismatch** (Confidence: 65%) — The PR title says "update --review to deprecate in rendered markdown" but the `updateDecisionsStatus` calls for both individual review and capacity review modes already existed in the base commit. The actual changes are: refactoring `tryImmediatePromotion` to accept options, extracting `clearCapacityNotifications`, adding `DecisionsEntryStatus` type safety, and fixing EEXIST handling in `acquireMkdirLock`. Consider updating the PR description to reflect the actual changes.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Conditions
1. Apply the EEXIST fix to the duplicated `acquireMkdirLock` in `legacy-decisions-purge.ts` to complete the migration.

### Regression Checklist

- [x] No exports removed without deprecation — `tryImmediatePromotion` signature extended with backward-compatible optional parameter (`opts = {}`)
- [x] Return types backward compatible — `DecisionsEntry.status` narrowed from `string` to union type (stricter, not breaking); `file` narrowed from `string` to `'decisions' | 'pitfalls'` (stricter, not breaking)
- [x] Default values unchanged — `tryImmediatePromotion` opts default to `{ guardCreated: false, firstSeenFallback: false }` which matches pre-refactor behavior for new entries
- [x] Side effects preserved — `clearCapacityNotifications` extraction preserves exact mutation semantics (sets `active = false`, `dismissed_at_threshold = null`)
- [x] All consumers of changed code updated — all 3 callers of `tryImmediatePromotion` verified; `existing` path passes `{ guardCreated: true, firstSeenFallback: true }` matching the inlined logic it replaced; new-entry paths pass no opts (matching old no-guard behavior)
- [x] Migration complete across codebase — **PARTIAL**: `acquireMkdirLock` fix not propagated to `legacy-decisions-purge.ts` duplicate (applies ADR-001 — clean break philosophy means no migration compat code, but this is the same function with the same bug, not a compat shim)
- [x] Tests updated — capacity notification tests now call `clearCapacityNotifications` directly instead of inlining the logic; TypeScript compiles cleanly; all 20 tests pass
- [x] Commit message matches implementation — largely yes, though the stated focus ("update --review to deprecate in rendered markdown") describes pre-existing functionality rather than the refactoring work done
