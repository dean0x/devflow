# Performance Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-24

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Synchronous `fs.readFileSync` in `loadIndex` called repeatedly by multiple entry points** - `scripts/hooks/lib/feature-kb.cjs:91`
**Confidence**: 65%
- Problem: `loadIndex()` uses synchronous `fs.readFileSync` and `JSON.parse`. This is called from `checkStaleness`, `checkAllStaleness`, `findOverlapping`, `listKBs`, and `removeEntry`. In CLI one-shot usage (the only current caller pattern) this is fine. However, if this module is ever imported into a hot path (e.g., a session-start hook or background process), the synchronous I/O blocks the event loop.
- Impact: Negligible in current usage. This is a CLI tool invoked via `node feature-kb.cjs` subcommands or from orchestrator scripts that run sequentially. The index file is typically small (a few KB). No current caller is latency-sensitive.
- Fix: No fix needed now. If the module is ever consumed from an async context, convert `loadIndex` to use `fs.promises.readFile`.

## Suggestions (Lower Confidence)

- **Sequential `execFileSync` per slug in `checkAllStaleness`** - `scripts/hooks/lib/feature-kb.cjs:186-196` (Confidence: 70%) -- The new `checkAllStaleness` inlines one `git log` call per slug rather than delegating to `checkStaleness` (which also checked `git rev-parse --git-dir` per slug). The refactoring correctly lifts the git-dir check out of the loop (line 172), eliminating the N+1 git-dir pattern. However, the per-slug `git log` calls remain sequential. For N KBs, this is N process spawns. A single `git log --after=<earliest-lastUpdated> --name-only --pretty=format: -- <all-referenced-files>` could reduce this to 1 spawn, though the post-processing to attribute changed files back to per-slug timestamps would add complexity. Current N is small (typically 1-5 KBs), so the overhead is under 1 second total.

- **`Atomics.wait` busy-loop fallback in `acquireLock`** - `scripts/hooks/lib/feature-kb.cjs:242-243` (Confidence: 65%) -- The `Atomics.wait` call provides a 100ms sleep without shell dependency, which is good. The Node < 16 fallback comment says "busy-wait" but the catch block is empty, meaning on older runtimes the loop would spin with zero delay. In practice, Node 16+ is the minimum for Claude Code, and `Atomics.wait` will always succeed. The actual concern is negligible.

- **New `SharedArrayBuffer` allocation per retry iteration** - `scripts/hooks/lib/feature-kb.cjs:242` (Confidence: 60%) -- Each retry allocates a new `SharedArrayBuffer(4)` and `Int32Array`. For a lock that typically succeeds on the first try, this is irrelevant. Even in the worst case (300 retries over 30s timeout), allocating 4-byte buffers 300 times is trivially cheap. No action needed.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 0 |

**Performance Score**: 9/10
**Recommendation**: APPROVED

### Analysis Summary

This PR introduces well-structured performance improvements to the feature-kb module:

1. **N+1 elimination in `checkAllStaleness`**: The previous implementation delegated to `checkStaleness` per slug, which redundantly called `git rev-parse --git-dir` N times. The refactored version (lines 166-199) checks git-dir once for the entire batch and inlines the per-slug git-log calls. This correctly eliminates the N+1 overhead on the git-dir check while keeping per-slug `git log` calls (acceptable for the small N expected).

2. **`NOT_STALE` sentinel**: Extracting `Object.freeze({ stale: false, changedFiles: [] })` into a shared constant avoids repeated object allocation across all non-stale paths. This is a minor but correct micro-optimization.

3. **`parseGitChangedFiles` extraction**: Deduplicating the `split/trim/filter/Set` logic into a named function improves maintainability without any performance cost.

4. **`findOverlapping` directory-boundary fix**: Adding `+ '/'` to `startsWith` checks (line 325) prevents false prefix matches (e.g., `src/cli` matching `src/clitools`). This is a correctness fix with no performance impact.

5. **Lock timeout parameterization**: Exposing `lockTimeoutMs` in `updateIndex` and `removeEntry` improves testability (the T1 test uses 500ms timeout) without affecting production behavior.

6. **Background hook `--allowedTools` restriction**: Adding `--allowedTools 'Read'` to `background-learning` and `--allowedTools 'Read,Write'` to `background-memory-update` constrains the tool surface of background `claude -p` processes. This has no direct performance effect but is good practice for limiting unnecessary tool initialization overhead.

No blocking or should-fix performance issues were found. The changes demonstrate awareness of the N+1 pattern and apply the fix correctly at the appropriate scope.
