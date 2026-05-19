# Documentation Review Report

**Branch**: feat-restore-companion-skill-loading -> main
**Date**: 2026-05-12
**PR**: #218

## Issues in Your Changes (BLOCKING)

### MEDIUM

**CLAUDE.md not updated to reflect companion skill loading at ORCHESTRATED depth** - `CLAUDE.md:46`
**Confidence**: 85%
- Problem: CLAUDE.md line 46 describes the ambient mode architecture and currently says: "maps intent + depth to a guided skill (short, focused, loads companion skills) or an orch skill (full agent pipeline)". The parenthetical "(short, focused, loads companion skills)" implies only guided skills load companions, and the orch skill description omits any mention of companion loading. This PR restores companion skill loading to orch skills and commands, but CLAUDE.md was not updated to reflect this change. The new `skill-catalog.md` section "ORCHESTRATED Companion Skills" correctly documents the behavior, but CLAUDE.md -- the primary project documentation artifact -- now contradicts reality.
- Fix: Update CLAUDE.md line 46 to acknowledge that both guided and orch skills load companion skills. For example:
  ```
  Router SKILL.md is a pure dispatcher loaded on-demand only for GUIDED/ORCHESTRATED depth -- maps intent + depth to a guided skill (short, focused, loads companion skills) or an orch skill (full agent pipeline, loads companion skills before first phase).
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Inconsistent section ordering of "Load Companion Skills" across orch skills** - `shared/skills/plan:orch/SKILL.md:25`, `shared/skills/debug:orch/SKILL.md:25`, `shared/skills/implement:orch/SKILL.md:21`, `shared/skills/review:orch/SKILL.md:22`, `shared/skills/release:orch/SKILL.md:20`
**Confidence**: 82%
- Problem: The placement of the "## Load Companion Skills" section varies across orch skills. In `implement:orch` and `review:orch`, it appears immediately after the Iron Law (before Worktree Support or Continuation Detection). In `plan:orch` and `debug:orch`, it appears after Worktree Support (between Worktree Support and the first Phase). In `release:orch`, it appears after Iron Law but before Continuation Detection (no Worktree Support precedes it). This inconsistency makes it harder to find the section when maintaining these files. A consistent pattern -- either always-after-Iron-Law or always-before-first-Phase -- would improve navigability.
- Fix: Standardize the section position. The most logical placement is immediately after the Iron Law and before any content sections (Worktree Support, Continuation Detection, Phase 1), since companion skill loading is a prerequisite for everything that follows. This matches the pattern in `implement:orch` and `review:orch`.

**Inconsistent placement of "Load Companion Skills" within commands** - `plugins/devflow-code-review/commands/code-review.md:113`, `plugins/devflow-debug/commands/debug.md:30`, `plugins/devflow-implement/commands/implement.md:34`, `plugins/devflow-plan/commands/plan.md:76`, `plugins/devflow-release/commands/release.md:37`
**Confidence**: 80%
- Problem: In command files, the companion skill loading instruction is placed at different structural levels. In `code-review.md` it is inside Phase 1b as a bold paragraph. In `debug.md` it is inside Phase 1 as a bold paragraph. In `implement.md` it is inside Phase 1. In `plan.md` it is inside Phase 2. In `release.md` it is inside Phase 1. While each placement is locally reasonable (skills are loaded before they are needed), the inconsistent pattern makes cross-command maintenance harder. This mirrors the same inconsistency observed in the orch skills.
- Fix: This is a minor consistency concern. Consider standardizing to "always at the top of the earliest phase" or creating a dedicated pre-phase section. Not blocking.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **skill-catalog.md "ORCHESTRATED Companion Skills" table could note explore:guided also has "(none)"** - `shared/skills/router/references/skill-catalog.md:42` (Confidence: 65%) -- The GUIDED section already documents "No companion skills" for EXPLORE, but adding the ORCHESTRATED table creates a second place to maintain. The tables are consistent now, but future drift between the GUIDED and ORCHESTRATED documentation is a maintenance risk.

- **Phase Completion Checklists could standardize companion skill wording** - `shared/skills/debug:orch/SKILL.md:113`, `shared/skills/implement:orch/SKILL.md:245` (Confidence: 62%) -- The checklist item reads "Companion Skills -> loaded (or continued without on failure)" which is slightly informal compared to other checklist items that use the "Phase N: Name -> VARIABLE captured" pattern. Consider: "Load Companion Skills -> loaded (or graceful fallback)".

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Documentation Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR successfully restores companion skill loading to all orch skills and commands, with a new reference table in skill-catalog.md. The primary documentation concern is that CLAUDE.md -- the project's top-level documentation artifact -- still implies only guided skills load companions. Fixing that single line would bring the score to 9/10. The section ordering inconsistencies are cosmetic but worth standardizing in a follow-up.
