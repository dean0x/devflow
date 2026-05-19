# Performance Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-26

## Issues in Your Changes (BLOCKING)

### HIGH

**Redundant staleness computation in `stale-slugs` + `refresh-context` calls** - `scripts/hooks/background-kb-refresh:89,107`
**Confidence**: 90%
- Problem: The `background-kb-refresh` script calls `stale-slugs` (line 89) which runs `checkAllStaleness` — loading the index once and running `git log` per KB. It then loops over each stale slug and calls `refresh-context` (line 107) which calls `checkStaleness` — reloading the index from disk and re-running `git rev-parse --git-dir` per slug. For 3 stale KBs, this results in 1 `checkAllStaleness` call (1 index read + 1 git-dir check + N git-log calls) plus 3 `checkStaleness` calls (3 index reads + 3 git-dir checks + 3 git-log calls). The git-log calls are duplicated for every stale slug.
- Fix: The `refresh-context` CLI command already has the index loaded. Use `checkEntryFiles` directly instead of `checkStaleness` to avoid the redundant `loadIndex` and `git rev-parse --git-dir` calls per slug. However, this is the minor savings. The larger issue is that the `session-end-kb-refresh` hook (line 41) already runs `stale-slugs` to decide whether to spawn the background process, and then `background-kb-refresh` re-runs `stale-slugs` again. This is unavoidable due to the TOCTOU gap (state may change between hook and background), but the cost within `background-kb-refresh` itself can be reduced:

```javascript
// In refresh-context CLI handler, replace checkStaleness with checkEntryFiles:
'refresh-context'() {
  const worktreePath = requireWorktree(argv);
  const slug = argv[2];
  // ... validation ...
  const index = loadIndex(worktreePath);
  // ... null check ...
  const entry = index.features[slug];
  // Use checkEntryFiles directly — git-dir was already verified by stale-slugs
  const staleness = checkEntryFiles(worktreePath, entry);
  // ... output ...
}
```

### MEDIUM

**Sequential `claude -p` spawns for KB refresh — each blocked for up to 180 seconds** - `scripts/hooks/background-kb-refresh:96-164`
**Confidence**: 85%
- Problem: The loop refreshes up to 3 KBs sequentially, spawning a separate `claude -p` process for each with a 180-second watchdog. In the worst case, this holds the lock for 3 x 180 = 540 seconds (9 minutes), which exceeds the stale lock threshold of 300 seconds. A concurrent `background-kb-refresh` invocation would break the lock mid-refresh.
- Fix: The stale lock threshold (300s) should be at least `3 * 180 = 540s` plus margin, or the max KBs per run should be reduced to 1 (since 180s < 300s). Alternatively, touch the lock directory between iterations to keep its mtime fresh:

```bash
for SLUG in $STALE_SLUGS; do
  # ... existing code ...
  # Touch lock to prevent stale-lock breakage during multi-KB runs
  touch "$LOCK_DIR" 2>/dev/null || true
done
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Double `node` process spawn in session-end hook critical path** - `scripts/hooks/session-end-kb-refresh:41`
**Confidence**: 82%
- Problem: The SessionEnd hook runs `node feature-kb.cjs stale-slugs` (which loads the index and runs `git log` per KB) synchronously in the hook's critical path before deciding whether to spawn the background process. The hook has a 10-second timeout. For projects with many KBs and many referenced files, the `stale-slugs` call could approach this timeout — each `git log` call is an `execFileSync` that could take hundreds of milliseconds on large repos.
- Fix: Consider moving the stale-slugs check into the background script entirely. The session-end hook only needs to know whether `.features/index.json` exists and the throttle hasn't fired — both are already checked. Let the background process handle the staleness check after acquiring the lock:

```bash
# session-end-kb-refresh: remove lines 40-42, spawn unconditionally
# Let background-kb-refresh handle the stale-slugs check
```

This saves one full `node` invocation in the hook's critical path.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`refresh-context` calls `checkStaleness` which re-loads the index it already loaded** - `scripts/hooks/lib/feature-kb.cjs:540` (Confidence: 78%) — The `refresh-context` CLI handler loads the index at line 534, validates the slug, then calls `checkStaleness` at line 540 which loads the index again internally. Could pass the already-loaded entry to `checkEntryFiles` directly.

- **`cat "$KB_PATH"` reads entire KB into shell variable** - `scripts/hooks/background-kb-refresh:104` (Confidence: 65%) — For very large KBs (approaching the 500-line cap), this reads the entire content into a bash variable and then interpolates it into the prompt string. This is fine for typical KB sizes but could cause issues if a KB grows beyond the cap without being split.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Performance Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR introduces well-structured background refresh with proper throttling (2-hour interval), locking (mkdir-based), and watchdog timeouts. The main performance concern is the stale lock threshold (300s) being shorter than the worst-case lock hold time (540s) for 3-KB sequential refreshes, which can cause lock breakage. The redundant staleness computations across the hook and background script are a secondary concern — they add unnecessary git subprocess spawns but are individually fast. The refactoring of `checkAllStaleness` to use the extracted `checkEntryFiles` helper is a good deduplication that properly avoids the N+1 git-dir check pattern.
