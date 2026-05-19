# Documentation Review Report

**Branch**: feat/restore-companion-skill-loading -> main
**Date**: 2026-05-12
**Scope**: Incremental diff (b973e9d...HEAD) covering commit f33e7ef

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Inconsistent Worktree Support section placement across orch skills** - `shared/skills/implement:orch/SKILL.md:92`, `shared/skills/release:orch/SKILL.md:250`
**Confidence**: 85%
- Problem: The commit message says "standardize orch skill ordering" and the changes move `## Worktree Support` to immediately after `## Load Companion Skills` in `debug:orch` and `plan:orch`. However, `implement:orch` still has `## Worktree Support` at line 92 (after multiple phases), and `release:orch` has it at line 250 (near the end of the file). The `review:orch` skill has no `## Worktree Support` section at all. The commit partially standardizes the ordering but does not apply it consistently to all five orch skills, making the "standardize" claim in the commit message inaccurate.
- Fix: Either move `## Worktree Support` to the same position (immediately after `## Load Companion Skills`) in all orch skills that have it, or qualify the commit message to note only `debug:orch` and `plan:orch` were reordered.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **New test does not handle missing command files gracefully** - `tests/skill-references.test.ts:1078` (Confidence: 65%) -- The test uses `readFileSync` for command files (base + teams variants) without try/catch. If a `-teams.md` file does not exist, the test will throw rather than skip gracefully, unlike the existing `code-review-teams install paths` test at line 992-996 which wraps in try/catch. The `intentCommandMap` hardcodes all teams variants as required, but the CLAUDE.md notes teams variants are optional ("The installer copies the chosen variant based on `--teams`/`--no-teams` flag").

- **CLAUDE.md Ambient Mode description now claims companion skill loading for orch skills** - `CLAUDE.md:46` (Confidence: 70%) -- The addition of "loads companion skills before first phase" to the Ambient Mode paragraph is accurate for the current state but partially redundant with the Orchestration skills convention documented in `shared/skills/router/references/skill-catalog.md:51` ("orch skills and commands load always-on companion skills before their first phase"). This is not a drift issue but a minor documentation coupling point where future changes to the companion skill loading strategy would need to be updated in two places.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | - | - | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Documentation Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The CLAUDE.md update and orch skill section reordering are directionally correct. The main documentation concern is that the commit claims to "standardize orch skill ordering" but only applies the reordering to 2 of the 5 orch skills, creating a partial inconsistency rather than full standardization. The new consistency test is well-structured and validates the companion skill lists across catalog, orch skills, and commands effectively.
