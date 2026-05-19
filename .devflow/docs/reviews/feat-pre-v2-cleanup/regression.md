# Regression Review Report

**Branch**: feat/pre-v2-cleanup -> main
**Date**: 2026-03-30
**Scope**: Shadow handling changes in `src/cli/utils/installer.ts` (cleanup loop lines 146-161, install loop lines 214-239)

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Empty shadow directory produces an empty install target** - `installer.ts:228-235`
**Confidence**: 85%
- Problem: The shadow detection at line 231 (`isShadowed = stat.isDirectory()`) resolves to `true` even when the shadow directory exists but is completely empty (contains zero files). When `isShadowed` is true, `copyDirectory(shadowDir, skillTarget)` is called. `copyDirectory` creates the destination directory via `fs.mkdir(dest, { recursive: true })` but then iterates zero entries, producing an empty skill directory at the install target. The user ends up with `~/.claude/skills/devflow:some-skill/` containing no files -- no `SKILL.md`, nothing. The skill silently fails to load with no error or warning.
- Impact: A user who creates `~/.devflow/skills/foo/` as a placeholder (or accidentally empties it) will get a broken skill installation with no diagnostic output. The previous code (shadow `continue` in the install loop) had the same latent issue -- it would skip the skill entirely, resulting in no install at all -- but skipping is arguably a safer failure mode than installing an empty directory that masquerades as a valid skill.
- Fix: Add a non-empty check after the shadow detection. If the shadow directory exists but is empty, either fall back to the source copy or log a warning.
```typescript
    let isShadowed = false;
    try {
      const stat = await fs.stat(shadowDir);
      if (stat.isDirectory()) {
        const entries = await fs.readdir(shadowDir);
        isShadowed = entries.length > 0;
      }
    } catch { /* no shadow */ }
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Answers to Key Questions

### 1. Does removing the shadow `continue` from cleanup cause issues with the install phase?

**No regression.** The old cleanup loop (on `main`) had a shadow `continue` that skipped cleanup of shadowed skills, leaving their unprefixed install directory intact. The new code removes this `continue` and unconditionally deletes both prefixed and unprefixed directories for every skill. This is correct because the install loop (lines 214-239) independently re-detects shadows and copies from the shadow source to the prefixed target. The cleanup is purely a "wipe slate clean" phase -- it does not need to preserve anything since the install phase will recreate everything from the appropriate source (shadow or DevFlow source). The two phases are cleanly decoupled now, which is an improvement.

### 2. Are there race conditions between cleanup and install?

**No.** The entire `installViaFileCopy` function is a single `async` function with sequential `await` calls. The cleanup loop (lines 146-161) runs to completion before the install loop (lines 214-239) begins. There are no parallel operations, no background tasks, and no event-driven callbacks between these phases. The command/agent install loop (lines 164-209) sits between them but operates on different directories (`commands/devflow`, `agents/devflow`) and does not interact with the `skills/` directory.

### 3. Is the shadow check in the install loop still correct after cleanup removes everything?

**Yes.** The shadow check in the install loop (lines 222-232) reads from `~/.devflow/skills/{skillName}` (the `devflowDir`), which is the user's shadow override directory. The cleanup loop deletes from `~/.claude/skills/` (the `claudeDir`). These are distinct filesystem paths. Cleanup never touches the shadow source directory. The shadow detection remains fully intact after cleanup runs.

### 4. Edge case: empty shadow directory?

**This is the one issue found.** See the HIGH-severity finding above. An empty shadow directory at `~/.devflow/skills/{name}/` passes the `stat.isDirectory()` check and `copyDirectory` will create an empty prefixed target. No error is raised, but the installed skill will have no content.

## Suggestions (Lower Confidence)

- **Cleanup loop uses `DEVFLOW_PLUGINS` while install loop uses `skillsMap`** - `installer.ts:147,215` (Confidence: 65%) -- The cleanup loop iterates skills from `DEVFLOW_PLUGINS` (all registered plugins) while the install loop iterates `skillsMap` (which is passed in as a parameter). If these ever diverge (e.g., a skill exists in `DEVFLOW_PLUGINS` but not in `skillsMap`, or vice versa), cleanup could delete a skill that never gets reinstalled. Currently they appear to be populated from the same source, but the asymmetry is a maintenance risk.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The shadow handling refactor is architecturally sound. Removing the `continue` from the cleanup loop is the right call -- it simplifies the cleanup phase to a pure "delete everything" operation and delegates shadow awareness entirely to the install phase, which is the correct separation of concerns. The one finding (empty shadow directory edge case) is a defensive hardening issue rather than a regression introduced by this change specifically. The test coverage in `skill-namespace.test.ts` validates the core cleanup and shadow install paths. Consider addressing the empty-shadow edge case before merge.
