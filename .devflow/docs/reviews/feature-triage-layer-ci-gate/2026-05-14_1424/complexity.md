# Complexity Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

### HIGH

**CI Status Gate logic duplicated verbatim across 4 files** -- Confidence: 88%
- `shared/skills/implement:orch/SKILL.md:153-162`, `shared/skills/resolve:orch/SKILL.md:113-126`, `plugins/devflow-resolve/commands/resolve.md:201-214`, `plugins/devflow-resolve/commands/resolve-teams.md:248-261`
- Problem: The CI Status Gate phase (5-step status check with poll loop, fix loop, and timeout bounds) is duplicated near-verbatim in 4 separate files. Each copy contains the same branching logic (PASSING/NO_PR/NO_CI/PENDING/FAILING), the same poll interval (60s), the same max iterations (10), and the same fix attempt cap (2). Any future change to CI gate behavior requires updating all 4 locations in lockstep, which is error-prone and violates DRY. The copies already have minor inconsistencies: `implement:orch` passes `PR_NUMBER from PR_URL`, `resolve:orch` omits PR_NUMBER entirely, and the two resolve commands pass `WORKTREE_PATH`. These divergences are each correct for their context but make the duplication harder to reason about -- a maintainer must carefully distinguish intentional variation from accidental drift.
- Fix: This is a markdown-skills codebase where extraction to a shared module is not mechanically possible (skills are standalone markdown documents). The appropriate mitigation is to add a `SYNC:` comment at the top of each CI Status Gate section referencing the other 3 locations, following the project's existing `SYNC:` pattern (see `scripts/hooks/preamble` line 36). For example: `<!-- SYNC: CI Status Gate logic — also in implement:orch, resolve:orch, resolve.md, resolve-teams.md -->`. This makes drift detectable during maintenance.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Triage skills share ~70% boilerplate structure** - `shared/skills/*:triage/SKILL.md` (7 files) (Confidence: 65%) -- All 7 triage skills follow an identical skeleton (frontmatter, title, default-to-GUIDED statement, Orchestration Hint Override section with same 4 keywords, Scope Assessment section with intent-specific signals, Route section with same emit/load pattern). Only the Scope Assessment signals differ per intent. This is intentional template consistency and each skill is only ~35 lines, so the duplication cost is low. Worth noting as a maintenance surface if the triage protocol evolves.

- **resolve commands grew to 380/428 lines** - `plugins/devflow-resolve/commands/resolve.md:380`, `plugins/devflow-resolve/commands/resolve-teams.md:428` (Confidence: 62%) -- Adding Phase 7 (CI Status Gate) and renumbering Phases 7->8->9 pushed these already-long command files further. The 428-line teams variant is above the 300-line warning threshold for file length. However, these are orchestration command specifications (not executable code), where each phase is independently readable, so the metric applies less strictly than it would to a function.

- **implement:orch grew to 267 lines** - `shared/skills/implement:orch/SKILL.md:267` (Confidence: 60%) -- The implement:orch skill grew from ~253 to 267 lines with the CI Status Gate insertion. This exceeds the project's target of ~120-150 lines per SKILL.md (documented in CLAUDE.md). However, this skill covers 9 phases with a Phase Completion Checklist, making it inherently longer than single-concern skills. The progressive disclosure pattern (references/) could absorb the CI gate details if size becomes a concern.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Complexity Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The triage layer is well-designed from a complexity perspective: each triage skill is a focused ~35-line decision tree with clear default-to-GUIDED bias, explicit escalation signals, and a single routing outcome. The classification rules simplification (removing the 3-depth system in favor of QUICK vs router-dispatch) reduces cognitive load in the ambient classification path. The CI Status Gate introduces a bounded poll/fix loop with explicit termination (max 10 polls, max 2 fix attempts), which satisfies reliability constraints.

The single condition is adding `SYNC:` markers to the 4 CI Status Gate locations to make the duplication maintainable. This is non-blocking but strongly recommended before the duplication causes drift.
