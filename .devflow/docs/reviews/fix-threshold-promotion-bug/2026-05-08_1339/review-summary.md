# Code Review Summary

**Branch**: fix/threshold-promotion-bug -> main
**Date**: 2026-05-08_1339
**Reviewers**: Security, Architecture, Performance, Complexity, Consistency, Regression, Testing, TypeScript

## Merge Recommendation: CHANGES_REQUESTED

**Reasoning**: Three blocking issues prevent merge: (1) TypeScript types missing literal unions on `DecisionsEntry.status` and `file` fields, (2) incomplete refactoring leaving duplicate inline promotion logic in `process-observations` existing-entry path, and (3) new D28 tests replicating inline notification-clearing logic instead of testing production code. All are high confidence and fixable in <30 minutes.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| **Blocking** | 0 | 2 | 2 | 0 | **4** |
| **Should Fix** | 0 | 1 | 1 | 0 | **2** |
| **Pre-existing** | 0 | 1 | 5 | 1 | **7** |

---

## Blocking Issues (Must Fix Before Merge)

### 1. Incomplete Refactoring: Promotion Logic Not Consolidated in Existing-Entry Path
**File**: `scripts/hooks/json-helper.cjs:1017-1030`
**Severity**: HIGH
**Confidence**: 85%

The `tryImmediatePromotion` helper was extracted and applied to new-entry creation (lines 1054 and 1784) but the existing-entry promotion block (lines 1017-1030) still uses nearly identical inline logic. The inline block has two semantic differences: (1) `status !== 'created'` guard, and (2) `first_seen ? ... : 0` fallback vs. direct `new Date()` parsing. This violates DRY and creates a maintenance risk.

**Fix**: Extract a second helper (e.g., `tryPromoteExisting(entry)`) that includes the `status !== 'created'` guard, or parameterize `tryImmediatePromotion` with `{ guardCreated: true }`.

---

### 2. DecisionsEntry Type Missing Literal Union on `status` Field
**File**: `src/cli/commands/decisions.ts:139`
**Severity**: MEDIUM
**Confidence**: 85%

The `status` field is typed as `string` but only uses fixed values: `'Accepted'`, `'Active'`, `'Deprecated'`, `'Superseded'`, `'Unknown'`. Plain `string` loses compile-time exhaustiveness checking.

**Fix**:
```typescript
status: 'Accepted' | 'Active' | 'Deprecated' | 'Superseded' | 'Unknown';
```

---

### 3. DecisionsEntry Type Missing Literal Union on `file` Field
**File**: `src/cli/commands/decisions.ts:137`
**Severity**: MEDIUM
**Confidence**: 82%

The `file` field is typed as `string` but only ever set to `'decisions'` or `'pitfalls'`.

**Fix**:
```typescript
file: 'decisions' | 'pitfalls';
```

---

### 4. D28 Notification Tests Replicate Inline Logic Instead of Testing Production Code
**File**: `tests/decisions/cli-subcommands.test.ts:505-565`
**Severity**: HIGH
**Confidence**: 85%

The three new tests in the `capacity review notification clearing (D28)` describe block manually re-implement the notification clearing logic inline (`if (activeCount < 50 && notifications[notifKey]) { ... }`) rather than importing and calling the actual function from `decisions.ts`. This is the same anti-pattern this PR elsewhere fixes (with `filterEligibleEntries` and `sortByLeastUsed`).

**Fix**: Extract the notification clearing logic from `decisions.ts:882-898` into a named exported function (e.g., `clearCapacityNotificationsIfBelowThreshold`), then call that function from the tests. This follows the pattern already established in the PR.

---

## Should-Fix Issues (Recommend Fixing Now)

### 5. Dual `acquireMkdirLock` Implementations with Divergent Error Handling
**File**: `scripts/hooks/json-helper.cjs:548` / `src/cli/commands/learn.ts:333`
**Severity**: HIGH
**Confidence**: 85%

Two independent implementations exist with subtly different error handling. The CJS sync version explicitly checks `err.code !== 'EEXIST'` and re-throws unexpected errors, while the TS async version swallows all `mkdir` failures in a bare `catch`. Both protect the same `.decisions.lock` directory, creating a latent coupling issue.

**Fix**: Extract lock acquisition logic into a shared utility (e.g., `src/cli/utils/lock.ts`). At minimum, fix the TS async version to check `EEXIST` explicitly:
```typescript
} catch (err: unknown) {
  if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  // ... stale lock check
}
```

---

### 6. Lock Release Uses Raw `fs.rmdir` Instead of Reusing Pattern
**File**: `src/cli/commands/decisions.ts:729`
**Severity**: MEDIUM
**Confidence**: 85%

Lock acquisition was hardened via `acquireMkdirLock` (with stale detection and timeout) but release side still uses bare `await fs.rmdir`. The `learn.ts` module does not export a matching `releaseMkdirLock`. This asymmetry means future changes need independent updates at each call site.

**Fix**: Export a `releaseMkdirLock` companion from `learn.ts` and use it here, or add a code comment noting the intentional asymmetry.

---

## Pre-existing Issues (Not Blocking)

### High Severity Pre-existing Issues

**Monolithic action handler in decisions.ts** (line 217) - 780-line closure with 11 branched subcommands, cyclomatic complexity >30. Extract each branch into named functions. Confidence: 90%

### Medium Severity Pre-existing Issues

1. **learn.ts becoming a shared utility barrel** - Exporting 8+ symbols creates implicit cross-command coupling. Extract to `src/cli/utils/`. Confidence: 82%

2. **Sequential subprocess spawning for capacity review** - Two `execFileSync` calls could run in parallel. Not blocking for interactive CLI. Confidence: 82%

3. **json-helper.cjs file length** - 1935 lines exceeds critical threshold (>500). Extract domain modules like `lib/decisions-ops.cjs`. Confidence: 85%

4. **Inline promotion logic duplication in process-observations** - Lines 1021-1030 duplicate logic from `tryImmediatePromotion`. Confidence: 82%

5. **safePath called without allowedRoot constraint** (json-helper.cjs) - Mitigated by internal-only invocation. Confidence: 65%

---

## Action Plan

1. **Fix TypeScript types** (10 min): Add literal unions to `DecisionsEntry.status` and `file` fields
2. **Extract missing promotion helper** (15 min): Consolidate existing-entry promotion logic or extend `tryImmediatePromotion`
3. **Extract notification-clearing function** (10 min): Create `clearCapacityNotificationsIfBelowThreshold` and update tests
4. **Fix async lock error handling** (5 min): Explicitly check `EEXIST` in `learn.ts` async version
5. **Consider lock release pattern** (optional): Document or implement `releaseMkdirLock` companion

**Estimated fix time**: ~40 minutes for all blocking + should-fix issues.

---

## Quality Scores

| Reviewer | Score | Status |
|----------|-------|--------|
| Security | 9/10 | APPROVED |
| Architecture | 8/10 | APPROVED_WITH_CONDITIONS |
| Performance | 9/10 | APPROVED |
| Complexity | 7/10 | APPROVED |
| Consistency | 7/10 | CHANGES_REQUESTED |
| Regression | 10/10 | APPROVED |
| Testing | 6/10 | CHANGES_REQUESTED |
| TypeScript | 7/10 | APPROVED_WITH_CONDITIONS |

**Overall**: Solid refactoring PR with clear improvements to extracting duplicated logic and hardening lock acquisition. The blocking issues are minor type safety and test quality gaps that are straightforward to fix.
