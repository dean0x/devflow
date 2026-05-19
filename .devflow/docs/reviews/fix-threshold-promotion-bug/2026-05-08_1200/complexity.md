# Complexity Review Report

**Branch**: fix-threshold-promotion-bug -> main
**Date**: 2026-05-08

## Issues in Your Changes (BLOCKING)

### HIGH

**Duplicated promotion logic across process-observations and merge-observation (2 occurrences)** - Confidence: 85%
- `scripts/hooks/json-helper.cjs:1014-1041`, `scripts/hooks/json-helper.cjs:1752-1778`
- Problem: The identical "immediate type promotion on first creation" block is copy-pasted into both the `process-observations` new-entry path (lines 1014-1041) and the `merge-observation` new-entry path (lines 1752-1778). Both blocks check `isImmediateType`, compute confidence via `calculateConfidence(1, type)`, then repeat the same THRESHOLDS lookup, confidence check, spread check, and status promotion. This is a maintenance risk -- any future change to the promotion protocol must be applied in two places, and the blocks already differ slightly in variable naming (`obs.type` vs `newObs.type`, `newEntry` vs `entry`).
- Fix: Extract a shared helper function:
```javascript
function tryImmediatePromotion(entry) {
  if (entry.type !== 'decision' && entry.type !== 'pitfall') return;
  const th = THRESHOLDS[entry.type] || THRESHOLDS.procedural;
  if (entry.confidence >= th.promote && entry.quality_ok === true) {
    const firstSeenMs = new Date(entry.first_seen).getTime();
    const spread = (Date.now() - firstSeenMs) / 1000;
    if (!isNaN(firstSeenMs) && spread >= th.spread) {
      entry.status = 'ready';
    }
  }
}
```
  Then call it from both `process-observations` and `merge-observation` after constructing the new entry. This also aligns with the existing promotion block for the `existing` entry path (lines 1000-1009) which itself could use the same helper.

### MEDIUM

**decisions.ts --review handler is 333 lines with 2 deeply-nested branches** - `src/cli/commands/decisions.ts:558-889`
**Confidence**: 82%
- Problem: The `--review` block contains two independent code paths (`observations` mode at lines 573-684, `capacity` mode at lines 686-886) inlined as nested `if` blocks inside the main action handler. The capacity mode alone is 201 lines. This makes the action handler 819 lines total -- well above the 50-line critical threshold for individual blocks and 200+ for the enclosing function. Each mode has its own file I/O, locking, user interaction, and notification cleanup, which are logically independent concerns.
- Fix: Extract each review mode into its own async function:
```typescript
async function handleObservationsReview(logPath: string, memoryDir: string): Promise<void> { ... }
async function handleCapacityReview(memoryDir: string): Promise<void> { ... }
```
  Then the `--review` block becomes a simple mode dispatch of ~10 lines.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Monolithic action handler in decisions.ts exceeds 800 lines** - `src/cli/commands/decisions.ts:158-977`
**Confidence**: 85%
- Problem: The `.action()` callback is 819 lines containing 11 top-level `if` branches (one per CLI flag). While this is a pre-existing pattern from learn.ts, the capacity review migration made it worse -- the decisions.ts handler grew from ~640 lines to 819 lines. Each flag handler is essentially an independent sub-command with its own I/O, error handling, and user interaction. Cyclomatic complexity of the combined handler is very high (estimated CC > 30).
- Fix: Each `--flag` handler should be an independent async function. The action body becomes a router:
```typescript
.action(async (options) => {
  if (options.runBackground) return handleRunBackground(options);
  if (options.status) return handleStatus();
  if (options.list) return handleList();
  // ...
})
```
  This is a refactoring that could be done incrementally.

**learn.ts action handler remains at 673 lines after the capacity review was moved out** - `src/cli/commands/learn.ts:486-1159`
**Confidence**: 82%
- Problem: Even after migrating capacity review to decisions.ts, the learn command action handler is still 673 lines. The migration was an opportunity to also split the remaining handlers into individual functions, but the pre-existing monolith structure was preserved.
- Fix: Same pattern as decisions.ts -- extract each flag handler into its own async function.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**json-helper.cjs main switch is 1280+ lines** - `scripts/hooks/json-helper.cjs:647-1907`
**Confidence**: 85%
- Problem: The `if (require.main === module)` block contains a single switch statement with 25+ cases spanning over 1280 lines. Each case is a mini-program. While this is a pre-existing pattern, the new `process-observations` and `merge-observation` modifications add further weight. The existing promotion logic at lines 996-1009 (for existing entries) is structurally identical to the new lines 1032-1041 (for new entries), creating a three-way duplication of the promotion check.
- Fix: Extract each case into a named function called from the switch, and create shared helpers for repeated patterns like the promotion check.

## Suggestions (Lower Confidence)

- **Inline sorting/filtering logic in capacity review tests duplicates production code** - `tests/decisions/cli-subcommands.test.ts:441-508` (Confidence: 70%) -- Tests replicate the filtering and sorting logic verbatim from decisions.ts rather than importing or calling through the actual code path. If the production logic changes, these tests could pass while the real code is broken.

- **isCountActiveResult guard duplicated between decisions.ts and (removed from) learn.ts** - `src/cli/commands/decisions.ts:36-39` (Confidence: 65%) -- The comment says "local copy -- decisions.ts does not import from learn.ts for this guard" but this is a project-internal module, not a cross-package boundary. Sharing via import would be simpler.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Complexity Score**: 5/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The core bug fix (threshold promotion on first observation) is correct and well-tested. The primary complexity concern is the duplicated promotion logic in json-helper.cjs which should be extracted into a shared helper before merge. The monolithic action handlers in decisions.ts (819 lines) and learn.ts (673 lines) are an existing pattern that the capacity review migration made incrementally worse -- extracting flag handlers into individual functions is recommended but can be deferred.
