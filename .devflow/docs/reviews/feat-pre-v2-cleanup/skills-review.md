# Consistency Review Report

**Branch**: feat/pre-v2-cleanup -> main
**Date**: 2026-03-30
**Scope**: `src/cli/commands/skills.ts`, `src/cli/plugins.ts`

## Issues in Your Changes (BLOCKING)

### MEDIUM

**`unprefixSkillName` does not guard against degenerate inputs** - `src/cli/plugins.ts:24-26`
**Confidence**: 82%
- Problem: `unprefixSkillName` handles the happy path (bare name and prefixed name) correctly, but does not handle edge cases that could surface from user input:
  - Empty string `""` passes through silently, leading to a lookup of `""` in `allSkills` which fails with a confusing "Unknown skill: " message (no name shown).
  - The bare prefix `"devflow:"` strips to `""`, same result.
  - Double-prefixed `"devflow:devflow:name"` strips to `"devflow:name"`, which will fail the `allSkills.includes()` check but show a confusing error: "Unknown skill: devflow:name".

  These are all user-facing CLI inputs where a typo is plausible. The existing pattern in the codebase already validates `name` for presence (the `if (!name)` check at line 62) but does not validate the *unprefixed* result.
- Fix: Add a post-unprefix guard in `skills.ts` (not in the utility itself, which should stay pure):
  ```typescript
  const bareName = unprefixSkillName(name);
  if (!bareName) {
    p.log.error('Invalid skill name.');
    process.exit(1);
  }
  ```
  This keeps `unprefixSkillName` a pure string function while the command handles validation at the boundary -- consistent with the project's "validate at boundaries" principle from CLAUDE.md.

---

**`hasShadow` function accepts `skillName` but does not document prefix expectations** - `src/cli/commands/skills.ts:32-35`
**Confidence**: 80%
- Problem: The exported `hasShadow` function takes a `skillName` parameter but its contract does not clarify whether it expects a bare name or a prefixed name. Internally it passes the name directly to `getShadowDir` which builds an unprefixed path (`~/.devflow/skills/{name}/`). If a caller passes a prefixed name like `devflow:security-patterns`, it would check the wrong directory (`~/.devflow/skills/devflow:security-patterns/` instead of `~/.devflow/skills/security-patterns/`). The `shadow` and `unshadow` actions both correctly pass `bareName`, but `hasShadow` is exported and has no callers yet -- meaning future callers might use the wrong convention.
- Fix: Either add an `unprefixSkillName` call inside `hasShadow` for defensive normalization, or document the contract in the JSDoc:
  ```typescript
  /**
   * Check if a skill has a shadow (personal override).
   * @param skillName Bare (unprefixed) skill name, e.g. 'security-patterns'
   */
  export async function hasShadow(skillName: string, devflowDir?: string): Promise<boolean> {
  ```

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`init.ts` legacy cleanup does not prefix LEGACY_SKILL_NAMES before deletion** - `src/cli/commands/init.ts:791-799`
**Confidence**: 85%
- Problem: The init cleanup loop iterates `LEGACY_SKILL_NAMES` and removes `path.join(skillsDir, legacy)` -- i.e., the bare name. For the newly added v2.0.0 migration entries (e.g., `'security-patterns'`), this correctly targets the unprefixed directory `~/.claude/skills/security-patterns/`. However, the uninstall command (`uninstall.ts:537-547`) applies *both* `prefixSkillName(skillName)` and bare `skillName` removal for every entry. The init cleanup only does bare removal. This means if a user somehow has a `devflow:security-patterns` directory left behind *without* a corresponding current install, init would not clean it up. This is a pre-existing inconsistency between `init.ts` and `uninstall.ts` cleanup approaches -- not introduced by this PR.
- Fix: Not blocking. If desired for consistency, init cleanup could mirror the uninstall pattern by also attempting `prefixSkillName(legacy)` removal.

## Suggestions (Lower Confidence)

- **`list-shadowed` shows bare names but user may not know the install name** - `src/cli/commands/skills.ts:123-127` (Confidence: 65%) -- The `list-shadowed` action displays shadow directory names (unprefixed) and checks them against `allSkills` (also unprefixed), so the logic is correct. However, users who are accustomed to seeing `devflow:name` in `~/.claude/skills/` might find the bare names slightly confusing. A minor UX consideration, not a bug.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Consistency Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Rationale

The namespace prefix implementation is well-executed and consistent across the codebase:
- Shadow directories correctly use bare (unprefixed) names everywhere
- Install directories correctly use prefixed names everywhere
- Both `shadow` and `unshadow` accept either form of input and normalize consistently
- `LEGACY_SKILL_NAMES` v2.0.0 migration entries are complete (all 39 skills present)
- User-facing messages consistently show bare names (appropriate since that is what users type)
- The installer in `installer.ts` correctly applies `prefixSkillName` during install and checks bare shadow dirs

The two blocking MEDIUM items are minor defensive-coding improvements, not correctness bugs. The empty-string edge case is unlikely in practice but violates the project's "validate at boundaries" principle. The `hasShadow` contract ambiguity should be resolved before the function gains callers.
