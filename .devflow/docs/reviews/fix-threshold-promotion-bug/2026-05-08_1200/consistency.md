# Consistency Review Report

**Branch**: fix-threshold-promotion-bug -> main
**Date**: 2026-05-08

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent lock acquisition pattern between decisions.ts and learn.ts review modes** - `src/cli/commands/decisions.ts:586-594`
**Confidence**: 85%
- Problem: The `decisions --review` observations mode uses a raw `fs.mkdir` + `try/catch` pattern for lock acquisition (lines 586-594), while the corresponding `learn --review` code (learn.ts:974-980) uses the shared `acquireMkdirLock()` utility which provides stale-lock detection and retry-with-timeout. The same inconsistency exists in `decisions --reset` (line 486). Both files import from the same codebase and the `acquireMkdirLock` function is exported from learn.ts and used elsewhere. The raw `fs.mkdir` approach will deadlock permanently if a prior process crashed and left a stale lock directory, while `acquireMkdirLock` handles that case via stale detection after 60 seconds.
- Fix: Import and use `acquireMkdirLock` in decisions.ts for the `--review` observations lock and the `--reset` lock, matching the pattern in learn.ts:
```typescript
// decisions.ts --review observations mode (line ~586):
const lockAcquired = await acquireMkdirLock(decisionsLockDir);
if (!lockAcquired) {
  p.log.error('Decisions system is currently running. Try again in a moment.');
  return;
}

// decisions.ts --reset (line ~486):
const lockAcquired = await acquireMkdirLock(lockDir);
if (!lockAcquired) {
  p.log.error('Decisions system is currently running. Try again in a moment.');
  return;
}
```
Note: `acquireMkdirLock` would need to be added to the import from `./learn.js` or be extracted to a shared utility.

**Inconsistent reason formatting between decisions and learn review modes** - `src/cli/commands/decisions.ts:603-608`
**Confidence**: 82%
- Problem: The `decisions --review` observations mode builds the reason string manually with inline logic (lines 603-608), while `learn --review` (learn.ts:990) uses the shared `formatStaleReason()` helper. Both operate on the same `LearningObservation` type and display similar output. This creates a divergence risk where one formatter is updated but not the other.
- Fix: Export `formatStaleReason` from learn.ts and use it in decisions.ts:
```typescript
// decisions.ts, observations review loop:
import { formatStaleReason } from './learn.js';
// ...
const reason = formatStaleReason(obs);
```

### MEDIUM

**Duplicated `isCountActiveResult` type guard instead of sharing** - `src/cli/commands/decisions.ts:31-39`
**Confidence**: 80%
- Problem: The `isCountActiveResult` function was removed from learn.ts and added as a "local copy" in decisions.ts with a comment `(Local copy -- decisions.ts does not import from learn.ts for this guard.)`. However, decisions.ts already imports `isLearningObservation`, `readObservations`, `warnIfInvalid`, `writeObservations`, and `updateDecisionsStatus` from learn.ts (line 22-29). The stated rationale contradicts the existing import relationship.
- Fix: Either export `isCountActiveResult` from learn.ts alongside the other exports (maintaining the existing sharing pattern), or extract it to a shared utils module. The current local-copy approach contradicts the established pattern where decisions.ts freely imports utilities from learn.ts.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Inconsistent type-label formatting between decisions and learn observation reviewers** - `src/cli/commands/decisions.ts:603`, `src/cli/commands/learn.ts:989`
**Confidence**: 82%
- Problem: In the decisions review, `typeLabel` is computed as a ternary `obs.type === 'decision' ? 'Decision' : 'Pitfall'` (decisions.ts:603), while in learn review it uses `obs.type.charAt(0).toUpperCase() + obs.type.slice(1)` (learn.ts:989). Both produce capitalized type names, but decisions.ts will show "Pitfall" for all non-decision types (including workflow/procedural if they ever appear due to filter changes), whereas learn.ts correctly capitalizes any type.
- Fix: Use the generic capitalization pattern in both files for consistency:
```typescript
const typeLabel = obs.type.charAt(0).toUpperCase() + obs.type.slice(1);
```

## Pre-existing Issues (Not Blocking)

No pre-existing issues identified above CRITICAL threshold.

## Suggestions (Lower Confidence)

- **Capacity review notification path inconsistency** - `src/cli/commands/decisions.ts:845` vs `src/cli/commands/learn.ts` (Confidence: 65%) -- The capacity review (now in decisions.ts) reads notifications from `.decisions-notifications.json` (line 845), which is correct for its new home. However, the old learn.ts code read from `.learning-notifications.json`. Verify that the notification file path is intentionally changed and that no other code still writes capacity notifications to the old learning file for decisions-related events.

- **Test coverage: capacity sort logic extracted but duplicated** - `tests/decisions/cli-subcommands.test.ts:430-516` (Confidence: 72%) -- The three new capacity tests replicate inline sort/filter logic from decisions.ts rather than importing a shared function. If the capacity logic in decisions.ts is ever refactored, the test assertions may pass on stale logic. Consider extracting the sort/filter into a named function that both the command handler and the tests call.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The PR successfully fixes the promotion bug and ports capacity review to its logical home (`decisions --review`). However, the port introduces inconsistent patterns between the two CLI modules — most notably the lock acquisition divergence (raw `fs.mkdir` vs shared `acquireMkdirLock`), which has behavioral consequences beyond style (stale lock recovery). The reason formatting and type guard duplication are lower severity but undermine the single-source-of-truth pattern the codebase follows elsewhere. Applies ADR-001 (clean break philosophy is respected -- no migration code was added for the port).
