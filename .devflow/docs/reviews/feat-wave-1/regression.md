# Regression Review Report

**Branch**: feat/wave-1 -> main
**Date**: 2026-03-13

## Issues in Your Changes (BLOCKING)

### CRITICAL

No critical regression issues found.

### HIGH

No high-severity regression issues found.

### MEDIUM

**Missing error handling for writeManifest failure in init.ts** - `/Users/dean/Sandbox/devflow/src/cli/commands/init.ts:624`
**Confidence**: 82%
- Problem: The `writeManifest(devflowDir, manifestData)` call at the end of `init.ts` is not wrapped in a try/catch. If writing the manifest fails (permissions, disk full, etc.), the entire `init` command throws an unhandled error after all plugins have already been installed successfully. The user sees a crash instead of a graceful degradation, and the installation appears to have failed even though all plugins were correctly installed.
- Impact: Installation completes but the final manifest write failure crashes the CLI, confusing the user about installation state.
- Fix: Wrap the manifest write in a try/catch that logs a warning rather than crashing, since the manifest is a non-critical enhancement (upgrade tracking) and the installation itself succeeded:
```typescript
// Write installation manifest for upgrade tracking
try {
  const installedPluginNames = pluginsToInstall.map(pl => pl.name);
  const now = new Date().toISOString();
  const manifestData = {
    version,
    plugins: existingManifest && options.plugin
      ? mergeManifestPlugins(existingManifest.plugins, installedPluginNames)
      : installedPluginNames,
    scope,
    features: { teams: teamsEnabled, ambient: ambientEnabled, memory: memoryEnabled },
    installedAt: existingManifest?.installedAt ?? now,
    updatedAt: now,
  };
  await writeManifest(devflowDir, manifestData);
} catch (error) {
  p.log.warn(`Could not write manifest: ${error instanceof Error ? error.message : error}`);
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Synthesizer review glob self-exclusion is pattern-dependent** - `/Users/dean/Sandbox/devflow/shared/agents/synthesizer.md:131`
**Confidence**: 80%
- Problem: The synthesizer changed from `${REVIEW_BASE_DIR}/*-report.*.md` (too restrictive, matched zero files) to `${REVIEW_BASE_DIR}/*.md` with instruction to "exclude your own output `review-summary.*.md`". The self-exclusion depends on the agent correctly implementing the exclusion at runtime. If the synthesizer reads its own prior output file during aggregation, it would double-count findings. This is a behavioral contract change rather than a code-enforced guarantee.
- Impact: If the synthesizer agent fails to self-exclude, review summaries could include duplicated or recursive findings.
- Fix: This is an agent instruction, not code, so the fix is to verify the instruction is clear (it is) and that the naming convention (`review-summary.*`) is distinct enough from reviewer output filenames (`{focus}.md`). The current naming convention is distinct -- reviewer files are named like `security.md`, `architecture.md`, etc., while the synthesizer writes `review-summary.{timestamp}.md`. The self-exclusion pattern is clear. No code change needed, but worth verifying in integration testing.

## Pre-existing Issues (Not Blocking)

No critical pre-existing regression issues identified in reviewed files.

## Suggestions (Lower Confidence)

- **Manifest validation is minimal** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts:29` (Confidence: 70%) -- `readManifest` checks `version`, `plugins` (array), and `scope`, but does not validate `features`, `installedAt`, or `updatedAt`. A partially corrupt manifest with valid top-level fields but missing `features` could cause a runtime error in `list.ts:41` when accessing `manifest.features.teams`. Consider validating the full shape or using optional chaining in consumers.

- **compareSemver does not handle pre-release suffixes** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts:65` (Confidence: 65%) -- The semver comparison regex `/^v?(\d+)\.(\d+)\.(\d+)/` strips pre-release suffixes (e.g., `1.5.0-beta.1`). This means `1.5.0-beta.1` and `1.5.0` are treated as equal. If DevFlow ever uses pre-release versions, upgrade detection would report "same version" incorrectly. Acceptable for now given the project only uses stable versions.

- **Downgrade scenario has no user-facing message** - `/Users/dean/Sandbox/devflow/src/cli/commands/init.ts:296-305` (Confidence: 62%) -- The upgrade detection code handles `isUpgrade` and `isSameVersion` with spinner messages, but `isDowngrade` is silently ignored. If a user installs an older version, there is no warning. This is unlikely to cause breakage but could confuse users expecting feedback.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

## Regression Checklist

- [x] No exports removed without deprecation -- deleted files (`skimmer.md`, `synthesizer.md`) were gitignored build artifacts identical to `shared/agents/` originals (verified via md5 hash match). The build system distributes these from `shared/agents/` to plugins. Commit `cd315f5` correctly untracks them.
- [x] Return types backward compatible -- `list.ts` action changed from sync to async, which Commander.js handles natively. No breaking change.
- [x] Default values unchanged -- no defaults modified.
- [x] Side effects preserved -- all event/logging behavior intact.
- [x] All consumers of changed code updated -- synthesizer glob change is consistent across `synthesizer.md` and `git.md`. Both use `${REVIEW_BASE_DIR}/*.md`.
- [x] Migration complete across codebase -- `search-first` skill added to `plugins.ts`, `plugin.json`, `ambient-router/SKILL.md`, and `skill-catalog.md` consistently.
- [x] CLI options preserved -- no CLI options removed.
- [x] API endpoints preserved -- N/A.
- [x] Commit messages match implementation -- all 5 commits verified against their diffs.
- [x] Breaking changes documented in CHANGELOG -- glob fix, confidence thresholds, manifest, and search-first skill all documented.
- [x] Tests pass -- 208/208 tests pass (12 test files), including 17 new manifest tests.

## Detailed Commit-by-Commit Regression Analysis

### 1. `53380dc` feat: add search-first skill (#111)
- **New files only** (`SKILL.md`, `evaluation-criteria.md`) -- no existing functionality removed or changed.
- Correctly registered in `plugins.ts`, `plugin.json`, `ambient-router`, and `skill-catalog.md`.
- **Regression risk**: None. Additive change.

### 2. `7879fc6` feat: add reviewer confidence thresholds and consolidation rules (#113)
- **Reviewer agent**: Steps 6-7 renumbered to 6-10 with new confidence/consolidation steps inserted. No steps removed.
- **Synthesizer agent**: Review mode process steps expanded from 4 to 7. Old steps preserved (categorize, count, determine) with new confidence-aware steps prepended. Glob pattern fixed from `*-report.*.md` to `*.md` with self-exclusion.
- **Code-review command**: Git agent instructions updated for confidence-based PR commenting. No invocation pattern changes.
- **Regression risk**: Low. All changes are additive to agent instructions. The glob fix is a bugfix (old pattern matched zero files).

### 3. `47c4a67` feat: add version manifest for upgrade tracking (#91)
- **New file**: `src/cli/utils/manifest.ts` with `readManifest`, `writeManifest`, `mergeManifestPlugins`, `detectUpgrade`.
- **init.ts**: Two insertions -- manifest read at top (upgrade detection), manifest write at bottom. No existing code modified.
- **list.ts**: Changed from sync to async. Added manifest reading and install status display. Core plugin listing logic unchanged.
- **Regression risk**: Low. The `writeManifest` call lacks error handling (noted as MEDIUM blocking issue above). The async change in `list.ts` is backward compatible with Commander.js.

### 4. `9e316a7` docs: update changelog and skill count
- **CHANGELOG.md**: Additive entries only.
- **CLAUDE.md**: Skill count `30` -> `31`. Matches actual count after search-first addition.
- **Regression risk**: None. Documentation only.

### 5. `cd315f5` chore: untrack gitignored build artifacts in devflow-specify
- **Deleted**: `plugins/devflow-specify/agents/skimmer.md` and `plugins/devflow-specify/agents/synthesizer.md`.
- **Verified**: Both files were byte-identical copies of `shared/agents/skimmer.md` and `shared/agents/synthesizer.md` (md5 match confirmed). Both are listed in `.gitignore` as generated build artifacts (`plugins/*/agents/skimmer.md`, `plugins/*/agents/synthesizer.md`).
- **Build system**: `npm run build` distributes shared agents to plugins at build time. The `devflow-specify` plugin.json still declares `"agents": ["skimmer", "synthesizer"]` which the build system resolves from `shared/agents/`.
- **Regression risk**: None. These were accidentally committed copies of gitignored build artifacts.
