# Regression Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-30

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**read-sidecar behavior change: string field handling added without backward-compatibility concern** - `scripts/hooks/lib/sidecar-ops.cjs:28-29`
**Confidence**: 82%
- Problem: The old `read-sidecar` in `json-helper.cjs` only handled array fields -- any non-array field returned `'[]'`. The new `sidecar-ops.cjs` adds a `typeof value === 'string'` branch that outputs the raw string value. While this is an intentional improvement (the test at line 646 explicitly validates this), callers that previously relied on `read-sidecar` always returning a JSON-parseable array may break if they receive a raw string. The actual caller (`background-kb-refresh:178-179`) reads `description` via `read-sidecar` but was already wrapping it in a fallback (`|| echo ""`), so this specific caller should be fine. However, the behavioral contract of the CLI command changed silently.
- Fix: Acceptable as-is since the only real-world caller (`background-kb-refresh`) handles both cases. The new behavior is strictly more useful. Document this intentional change in a commit message or comment for future reference.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Shell hooks: source error-exit may change failure mode** - `scripts/hooks/pre-compact-memory:12`, `scripts/hooks/preamble:11`, and 6 other hooks (Confidence: 65%) -- The `|| { echo "..."; exit 1; }` pattern added to `source` commands changes behavior from a silent `set -e` exit to an explicit error message + exit. Under `set -e`, a failed `source` already exits non-zero, so this adds diagnostics without changing the exit behavior. However, the `json-parse` file that is being sourced could theoretically return non-zero from internal commands without failing entirely (edge case). The comment on `pre-compact-memory:11` says "silently no-op if neither available," which slightly contradicts the new exit-on-failure approach -- but the `_JSON_AVAILABLE` guard on the next line handles that case. This is a strict improvement in debuggability.

- **checkAllStaleness: git log --after cutoff uses oldest timestamp across all KBs** - `scripts/hooks/lib/feature-kb.cjs:250` (Confidence: 70%) -- The new batched staleness check uses the oldest `lastUpdated` across all KB entries as the `--after` cutoff for a single `git log` call. If one very old KB exists alongside many recent ones, the git log will scan more history than needed. This is a performance tradeoff (fewer git invocations at the cost of a potentially larger log scan), not a regression -- the per-file timestamp comparison at lines 273-276 ensures correctness. However, extremely old KBs could cause a slow single git call vs. the old per-entry approach.

- **Unused import left in kb-agent.ts** - `src/cli/utils/kb-agent.ts:1` (Confidence: 72%) -- `execFileSync` is imported from `child_process` but the file on disk also uses it (for `loadKnowledgeContext`). However, in the diff's view of the file, only `execFile` is used for the async path. This may be an artifact of incremental commits adding `loadKnowledgeContext` after the initial refactor.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED

### Rationale

This PR is a clean module decomposition of the monolithic `kb.ts` into focused subcommand modules (`check.ts`, `create.ts`, `list.ts`, `refresh.ts`, `remove.ts`, `toggle.ts`, `shared.ts`) plus utility extraction (`kb-agent.ts`, `sidecar.ts`, `safe-path.cjs`, `sidecar-ops.cjs`).

**No regressions detected in the core areas:**

1. **Exports preserved**: The old `kb.ts` is now a compatibility shim (`export * from './kb/index.js'`). The `index.ts` re-exports `addKbHook`, `removeKbHook`, `hasKbHook`, `readSidecar`, and `SidecarData` -- matching all exports consumed by `init.ts`, `uninstall.ts`, `kb.test.ts`, and `feature-kb.test.ts`. No broken consumers.

2. **CLI commands preserved**: All subcommands (`list`, `check`, `create <slug>`, `refresh [slug]`, `remove <slug>`) and root-level options (`--enable`, `--disable`, `--status`) are registered identically in `kb/index.ts`.

3. **read-sidecar operation**: Correctly moved from inline `json-helper.cjs` switch-case to `sidecar-ops.cjs` with routing via `sidecarOps.handle(op, args)`. Behavior is preserved for the array path (with added string filtering) and the error/fallback paths. The `background-kb-refresh` hook (the only shell caller) continues to work.

4. **safePath extraction**: Moved from inline function in `json-helper.cjs` to `lib/safe-path.cjs`. The implementation is identical. Imported back into `json-helper.cjs` and `sidecar-ops.cjs`.

5. **checkAllStaleness/listKBs cachedIndex**: The added optional `cachedIndex` parameter is backward-compatible -- existing callers without the parameter get the previous behavior (`loadIndex` is called internally). The `list` and `check` subcommands now use single-load patterns to avoid the N+1 double-read that was previously reported.

6. **sync-to-async migration**: `create.ts` and `refresh.ts` now use async `execFile` via `runKbAgent()` instead of sync `execFileSync`. This is a strict improvement (unblocks the event loop for spinner animation) with no behavioral change to callers since the functions were already `async`.

7. **Feature-kb skill**: The skill now instructs the Knowledge agent to write a sidecar JSON file instead of calling `update-index` directly. This is coordinated with the host-side changes in `create.ts`, `refresh.ts`, and `plan:orch`. The old direct-index-update instruction was a security concern (agent writing to shared index); the sidecar pattern is safer.

8. **All 97 tests pass** (81 feature-kb + 16 kb-hook tests).
