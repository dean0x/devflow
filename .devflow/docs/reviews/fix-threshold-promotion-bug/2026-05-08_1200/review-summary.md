# Code Review Summary

**Branch**: fix-threshold-promotion-bug -> main
**Date**: 2026-05-08_1200

## Merge Recommendation: CHANGES_REQUESTED

The PR successfully fixes the threshold-promotion bug for decision/pitfall observations and cleanly relocates capacity review from `learn.ts` to its logical home in `decisions.ts`. However, **two HIGH-severity issues in blocking categories must be resolved before merge**:

1. **Locking inconsistency** (85% confidence, HIGH, blocking) — The `decisions --review` observations handler uses a naive `fs.mkdir` lock without stale-lock recovery, creating deadlock risk if a background process crashes. The equivalent `learn.ts` code uses a robust `acquireMkdirLock` utility with timeout and staleness detection.

2. **Duplicated promotion logic in json-helper.cjs** (85% confidence, HIGH, blocking) — The "immediate type promotion" check is copy-pasted into two separate code paths (`process-observations` and `merge-observation`). This is a maintenance risk and violates the single-source-of-truth principle.

The merge cannot proceed without addressing both issues.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| **Blocking (Your Changes)** | 0 | 2 | 3 | 0 | **5** |
| **Should Fix (Code You Touched)** | 0 | 0 | 3 | 0 | **3** |
| **Pre-existing** | 0 | 0 | 2 | 0 | **2** |

---

## Blocking Issues (Must Fix)

### HIGH - Locking Inconsistency
**File**: `src/cli/commands/decisions.ts:586-594`
**Confidence**: 85% (flagged by: consistency, typescript)

The `decisions --review` observations handler acquires `.decisions.lock` via a bare `fs.mkdir` call with no stale-lock recovery:

```typescript
// Current code — NO stale lock handling
let lockAcquired = false;
try {
  await fs.mkdir(decisionsLockDir);
  lockAcquired = true;
} catch {
  p.log.error('Decisions system is currently running. Try again in a moment.');
  return;
}
```

The equivalent `learn.ts --review` code uses `acquireMkdirLock()` which detects and removes locks older than 60s, then retries with timeout. If a background decisions agent crashes with `.decisions.lock` left behind, the `decisions --review` command will permanently deadlock.

**Fix**: Import `acquireMkdirLock` from learn.ts (or extract to shared utility) and use it:
```typescript
const decisionsLockDir = path.join(memoryDir, '.decisions.lock');
const lockAcquired = await acquireMkdirLock(decisionsLockDir);
if (!lockAcquired) {
  p.log.error('Decisions system is currently running. Try again in a moment.');
  return;
}
```

---

### HIGH - Duplicated Promotion Logic
**File**: `scripts/hooks/json-helper.cjs:1014-1041` and `scripts/hooks/json-helper.cjs:1752-1778`
**Confidence**: 85% (flagged by: complexity, testing)

The identical "immediate type promotion" block is copy-pasted into both `process-observations` and `merge-observation` code paths:

```javascript
// Lines 1014-1041 (process-observations new-entry path)
if (isImmediateType(obs.type)) {
  const th = THRESHOLDS[obs.type] || THRESHOLDS.procedural;
  if (obs.confidence >= th.promote && obs.quality_ok === true) {
    const firstSeenMs = new Date(obs.first_seen).getTime();
    const spread = (Date.now() - firstSeenMs) / 1000;
    if (!isNaN(firstSeenMs) && spread >= th.spread) {
      obs.status = 'ready';
    }
  }
}

// Lines 1752-1778 (merge-observation new-entry path)
// IDENTICAL LOGIC, different variable names (newObs vs obs)
```

Future changes to the promotion protocol must be applied in two places, creating maintenance and correctness risk.

**Fix**: Extract a shared helper:
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

Then call it from both paths after constructing the entry.

---

### MEDIUM - Duplicated Sorting/Filtering Logic Between Tests and Production
**File**: `src/cli/commands/decisions.ts:748-799` vs `tests/decisions/cli-subcommands.test.ts:441-508`
**Confidence**: 82% (flagged by: architecture, testing)

The capacity review tests replicate the exact sorting/filtering logic from the production handler inline, rather than importing it. The sort comparator at lines 780-799 of decisions.ts and lines 492-508 of the test are structurally identical copy-paste. If the production handler's logic diverges, the tests will still pass while the real code is broken.

**Fix**: Extract filtering and sorting functions from `decisions.ts`:
```typescript
export function filterEligibleEntries(entries: CapacityEntry[], protectionDays: number = 7): CapacityEntry[] {
  const cutoff = new Date(Date.now() - protectionDays * 86400000).toISOString().slice(0, 10);
  return entries.filter(e => !e.createdDate || e.createdDate <= cutoff);
}

export function sortByLeastUsed(entries: CapacityEntry[]): CapacityEntry[] {
  // ... existing sort logic
}
```

Then import and use these in the tests:
```typescript
import { filterEligibleEntries, sortByLeastUsed } from '../../src/cli/commands/decisions.js';

const eligible = filterEligibleEntries(entries);
const sorted = sortByLeastUsed(eligible);
```

---

### MEDIUM - Capacity Review Lock Strategy Differs from Observations Review
**File**: `src/cli/commands/decisions.ts:827-841`
**Confidence**: 80% (flagged by: architecture)

The capacity review handler comment states "no outer lock needed (no reentrancy issue since calls are sequential)" and relies on each `updateDecisionsStatus` call acquiring `.decisions.lock` internally. However, the observations review handler (lines 586-594) acquires `.decisions.lock` once for the entire review loop. This inconsistency means a concurrent background decisions agent could interleave writes between individual `updateDecisionsStatus` calls.

**Fix**: Wrap the entire capacity deprecation loop (lines 830-841) plus the post-deprecation notification update (lines 843-881) in a single `.decisions.lock` acquisition, matching the observations pattern.

---

### MEDIUM - Capacity Review Notification Clearing not Tested
**File**: `src/cli/commands/decisions.ts:843-881`
**Confidence**: 80% (flagged by: testing)

The post-deprecation notification clearing logic (read `.decisions-notifications.json`, invoke `count-active` via subprocess, conditionally clear when count < 50) is not tested. This multi-step side-effect chain could silently break.

**Fix**: Add integration test for the notification clearing path with mock file state.

---

## Should-Fix Issues (Code You Touched)

### MEDIUM - `isCountActiveResult` Duplicated Rather than Shared
**File**: `src/cli/commands/decisions.ts:31-39`
**Confidence**: 82% (flagged by: architecture, consistency, typescript)

The `isCountActiveResult` type guard was moved from learn.ts to decisions.ts as a local copy with comment "Local copy -- decisions.ts does not import from learn.ts for this guard." However, decisions.ts already imports 5 other symbols from learn.ts (line 22-29). Adding a sixth import would not introduce new coupling. Maintaining two identical copies is a maintenance burden.

**Fix**: Export `isCountActiveResult` from learn.ts and import it in decisions.ts, or move both `isCountActiveResult` and `isNotificationMap` to a shared utility (e.g., `src/cli/utils/json-helper-types.ts`).

---

### MEDIUM - `learn.ts` is a Shared Data Module Masquerading as a Command
**File**: `src/cli/commands/learn.ts`
**Confidence**: 88% (flagged by: architecture)

The module exports 15+ shared types and utilities consumed by `decisions.ts`. This violates single responsibility: the module has two reasons to change (the `learn` command UI/behavior, and the shared data model). The import from decisions.ts creates coupling between sibling command modules.

**Fix**: Extract shared types and utilities into `src/cli/utils/learning-types.ts` or `src/cli/utils/observation-store.ts`. Both `learn.ts` and `decisions.ts` would import from the utility module. This establishes clean dependency direction: commands depend on utilities, not on each other.

---

### MEDIUM - Inconsistent Type-Label Formatting Between Commands
**File**: `src/cli/commands/decisions.ts:603` vs `src/cli/commands/learn.ts:989`
**Confidence**: 82% (flagged by: consistency)

In decisions review, `typeLabel = obs.type === 'decision' ? 'Decision' : 'Pitfall'` (ternary, non-generic).
In learn review, `typeLabel = obs.type.charAt(0).toUpperCase() + obs.type.slice(1)` (generic capitalization).

The decisions version will show "Pitfall" for all non-decision types, while the learn version correctly capitalizes any type. Use the generic pattern in both for consistency.

---

## Pre-existing Issues (Not Blocking)

### MEDIUM - `learn.ts` Architecture Violation
**File**: `src/cli/commands/learn.ts`
**Confidence**: 88% (flagged by: architecture)

The entire action handler is 673 lines with 11 top-level `if` branches. Even after the capacity review migration, this remains a monolithic structure. Extracting each flag handler into its own async function would improve maintainability. (Pre-existing — not introduced by this PR, but note that capacity review migration was an opportunity to also refactor the remaining handlers.)

### MEDIUM - Inconsistent Reason Formatting Between Modules
**File**: `src/cli/commands/decisions.ts:603-608` vs `src/cli/commands/learn.ts:990`
**Confidence**: 82% (flagged by: consistency)

The `decisions --review` observations mode builds the reason string manually with inline logic, while `learn --review` uses the shared `formatStaleReason()` helper. This creates divergence risk. (Related to should-fix issue above — both are symptoms of the larger learn.ts coupling problem.)

---

## Action Plan

1. **Extract `tryImmediatePromotion` in json-helper.cjs** (BLOCKING) — Create shared helper and call from both `process-observations` and `merge-observation` paths.

2. **Fix lock acquisition in decisions.ts** (BLOCKING) — Import `acquireMkdirLock` from learn.ts and use it for `--review` observations handler. Also add outer lock for capacity deprecation loop.

3. **Extract capacity review filtering/sorting** (BLOCKING) — Create exportable functions `filterEligibleEntries` and `sortByLeastUsed` in decisions.ts and import them in tests.

4. **Add notification clearing test** (BLOCKING) — Test the post-deprecation notification logic path.

5. **Share `isCountActiveResult`** (SHOULD FIX) — Export from learn.ts or move to shared utility.

6. **Standardize type-label formatting** (SHOULD FIX) — Use generic capitalization pattern in both decisions.ts and learn.ts.

The PR's core fix (immediate promotion for decision/pitfall observations) and the capacity review relocation are both correct and well-intentioned. Once the locking and logic-duplication issues are resolved, this is a solid contribution.
