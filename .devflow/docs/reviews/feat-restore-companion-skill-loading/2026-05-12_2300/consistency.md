# Consistency Review Report

**Branch**: feat/restore-companion-skill-loading -> main
**Date**: 2026-05-12

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent section ordering of "Load Companion Skills" in orch skills (2 patterns)**
**Confidence**: 85%
- `shared/skills/implement:orch/SKILL.md`: Iron Law -> Load Companion Skills -> Continuation Detection -> Phase 1
- `shared/skills/review:orch/SKILL.md`: Iron Law -> Load Companion Skills -> Phase 1
- `shared/skills/release:orch/SKILL.md`: Iron Law -> Load Companion Skills -> Continuation Detection -> Phase 1
- vs.
- `shared/skills/debug:orch/SKILL.md`: Iron Law -> Worktree Support -> Load Companion Skills -> Phase 1
- `shared/skills/plan:orch/SKILL.md`: Iron Law -> Worktree Support -> Load Companion Skills -> Continuation Detection -> Phase 1
- Problem: Two placement patterns exist. `implement:orch`, `review:orch`, and `release:orch` place "Load Companion Skills" immediately after Iron Law (before Worktree Support or Continuation Detection). `debug:orch` and `plan:orch` place it after Worktree Support but before Phase 1. The PR restores companion skill loading to orch skills but introduces two distinct ordering patterns instead of one.
- Fix: Standardize on a single ordering. The most common pattern (3 of 5) is Iron Law -> Load Companion Skills -> [Worktree/Continuation] -> Phase 1. Move the section in `debug:orch` and `plan:orch` to match:

```markdown
## Iron Law
...

## Load Companion Skills

Load via Skill tool: ...

## Worktree Support
...
```

### MEDIUM

**Inconsistent placement of "Load Companion Skills" in commands relative to Produces/Requires** (6 occurrences)
**Confidence**: 82%
- `plugins/devflow-debug/commands/debug.md:28-30`: Produces line, then blank line, then Load Companion Skills
- `plugins/devflow-debug/commands/debug-teams.md:28-30`: Same pattern
- `plugins/devflow-implement/commands/implement.md:32-34`: Produces line, then blank line, then Load Companion Skills
- `plugins/devflow-implement/commands/implement-teams.md:32-34`: Same pattern
- vs.
- `plugins/devflow-plan/commands/plan.md:73-76`: Produces line, Requires line, then blank line, then Load Companion Skills
- `plugins/devflow-plan/commands/plan-teams.md:64-67`: Same pattern with Requires
- `plugins/devflow-code-review/commands/code-review.md:111-113`: Produces line, then blank line, then Load Companion Skills (inside Phase 1b, not Phase 1)
- `plugins/devflow-code-review/commands/code-review-teams.md:98-100`: Same pattern inside Phase 1b
- `plugins/devflow-release/commands/release.md:35-37`: Produces line, then blank line, then Load Companion Skills
- `plugins/devflow-release/commands/release-teams.md:35-37`: Same pattern
- Problem: The companion skill loading instruction is placed inside different phases depending on the command: Phase 1 for implement/debug/release, Phase 2 for plan, Phase 1b for code-review. While each command's phase semantics differ, the instruction style is inline-bold (`**Load Companion Skills**`) in commands but heading-level (`## Load Companion Skills`) in orch skills. This inconsistency is minor but may cause confusion when maintaining both surfaces.
- Fix: This is acceptable as-is since commands and orch skills are separate authoring surfaces with different structural conventions. No action needed unless you want to promote the command-level instruction to its own phase or standardize formatting.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Companion skill list for debug commands differs from debug:orch in the skill catalog prior to this PR** - `shared/skills/router/references/skill-catalog.md:56-58` (Confidence: 65%) -- The skill catalog table was updated in this PR to document the mapping, and all three sources (orch skill, commands, catalog) now agree. However, there is no automated validation that these three lists stay in sync over time. A future drift would be caught only by manual review.

- **Missing Phase Completion Checklist update in some orch skills** - `shared/skills/plan:orch/SKILL.md`, `shared/skills/implement:orch/SKILL.md`, `shared/skills/review:orch/SKILL.md`, `shared/skills/release:orch/SKILL.md` (Confidence: 70%) -- `debug:orch` added a checklist item `- [ ] Companion Skills -> loaded (or continued without on failure)` at line 113. The other four orch skills that gained Load Companion Skills sections do not have equivalent checklist updates. If these skills have Phase Completion Checklists (like debug:orch does), they should also include the companion skill loading verification step.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR is highly consistent in its core mission: every orch skill and command that should have companion skill loading now has it, the skill lists match perfectly across all three sources (orch skills, commands, and the router catalog), and the base/teams command variants are always kept in sync. The two findings are about structural ordering within the orch skills (two placement patterns instead of one) and a missing checklist item in 4 of 5 orch skills. Neither blocks merge, but the HIGH ordering inconsistency should ideally be standardized before establishing the pattern further.
