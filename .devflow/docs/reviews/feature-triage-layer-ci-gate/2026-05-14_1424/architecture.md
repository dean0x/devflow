# Architecture Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

### HIGH

**CI Status Gate lacks bounded retry specification in resolve commands** - `plugins/devflow-resolve/commands/resolve.md:260-261`, `plugins/devflow-resolve/commands/resolve-teams.md:260-261`
**Confidence**: 85%
- Problem: The CI Status Gate (Phase 7) specifies "poll every 60 seconds, max 10 iterations" and "Max 2 fix attempts" for CI failures, but the Coder agent spawned for CI fixes has no bounded scope. The instruction says "Spawn `Agent(subagent_type="Coder")` to fix CI failures based on check names and failure context" without specifying what the Coder should be constrained to fix (only CI-related files? any file?). A Coder given a vague "fix CI failures" directive could make unbounded changes. Additionally, the interaction between the CI gate's Coder fixes and the preceding Simplifier (Phase 6) creates an ordering concern — Coder changes in Phase 7 bypass the Simplifier refinement pass.
- Fix: Add scope constraints to the Coder spawn: specify that the Coder should only modify files directly related to the failing checks (e.g., CI config, test files referenced in failure output), and cap the diff to a reasonable number of files. Consider whether a Simplifier pass should run after CI fixes, or document why it is intentionally skipped.

**CI Status Gate introduces tight coupling between resolve:orch and Git agent's new operation** - `shared/skills/resolve:orch/SKILL.md:121-126`
**Confidence**: 82%
- Problem: The resolve:orch skill references `OPERATION: check-ci-status` and embeds detailed polling/fix logic (60s intervals, 10 iterations, max 2 fix attempts) directly in the skill markdown. The same polling and fix logic is duplicated verbatim across three locations: `resolve:orch/SKILL.md`, `resolve.md`, `resolve-teams.md`, and `implement:orch/SKILL.md`. This violates DIP — the orchestration skills know implementation details of the CI gate flow rather than delegating to a higher-level abstraction. When the polling strategy changes (e.g., exponential backoff, different timeouts), all four locations must be updated in sync.
- Fix: Extract the CI gate polling/fix logic into a dedicated section in the Git agent or a shared reference document. The orchestration skills should reference a single canonical source (e.g., "Run CI Status Gate per `git.md#check-ci-status` protocol") rather than embedding the full polling algorithm inline. Alternatively, consider a `ci-gate` shared skill that encapsulates the complete check-poll-fix loop.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Phase numbering inconsistency between resolve.md and resolve-teams.md Output Artifact section** - `plugins/devflow-resolve/commands/resolve-teams.md:383`
**Confidence**: 88%
- Problem: In `resolve-teams.md`, the "Output Artifact" section header says "Written by orchestrator in Phase 8" but the actual Phase 8 is now "Manage Tech Debt" and the Report phase is Phase 9. The `resolve.md` variant correctly states "Written in Phase 5" for its early-write strategy. The teams variant still references the old phase number.
- Fix: Update line 383 of `resolve-teams.md` from "Written by orchestrator in Phase 8" to "Written by orchestrator in Phase 9" to match the new phase numbering.

**Triage skills share identical structure — potential maintenance burden from 7-way duplication** - `shared/skills/implement:triage/SKILL.md`, `shared/skills/debug:triage/SKILL.md`, `shared/skills/explore:triage/SKILL.md`, `shared/skills/plan:triage/SKILL.md`, `shared/skills/research:triage/SKILL.md`, `shared/skills/release:triage/SKILL.md`, `shared/skills/review:triage/SKILL.md`
**Confidence**: 82%
- Problem: All 7 triage skills follow an identical 4-section template (Iron-law default, Orchestration Hint Override, Scope Assessment, Route). The boilerplate sections (Orchestration Hint Override and Route) are copy-pasted verbatim across all 7 files. When the hint keywords change (e.g., adding "comprehensive" as a trigger), all 7 files must be updated. Only the "Scope Assessment" section varies per intent. This is a shallow module pattern — each triage skill exposes more surface area than the unique logic it encapsulates.
- Fix: This is a known tradeoff in the skill architecture (skills are self-contained markdown files, not composable templates). The current approach is acceptable given the small count (7 files) and the fact that skills are meant to be independently readable. However, consider extracting the shared "Orchestration Hint Override" keywords into the router's `classification-rules.md` as a reference list, so triage skills can say "see classification-rules.md for override keywords" rather than duplicating the list.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**resolve:orch grows to 8 phases without a Phase Completion Checklist reset** - `shared/skills/resolve:orch/SKILL.md:148-159`
**Confidence**: 80%
- Problem: The resolve:orch Phase Completion Checklist was updated to include the new CI Status Gate phase, but the skill now has 8 phases (1 through 8) which approaches the complexity boundary where phase tracking becomes error-prone. The implement:orch skill has 9 phases and both resolve commands have 9+. The CLAUDE.md convention notes "Orchestration skills follow the Phase Protocol" but does not set a maximum phase count. More phases means more context for the model to track.

## Suggestions (Lower Confidence)

- **review:triage "Depth Continuation" cross-session state assumption** - `shared/skills/review:triage/SKILL.md:19-20` (Confidence: 72%) -- The review:triage skill says "If a previous classification in this session was IMPLEMENT with ORCHESTRATED scope, inherit ORCHESTRATED." This requires the model to remember a prior triage outcome from earlier in the session, but triage skills are loaded on demand and have no explicit state mechanism. The model may or may not recall this. Consider whether this should be surfaced as a router-level rule rather than buried in one triage skill.

- **Classification rules removed "REVIEW depth continuation" but review:triage reimplements it** - `shared/skills/router/classification-rules.md` vs `shared/skills/review:triage/SKILL.md:19-20` (Confidence: 65%) -- The old classification-rules.md had a "REVIEW depth continuation" rule that was removed in this PR. The review:triage skill reintroduces the same concept in a different location. This is intentional (moving depth logic to triage), but the dual removal+readd across files could cause confusion if someone only reads the classification-rules diff and concludes the feature was dropped.

- **`check-ci-status` Git operation uses `gh pr checks` which may not exist in all environments** - `shared/agents/git.md:290` (Confidence: 60%) -- The `gh pr checks` command requires GitHub CLI and a GitHub-hosted repo. The operation gracefully handles `NO_PR` and `NO_CI` but does not document what happens if `gh` itself is not installed. Other Git agent operations use `2>/dev/null || echo "(none)"` patterns; this one uses `2>/dev/null` without a fallback description.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 1 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The triage layer is a well-conceived architectural improvement — introducing a scope assessment gate between intent classification and workflow execution cleanly separates the "what" (intent) from the "how much" (scope). The default-to-GUIDED bias correctly inverts the prior default-to-ORCHESTRATED behavior, reducing unnecessary agent spawning. The CI Status Gate is a valuable addition to the resolve and implement pipelines.

The primary architectural concerns are: (1) the CI gate's fix-loop logic is duplicated across 4 files with no single source of truth (applies ADR-001 — this is new code, not migration, but the DRY principle applies), and (2) the Coder agent spawned for CI fixes in Phase 7 has no explicit scope constraints, risking unbounded changes that bypass earlier quality gates. Both issues are addressable without restructuring the overall design.
