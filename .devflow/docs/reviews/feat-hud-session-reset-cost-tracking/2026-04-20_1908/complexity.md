# Complexity Review Report

**Branch**: feat/hud-session-reset-cost-tracking -> main
**Date**: 2026-04-20

## Issues in Your Changes (BLOCKING)

### HIGH

**`aggregateCosts` function has high cyclomatic complexity and excessive nesting** - `src/cli/hud/cost-history.ts:162-252`
**Confidence**: 90%
- Problem: The `aggregateCosts` function is 90 lines long with 4 levels of nesting (outer try -> inner try -> for loop -> inner try/if), cyclomatic complexity of approximately 14 (multiple try/catch blocks, if-chains, null checks, and for loops). It handles three distinct responsibilities in a single function: (1) reading session files, (2) reading archive entries, (3) computing time-bucketed aggregations. Each responsibility has its own try/catch + for loop + validation logic, resulting in a dense, hard-to-test monolith.
- Fix: Extract the three responsibilities into helper functions:

```typescript
function readSessionEntries(sessionsDir: string): Map<string, SessionEntry> {
  const map = new Map<string, SessionEntry>();
  try {
    const files = fs.readdirSync(sessionsDir);
    for (const filename of files) {
      if (!filename.endsWith('.json')) continue;
      try {
        const raw = fs.readFileSync(path.join(sessionsDir, filename), 'utf-8');
        const entry = JSON.parse(raw) as SessionEntry;
        if (typeof entry.session_id === 'string' && typeof entry.cost_usd === 'number') {
          upsertMax(map, entry);
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* dir may not exist */ }
  return map;
}

function readArchiveEntries(archivePath: string): Map<string, SessionEntry> {
  const map = new Map<string, SessionEntry>();
  try {
    const raw = fs.readFileSync(archivePath, 'utf-8');
    for (const line of raw.split('\n').filter(l => l.trim())) {
      try {
        const entry = JSON.parse(line) as SessionEntry;
        if (typeof entry.session_id === 'string' && typeof entry.cost_usd === 'number') {
          upsertMax(map, entry);
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* archive may not exist */ }
  return map;
}

function upsertMax(map: Map<string, SessionEntry>, entry: SessionEntry): void {
  const existing = map.get(entry.session_id);
  if (!existing || entry.cost_usd > existing.cost_usd) {
    map.set(entry.session_id, entry);
  }
}
```

This reduces `aggregateCosts` to ~30 lines: merge maps, override current session, compute buckets.

**`runCleanup` function has high nesting depth (4 levels)** - `src/cli/hud/cost-history.ts:89-134`
**Confidence**: 85%
- Problem: `runCleanup` has 45 lines with 4 levels of nesting (try -> for -> if -> try). The function handles two distinct cleanup tasks in a single loop body -- orphaned `.tmp` cleanup and old session archival -- separated only by a `continue` statement. Cyclomatic complexity is approximately 10.
- Fix: Extract the two cleanup paths into separate helper functions:

```typescript
function cleanOrphanedTmpFiles(sessionsDir: string, nowSeconds: number): void {
  // handles .tmp file cleanup
}

function archiveOldSessions(sessionsDir: string, archivePath: string, nowSeconds: number): void {
  // handles session -> archive migration
}
```

Then `runCleanup` becomes a simple orchestrator that calls both helpers sequentially.

### MEDIUM

**Duplicated map-upsert pattern across `aggregateCosts`** - `src/cli/hud/cost-history.ts:178-184,196-201`
**Confidence**: 88%
- Problem: The exact same 4-line pattern for checking an existing map entry and upserting the max cost appears twice (once for session files, once for archive entries). This is a textbook DRY violation that also contributes to the function's overall length.
- Fix: Extract a shared `upsertMax` helper (shown in the fix above for `aggregateCosts`).

**Duplicated `Math.floor(Date.now() / 1000)` pattern (5 occurrences)** - `src/cli/hud/cost-history.ts:54,92,213,225`
**Confidence**: 82%
- Problem: The expression `Math.floor(Date.now() / 1000)` appears 4 times in cost-history.ts alone. While not functionally wrong, it adds cognitive overhead and each call returns a slightly different timestamp within the same logical operation.
- Fix: Extract to a helper `function nowEpoch(): number { return Math.floor(Date.now() / 1000); }` and call once per function, passing the value through. This also makes the functions more testable since you could inject the timestamp.

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`run()` function in index.ts approaching length threshold** - `src/cli/hud/index.ts:63-160`
**Confidence**: 80%
- Problem: The `run()` function is approximately 97 lines and continues to grow with each new feature (cost history is the latest addition). It handles stdin reading, config resolution, component-needs analysis, data gathering, and context assembly. While each section is clearly commented, the function is approaching the 100-line threshold where extraction becomes worthwhile.
- Fix: Consider extracting a `gatherData(stdin, components)` function that returns all the gathered data, keeping `run()` focused on orchestration (read stdin -> gather data -> render).

## Suggestions (Lower Confidence)

- **`persistSessionCost` atomic write retry logic adds nesting** - `src/cli/hud/cost-history.ts:62-73` (Confidence: 65%) -- The nested try/catch for handling stale `.tmp` files from prior crashes adds a third nesting level. An `unlinkSafe` + single `writeFileSync` call with `'w'` flag instead of `'wx'` could simplify this, though the current approach provides stronger atomicity guarantees.

- **`contextUsage` duplicates bar-rendering logic from `usage-quota`** - `src/cli/hud/components/context-usage.ts:26-36` vs `src/cli/hud/components/usage-quota.ts:6-28` (Confidence: 60%) -- Both components implement the same 3-tier color logic (green < 50, yellow < 80, red >= 80) and bar rendering with identical BAR_WIDTH. The usage-quota component already extracted `renderBar()` as a local function -- it could be shared. Pre-existing issue, not introduced in this branch.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Complexity Score**: 6/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The new `cost-history.ts` module is the primary complexity concern. The `aggregateCosts` function (90 lines, ~14 cyclomatic complexity) and `runCleanup` (45 lines, 4 nesting levels) both exceed the recommended thresholds. The good news: the refactoring is straightforward -- extracting helper functions for the duplicated upsert pattern and the two cleanup paths would bring both functions well within acceptable ranges. The rest of the changes (usage-quota refactoring into `renderQuotaWindow`, session-cost weekly/monthly display, index.ts wiring) are clean and well-structured, with the usage-quota refactoring actually reducing complexity compared to its committed predecessor.
