# Complexity Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-24

## Issues in Your Changes (BLOCKING)

### HIGH

**`checkAllStaleness` inlines logic from `checkStaleness` instead of delegating** - `scripts/hooks/lib/feature-kb.cjs:166-199`
**Confidence**: 85%
- Problem: `checkAllStaleness` was refactored to inline the staleness-checking logic (git-dir check, referencedFiles iteration, git log call, `parseGitChangedFiles`) rather than calling `checkStaleness` per slug. The stated motivation is "avoid N+1 overhead" by checking git-dir once for the batch. However, the duplicated logic (lines 180-196) is nearly identical to `checkStaleness` lines 131-156 -- same `git log` call, same `parseGitChangedFiles`, same error handling pattern. This creates a maintenance burden: any bug fix or behavior change in one must be mirrored in the other.
- Impact: Two code paths that must stay in sync. If one diverges (e.g., a future change to git log flags, date format, or error handling), stale detection will behave differently in single-slug vs batch mode.
- Fix: Extract the shared per-entry logic into a private helper (e.g., `checkEntryStaleness(worktreePath, entry)`) and call it from both `checkStaleness` and `checkAllStaleness`. The git-dir check can remain hoisted in `checkAllStaleness` as a short-circuit:
  ```javascript
  function checkEntryStaleness(worktreePath, entry) {
    const files = entry.referencedFiles || [];
    if (files.length === 0) return NOT_STALE;
    try {
      const result = execFileSync('git',
        ['log', `--after=${entry.lastUpdated}`, '--name-only', '--pretty=format:', '--', ...files],
        { cwd: worktreePath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      const changedFiles = parseGitChangedFiles(result);
      return { stale: changedFiles.length > 0, changedFiles };
    } catch { return NOT_STALE; }
  }

  function checkAllStaleness(worktreePath) {
    const index = loadIndex(worktreePath);
    if (!index) return {};
    try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd: worktreePath, stdio: 'pipe' }); }
    catch { return Object.fromEntries(Object.keys(index.features).map(s => [s, NOT_STALE])); }
    const results = {};
    for (const [slug, entry] of Object.entries(index.features)) {
      results[slug] = checkEntryStaleness(worktreePath, entry);
    }
    return results;
  }
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`acquireLock` busy-wait loop with silent fallback** - `scripts/hooks/lib/feature-kb.cjs:232-248`
**Confidence**: 82%
- Problem: The `acquireLock` function uses `Atomics.wait` for sleeping, with a silent `catch` fallback labeled "Node < 16 fallback: busy-wait." When `Atomics.wait` is unavailable, the loop becomes a CPU-spinning busy-wait with zero delay between iterations. This is not a new issue (the catch was present before), but the refactoring to extract `tryBreakStaleLock` touched this code path without addressing it.
- Impact: On Node < 16 (or when SharedArrayBuffer is unavailable), `acquireLock` will spin at 100% CPU for up to `timeoutMs` (default 30 seconds). In practice, current Node LTS (20+) supports both, so the risk is low but the fallback is misleading.
- Fix: Use `setTimeout`-based blocking or `child_process.spawnSync('sleep', ['0.1'])` as a portable fallback, or simply drop the fallback comment since Node 16+ is the minimum supported version:
  ```javascript
  // If Atomics.wait is unavailable, use a tiny synchronous sleep via spawnSync
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  } catch {
    try { require('child_process').spawnSync('sleep', ['0.1']); } catch { /* last resort */ }
  }
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**CLI dispatch functions all call `process.exit(0)` explicitly** - `scripts/hooks/lib/feature-kb.cjs:440-513`
**Confidence**: 82%
- Problem: Every handler in the `dispatch` object ends with `process.exit(0)`. This is redundant -- once `handler()` is called on line 526 and it writes to stdout, the process will exit naturally after the script completes. The explicit exits prevent any cleanup code that might be added after the dispatch call.
- Impact: Minor -- no current issue, but makes it impossible to add post-dispatch logic (e.g., telemetry, cleanup) without modifying every handler.

### LOW

**Phase renumbering across 7 orchestration skills is pure mechanical search-and-replace** - Multiple files
**Confidence**: 80%
- Problem: The renumbering of fractional phases (0, 0.5, 0.6, 1.5, 8.5, 14.5, 2b) to integer sequences (1, 2, 3, ...) across `debug:orch`, `explore:orch`, `implement:orch`, `plan:orch`, `resolve:orch`, `review:orch`, and `pipeline:orch` is a large volume of changes (~250 lines across 7 files). While the new numbering is cleaner, the volume increases review burden and merge conflict risk.
- Impact: None functionally -- these are markdown skill files consumed by LLMs. The renumbering improves readability but carries no runtime risk.

## Suggestions (Lower Confidence)

- **`findOverlapping` uses O(n*m) nested loop** - `scripts/hooks/lib/feature-kb.cjs:317-330` (Confidence: 65%) -- The nested `refs.some(ref => changedFiles.some(...))` is quadratic in the number of refs x changed files. For typical use (small index, <20 changed files) this is fine, but could be optimized with a Set or trie if the index grows large.

- **`removeEntry` writes index even when slug was not present** - `scripts/hooks/lib/feature-kb.cjs:351-366` (Confidence: 70%) -- After the catch that silently continues on missing index, `delete index.features[slug]` is a no-op, but `writeFileSync` still rewrites the index file. The old code had an early return in the catch block; the new code always writes. This adds a minor unnecessary write.

- **`plan:orch` GUIDED mode numbering inconsistency** - `shared/skills/plan:orch/SKILL.md:27-31` (Confidence: 62%) -- The GUIDED steps are numbered 1, 2, 1, 2, 3 (the third step resets to "1. Spawn Skimmer"). This appears to be a pre-existing formatting issue that wasn't addressed in the renumbering pass.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 1 | 1 |

**Complexity Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The codebase complexity is well-managed overall. The refactoring from `markStale` to `findOverlapping` with directory-boundary matching, the `NOT_STALE` sentinel, `parseGitChangedFiles` extraction, dispatch table pattern in the CLI, and `exitOnInvalidSlug` helper all reduce complexity. The `tryBreakStaleLock` extraction improves readability of `acquireLock`. The one blocking issue is the duplicated staleness-checking logic between `checkStaleness` and `checkAllStaleness` -- extracting a shared helper would bring this to APPROVED.
