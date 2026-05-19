# Correctness Review Report — Dual-Path Skill Removal

**Branch**: feat/pre-v2-cleanup -> main
**Date**: 2026-03-30
**Scope**: `src/cli/commands/uninstall.ts` and `src/cli/plugins.ts` — dual-path (prefixed + unprefixed) skill removal logic

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Inflated `skillsRemoved` counter due to `fs.rm` with `force: true` always succeeding** - `uninstall.ts:536-548`
**Confidence**: 90%
- Problem: The `skillsRemoved` counter increments after every `fs.rm()` call, but `fs.rm(..., { force: true })` does not throw when the target does not exist. This means both the prefixed and unprefixed removal always "succeed" and both increment the counter, yielding a count that is roughly 2x the actual number of directories removed. Additionally, the combined list `[...getAllSkillNames(), ...LEGACY_SKILL_NAMES]` contains 39 duplicates (every current skill name appears in both lists), further inflating the count by ~4x for those entries.
- Impact: The `verbose` log message `Removed ${skillsRemoved} DevFlow skills` reports an inflated number (up to ~230 instead of ~39). This is cosmetic only — no functional breakage — but it violates the project's "brutal honesty" principle for CLI output.
- Fix: Either (a) check if the path existed before removal:
  ```typescript
  const allSkillNames = [...new Set([...getAllSkillNames(), ...LEGACY_SKILL_NAMES])];
  // ...
  for (const skillName of allSkillNames) {
    for (const variant of [prefixSkillName(skillName), skillName]) {
      try {
        await fs.access(path.join(skillsDir, variant));
        await fs.rm(path.join(skillsDir, variant), { recursive: true, force: true });
        skillsRemoved++;
      } catch { /* doesn't exist */ }
    }
  }
  ```
  Or (b) deduplicate the input list and accept the 2x count:
  ```typescript
  const allSkillNames = [...new Set([...getAllSkillNames(), ...LEGACY_SKILL_NAMES])];
  ```

---

**`removeSelectedPlugins` does not clean up legacy `devflow-*` skill names** - `uninstall.ts:598-611`
**Confidence**: 82%
- Problem: The selective uninstall path (`removeSelectedPlugins`) iterates only the skill names from `computeAssetsToRemove` — these are bare names like `core-patterns`. It correctly removes both `devflow:core-patterns` (prefixed) and `core-patterns` (unprefixed). However, it never attempts to remove legacy `devflow-core-patterns` (the old dash-prefixed naming). Only `removeAllDevFlow` handles legacy names by concatenating `LEGACY_SKILL_NAMES`.
- Impact: If a user upgrades from a pre-v1.0.0 installation (which used `devflow-core-patterns` style names) and then does a selective uninstall, legacy-named skill directories will be orphaned. This is a narrow edge case — it requires a very old installation that was never fully re-initialized — but it violates the principle of clean uninstall.
- Fix: Add legacy name iteration in `removeSelectedPlugins`, or build a lookup map from current names to their legacy counterparts. The simplest approach:
  ```typescript
  // After the current prefixed/unprefixed removal loop
  const legacyVariant = `devflow-${skill}`;
  if (LEGACY_SKILL_NAMES.includes(legacyVariant)) {
    try {
      await fs.rm(path.join(skillsDir, legacyVariant), { recursive: true, force: true });
    } catch { /* Skill might not exist */ }
  }
  ```

## Issues in Code You Touched (Should Fix)

### LOW

**Redundant `prefixSkillName` call on already-prefixed legacy names** - `uninstall.ts:540`
**Confidence**: 85%
- Problem: `LEGACY_SKILL_NAMES` includes entries like `devflow-core-patterns`. When these pass through `prefixSkillName()`, they become `devflow:devflow-core-patterns` — a directory that will never exist on disk. The `fs.rm(..., { force: true })` swallows the no-op silently so there is no functional bug, but it is wasted work (~76 unnecessary filesystem calls).
- Impact: Negligible performance cost but conceptual confusion for anyone reading the code — it looks like it expects `devflow:devflow-core-patterns` directories to exist.
- Fix: This resolves naturally if the input list is deduplicated (see first finding above). The `getAllSkillNames()` entries produce valid prefixed paths; the `LEGACY_SKILL_NAMES` entries only need the bare (unprefixed) removal path.

## Pre-existing Issues (Not Blocking)

None. The `init.ts` legacy cleanup at line 791 has the same pattern (only removes bare legacy names, not prefixed), but that code is not touched in this branch and is not critical because `init` also runs `installViaFileCopy` which cleans both variants.

## Suggestions (Lower Confidence)

- **`computeAssetsToRemove` is prefix-unaware** - `uninstall.ts:26-55` (Confidence: 65%) — The function operates on bare skill names from `PluginDefinition.skills`, which is correct for the current data model. But if skill names in `plugin.json` were ever stored prefixed, the Set-based deduplication would silently break. Consider adding an assertion or normalizing via `unprefixSkillName`.

- **Verbose log fires even when both variants were absent** - `uninstall.ts:608-610` (Confidence: 70%) — In `removeSelectedPlugins`, the `if (verbose)` log fires unconditionally after the try/catch blocks, even if both `fs.rm` calls targeted non-existent directories. Minor UX issue for `--verbose` output.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 1 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Correctness Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

### Key Findings

1. The core dual-path removal logic is **functionally correct** — both `removeAllDevFlow` and `removeSelectedPlugins` correctly target `devflow:{name}` and `{name}` paths, ensuring no orphaned prefixed or unprefixed directories after uninstall.

2. The `LEGACY_SKILL_NAMES` list is **complete** — all 39 current skill names are included (verified by test), ensuring pre-namespace bare installs are cleaned up.

3. The `prefixSkillName` utility is **safe** — its idempotency guard prevents double-prefixing of already-prefixed names.

4. The two issues flagged are: (a) an inflated counter due to `force: true` semantics + list duplication (cosmetic), and (b) selective uninstall not cleaning up `devflow-*` legacy names (narrow edge case but a completeness gap).

5. The `computeAssetsToRemove` function correctly operates on bare names and does not need prefix awareness — its retained-set logic is sound for the current data model.
