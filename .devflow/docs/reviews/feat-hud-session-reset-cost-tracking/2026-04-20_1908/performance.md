# Performance Review Report

**Branch**: feat/hud-session-reset-cost-tracking -> main
**Date**: 2026-04-20

## Issues in Your Changes (BLOCKING)

### HIGH

**`aggregateCosts` performs synchronous I/O on every HUD render** - `src/cli/hud/cost-history.ts:162-251`
**Confidence**: 90%
- Problem: `aggregateCosts()` is called on every HUD render (every prompt). It performs `readdirSync` + `readFileSync` for every session file, plus reads the entire `archive.jsonl` file. As sessions accumulate (active sessions stay for 24h before archival), this becomes a synchronous I/O bottleneck in the HUD's hot path. With 10 concurrent active sessions, that is 10 `readFileSync` calls + 1 archive read + 1 directory read = 12 synchronous I/O operations per render. The archive file can contain up to 500 entries (the trim threshold) that are all parsed line-by-line with `JSON.parse`.
- Impact: The HUD has a 2-second overall timeout (`OVERALL_TIMEOUT = 2000` in `index.ts:15`). Every millisecond of synchronous I/O in `aggregateCosts` is time not available for git operations and transcript parsing. On slow disks or network filesystems, this can contribute to timeout-induced blank HUD renders.
- Fix: Consider caching the aggregation result in memory or using a single pre-computed summary file that `persistSessionCost` updates incrementally, rather than re-reading and re-parsing all files on every render. A simpler intermediate fix: cache the aggregation result for 30-60 seconds since cost data does not change faster than that.

```typescript
// Example: simple time-based memoization
let cachedResult: { value: CostAggregation | null; expiresAt: number } | null = null;
const CACHE_TTL_MS = 30_000; // 30 seconds

export function aggregateCosts(
  currentSessionId: string,
  currentCostUsd: number,
): CostAggregation | null {
  const now = Date.now();
  if (cachedResult && now < cachedResult.expiresAt) {
    return cachedResult.value;
  }
  // ... existing logic ...
  cachedResult = { value: result, expiresAt: now + CACHE_TTL_MS };
  return result;
}
```

---

**`persistSessionCost` calls `mkdirSync` on every render** - `src/cli/hud/cost-history.ts:49`
**Confidence**: 85%
- Problem: `fs.mkdirSync(sessionsDir, { recursive: true })` is called on every invocation of `persistSessionCost`, even when the directory already exists. This is a system call that checks the entire path hierarchy on every HUD render.
- Impact: While `mkdirSync` with `{ recursive: true }` is a no-op when the directory exists, it still performs filesystem stat operations on each path component. On every prompt, this is unnecessary overhead.
- Fix: Guard with an `existsSync` check or use a module-level flag to skip after first creation:

```typescript
let sessionsDirCreated = false;

// Inside persistSessionCost:
if (!sessionsDirCreated) {
  fs.mkdirSync(sessionsDir, { recursive: true });
  sessionsDirCreated = true;
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`persistSessionCost` runs synchronous I/O in the HUD critical path** - `src/cli/hud/index.ts:133-134`
**Confidence**: 82%
- Problem: `persistSessionCost` performs synchronous file writes (`writeFileSync`, `renameSync`) directly in the `run()` function, which is the HUD's main render path protected by a 2-second timeout. The atomic write pattern (write tmp + rename) involves 2 synchronous file operations per render, plus the `mkdirSync` call noted above.
- Impact: Each synchronous write blocks the event loop. While individual writes are fast on local SSDs, this is additive with all other synchronous operations (`fs.statSync` for session time, `gatherConfigCounts`, `getLearningCounts`, `getActiveNotification`, and now `aggregateCosts`). The accumulation of synchronous I/O operations pushes closer to the 2-second timeout boundary.
- Fix: Consider making `persistSessionCost` fully async, or fire-and-forget it outside the `run()` return path so it does not block rendering:

```typescript
// Fire-and-forget: don't await, don't block render
if (sessionId && costUsd) {
  setImmediate(() => persistSessionCost(sessionId, costUsd, cwd));
}
```

## Pre-existing Issues (Not Blocking)

No pre-existing performance issues identified in reviewed files.

## Suggestions (Lower Confidence)

- **Archive file grows without bound between cleanups** - `src/cli/hud/cost-history.ts:136-154` (Confidence: 70%) -- `trimArchive` only runs during periodic cleanup (timestamp % 50 === 0), and the 500-line threshold means the archive can contain ~500 JSONL entries that are all read and parsed during every `aggregateCosts` call. For very active users this could be a noticeable cost.

- **Redundant `Date.now()` calls across functions** - `src/cli/hud/cost-history.ts` (Confidence: 65%) -- `Math.floor(Date.now() / 1000)` is computed independently in `persistSessionCost` (line 54), `runCleanup` (line 92), `aggregateCosts` (line 214, 225), and `trimArchive` (called from `runCleanup`). A single timestamp passed as a parameter would eliminate redundant system calls and ensure temporal consistency.

- **`runCleanup` reads and parses every session file** - `src/cli/hud/cost-history.ts:101-128` (Confidence: 62%) -- During cleanup, every `.json` file in the sessions directory is read and parsed to check its age. This is O(n) file reads. For the typical case (few sessions), this is fine, but it runs in the same synchronous path. Using file modification time (`stat.mtimeMs`) instead of reading file contents would avoid the read+parse overhead.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Performance Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The new `cost-history.ts` module introduces a significant amount of synchronous filesystem I/O into the HUD's hot path. The core design -- one file per session plus an archive JSONL file, all re-read and re-parsed on every prompt -- is sound for correctness but not optimized for the HUD's latency-sensitive render loop. The two HIGH findings (unbounded per-render I/O in `aggregateCosts` and redundant `mkdirSync`) are the most impactful. Adding a simple time-based cache for the aggregation result would eliminate the majority of the per-render I/O cost with minimal code change. The deleted `usage-api.ts` (replaced by stdin extraction) is a clear performance win -- removing an HTTP fetch from the render path.
