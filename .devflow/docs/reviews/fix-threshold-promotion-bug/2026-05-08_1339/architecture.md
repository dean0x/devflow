# Architecture Review Report

**Branch**: fix/threshold-promotion-bug -> main
**Date**: 2026-05-08
**Commits**: 80113ca, 8d89a20

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

### HIGH

**Dual `acquireMkdirLock` implementations with divergent semantics** - `scripts/hooks/json-helper.cjs:548` / `src/cli/commands/learn.ts:333`
**Confidence**: 85%
- Problem: There are two independent implementations of `acquireMkdirLock` -- a synchronous one in `json-helper.cjs` (using `fs.mkdirSync`, `Atomics.wait` for sleep, explicit `EEXIST` checking) and an async one in `learn.ts` (using `await fs.mkdir`, `setTimeout`-based polling, swallowing all errors in catch). The PR exports the async version from `learn.ts` and imports it in `decisions.ts`, which is correct. However, the two implementations have subtly different behavior: the CJS version explicitly checks `err.code !== 'EEXIST'` and re-throws unexpected errors, while the TS async version swallows all `mkdir` failures in a bare `catch`. This is a latent coupling issue -- the two lock implementations should share the same error-handling contract since they protect the same `.decisions.lock` directory (the CJS version is called from `render-ready`, the TS version from `--review`). This is not introduced by this PR but is now made more visible by the cross-module export.
- Fix: Consider extracting the lock acquisition logic into a shared utility (e.g., `src/cli/utils/lock.ts` for the async version, keeping the CJS sync version in `json-helper.cjs`). At minimum, the async version in `learn.ts` should check for `EEXIST` explicitly rather than swallowing all errors:
```typescript
} catch (err: unknown) {
  if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  // ... stale lock check
}
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`learn.ts` is becoming a shared utility barrel** - `src/cli/commands/learn.ts`
**Confidence**: 82%
- Problem: `learn.ts` is a CLI command module (it exports `learnCommand`) but is also evolving into a shared utility barrel. It now exports: `LearningObservation` (type), `isLearningObservation`, `readObservations`, `warnIfInvalid`, `writeObservations`, `updateDecisionsStatus`, `acquireMkdirLock`, `formatStaleReason`, and `NotificationFileEntry`. The `decisions.ts` command imports 8 symbols from `learn.ts`. This violates SRP -- a command module should define its command, not serve as a utility library for sibling commands. The cross-command import creates implicit coupling: changes to `learn.ts` internals can break `decisions.ts`.
- Fix: Extract shared types (`LearningObservation`, `DecisionsEntry`), shared logic (`acquireMkdirLock`, `formatStaleReason`, `readObservations`, `writeObservations`, `updateDecisionsStatus`, `isLearningObservation`), and shared constants into dedicated utility modules under `src/cli/utils/` (e.g., `observation-types.ts`, `observation-io.ts`, `lock.ts`). Both `learn.ts` and `decisions.ts` then import from shared utilities rather than from each other.

## Suggestions (Lower Confidence)

- **`tryImmediatePromotion` could benefit from unit tests** - `scripts/hooks/json-helper.cjs:515` (Confidence: 70%) -- The extracted helper is now called from two sites (`process-observations` and `merge-observation`). A direct unit test of the function would guard against regressions if threshold logic changes.

- **Notification-clearing test duplicates production code** - `tests/decisions/cli-subcommands.test.ts:505` (Confidence: 65%) -- The new `capacity review notification clearing (D28)` test block inlines the production logic (`if (activeCount < 50 && notifications[notifKey])`) rather than calling the actual code path. If the production threshold changes, the test will pass while the real code behaves differently. Consider extracting the notification-clearing logic into a testable function (similar to what was done with `filterEligibleEntries` and `sortByLeastUsed`).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 1 | 0 | - |
| Pre-existing | - | - | 1 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR makes sound architectural improvements: extracting `tryImmediatePromotion` eliminates duplication across two call sites in `json-helper.cjs` (DRY/SRP), extracting `filterEligibleEntries` and `sortByLeastUsed` from `decisions.ts` enables direct unit testing of previously inline logic (OCP -- behavior now extends through composition), and replacing the ad-hoc `try { mkdir } catch` with the robust `acquireMkdirLock` in the `--review observations` path hardens lock acquisition with timeout and stale-lock recovery. The `formatStaleReason` reuse eliminates the inline reason-formatting duplication. These are clean refactors that improve separation of concerns.

The one condition: the divergent error-handling between the sync (`json-helper.cjs`) and async (`learn.ts`) `acquireMkdirLock` implementations should be tracked for convergence -- the async version silently swallows non-EEXIST errors while the sync version propagates them. This is not a blocker for this PR since both implementations work correctly in practice, but it represents a subtle contract inconsistency that could cause hard-to-diagnose issues if the lock directory path is misconfigured.
