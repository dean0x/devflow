# TypeScript Review Report

**Branch**: fix-threshold-promotion-bug -> main
**Date**: 2026-05-08

## Issues in Your Changes (BLOCKING)

### HIGH

**Locking inconsistency: `decisions --review observations` uses naive `fs.mkdir` instead of `acquireMkdirLock`** - `src/cli/commands/decisions.ts:586-594`
**Confidence**: 85%
- Problem: The decisions `--review` observations mode acquires the `.decisions.lock` via a bare `fs.mkdir` call (lines 586-594) with no stale-lock recovery and no retry/timeout. In contrast, `learn.ts --review` uses `acquireMkdirLock` (line 976), which includes stale lock detection (auto-removes locks older than 60s) and retries with a 30s timeout. If a background decisions agent crashes and leaves `.decisions.lock` behind, the decisions `--review` command will permanently report "Decisions system is currently running" until the user manually removes the lock directory.
- Fix: Import or expose `acquireMkdirLock` from learn.ts (or a shared utility) and use it in the decisions review handler:
```typescript
// decisions.ts line 586-594, replace:
const decisionsLockDir = path.join(memoryDir, '.decisions.lock');
let lockAcquired = false;
try {
  await fs.mkdir(decisionsLockDir);
  lockAcquired = true;
} catch {
  p.log.error('Decisions system is currently running. Try again in a moment.');
  return;
}

// with:
const decisionsLockDir = path.join(memoryDir, '.decisions.lock');
const lockAcquired = await acquireMkdirLock(decisionsLockDir);
if (!lockAcquired) {
  p.log.error('Decisions system is currently running. Try again in a moment.');
  return;
}
```
Note: `acquireMkdirLock` is currently a module-private function in learn.ts. It would need to be exported, or moved to a shared utility (e.g., `background-runner.ts`).

### MEDIUM

**Capacity review lacks lock protection for concurrent writes** - `src/cli/commands/decisions.ts:827-841`
**Confidence**: 82%
- Problem: The capacity review mode's batch deprecation loop (lines 829-841) calls `updateDecisionsStatus` for each selected entry, which internally acquires `.decisions.lock` per call. However, the comment on line 827-828 states "no outer lock needed (no reentrancy issue since calls are sequential)." While that is correct for reentrancy, the missing outer lock means a concurrent background decisions agent could interleave writes to `decisions-log.jsonl` between individual `updateDecisionsStatus` calls. The observations mode (line 586) does hold a lock for the full loop. The capacity mode should hold the same `.decisions.lock` for the entire batch, not rely solely on per-call locking.
- Fix: Wrap the batch deprecation loop with `acquireMkdirLock` on `.decisions.lock`:
```typescript
const decisionsLockDir = path.join(memoryDir, '.decisions.lock');
const lockAcquired = await acquireMkdirLock(decisionsLockDir);
if (!lockAcquired) {
  p.log.error('Decisions system is currently running. Try again in a moment.');
  return;
}
try {
  // ... existing batch deprecation loop ...
} finally {
  try { await fs.rmdir(decisionsLockDir); } catch { /* already cleaned */ }
}
```

**`usageData` narrowing relies on bare `as` assertion without per-entry validation** - `src/cli/commands/decisions.ts:775`
**Confidence**: 80%
- Problem: After validating the top-level structure of `.decisions-usage.json` (version, entries shape), the code casts `parsed.entries as typeof usageData` on line 775. This trusts that every value in `entries` matches `{ cites: number; last_cited: string | null; created: string | null }` without checking individual entries. A malformed entry (e.g., `{ cites: "not a number" }`) would silently flow into the sort comparator on line 785 where `aUsage.cites - bUsage.cites` would produce `NaN`, causing unpredictable sort order.
- Fix: Add a per-entry guard or use a safe accessor pattern. At minimum, default-coerce in the sort:
```typescript
const aCites = typeof aUsage.cites === 'number' ? aUsage.cites : 0;
const bCites = typeof bUsage.cites === 'number' ? bUsage.cites : 0;
if (aCites !== bCites) return aCites - bCites;
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`isCountActiveResult` duplicated rather than shared** - `src/cli/commands/decisions.ts:31-39`
**Confidence**: 82%
- Problem: The `isCountActiveResult` type guard was moved from learn.ts to decisions.ts as a local copy (commented as "Local copy -- decisions.ts does not import from learn.ts for this guard"). However, decisions.ts already imports five symbols from learn.ts (line 22-29). Adding a sixth would not introduce a circular dependency or coupling that does not already exist. Having two identical copies of the same type guard is a maintenance liability.
- Fix: Export `isCountActiveResult` from learn.ts and import it in decisions.ts, or move it to a shared utility (e.g., alongside `isNotificationMap` in `notifications-shape.ts`).

## Pre-existing Issues (Not Blocking)

No critical pre-existing issues identified.

## Suggestions (Lower Confidence)

- **Inline entry type should be extracted to a named interface** - `src/cli/commands/decisions.ts:692-699` (Confidence: 70%) -- The `allEntries` array uses an inline `Array<{id: string; pattern: string; ...}>` type declaration spanning 7 lines. This same shape is also replicated in the test file. Extracting it to a named `CapacityEntry` interface would improve readability and enable reuse.

- **`notifications` written unconditionally even when no changes occurred** - `src/cli/commands/decisions.ts:881` (Confidence: 65%) -- After the capacity deprecation loop, `writeFileAtomicExclusive` is called on the notifications file regardless of whether any notification entries were actually modified. A no-op guard (e.g., checking if any notification's active/dismissed fields changed) would avoid unnecessary disk writes.

- **Test duplicates production logic instead of importing it** - `tests/decisions/cli-subcommands.test.ts:441-508` (Confidence: 72%) -- The capacity review tests replicate the filtering and sorting logic from decisions.ts inline rather than importing and testing the actual functions. This means the tests can pass even if the production code diverges. Consider extracting the filter/sort logic into testable pure functions.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR correctly refactors capacity review from learn.ts to decisions.ts (applies ADR-001 -- clean break, no backward compat shim in learn.ts), and the new immediate-promotion tests for decision/pitfall types are well-structured. The primary concern is the locking inconsistency where the decisions observations review uses a naive `fs.mkdir` lock without stale-lock recovery, while the equivalent learn.ts code uses the robust `acquireMkdirLock` with retry and staleness detection. The `usageData` narrowing via bare `as` cast also needs hardening. Type safety is otherwise good -- the `isCountActiveResult` guard and `isNotificationMap` guard demonstrate proper `unknown` narrowing.
