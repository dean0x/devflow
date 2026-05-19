# Regression Review Report

**Branch**: feat/108-unified-plan-command -> main
**Date**: 2026-04-08_0204
**Type**: RE-REVIEW (verifying fixes from prior review)

## Verification Checklist

### 1. LEGACY_PLUGIN_NAMES maps 'devflow-specify' to 'devflow-plan' -- PASS
- `src/cli/plugins.ts:207` contains `'devflow-specify': 'devflow-plan'`
- This ensures `devflow init` upgrades migrate the old plugin name correctly

### 2. LEGACY_COMMAND_NAMES includes 'specify' and 'specify-teams' -- PASS
- `src/cli/plugins.ts:216-217` lists both `'specify'` and `'specify-teams'`
- Old command files at `~/.claude/commands/devflow/specify.md` and `specify-teams.md` will be cleaned up on upgrade

### 3. LEGACY_SKILL_NAMES includes bare names for gap-analysis and design-review -- PASS
- `src/cli/plugins.ts:393-394` lists `'gap-analysis'` and `'design-review'`
- These entries ensure pre-namespace installs (bare `gap-analysis/` and `design-review/` directories) are cleaned up when the namespaced `devflow:gap-analysis` and `devflow:design-review` are installed

### 4. All 614 tests passing -- PASS
- `npm test` output: 23 test files, 614 tests passed, 0 failures
- No regressions from the plugin rename or new skill additions

### 5. Build distributes 41 skills and 12 agents -- PASS
- `npm run build` output: "Found 41 skills in shared/skills/" and "Found 12 agents in shared/agents/"
- `devflow-plan: 6 skills, 4 agents copied` (correct: agent-teams, gap-analysis, design-review, patterns, knowledge-persistence, worktree-support + git, skimmer, synthesizer, designer)
- `devflow-ambient: 25 skills, 12 agents copied` (includes gap-analysis, design-review, designer)
- Total: 78 skill copies + 34 agent copies across 17 plugins

### 6. Test assertions for counts -- PASS
- `tests/plugins.test.ts:152`: `DEVFLOW_PLUGINS.length >= 8` (passes at 17)
- `tests/plugins.test.ts:17`: `skills.length > 0` (no hardcoded count)
- `tests/plugins.test.ts:33`: `agents.length > 0` (no hardcoded count)
- `tests/plugins.test.ts:113`: `buildFullSkillsMap.size === getAllSkillNames.length` (structural, not hardcoded)
- `tests/build.test.ts`: All checks are structural (every referenced skill/agent exists on disk) -- no stale counts
- `tests/skill-references.test.ts:927`: `coreReviewers.length === 7` -- unrelated to plan, still correct

## Fresh Regression Analysis

### init.ts handles plan plugin correctly -- PASS
- **Advanced mode**: `pluginHints` map at line 304 includes `'devflow-plan': 'gap analysis, design review'`
- **Recommended mode**: Uses `selectedPlugins` from multiselect or CLI flags; `devflow-plan` appears in the DEVFLOW_PLUGINS filter used for multiselect choices
- **No stale references**: Zero occurrences of `devflow-specify` in init.ts (grep confirms)

### Ambient plugin includes plan-related assets -- PASS
- `plugins/devflow-ambient/.claude-plugin/plugin.json` skills array includes `plan:orch`, `gap-analysis`, `design-review`
- Agents array includes `designer` (required by plan:orch pipeline)
- Router SKILL.md ORCHESTRATED table maps PLAN to `devflow:plan:orch` (line 33)

### Router SKILL.md routes correctly -- PASS
- GUIDED PLAN loads: `devflow:test-driven-development, devflow:patterns, devflow:software-design, devflow:security, devflow:design-review`
- ORCHESTRATED PLAN loads: `devflow:plan:orch, devflow:patterns, devflow:software-design, devflow:security, devflow:design-review`
- Both paths include the new `design-review` skill

### No stale 'specify' references in source -- PASS
- `src/cli/` only references `specify` in LEGACY_PLUGIN_NAMES and LEGACY_COMMAND_NAMES (correct migration entries)
- `tests/` has zero references to `specify`
- `docs/commands.md` has no mention of `/specify` -- correctly shows `/plan`
- `CHANGELOG.md` has historical `/specify` references (correct -- changelog should not be rewritten)
- `plugins/` and `shared/` only use "specify" as the English verb (e.g., "without specifying"), never as a plugin/command name

### Old plugin directory removed -- PASS
- `plugins/devflow-specify/` does not exist on disk
- All files show as deleted in the diff: `plugin.json`, `README.md`, `specify.md`, `specify-teams.md`

### New plugin directory complete -- PASS
- `plugins/devflow-plan/` exists with `.claude-plugin/plugin.json`, `README.md`, `commands/plan.md`, `commands/plan-teams.md`, `agents/designer.md`
- plugin.json declares correct agents (`git`, `skimmer`, `synthesizer`, `designer`) and skills (`agent-teams`, `gap-analysis`, `design-review`, `patterns`, `knowledge-persistence`, `worktree-support`)

### Pitfall Check -- NO REGRESSIONS
- PF-001 (Synthesizer glob): Not affected by this change
- PF-002 (Init monolith): pluginHints updated correctly for devflow-plan, no new growth
- PF-003 (pluginHints duplication): Pre-existing, correctly updated with new name
- PF-004-006: Unrelated to this change

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

(none -- all verification items passed cleanly)

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 10/10
**Recommendation**: APPROVED

The previous review's finding (missing `LEGACY_PLUGIN_NAMES` entry) has been fixed. All six verification items pass. The migration from `devflow-specify` to `devflow-plan` is complete with no stale references, all legacy cleanup entries in place, and all tests and build passing. No functional regression risks identified.
