# Architecture Review Report

**Branch**: feat/restore-companion-skill-loading -> main
**Date**: 2026-05-12

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

(none)

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Architecture Score**: 9/10
**Recommendation**: APPROVED

## Detailed Analysis

### What Changed

This PR restores companion skill loading to all orchestration entry points (5 orch skills and 10 orchestration commands -- base and teams variants). Prior to this change, only guided skills loaded companions; orch skills and commands did not. The PR also updates the router's `skill-catalog.md` reference to document the ORCHESTRATED companion skill assignments and refreshes the feature knowledge index.

**Changed files (18):**
- 5 orch skills: `debug:orch`, `implement:orch`, `plan:orch`, `release:orch`, `review:orch`
- 10 commands: `code-review.md`, `code-review-teams.md`, `debug.md`, `debug-teams.md`, `implement.md`, `implement-teams.md`, `plan.md`, `plan-teams.md`, `release.md`, `release-teams.md`
- 1 reference doc: `router/references/skill-catalog.md`
- 2 feature knowledge files: `.features/cli-rules/KNOWLEDGE.md`, `.features/index.json`

### Architectural Assessment

**Separation of Concerns**: The change respects the existing layering architecture. Companion skills are loaded by the orchestrator (command/orch skill) before phases begin, while agent-internal skills remain agent-loaded. The skill catalog cleanly separates these two tiers.

**Consistency**: Verified five-way alignment between:
1. Guided skill companions (pre-existing, documented in skill-catalog.md)
2. Orch skill companions (new, added by this PR)
3. Base command companions (new, added by this PR)
4. Teams command companions (new, added by this PR)
5. Skill-catalog reference table (new, added by this PR)

All five sources agree for all five intents:
- IMPLEMENT: `test-driven-development`, `patterns`, `dependency-research`
- DEBUG: `test-driven-development`, `software-design`, `testing`
- PLAN: `test-driven-development`, `patterns`, `software-design`, `security`, `design-review`
- REVIEW: `quality-gates`, `software-design`
- RELEASE: `git`

**Intentional omissions** (correctly not touched):
- EXPLORE, RESEARCH, RESOLVE, PIPELINE: no companion skills -- documented as `(none)` in the catalog. The corresponding orch skills and commands were not modified.

**Dependency Inversion**: Companion skills are loaded via the Skill tool at runtime, not via hard imports. The fallback pattern ("If a skill fails to load, continue without it") ensures graceful degradation -- no tight coupling.

**Placement Consistency**: In all orch skills, the "Load Companion Skills" section is placed before the first phase, after Worktree Support / Iron Law but before any `**Produces:**` annotations. In commands, placement is similarly before the first phase that requires skill context (e.g., before Phase 1b in code-review, before Phase 1 in implement/debug/release, before Phase 2 in plan). This is architecturally sound -- skills are available before any phase that might reference them.

**Phase Completion Checklist**: All 5 orch skills correctly add a companion skills line item to their Phase Completion Checklist, maintaining the existing audit trail pattern.

**Modularity**: The skill-catalog.md update clearly separates GUIDED (with file-type conditionals) from ORCHESTRATED (always-on only, no file-type conditionals). The rationale is documented inline: "the orchestrator doesn't know which files will be touched, and agents load their own language/framework skills."

### Decisions Context

Reviewed ADR-001 (clean break philosophy) and PF-001 (migration code without verifying clean-break philosophy). Neither is directly relevant to this PR -- this change adds new capability to existing files rather than renaming or migrating anything. No compat shims, no migration code. The clean-break philosophy is not triggered.
