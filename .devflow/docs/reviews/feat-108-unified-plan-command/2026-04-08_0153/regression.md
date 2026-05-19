# Regression Review Report

**Branch**: feat/108-unified-plan-command -> main
**Date**: 2026-04-08_0153

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Incomplete agent count migration in file-organization.md** - `docs/reference/file-organization.md:18,138`
**Confidence**: 95%
- Problem: `CLAUDE.md` was updated to "12 shared agents" and the agents list includes `designer`, but `docs/reference/file-organization.md` still says "11 shared agents" in two places (line 18: the tree comment, line 138: the "Shared (11)" list). The list at line 138 enumerates 11 agents without `designer`.
- Impact: Documentation drift. The file-organization reference doc is a canonical reference for contributors and agents. Stale count will confuse anyone consulting it.
- Fix: Update line 18 to `# SINGLE SOURCE OF TRUTH (12 shared agents)` and line 138 to `- **Shared** (12): git, synthesizer, skimmer, simplifier, coder, reviewer, resolver, evaluator, tester, scrutinizer, validator, designer`.

## Issues in Code You Touched (Should Fix)

No issues found.

## Pre-existing Issues (Not Blocking)

No critical pre-existing issues found.

## Suggestions (Lower Confidence)

None.

## Migration Completeness Assessment

The primary risk in this branch is the specify-to-plan rename leaving stale references. Here is a systematic check of all areas:

### 1. Removed exports/references - CLEAN

| Location | Status | Notes |
|----------|--------|-------|
| `src/cli/plugins.ts` DEVFLOW_PLUGINS | CLEAN | `devflow-specify` replaced with `devflow-plan`; `specify`/`specify-teams` correctly added to `LEGACY_COMMAND_NAMES` for cleanup on upgrade |
| `src/cli/commands/init.ts` | CLEAN | No `specify` references remain; imports from `plugins.ts` which has the updated registry |
| `.claude-plugin/marketplace.json` | CLEAN | `devflow-specify` replaced with `devflow-plan` |
| `tests/plugins.test.ts` | CLEAN | Test for `agentsMap.get('git')` updated to expect `devflow-plan` (first declaring plugin); no specify references |
| `tests/skill-references.test.ts` | CLEAN | No specify references; removed stale allowlist entry |
| `tests/integration/ambient-activation.test.ts` | CLEAN | No specify references |
| All test files | CLEAN | Grep confirms zero specify references in `tests/` |

### 2. Specify plugin deprecation - CLEAN

| File | Status | Notes |
|------|--------|-------|
| `plugins/devflow-specify/` (entire directory) | DELETED | plugin.json, README.md, commands/specify.md, commands/specify-teams.md all removed |
| `plugins/devflow-plan/` (replacement) | ADDED | New plugin.json, README.md, commands/plan.md, commands/plan-teams.md, agents/designer.md |
| `.gitignore` | UPDATED | `plugins/*/agents/designer.md` added to gitignore (shared agent distribution) |
| `LEGACY_COMMAND_NAMES` in plugins.ts | UPDATED | `'specify'` and `'specify-teams'` entries ensure old installed commands are cleaned up on next `devflow init` |

### 3. Implement command - CLEAN

| File | Status | Notes |
|------|--------|-------|
| `implement.md` | UPDATED | Removed Phases 2-6 (Orient, Explore, Synthesize, Plan, Synthesize); Phase 1 now handles plan document parsing; references `/plan` not `/specify` |
| `implement-teams.md` | UPDATED | Same restructuring; exploration/planning teams removed; alignment team retained; references `/plan` not `/specify` |
| `implement/README.md` | UPDATED | References `devflow-plan` not `devflow-specify`; workflow steps updated |
| `implement/plugin.json` | UPDATED | Removed `skimmer` and `synthesizer` from agents array (moved to plan plugin) |

### 4. Skills referencing plan/specify - CLEAN

| Skill | Status | Notes |
|-------|--------|-------|
| `plan:orch` | CLEAN | No specify references; properly references Designer agent, gap-analysis, design-review |
| `router` | CLEAN | PLAN intent correctly mapped to `plan:orch` and design-review skills |
| `gap-analysis` (new) | CLEAN | No specify references; uses natural "specifying" in English context only |
| `design-review` (new) | CLEAN | Same; "specify" only in natural English |
| `docs-framework` | UPDATED | Design artifact row added to Agent Persistence table; `.docs/design/` structure documented |
| `agent-teams` | UPDATED | "Specification" replaced with "Planning" in team patterns; references `/plan` not `/specify` |
| `agent-teams/references/team-patterns.md` | UPDATED | "Specification Team" renamed to "Planning Team"; all debate flows updated |
| `agent-teams/references/cleanup.md` | UPDATED | `/specify` replaced with `/plan` in sequential team transition protocol |
| `knowledge-persistence` in skills-architecture.md | UPDATED | `/specify` replaced with `/plan` in Used By column |

### 5. Test coverage - CLEAN

| Test File | Status | Notes |
|-----------|--------|-------|
| `tests/plugins.test.ts` | UPDATED | `buildAssetMaps` expects `git`/`synthesizer` first from `devflow-plan` (correct — plan is before implement in DEVFLOW_PLUGINS array) |
| `tests/skill-references.test.ts` | UPDATED | Removed stale `specify` from test allowlist |
| `tests/integration/ambient-activation.test.ts` | UPDATED | Test IDs renumbered (4 tests remain for PLAN intent) |
| All 614 tests | PASSING | Full suite passes with zero failures |

### 6. Documentation - MOSTLY CLEAN

| Document | Status | Notes |
|----------|--------|-------|
| `CLAUDE.md` | UPDATED | Plugin table, agent roster, command roster, agent teams list all updated |
| `README.md` | UPDATED | Commands table, skill count (41), lifecycle description all updated |
| `docs/commands.md` | UPDATED | `/specify` section replaced with `/plan`; `/implement` updated |
| `docs/cli-reference.md` | UPDATED | Plugin table updated |
| `docs/reference/file-organization.md` | PARTIAL | Tree updated (specify->plan), but shared agent count and list NOT updated (see Blocking issue above) |
| `docs/reference/skills-architecture.md` | UPDATED | Clarification Gates section removed; knowledge-persistence references `/plan` |
| `CHANGELOG.md` | NOT UPDATED | Historical references to `/specify` remain (lines 149, 378, 411, 418) — this is expected and correct; changelogs are historical records |

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The specify-to-plan migration is thorough. The single blocking finding is a documentation count mismatch in `docs/reference/file-organization.md` (says 11 shared agents, should be 12 with the new `designer` agent). All code paths, plugin registrations, test expectations, skill references, and command files have been properly updated. The `LEGACY_COMMAND_NAMES` array correctly includes `specify` and `specify-teams` to ensure cleanup on upgrade. All 614 tests pass.
