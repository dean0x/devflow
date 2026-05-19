# Regression Review Report

**Branch**: feat/pre-v2-cleanup -> main
**Date**: 2026-03-30
**Scope**: `src/cli/utils/installer.ts` (namespace prefix migration)

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Shadow + cleanup interaction: shadowed skills are skipped during cleanup but overwritten during install** - `installer.ts:152-158` / `installer.ts:239-243`
**Confidence**: 85%
- Problem: In the cleanup phase (lines 152-158), if a shadow directory exists, the loop `continue`s -- skipping removal of both the prefixed and unprefixed installed directories. Then in the install phase (lines 239-243), the shadow content is copied to the prefixed target via `copyDirectory`. This means if a user already had a prefixed install (`~/.claude/skills/devflow:foo/`) with stale content, the cleanup phase does NOT remove it before the install phase overwrites it. `copyDirectory` does `mkdir(dest, { recursive: true })` then copies files into it, but it never deletes files that already exist in the target but are absent from the source. If a user's shadow has fewer files than the previously installed version, orphan files from the old install will persist in the target.

  Consider a scenario: the official skill has `SKILL.md` + `references/violations.md`. User shadows and only customizes `SKILL.md`. Later, DevFlow removes `references/violations.md` from the official skill. The user re-runs `devflow init`. The cleanup is skipped (shadow exists), and `copyDirectory` from the shadow only copies `SKILL.md`. But `references/violations.md` from the previous prefixed install survives as an orphan.

  This same issue existed before this PR for the unprefixed path, but the migration amplifies it because the cleanup now has two targets to consider and the shadow skip bypasses both.

- Fix: In the cleanup phase, do NOT skip prefixed directory removal for shadowed skills. The install phase will re-populate the prefixed target from the shadow content immediately after. Alternatively, add a `removeDirectory` step before `copyDirectory` in the install phase for shadowed skills:
  ```typescript
  if (isShadowed) {
    // Clean target before copying shadow to avoid orphan files
    try { await fs.rm(skillTarget, { recursive: true, force: true }); } catch { /* ignore */ }
    await copyDirectory(shadowDir, skillTarget);
  } else {
    await copyDirectory(skillSource, skillTarget);
  }
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Cleanup phase leaves unprefixed legacy installs intact for shadowed skills** - `installer.ts:152-165`
**Confidence**: 82%
- Problem: When a shadow exists, the cleanup skips removing BOTH the prefixed and unprefixed directories (the `continue` on line 157 jumps past both `fs.rm` calls on lines 161 and 164). The install phase then writes only to the prefixed target. This means an unprefixed legacy install (`~/.claude/skills/foo/`) will persist alongside the new prefixed install (`~/.claude/skills/devflow:foo/`) for any shadowed skill. Claude Code may pick up both, leading to duplicate skill loading.
- Fix: Only skip the prefixed cleanup for shadowed skills; always clean up the unprefixed legacy directory:
  ```typescript
  for (const skill of allSkills) {
    const shadowDir = path.join(devflowDir, 'skills', skill);
    let isShadowed = false;
    try {
      const stat = await fs.stat(shadowDir);
      isShadowed = stat.isDirectory();
    } catch { /* no shadow */ }

    // Always remove legacy unprefixed directory
    try {
      await fs.rm(path.join(claudeDir, 'skills', skill), { recursive: true, force: true });
    } catch { /* ignore */ }

    // Remove prefixed directory (will be re-created during install)
    if (!isShadowed) {
      try {
        await fs.rm(path.join(claudeDir, 'skills', prefixSkillName(skill)), { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  }
  ```

**No test coverage for shadow-to-prefixed-target install path** - `tests/init-logic.test.ts`
**Confidence**: 90%
- Problem: The existing `installViaFileCopy cleanup (isPartialInstall)` test suite only validates stale command/agent cleanup. There are no tests that verify: (a) shadowed skills are copied to the prefixed target, (b) non-shadowed skills are installed to the prefixed target, or (c) legacy unprefixed directories are cleaned up during the migration. The `skill-namespace.test.ts` only tests the pure `prefixSkillName`/`unprefixSkillName` functions, not the installer's integration behavior.
- Fix: Add test cases to `tests/init-logic.test.ts` that seed a shadow directory, run `installViaFileCopy`, and assert the skill lands at the prefixed path. Also add a test that seeds an unprefixed legacy skill and verifies it is removed after a full install.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`copyDirectory` does not clean target before writing** - `installer.ts:19-33`
**Confidence**: 85%
- Problem: `copyDirectory` performs additive copy (`mkdir` + iterate source entries). It never removes files in the destination that do not exist in the source. This is a general issue that affects all copy operations (skills, agents, scripts), not just the shadow path. The namespace migration just makes it more visible because the cleanup-then-install contract now has a gap for shadowed skills.
- This is a design choice that predates this PR and is noted here for awareness only.

## Suggestions (Lower Confidence)

- **Partial install does not clean stale prefixed skills** - `installer.ts:135` (Confidence: 65%) -- When `isPartialInstall` is true, the entire cleanup block is skipped. If a user runs `devflow init --plugin=code-review` after upgrading from unprefixed to prefixed, any previously-installed unprefixed skills from that plugin will persist. This is a pre-existing behavior that the namespace migration does not change, but worth noting since partial installs will now produce a mixed state (some prefixed, some not).

- **`spinner.message('Cleaning old files...')` runs even for partial installs** - `installer.ts:134` (Confidence: 70%) -- The spinner message on line 134 is displayed before the `if (!isPartialInstall)` guard. For partial installs, the user sees "Cleaning old files..." but no cleanup occurs. This is cosmetic only but could confuse users.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The namespace prefix migration is well-executed across the codebase (50 files, all skill references updated to `devflow:` prefix, all consumers -- uninstall, skills command, tests -- are consistent). The `prefixSkillName` / `unprefixSkillName` helpers are clean, idempotent, and tested. All 524 tests pass. The `LEGACY_SKILL_NAMES` list correctly includes all bare names for migration cleanup.

The primary regression concern is the shadow + cleanup interaction: the cleanup phase skips both prefixed and unprefixed removal for shadowed skills, but the install phase only writes to the prefixed target. This leaves orphan files in the prefixed target (if the shadow has fewer files than the prior install) and leaves unprefixed legacy installs intact (potential duplicate skill loading). Both issues are fixable with targeted changes to the cleanup loop and/or adding an `fs.rm` before `copyDirectory` for shadowed skills.

The missing test coverage for the shadow-to-prefixed path is the most actionable item -- adding 2-3 integration tests would validate the migration path and prevent future regressions in this area.
