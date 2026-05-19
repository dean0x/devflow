# Performance Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-27

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Staleness recheck for single-slug refresh calls `checkStaleness` redundantly** - `src/cli/commands/kb.ts:514`
**Confidence**: 80%
- Problem: When `devflow kb refresh <slug>` is called with a specific slug, `stalenessMap` is `undefined` (set only when no slug is provided), so the fallback `featureKb.checkStaleness(worktreePath, kbSlug)` fires. `checkStaleness` independently calls `loadIndex` (file read + JSON parse) and `git rev-parse --git-dir` (process spawn), even though `listKBs` at line 508 already loads and parses the same index. For a single slug this is one redundant file read + JSON parse + one extra git process spawn.
- Fix: This is a minor inefficiency (constant factor, not algorithmic). The optimization introduced on line 490-495 correctly caches `stalenessMap` for the multi-slug path, which is the higher-impact case. The single-slug path spawns a full `claude -p` process immediately after (taking 30-180 seconds), so the ~5ms overhead from the redundant index load is negligible in practice. Acceptable as-is, but if desired, pre-populate `stalenessMap` for the single-slug case too:

```typescript
if (slug) {
  stalenessMap = { [slug]: featureKb.checkStaleness(worktreePath, slug) };
  slugsToRefresh = stalenessMap[slug].stale ? [slug] : [];
} else {
  stalenessMap = featureKb.checkAllStaleness(worktreePath);
  slugsToRefresh = Object.entries(stalenessMap)
    .filter(([, info]) => info.stale)
    .map(([s]) => s);
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`checkAllStaleness` spawns one `git log` process per KB entry (N+1 pattern)** - `scripts/hooks/lib/feature-kb.cjs:175-192`
**Confidence**: 82%
- Problem: `checkAllStaleness` correctly avoids the N+1 for `git rev-parse --git-dir` (checked once on line 181), but still calls `checkEntryFiles` per slug (line 189), each of which spawns a separate `git log` process. With N KBs, this is N process spawns. This is not new code (pre-existing pattern), but the `refresh` command's new `stalenessMap` caching (line 494) relies on this function, making the cost more visible in the new workflow.
- Fix: For typical usage (< 10 KBs), this is acceptable. If KB count grows, a single `git log --after=<oldest-timestamp> --name-only --pretty=format: -- <all-referenced-files>` could replace N spawns, then post-filter results per entry. However, this optimization is premature for the current scale and can be deferred.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`kb list` loads the index twice** - `src/cli/commands/kb.ts:287-288`
**Confidence**: 85%
- Problem: `listKBs(worktreePath)` calls `loadIndex` internally, then `checkAllStaleness(worktreePath)` calls `loadIndex` again. This double-reads and double-parses `index.json`. Not introduced by this PR (the `list` command predates this diff), but the removal of `category` touches this code path.
- Fix: Not blocking. Both calls complete in < 5ms for any realistic index size. Could be refactored to pass a shared index object, but the cost is negligible.

**`execFileSync('claude', ...)` blocks the Node event loop during KB create/refresh** - `src/cli/commands/kb.ts:433, 542`
**Confidence**: 80%
- Problem: `execFileSync` blocks the entire Node.js event loop while the `claude` subprocess runs (potentially 30-180 seconds). The spinner animation (`p.spinner()`) will appear frozen to the user because the event loop cannot process its ticks.
- Fix: Not introduced by this PR (pre-existing pattern), and this is a CLI command (not a server), so event-loop blocking is tolerable. For a better UX, `execFile` (async) with `await` and a proper spinner would allow the spinner to animate. This is a polish item, not a performance regression.

## Suggestions (Lower Confidence)

- **Sequential KB refresh could be parallelized** - `src/cli/commands/kb.ts:510` (Confidence: 65%) -- The `for` loop refreshes stale KBs one at a time. Since each refresh spawns an independent `claude -p` process writing to separate sidecar files, they could theoretically run in parallel. However, the background-kb-refresh script intentionally limits to sequential execution (with a cap of 3), likely to control resource usage. The CLI command follows the same conservative pattern, which is reasonable.

- **`findOverlapping` uses nested `some` with O(n*m) complexity** - `scripts/hooks/lib/feature-kb.cjs:315-316` (Confidence: 62%) -- For each KB's `referencedFiles`, every changed file is checked with string comparison. With 10 KBs x 10 refs x 100 changed files = 10,000 string comparisons, this is fast enough. Would only matter at extreme scale.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED

The PR makes several positive performance improvements:
1. **Staleness caching** (line 490-495): The new `stalenessMap` variable correctly avoids redundant `checkAllStaleness` + per-slug `checkStaleness` calls in the multi-slug refresh path. This eliminates N redundant git process spawns.
2. **Sidecar pattern over inline eval**: Replacing inline `node -e` JSON parsing with `json-helper.cjs read-sidecar` is a marginal improvement (reuses the already-loaded Node process's module cache for json-helper.cjs across repeated calls in the background script).
3. **Removing Bash from Knowledge agent tools**: Eliminating the Bash tool from the Knowledge agent's allowed tools prevents the agent from spawning arbitrary shell processes, which is both a security and performance improvement (fewer unexpected process spawns).
4. **`--model sonnet` flag**: Explicitly pinning the model ensures consistent and predictable inference latency rather than inheriting whatever the user's default model is (which could be a slower model).

No algorithmic regressions, no new blocking I/O in hot paths, no memory leaks introduced. The changes are clean from a performance perspective.
