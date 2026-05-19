# Shadow Dir Normalization Review

**Branch**: feat/pre-v2-cleanup -> main
**Date**: 2026-03-30
**Scope**: `getShadowDir` normalization in `src/cli/commands/skills.ts` + supporting changes in `src/cli/plugins.ts` and `src/cli/utils/installer.ts`

## Analysis

### What Changed

1. **`getShadowDir` now calls `unprefixSkillName(skillName)`** (skills.ts:26) -- ensures shadow paths always resolve to `~/.devflow/skills/{bare-name}/`, never `~/.devflow/skills/devflow:{bare-name}/`.

2. **`shadow` and `unshadow` commands normalize user input** (skills.ts:69, 103) -- both call `unprefixSkillName(name)` on user-provided input before any logic, so `devflow skills shadow devflow:core-patterns` works identically to `devflow skills shadow core-patterns`.

3. **`shadow` command now looks up installed skill at prefixed path** (skills.ts:77-78) -- uses `prefixSkillName(bareName)` to find `~/.claude/skills/devflow:core-patterns/` instead of looking for the bare name.

4. **`shadow` success message points to shadow dir** (skills.ts:95) -- changed from pointing users to the claude skills dir (which gets overwritten) to the shadow dir (which persists). This is a correctness fix.

5. **Installer shadow check uses bare `skillName`** (installer.ts:224) -- `skillsMap` keys are bare names (from `DEVFLOW_PLUGINS.skills` arrays), so the shadow path `path.join(devflowDir, 'skills', skillName)` is already correct without calling `unprefixSkillName`. Installer now copies shadow to prefixed target instead of skipping.

6. **`unprefixSkillName` and `prefixSkillName` added to `plugins.ts`** -- both are idempotent (safe to call on already-bare or already-prefixed names respectively). Tests confirm roundtrip behavior.

### Key Questions Answered

**Does this affect all callers of `hasShadow` and `getShadowDir`?**

Yes, and correctly. There are exactly 4 call sites for `getShadowDir`:
- `hasShadow` (skills.ts:34) -- passes through to `getShadowDir`, which now normalizes. Any caller of `hasShadow` with a prefixed name will now correctly resolve to the bare shadow path.
- `shadow` command (skills.ts:84) -- passes `bareName` (already unprefixed at line 69).
- `unshadow` command (skills.ts:104) -- passes `bareName` (already unprefixed at line 103).

The `listShadowed` function (skills.ts:40-49) does NOT use `getShadowDir` -- it reads directory entries directly from `~/.devflow/skills/`. Since shadow dirs are always stored bare, this is correct.

The installer (installer.ts:224) does NOT use `getShadowDir` or `hasShadow` -- it has its own inline shadow check using `skillName` from `skillsMap`, which is already bare.

**Are there callers that might break if the name is double-unprefixed?**

No. `unprefixSkillName` is idempotent: calling it on `"core-patterns"` returns `"core-patterns"` (no-op branch). The `shadow` and `unshadow` commands call `unprefixSkillName` on user input, then pass `bareName` to `getShadowDir`, which calls `unprefixSkillName` again inside. The double call is harmless due to idempotency. The tests at skill-namespace.test.ts:44-46 explicitly verify this property.

**Is `unprefixSkillName` idempotent?**

Yes. Implementation at plugins.ts:24-26: `name.startsWith('devflow:') ? name.slice(7) : name`. A bare name does not start with `devflow:`, so it is returned as-is. Tests confirm: `unprefixSkillName('core-patterns') === 'core-patterns'`.

**Are `shadow`, `unshadow`, and `listShadowed` consistent?**

Yes. All three operate on bare names:
- `shadow`: normalizes input, validates against bare `allSkills`, creates shadow at bare path
- `unshadow`: normalizes input, resolves shadow at bare path, removes it
- `listShadowed`: reads directory entries (which are bare by construction), compares against bare `allSkills` for the "active" vs "unknown skill" status

## Issues in Your Changes (BLOCKING)

No blocking issues found.

## Issues in Code You Touched (Should Fix)

No should-fix issues found.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Installer shadow check does not use shared `hasShadow` function** -- `installer.ts:228-232`
**Confidence**: 82%
- Problem: The installer duplicates the shadow-detection logic (stat + isDirectory check) instead of calling the exported `hasShadow()` from skills.ts. If the shadow path convention ever changes, both locations must be updated in lockstep.
- Fix: Import and use `hasShadow(skillName, devflowDir)` in the installer loop. However, this is a minor DRY concern and the current inline check is functionally identical.

### LOW

**`listShadowed` returns raw directory names without validation** -- `skills.ts:46`
**Confidence**: 80%
- Problem: `listShadowed` returns whatever directory names exist under `~/.devflow/skills/`, which could include manually-created directories with unexpected names. The `list-shadowed` command handles this gracefully (shows "unknown skill" status), but callers like `uninstall.ts:494` just display the names without validation.
- Fix: No action needed -- the current behavior is reasonable for an informational display.

## Suggestions (Lower Confidence)

- **Double `unprefixSkillName` call is redundant in `shadow`/`unshadow` commands** -- `skills.ts:69+84, 103+104` (Confidence: 70%) -- The commands call `unprefixSkillName(name)` to get `bareName`, then pass `bareName` to `getShadowDir`, which calls `unprefixSkillName` again. The redundancy is harmless but could be slightly confusing to future readers. Consider either (a) having `getShadowDir` accept only bare names (document the contract) or (b) removing the `unprefixSkillName` from `getShadowDir` since all callers already normalize.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 1 |

**Correctness Score**: 9/10
**Recommendation**: APPROVED

### Rationale

The change is well-designed and correctly solves the namespace mismatch between installed skill paths (`devflow:name`) and shadow paths (`name`). Key strengths:

1. **Idempotent normalization** prevents double-strip bugs regardless of how callers pass names
2. **All three shadow commands are consistent** in their use of bare names
3. **The installer's inline shadow check is also correct** since `skillsMap` keys are always bare
4. **The success message fix** (pointing to shadow dir instead of installed dir) is a genuine UX improvement -- the old message pointed to a path that gets overwritten on next `devflow init`
5. **Test coverage is thorough** -- 23 tests pass including explicit hasShadow normalization tests for both bare and prefixed inputs, plus roundtrip verification
6. **No breaking changes** -- the change only makes existing APIs more tolerant of input variations
