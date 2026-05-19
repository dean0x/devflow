# Regression Review Report

**Branch**: feat/v2-skills-overhaul -> main
**Date**: 2026-03-31_1217

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Race condition in `migrateShadowOverrides` when multiple old names map to same target** - `src/cli/commands/init.ts:68-90`
**Confidence**: 85%
- Problem: The refactored `migrateShadowOverrides` function now uses `Promise.all` to process all `SHADOW_RENAMES` entries concurrently. Three entries map to the same target directory name `git`: `['git-safety', 'git']`, `['git-workflow', 'git']`, `['github-patterns', 'git']`. When a user has two or more of these old shadow overrides, the concurrent `shadowExists(newShadow)` checks can both return `false` (the target does not exist yet), and both will then call `fs.rename(oldShadow, newShadow)`. The second rename silently overwrites the first, losing one user's shadow customization. The original sequential `for...of` loop did not have this problem because after the first rename, subsequent iterations would find the target exists and emit a warning instead.
- Fix: Either revert to sequential processing for entries that share a target, or group `SHADOW_RENAMES` by target and process each group sequentially (only the first old shadow found gets renamed; subsequent old shadows for the same target get warnings). For example:
```typescript
// Group by target to handle many-to-one mappings safely
const byTarget = new Map<string, [string, string][]>();
for (const entry of SHADOW_RENAMES) {
  const group = byTarget.get(entry[1]) ?? [];
  group.push(entry);
  byTarget.set(entry[1], group);
}

// Process groups in parallel, but entries within a group sequentially
const groupResults = await Promise.all(
  [...byTarget.values()].map(async (group) => {
    let migrated = 0;
    const warnings: string[] = [];
    for (const [oldName, newName] of group) {
      const oldShadow = path.join(shadowsRoot, oldName);
      const newShadow = path.join(shadowsRoot, newName);
      if (!(await shadowExists(oldShadow))) continue;
      if (await shadowExists(newShadow)) {
        warnings.push(`Shadow '${oldName}' found alongside '${newName}' -- keeping '${newName}', old shadow at ${oldShadow}`);
        continue;
      }
      await fs.rename(oldShadow, newShadow);
      migrated++;
    }
    return { migrated, warnings };
  }),
);
```

### MEDIUM

**README.md still uses `tests` as reviewer focus name instead of `testing`** - `README.md:19,31`
**Confidence**: 90%
- Problem: The PR renames the reviewer focus from `tests` to `testing` across `reviewer.md`, `code-review.md`, `code-review-teams.md`, `review-orchestration/SKILL.md`, and all `plugin.json` manifests. However, `README.md` still references `tests` in two places (lines 19 and 31) as a reviewer focus name. While this is documentation-only, it creates a misleading inconsistency -- someone reading the README would expect a `tests` focus reviewer, but the system now dispatches `testing`.
- Fix: Replace `tests` with `testing` in the two reviewer focus lists in README.md:
```
Line 19: "...regression, testing, plus conditional..."
Line 31: "...regression, testing, plus conditional..."
```

**Missing `devflow-git-workflow` from `LEGACY_SKILL_NAMES`** - `src/cli/plugins.ts:209-318`
**Confidence**: 92%
- Problem: The `LEGACY_SKILL_NAMES` array includes `devflow-git-safety` (line 213) and `devflow-github-patterns` (line 214) for cleanup of old `devflow-` prefixed installs, but `devflow-git-workflow` is absent. During `init`, the cleanup loop at `init.ts:842` iterates `LEGACY_SKILL_NAMES` and removes matching directories from `~/.claude/skills/`. Users who installed a pre-namespace version will have `~/.claude/skills/devflow-git-workflow/` persisting as dead weight after upgrade. The consistency test at `tests/plugins.test.ts:232` does not catch this because it only checks that SHADOW_RENAMES old names appear in LEGACY (bare form `git-workflow` passes), not that all prefixed forms are covered.
- Fix: Add `'devflow-git-workflow'` to the `LEGACY_SKILL_NAMES` array alongside its siblings:
```typescript
  'devflow-git-safety',
  'devflow-git-workflow',  // <-- add this
  'devflow-github-patterns',
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Missing `devflow:git-safety` and `devflow:git-workflow` from LEGACY_SKILL_NAMES** - `src/cli/plugins.ts:288-317`
**Confidence**: 82%
- Problem: The PR adds `devflow:complexity-patterns`, `devflow:consistency-patterns`, `devflow:regression-patterns`, `devflow:database-patterns`, `devflow:dependencies-patterns`, and `devflow:documentation-patterns` to `LEGACY_SKILL_NAMES` for cleanup of old `devflow:` prefixed installs (lines 311-317). However, `devflow:git-safety`, `devflow:git-workflow`, and `devflow:github-patterns` are not added. Users who installed after the namespace migration (v2.0.0) but before this consolidation PR would have `~/.claude/skills/devflow:git-safety/`, `devflow:git-workflow/`, and `devflow:github-patterns/` directories that need cleanup.
- Fix: Add the three old prefixed names:
```typescript
  // v2.0.0 skill renames: prefixed old names for the git consolidation
  'devflow:git-safety',
  'devflow:git-workflow',
  'devflow:github-patterns',
```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Skill count drift in docs** - `docs/reference/file-organization.md:13` (Confidence: 65%) -- The file references "31 skills" in a comment but after removing 3 old git skills and adding 1 new `git` skill, the actual count may be different. Verify and update if needed.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The core skill rename and consolidation migration is thorough -- old names are fully purged from all `shared/`, `plugins/`, agent frontmatter, and command files. The new `git` skill preserves all content from the three merged skills (`git-safety`, `git-workflow`, `github-patterns`). Tests are updated and passing (60/60). The new test for frontmatter name-directory consistency is a good guardrail.

The blocking issues are: (1) a race condition in `migrateShadowOverrides` when three old shadow names compete for the same `git` target during concurrent `Promise.all` execution, and (2) an incomplete `tests` -> `testing` rename in README.md. Both are straightforward fixes.
