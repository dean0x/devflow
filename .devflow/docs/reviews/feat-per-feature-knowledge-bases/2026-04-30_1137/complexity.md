# Complexity Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-30

## Issues in Your Changes (BLOCKING)

### HIGH

**`handleToggle` function has high cyclomatic complexity (3 branches with deep nesting)** - `src/cli/commands/kb/toggle.ts:94`
**Confidence**: 85%
- Problem: `handleToggle` is 103 lines (lines 94-197) containing an if/else-if/else chain with 3 branches (`enable`, `disable`, `status`), each containing multiple nested try/catch blocks. The enable and disable branches share substantial duplicated logic (read settings, update hook, read/write manifest). Cyclomatic complexity is approximately 12 (3 main branches + 6 try/catch + conditional checks).
- Fix: Extract shared steps into helper functions. The enable/disable branches differ only in which hook function they call and which sentinel operation they perform. A single `toggleKb(enabled: boolean)` helper could handle both:

```typescript
async function updateHookAndManifest(
  settingsPath: string, devflowDir: string, enabled: boolean
): Promise<void> {
  try {
    const content = await fs.readFile(settingsPath, 'utf-8');
    const updated = enabled
      ? addKbHook(content, devflowDir)
      : removeKbHook(content);
    if (updated !== content) {
      await fs.writeFile(settingsPath, updated, 'utf-8');
    }
  } catch { /* settings.json may not exist */ }

  const manifest = await readManifest(devflowDir);
  if (manifest) {
    manifest.features.kb = enabled;
    manifest.updatedAt = new Date().toISOString();
    await writeManifest(devflowDir, manifest);
  }
}
```

---

**`checkAllStaleness` function is 77 lines with high cyclomatic complexity** - `scripts/hooks/lib/feature-kb.cjs:204`
**Confidence**: 82%
- Problem: The refactored `checkAllStaleness` function (lines 204-280) has approximately 13 decision points: 3 early returns, 2 fallback code paths (each with a for-loop), a for-loop collecting files with nested conditionals, a try/catch for git, and a final for-loop with conditionals. Two fallback blocks are exact duplicates (lines 238-243 and 256-261). While the function's algorithm is sound and well-commented, its length and branching complexity push it past the "warning" threshold.
- Fix: Extract the duplicated fallback into a helper:

```javascript
function perEntryFallback(worktreePath, index, slugs) {
  const results = {};
  for (const slug of slugs) {
    results[slug] = checkEntryFiles(worktreePath, index.features[slug]);
  }
  return results;
}
```

Then replace both duplicated blocks with `return perEntryFallback(worktreePath, index, slugs);`. This reduces the function from 77 to ~60 lines and eliminates the duplication.

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`json-helper.cjs` remains at 1837 lines** - `scripts/hooks/json-helper.cjs:1`
**Confidence**: 85%
- Problem: Even after extracting `sidecar-ops.cjs` and `safe-path.cjs`, `json-helper.cjs` is still 1837 lines -- well above the 500-line critical threshold for file length. The main switch statement contains 30+ cases. This PR made a good start by extracting `read-sidecar` into its own module, but the vast majority of the file remains a single monolithic dispatch.
- Impact: Informational only. The extraction pattern established in this PR (domain module with `handle()` returning boolean) is the right approach for further decomposition, but doing so is out of scope for this PR.

## Suggestions (Lower Confidence)

- **`handleRefresh` prompt construction mixes data and template** - `src/cli/commands/kb/refresh.ts:54-79` (Confidence: 65%) -- The 25-line prompt array literal interleaves dynamic data with static template text. A template function or constant would improve readability, but the current approach is standard for this codebase.

- **`parseGitLogWithDates` state machine could be more explicit** - `scripts/hooks/lib/feature-kb.cjs:50-64` (Confidence: 60%) -- The function uses a `currentDate` sentinel to track state transitions between date lines and file lines. Adding a brief comment documenting the two states (parsing-date vs. parsing-files) would aid future readers, though the function is short enough (15 lines) that it remains understandable.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 0 |

**Complexity Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR is a significant improvement in complexity: it decomposes a 607-line monolithic `kb.ts` file into 7 focused modules (each under 200 lines), extracts shared utilities (`sidecar.ts`, `kb-agent.ts`, `safe-path.cjs`, `sidecar-ops.cjs`), and eliminates the N+1 index loading problem with `cachedIndex` parameters. The decomposition pattern is clean and consistent. Two functions (`handleToggle`, `checkAllStaleness`) carry moderate complexity that would benefit from further extraction of shared logic and duplicated fallback paths, but neither is blocking at the current level.
