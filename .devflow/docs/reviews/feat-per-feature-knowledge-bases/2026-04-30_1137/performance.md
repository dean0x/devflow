# Performance Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-30

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Eager `require()` of `sidecar-ops.cjs` adds startup cost to every `json-helper.cjs` invocation** - `scripts/hooks/json-helper.cjs:48`
**Confidence**: 85%
- Problem: `json-helper.cjs` is invoked dozens of times per session (for `get-field`, `render-ready`, `reconcile-manifest`, etc.), but the new `require('./lib/sidecar-ops.cjs')` at module top-level (line 48) eagerly loads the sidecar module on every invocation, even though `read-sidecar` is only called by `background-kb-refresh`. This adds unnecessary `require()` + `fs.readFileSync` overhead (the `safe-path.cjs` transitive require) to every single `json-helper.cjs` call. Node's `require()` cache mitigates repeated calls within the same process, but `json-helper.cjs` is always invoked as a fresh process.
- Fix: Lazy-load the sidecar module inside the routing check instead of at module top-level:
  ```javascript
  // At the top of the main switch block, before the switch:
  if (op === 'read-sidecar') {
    const sidecarOps = require('./lib/sidecar-ops.cjs');
    sidecarOps.handle(op, args);
    process.exit(0);
  }
  ```
  This preserves the refactoring benefit while avoiding the startup penalty for the ~99% of invocations that do not use `read-sidecar`.

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

### HIGH

(none)

### MEDIUM

**Repeated `new Date(...).getTime()` parsing in tight loop** - `scripts/hooks/lib/feature-kb.cjs:229-231,272`
**Confidence**: 80%
- Problem: In `checkAllStaleness`, `new Date(entry.lastUpdated).getTime()` is called once per slug in the collection phase (line 229) and then again per slug in the comparison phase (line 272). For a small number of KBs this is negligible, but the pattern of parsing the same ISO string twice per entry is wasteful.
- Fix: Cache the parsed timestamp per entry in the collection loop so the comparison loop can reuse it:
  ```javascript
  const entryTimestamps = new Map();
  for (const slug of slugs) {
    const entry = index.features[slug];
    // ... existing file collection ...
    if (entry.lastUpdated) {
      const ts = new Date(entry.lastUpdated).getTime();
      entryTimestamps.set(slug, ts);
      if (!isNaN(ts) && (oldestTimestamp === null || ts < oldestTimestamp)) {
        oldestTimestamp = ts;
      }
    }
  }
  // Later:
  const entryTimestamp = entryTimestamps.get(slug) ?? 0;
  ```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`execFileSync` for `git rev-parse --git-dir` could be replaced with a cached check** - `scripts/hooks/lib/feature-kb.cjs:213` (Confidence: 65%) -- `checkStaleness` (per-entry) and `checkAllStaleness` both independently call `git rev-parse --git-dir`. If both are called in the same process (e.g., fallback path), the git-dir check runs twice. The batch function already deduplicates this, but the overall module has no process-level cache.

- **`parseGitLogWithDates` creates a new `Date` object per ISO date line** - `scripts/hooks/lib/feature-kb.cjs:57` (Confidence: 60%) -- For very large git histories, `new Date(trimmed).getTime()` for every date line in the log output could be a minor bottleneck. In practice, the `--after` cutoff limits output volume, making this unlikely to be significant.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Performance Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR delivers a strong performance improvement to the core `checkAllStaleness` path -- collapsing N per-entry `git log` calls into a single batched call with per-entry timestamp comparison. This directly eliminates the O(n) git subprocess spawns that the previous version incurred. The `cachedIndex` parameter across `listKBs` / `checkAllStaleness` correctly eliminates double index reads in `list`, `check`, and `refresh` commands. The switch from synchronous `execFileSync` to async `execFileAsync` in `kb-agent.ts` keeps the event loop free for spinner animation -- a meaningful UX improvement.

The one blocking issue is the eager `require()` of `sidecar-ops.cjs` at the top of `json-helper.cjs`, which adds a startup cost to every invocation of this high-frequency entry point. Lazy-loading it only when the `read-sidecar` operation is requested would preserve the refactoring while avoiding the penalty.
