# Complexity Review Report

**Branch**: feat/v2-skills-overhaul -> main
**Date**: 2026-03-31
**PR**: #168

## Issues in Your Changes (BLOCKING)

No CRITICAL or HIGH complexity issues found in new/modified code.

### MEDIUM

**SHADOW_RENAMES many-to-one mapping creates a hidden race condition in migrateShadowOverrides** - `src/cli/plugins.ts:327-329` and `src/cli/commands/init.ts:65-96`
**Confidence**: 85%
- Problem: Three old names (`git-safety`, `git-workflow`, `github-patterns`) all map to the same target `git` in SHADOW_RENAMES. When `migrateShadowOverrides` runs via `Promise.all`, all three entries execute concurrently. If a user has both `git-safety/` and `git-workflow/` shadow directories, the first `fs.rename` to `git/` succeeds, and the second concurrently checks `shadowExists(newShadow)` which may or may not see the newly-renamed directory depending on filesystem timing. The result is nondeterministic: either a warning ("found alongside") or a rename that silently overwrites the first migration. This is a cognitive complexity concern -- the many-to-one relationship is not obvious from the data structure and the concurrent execution makes reasoning about correctness difficult.
- Fix: Process SHADOW_RENAMES sequentially (replace `Promise.all` with a `for...of` loop) or deduplicate many-to-one targets so only the first matching old directory is renamed. Example:
```typescript
// Process sequentially to handle many-to-one safely
for (const [oldName, newName] of SHADOW_RENAMES) {
  const oldShadow = path.join(shadowsRoot, oldName);
  const newShadow = path.join(shadowsRoot, newName);
  if (!(await shadowExists(oldShadow))) continue;
  if (await shadowExists(newShadow)) {
    warnings.push(`Shadow '${oldName}' found alongside '${newName}' ...`);
    continue;
  }
  await fs.rename(oldShadow, newShadow);
  migrated++;
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**init.ts remains a 1060-line monolith (known pitfall PF-002, growing)** - `src/cli/commands/init.ts`
**Confidence**: 90%
- Problem: PF-002 already documents init.ts as a monolith at ~877 lines. This PR adds `shadowExists()` and refactors `migrateShadowOverrides()`, bringing the file to 1060 lines. The severity guidelines mark files > 500 lines as "Critical" threshold. The pitfall resolution ("Extract into `collectInitChoices()`, `executeInstallation()`, `printSummary()`") has not been applied, and each new function added to init.ts increases the cost of that eventual extraction.
- Fix: Deferred per PF-002 (major refactor). No immediate action required from this PR, but noting the trend.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**LEGACY_SKILL_NAMES is a linear list with 30+ entries and no structural organization** - `src/cli/plugins.ts:260-317`
**Confidence**: 82%
- Problem: The list now contains 30+ entries across 4 comment-delineated groups (legacy prefixed, v2 prefixed old names, v2 bare names, v2 -patterns removals). Determining whether a name is already in the list requires scanning all entries. Overlap between LEGACY_SKILL_NAMES and SHADOW_RENAMES is not enforced structurally -- the new test (`SHADOW_RENAMES consistency`) validates this at test time, which is good, but the data model itself does not prevent drift.
- Fix: Consider generating LEGACY_SKILL_NAMES from SHADOW_RENAMES plus a static base set, or use a Set with computed entries. This would make the relationship between the two lists explicit in the code rather than relying on test-time validation.

**tests/skill-references.test.ts at 980 lines exceeds complexity threshold** - `tests/skill-references.test.ts`
**Confidence**: 80%
- Problem: The file is 980 lines with 10+ describe blocks. The new `findStaleNameOccurrences` extraction is good (reduces inline nesting), but the file as a whole is approaching the "needs splitting" threshold. Multiple distinct concerns (reference resolution, frontmatter validation, completeness checks, stale name detection, cross-component alignment) are combined in one file.
- Fix: Consider splitting into `skill-integrity.test.ts` (frontmatter, references) and `skill-alignment.test.ts` (cross-component, completeness) in a future PR.

## Suggestions (Lower Confidence)

- **SHADOW_RENAMES type lacks self-documentation for many-to-one semantics** - `src/cli/plugins.ts:326` (Confidence: 65%) -- The `[string, string][]` type does not communicate that multiple old names can map to the same new name. A comment exists but a named type alias (e.g., `type ShadowRenameEntry = [oldName: string, newName: string]`) would improve readability.

- **OLD_SKILL_NAMES regex array in tests duplicates SHADOW_RENAMES knowledge** - `tests/skill-references.test.ts:716-731` (Confidence: 70%) -- Each time a skill is renamed, the regex patterns must be manually added here alongside the SHADOW_RENAMES entry. Consider deriving the test patterns from SHADOW_RENAMES to reduce maintenance burden.

- **git/SKILL.md at 254 lines is dense but within acceptable range** - `shared/skills/git/SKILL.md` (Confidence: 60%) -- The consolidated skill (254 lines SKILL.md + 1307 lines across 5 references) replaces 3 skills totaling 432 lines in main SKILL.md files. Progressive disclosure to references/ is used correctly. No action needed, but note this is the densest single skill file.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Complexity Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Positive Observations

1. **migrateShadowOverrides refactored well**: The rewrite from nested try/catch to `Promise.all` with structured return values significantly reduces nesting depth (was 3-4 levels, now flat). This is a genuine complexity improvement.
2. **findStaleNameOccurrences extracted cleanly**: The test helper extraction eliminates a 3-level nested loop from the test body, improving readability.
3. **Guard clauses over non-null assertions**: The `if (!coreMatch)` pattern replacing `coreMatch!` in skill-references.test.ts is a readability win -- TypeScript narrows the type after the guard, making the downstream code self-evidently safe.
4. **Net code reduction**: -658 lines net (1165 added, 1823 removed). The 3-to-1 git skill consolidation removes genuine duplication across git-safety, git-workflow, and github-patterns.
5. **Test coverage for invariants**: New tests (`SHADOW_RENAMES consistency`, `skill frontmatter integrity`) enforce structural invariants that prevent complexity drift.

### Condition

The SHADOW_RENAMES many-to-one race in `migrateShadowOverrides` should be addressed before merge -- either by processing sequentially or by deduplicating targets. The risk is low (shadow overrides are rare) but the fix is trivial.
