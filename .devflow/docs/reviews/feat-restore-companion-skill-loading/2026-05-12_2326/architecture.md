# Architecture Review Report

**Branch**: feat/restore-companion-skill-loading -> main
**Date**: 2026-05-12
**Diff scope**: `git diff b973e9daf8f7cb4157928ddd7c025cc1790bd0aa...HEAD` (fix commit f33e7ef)

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Inconsistent section ordering across orch skills** - `shared/skills/debug:orch/SKILL.md:21-27`, `shared/skills/plan:orch/SKILL.md:21-27`
**Confidence**: 82%
- Problem: The commit message claims "standardize orch skill ordering" but the standardization is incomplete. `debug:orch` and `plan:orch` now use the order `Iron Law -> Load Companion Skills -> Worktree Support -> Phase 1`, while `implement:orch` places Worktree Support at line 92 (between Phase 3 and Phase 4), and `release:orch` places it at line 250 (near the end). The "standardization" created a new inconsistency pattern rather than resolving the existing one. `review:orch` has no Worktree Support section at all.
- Fix: Either move Worktree Support to the same position in all orch skills (immediately after Load Companion Skills, as `debug:orch` and `plan:orch` now do) or document in the skill catalog that Worktree Support placement is intentionally context-dependent. The new test validates companion skill lists but does not enforce section ordering.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### LOW

**Missing Worktree Support section in review:orch** - `shared/skills/review:orch/SKILL.md`
**Confidence**: 80%
- Problem: `review:orch` is the only orch skill among the five with companions that lacks a Worktree Support section. The review pipeline does operate on worktrees (the `/code-review` command discovers them), so this omission may cause path resolution issues when WORKTREE_PATH is passed.
- Fix: Add a Worktree Support section to `review:orch` consistent with the other orch skills. This is a pre-existing gap, not introduced by this PR.

## Suggestions (Lower Confidence)

- **Test does not enforce section ordering** - `tests/skill-references.test.ts:1007` (Confidence: 65%) -- The new consistency test validates that companion skill lists match the catalog table, but does not verify that `## Load Companion Skills` appears before `## Worktree Support` or before `## Phase 1`. A section-order assertion would prevent future reordering drift. However, section ordering may be intentionally flexible per the CLAUDE.md convention "Orchestration skills follow the Phase Protocol -- each phase needs Produces/Requires annotations", which constrains phases but not pre-phase sections.

- **Regex in test may miss future catalog format changes** - `tests/skill-references.test.ts:1017` (Confidence: 62%) -- The `orchTableRegex` hardcodes five intent names (`IMPLEMENT|DEBUG|PLAN|REVIEW|RELEASE`). If a new intent with companions is added to the catalog (e.g., EXPLORE gains companions), the test would silently not cover it. The `expect(orchTable.size).toBeGreaterThanOrEqual(5)` assertion only catches removal, not addition. However, new intents are rare and the test would still catch the existing five.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 1 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The core architectural pattern is sound: the PR restores companion skill loading sections to orch skills and commands, backed by a catalog as single source of truth, with a cross-component consistency test that catches drift. The skill catalog at `shared/skills/router/references/skill-catalog.md` serves as the canonical reference, and the new test enforces that orch skills and commands match it -- this is good separation of concerns.

The one condition is that the "standardize orch skill ordering" claim in the commit message is aspirational rather than achieved. The section reordering in `debug:orch` and `plan:orch` is a local improvement (putting Load Companion Skills before Worktree Support so skills load first), but the broader inconsistency across all five orch skills remains. This is MEDIUM because the ordering affects readability and maintainability, not runtime behavior -- the LLM processes the full skill regardless of section order.
