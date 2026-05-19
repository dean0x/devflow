# Architecture Review Report

**Branch**: fix-threshold-promotion-bug -> main
**Date**: 2026-05-08

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Duplicated sorting/filtering logic between tests and production code** - `src/cli/commands/decisions.ts:748-799`, `tests/decisions/cli-subcommands.test.ts:441-508`
**Confidence**: 82%
- Problem: The capacity review tests replicate inline the exact sorting/filtering logic from the decisions.ts capacity handler (7-day protection window, cites-ASC sort, deprecated/superseded exclusion). This means the tests validate the algorithm in isolation from the actual handler -- if the handler's logic diverges from the test copy, the tests will still pass while the real code is broken. The sort comparator at lines 780-799 of decisions.ts and lines 492-508 of the test are structurally identical copy-paste.
- Fix: Extract the sorting comparator and filtering predicates into named, exported utility functions (e.g., `filterEligibleEntries`, `sortByLeastUsed`) in a shared module (like `src/cli/utils/decisions-capacity.ts`). Both the handler and tests would consume the same function. This eliminates logic duplication and makes the real code the subject of the test, not a copy. Alternatively, test the handler's output through integration tests that exercise the actual command path.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`isCountActiveResult` duplicated rather than shared** - `src/cli/commands/decisions.ts:36-39`
**Confidence**: 85%
- Problem: The `isCountActiveResult` type guard was removed from learn.ts and recreated verbatim as a local function in decisions.ts with the JSDoc comment explicitly noting "Local copy -- decisions.ts does not import from learn.ts for this guard." While the intent to avoid a cross-module dependency is understandable, this creates a maintenance burden: if the JSON shape from `count-active` ever changes, both copies must be updated. The function is a pure type guard with no module-specific logic.
- Fix: Move `isCountActiveResult` to an existing shared utility module (e.g., `src/cli/utils/notifications-shape.ts` or a new `src/cli/utils/json-helper-types.ts`). Both learn.ts and decisions.ts can import from there. This follows the DIP principle -- both modules depend on a shared abstraction rather than duplicating it. applies ADR-001 (clean break: the function already moved once, finish the migration to its proper shared home).

**Capacity review lock strategy differs from observations review** - `src/cli/commands/decisions.ts:827-828`
**Confidence**: 80%
- Problem: The capacity review handler comment states "no outer lock needed (no reentrancy issue since calls are sequential)" and relies on each `updateDecisionsStatus` call acquiring `.decisions.lock` internally. However, the observations review handler at lines 586-594 acquires `.decisions.lock` once for the entire review loop. This inconsistency means that during a capacity review, another process (e.g., a background decisions agent running `render-ready`) could interleave writes between individual `updateDecisionsStatus` calls, potentially causing the post-deprecation count-active check (lines 862-878) to read a stale count.
- Fix: Wrap the entire capacity deprecation loop (lines 830-841) plus the post-deprecation notification update (lines 843-881) in a single `.decisions.lock` acquisition, matching the pattern used by the observations review handler. This ensures atomicity of the batch deprecation operation.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`learn.ts` is a shared data module masquerading as a command module** - `src/cli/commands/learn.ts`
**Confidence**: 88%
- Problem: `learn.ts` exports core domain types (`LearningObservation`, `LearningConfig`), shared utility functions (`readObservations`, `writeObservations`, `updateDecisionsStatus`, `isLearningObservation`, `warnIfInvalid`), configuration helpers (`loadLearningConfig`, `applyConfigLayer`), and hook management functions -- all consumed by `decisions.ts` and potentially other modules. This violates SRP: the module has two reasons to change (the `learn` command's UI/behavior, and the shared data model/utilities). The import from `decisions.ts` (`import { ... } from './learn.js'`) creates a tight coupling between two sibling command modules.
- Fix: Extract the shared types and utilities into `src/cli/utils/learning-types.ts` or `src/cli/utils/observation-store.ts`. Both `learn.ts` and `decisions.ts` would import from the utility module. This establishes a clean dependency direction: commands depend on utilities, not on each other. avoids PF-001 (verify the architectural intent before implementing -- confirm this is wanted before refactoring).

## Suggestions (Lower Confidence)

- **Inline promotion logic duplicated across process-observations and merge-observation** - `scripts/hooks/json-helper.cjs:1032-1041`, `scripts/hooks/json-helper.cjs:1769-1778` (Confidence: 72%) -- The D3+D4 immediate-type promotion check block is copy-pasted between the new-entry path of `process-observations` and the new-entry path of `merge-observation`. Extracting a `tryImmediatePromotion(entry, thresholds)` helper would reduce the surface area for future divergence.

- **Capacity review notification path differs between decisions and learn** - `src/cli/commands/decisions.ts:845`, `src/cli/commands/learn.ts:1078` (Confidence: 65%) -- After the port, decisions --review capacity mode writes to `.decisions-notifications.json` while the old learn --review capacity mode wrote to `.learning-notifications.json`. The notification file naming convention is now split across two systems without a clear mapping of which file serves which purpose.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR accomplishes a well-motivated refactoring: porting capacity review from `devflow learn` (where it is contextually out of place) to `devflow decisions` (its natural domain owner), and fixing the immediate-promotion bug for decision/pitfall observations. The architectural direction is sound -- decisions-domain logic belongs in the decisions command.

The conditions for full approval are:
1. Address the lock strategy inconsistency in the capacity review handler (Should Fix, MEDIUM) to prevent interleaved writes during batch deprecation.
2. Consider extracting `isCountActiveResult` to a shared utility rather than duplicating it (Should Fix, MEDIUM) to maintain single-source-of-truth for type guards.

The duplicated test logic (Blocking, MEDIUM) is not a merge blocker given the tests still validate correct behavior, but extracting the shared sort/filter logic into reusable functions would improve long-term maintainability.
