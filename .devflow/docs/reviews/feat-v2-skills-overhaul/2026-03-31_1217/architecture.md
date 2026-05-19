# Architecture Review Report

**Branch**: feat/v2-skills-overhaul -> main
**Date**: 2026-03-31
**PR**: #168

## Issues in Your Changes (BLOCKING)

### HIGH

**SHADOW_RENAMES many-to-one race condition in parallel migration** - `src/cli/commands/init.ts:68-90`
**Confidence**: 85%
- Problem: Three old shadow skill directories (`git-safety`, `git-workflow`, `github-patterns`) all map to the same new target `git` in SHADOW_RENAMES. The refactored `migrateShadowOverrides` uses `Promise.all` to process all renames in parallel. When a user has shadows for two or more of these old names and the target `git` does not yet exist, multiple `fs.rename` calls race to create the same destination directory. Only one succeeds; the others may fail with `ENOTEMPTY` or `EEXIST` depending on OS timing, silently losing shadow overrides.
- Fix: Process SHADOW_RENAMES entries with the same `newName` sequentially, or deduplicate by target before parallelizing. For many-to-one renames, only migrate the first old shadow found and warn about the rest:
```typescript
// Group by target, process each group sequentially
const byTarget = new Map<string, [string, string][]>();
for (const pair of SHADOW_RENAMES) {
  const group = byTarget.get(pair[1]) || [];
  group.push(pair);
  byTarget.set(pair[1], group);
}

const results = await Promise.all(
  [...byTarget.values()].map(async (group) => {
    const groupResults = [];
    for (const [oldName, newName] of group) {
      // ... process sequentially within each target group
    }
    return groupResults;
  }),
);
```

### MEDIUM

**Unified git skill at 254 lines exceeds target size guideline** - `shared/skills/git/SKILL.md`
**Confidence**: 82%
- Problem: The project's own CLAUDE.md specifies "Target: ~120-150 lines per SKILL.md with progressive disclosure to references/". The unified `git` skill is 254 lines -- nearly double the upper guideline. While the consolidation of 3 skills into 1 is architecturally sound (SRP at the domain level: "git operations"), the SKILL.md itself now covers safety, commits, PRs, sensitive file detection, and GitHub API, which are 5 distinct concerns in a single main file.
- Fix: Move the GitHub API section (lines 192-218) and Sensitive File Detection section (lines 169-188) to `references/` files, keeping the SKILL.md focused on the top 3 concerns (safety, commits, PRs) with cross-references. This would bring the file to approximately 170 lines, closer to the 150-line target.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Iron Law change from "atomic commits" to "sequential ops" loses a primary invariant** - `plugins/devflow-core-skills/README.md:35`
**Confidence**: 80%
- Problem: The core-skills README previously listed the `git-workflow` Iron Law as "ATOMIC COMMITS WITH HONEST DESCRIPTIONS". After the consolidation, the `git` skill's Iron Law in the README is "NEVER RUN GIT COMMANDS IN PARALLEL" (the safety-focused law). While the unified SKILL.md does preserve the atomic commits principle as a secondary callout (`> **ATOMIC COMMITS WITH HONEST DESCRIPTIONS**`), the README's Iron Law table now omits commitment quality as a primary invariant. The git-workflow skill elevated this to Iron Law status for good reason -- it was the single most important enforcement point for commit hygiene.
- Fix: Either (a) update the README to show both principles, or (b) promote the atomic commits callout to equal prominence in the unified SKILL.md by making it a co-Iron Law or a "Secondary Iron Law" section. The current hierarchy suggests safety > quality, which may cause agents to deprioritize commit message quality.

## Pre-existing Issues (Not Blocking)

_None identified at CRITICAL severity._

## Suggestions (Lower Confidence)

- **SHADOW_RENAMES missing legacy entries for git consolidation** - `src/cli/plugins.ts:294-317` (Confidence: 70%) -- The LEGACY_SKILL_NAMES array includes `devflow:complexity-patterns`, `devflow:consistency-patterns`, etc. for the 6 renamed pattern skills, and adds bare `git` for the git consolidation. However, the prefixed entries `devflow:git-safety`, `devflow:git-workflow`, `devflow:github-patterns` are absent. The most recent commit (ccd2b7a) reverted adding these, suggesting an intentional decision, but the asymmetry with the other renames is noteworthy. If legacy installs had these prefixed names on disk, they would not be cleaned up.

- **`github-patterns` skill had a `references/patterns.md` that was renamed to `references/github-api.md`** - `shared/skills/git/references/github-api.md` (Confidence: 65%) -- The `github-patterns` SKILL.md referenced `references/commands.md` and `references/api.md` in its Extended References section. The new unified SKILL.md correctly references `references/github-api.md`, but if any external tooling or user documentation pointed to the old reference file paths, those links are now broken. This is a low risk since reference files are only used via progressive disclosure within the skill itself.

- **No migration test for the 3-to-1 shadow rename scenario** - `tests/plugins.test.ts` (Confidence: 75%) -- The new SHADOW_RENAMES consistency tests validate that old names appear in LEGACY_SKILL_NAMES and new names are valid skills. However, there is no test for the specific 3-to-1 convergence case (multiple old names mapping to one new name), which is the novel pattern introduced by the git consolidation. The existing `migrateShadowOverrides` tests (if any) should cover this edge case.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The core architectural decision -- consolidating 3 related git skills (`git-safety`, `git-workflow`, `github-patterns`) into a single unified `git` skill -- is well-motivated and well-executed. It reduces cognitive load, eliminates cross-references between closely related skills, and aligns naming conventions with the V2 overhaul pattern (dropping `-patterns` suffixes, using bare names).

The rename propagation across 71 files is thorough: all plugin manifests, agent frontmatter, command references, skill catalogs, documentation, and tests have been updated consistently. The migration infrastructure (SHADOW_RENAMES, LEGACY_SKILL_NAMES) properly handles upgrade paths from older installs.

The blocking issue is the race condition in `migrateShadowOverrides` when multiple old shadows target the same new name under `Promise.all`. This is a real-world scenario (a user who had both `git-safety` and `git-workflow` shadow overrides) and should be addressed before merge.
