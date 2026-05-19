# Regression Review Report

**Branch**: feat/evaluator-rename-tester-agent -> main
**Date**: 2026-04-03_0155

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Duplicate step number in README workflow list** - `plugins/devflow-implement/README.md:32-33`
**Confidence**: 95%
- Problem: After inserting step 7 (QA Testing) and step 8 (Simplification), the next step (PR Creation) is also numbered `8.` instead of `9.`. This is a documentation regression that will confuse users reading the workflow sequence.
- Fix:
  ```markdown
  # Change line 33 from:
  8. **PR Creation** - Git agent creates pull request
  # To:
  9. **PR Creation** - Git agent creates pull request
  ```

## Issues in Code You Touched (Should Fix)

No issues found.

## Pre-existing Issues (Not Blocking)

No issues found.

## Suggestions (Lower Confidence)

- **`devflow-ambient` plugin skills array missing `qa`** - `src/cli/plugins.ts:99-121` (Confidence: 65%) -- The ambient plugin declares the `tester` agent but does not list `qa` in its skills array. This works today because universal skill installation installs all skills regardless of plugin, but if the universal install mechanism ever changes, the ambient ORCHESTRATED pipeline would fail to find the `qa` skill. Adding `qa` to the ambient skills array would be defensive.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Detailed Analysis

**1. Lost Functionality Check**: No exports removed. No CLI options removed. No API endpoints removed. The `shepherd` agent is renamed to `evaluator` -- the old name is correctly added to `LEGACY_AGENT_NAMES` for cleanup, and `shepherd.md` is correctly removed from `.gitignore` and replaced with `evaluator.md`. The `devflow-frontend-design` plugin is renamed to `devflow-ui-design` -- the old name is correctly added to `LEGACY_PLUGIN_NAMES` for migration, and `parsePluginSelection` maps old names to new names so users passing `--plugin=frontend-design` still get the correct plugin installed.

**2. Broken Behavior Check**: All 581 tests pass. The shepherd-to-evaluator rename is thoroughly propagated through:
- `.gitignore` (build artifact patterns)
- `CLAUDE.md` (model strategy, agent roster, pipeline documentation)
- Both `implement.md` and `implement-teams.md` commands (all agent spawn calls, shutdown protocols, dialogue references)
- `plugins.json` for both `devflow-implement` and `devflow-ambient`
- `implementation-orchestration/SKILL.md` (quality gates pipeline)
- `ambient-router/SKILL.md` (ORCHESTRATED pipeline)
- Documentation files (`docs/commands.md`, `docs/reference/file-organization.md`, `docs/reference/skills-architecture.md`, `README.md`)

**3. Intent vs Reality Check**: Commit message says "agent consolidation -- evaluator rename, tester agent, QA skill, UI design plugin". The implementation delivers exactly this:
- Evaluator rename: shepherd.md renamed to evaluator.md, all references updated
- Tester agent: new `shared/agents/tester.md` (195 lines) with browser testing, dev server lifecycle, evidence collection
- QA skill: new `shared/skills/qa/SKILL.md` + 4 reference files (patterns, violations, scenario-templates, sources)
- UI design plugin: `devflow-frontend-design` renamed to `devflow-ui-design` with legacy name mapping

**4. Incomplete Migration Check**: Searched for remaining "shepherd" references -- only found in CHANGELOG.md (historical, correct) and `LEGACY_AGENT_NAMES` (migration cleanup, correct). Searched for remaining "frontend-design" references -- only found in LEGACY lists, SHADOW_RENAMES, test fixtures for legacy migration, and CHANGELOG (all correct).

**5. Phase Numbering Consistency**: Both `implement.md` and `implement-teams.md` correctly renumber phases 13-15 to 14-16 after inserting the new Phase 13 (QA Testing). The architecture diagrams in both files are also correctly updated. However, `plugins/devflow-implement/README.md` has a duplicate step number `8` (the only numbering regression found).

**6. Build System Check**: `npm run build` prerequisites are met. `shared/agents/tester.md` is a new file. `.gitignore` correctly adds `plugins/*/agents/tester.md` for build-time distribution. The `qa` skill is added to `devflow-implement`'s `plugin.json` skills array. Shell hook changes (`background-learning`, `background-memory-update`, `json-parse`) replace `echo` with `printf '%s\n'` for safer output -- these are correctness improvements, not regressions.
