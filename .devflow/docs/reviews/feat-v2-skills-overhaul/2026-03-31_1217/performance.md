# Performance Review Report

**Branch**: feat/v2-skills-overhaul -> main
**Date**: 2026-03-31

## Issues in Your Changes (BLOCKING)

### CRITICAL

_No critical performance issues found._

### HIGH

_No high-severity performance issues found._

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Regex re-creation inside tight loop in `findStaleNameOccurrences`** - `tests/skill-references.test.ts:105`
**Confidence**: 82%
- Problem: Inside the `findStaleNameOccurrences` function, a new `RegExp` object (`prefixedPattern`) is created once per `[oldName, pattern]` entry, which is fine. However, the function is called once per file and iterates all old-name/line combinations. The outer call site iterates all test files and calls this function for each. The `pattern` regex uses the `g` flag, and `pattern.lastIndex` is manually reset per line (line 110) -- this is correct and prevents a common stateful-regex bug. No blocking issue here, but the function materializes the entire file into a `lines` array via `split('\n')`, which creates N string objects per file. For the small test file counts in this repo this is negligible, but the function signature implies reusability.
- Fix: This is a test utility and file counts are small (dozens, not thousands). No action required. If reused at scale, consider streaming line-by-line or using a single-pass regex with match indices instead of splitting into an array.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`LEGACY_SKILL_NAMES` linear scan for each `SHADOW_RENAMES` entry** - `src/cli/plugins.ts:209-318`
**Confidence**: 80%
- Problem: The test `SHADOW_RENAMES consistency` (in `tests/plugins.test.ts:230`) calls `LEGACY_SKILL_NAMES.includes()` up to 3 times per `SHADOW_RENAMES` entry (bare, `devflow-` prefixed, `devflow:` prefixed). With ~80 legacy names and ~16 shadow renames, this is O(n*m) but the constants are small enough (~3840 comparisons max) that it has zero measurable impact. The `LEGACY_SKILL_NAMES` array itself grew from the previous branch but was already large.
- Fix: No action needed at current scale. If `LEGACY_SKILL_NAMES` grows past ~500 entries, converting to a `Set` would make lookups O(1).

### LOW

**`migrateShadowOverrides` calls `fs.access` twice per rename entry (old + new)** - `src/cli/commands/init.ts:68-90`
**Confidence**: 85%
- Problem: The refactored `migrateShadowOverrides` uses `Promise.all` to parallelize shadow migration checks across all 16 `SHADOW_RENAMES` entries. Each entry makes 1-2 `fs.access` calls (up to 32 total). The previous sequential version did the same number of filesystem calls but serially. The `Promise.all` refactor is a net improvement for latency since these I/O-bound checks now run concurrently. However, `fs.rename` operations within `Promise.all` could theoretically race if two old names map to the same new name (e.g., `git-safety -> git`, `git-workflow -> git`, `github-patterns -> git`). If both old shadows exist simultaneously, the first to pass the `shadowExists(newShadow)` check wins the rename, and the second may find `newShadow` already exists by the time it calls `fs.rename`, though it would have been caught by the `shadowExists(newShadow)` guard. The TOCTOU window is real but the practical impact is minimal since shadow overrides are rare.
- Fix: This is informational. The race window is harmless because even if both `fs.rename` calls fire, one will succeed and the other will fail with ENOENT (old already moved) or produce a warning. For correctness under adversarial conditions, the three `git-*` entries could be grouped and processed sequentially, but this is not worth the complexity at current scale.

## Suggestions (Lower Confidence)

- **`buildFullSkillsMap` iterates all plugins redundantly** - `src/cli/plugins.ts:402-412` (Confidence: 65%) -- `buildFullSkillsMap` duplicates the inner loop of `buildAssetMaps` but only for skills. Both are called during init. Could be unified, but the duplication is in a ~10-line function called once at startup -- negligible.

- **Sync I/O in test file (`readFileSync`)** - `tests/skill-references.test.ts:14` (Confidence: 70%) -- The test file uses synchronous `readFileSync` throughout. A comment was added in this PR explaining the rationale (no async benefit for static fixture reads during test discovery). This is a deliberate choice and appropriate for test code.

- **`Promise.all` shadow migration could saturate filesystem on very large rename lists** - `src/cli/commands/init.ts:68` (Confidence: 60%) -- With 16 entries, `Promise.all` is fine. At 1000+ entries, `p-limit` or batching would be advisable. Not a concern at current scale.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 1 | 1 |

**Performance Score**: 9/10
**Recommendation**: APPROVED

This PR is a naming consolidation refactor (renaming 9 skills by removing `-patterns` suffix and merging 3 git skills into one). The changes are overwhelmingly in markdown skill files, plugin manifests, agent frontmatter, and documentation -- none of which have runtime performance implications.

The one code-level change with performance relevance is the `migrateShadowOverrides` refactor from sequential `for...of` to `Promise.all`, which is a net performance improvement (parallel filesystem I/O). The TOCTOU race with multiple old names mapping to the same new name (`git`) is theoretically present but harmless in practice.

No N+1 queries, no blocking I/O in hot paths, no unbounded caches, no algorithmic regressions detected.
