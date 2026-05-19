# Consistency Review Report

**Branch**: feat/evaluator-rename-tester-agent -> main
**Date**: 2026-04-03

## Issues in Your Changes (BLOCKING)

### HIGH

**Duplicate step number in devflow-implement README workflow list** - `plugins/devflow-implement/README.md:32-33`
**Confidence**: 95%
- Problem: Steps 8 (Simplification) and 8 (PR Creation) have the same number. The QA Testing step was inserted as step 7, pushing subsequent steps up, but the final step was not renumbered from 8 to 9.
- Fix: Change line 33 from `8. **PR Creation**` to `9. **PR Creation**`.

### MEDIUM

**README skill count not updated after adding `qa` skill** - `plugins/devflow-implement/README.md:51`
**Confidence**: 90%
- Problem: The heading says `### Skills (9)` but the plugin.json now includes the `qa` skill (6 skills total in plugin.json). The README's skill list itself does not include `qa` either, even though the plugin ships with it and the Tester agent depends on it. Regardless of whether these 9 skills are an implicit combination of core-skills + implement-specific skills, the addition of `qa` means the count should be updated or `qa` should appear in the list.
- Fix: Either add `qa` to the listed skills and update the heading to `### Skills (10)`, or if the list intentionally omits skill dependencies from other plugins, add `qa` and update accordingly since it is a direct dependency of the Tester agent in this plugin.

**`devflow-ambient` plugin.json missing `qa` skill declaration** - `plugins/devflow-ambient/.claude-plugin/plugin.json`
**Confidence**: 82%
- Problem: The ambient plugin declares `tester` in its agents array and the ambient-router SKILL.md correctly lists `devflow:qa` as an excluded-from-loading skill (loaded by Tester agents at runtime). However, `qa` is not in the ambient plugin's `skills` array. All other runtime-loaded skills that the ambient router lists as excluded (review-methodology, security, architecture, performance, complexity, consistency, regression, testing, database, dependencies, documentation) ARE present in the ambient plugin.json skills array. This is a pattern deviation -- the convention is that excluded-from-loading skills are still declared as plugin dependencies so build-time distribution includes them.
- Fix: Add `"qa"` to the `plugins/devflow-ambient/.claude-plugin/plugin.json` skills array, consistent with how all other reviewer-agent runtime skills are declared there. (Note: due to universal skill installation, this has no functional impact today, but it breaks the established convention and could matter if universal install is ever removed.)

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

_No issues found._

## Suggestions (Lower Confidence)

- **CHANGELOG.md still references "Shepherd agent"** - `CHANGELOG.md:76,306` (Confidence: 65%) -- Historical CHANGELOG entries mention "Shepherd agent" and "Shepherd<->Coder direct dialogue". These are accurate historical records of what shipped in prior versions, but they could cause confusion for readers scanning the changelog for agent names. Typically changelogs are append-only records of the past, so renaming historical entries is debatable.

- **`src/cli/plugins.ts` LEGACY_AGENT_NAMES contains `shepherd` but init.ts does not import or use it** - `src/cli/plugins.ts:218` (Confidence: 70%) -- The `LEGACY_AGENT_NAMES` array is exported and consumed by `installer.ts` for cleanup, which is correct. However, only `installer.ts` imports it. The init.ts cleanup loop handles `LEGACY_SKILL_NAMES` and `LEGACY_COMMAND_NAMES` but not `LEGACY_AGENT_NAMES` -- that cleanup happens in `installViaFileCopy` in installer.ts instead. This is a mild pattern inconsistency in where cleanup lives (init.ts for skills/commands vs installer.ts for agents), but both paths execute during init.

- **Tester agent `skills` frontmatter references `devflow:testing` in addition to `devflow:qa`** - `shared/agents/tester.md:4` (Confidence: 60%) -- The Tester agent lists `devflow:qa, devflow:testing, devflow:worktree-support` in its skills frontmatter. The `testing` skill is oriented toward developer test design (unit/integration tests, mocking), while `qa` covers acceptance testing. Including both is not wrong but could cause token bloat if the `testing` skill content is not relevant to the Tester's scenario-based acceptance testing role.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The shepherd-to-evaluator rename is thorough and systematically applied across all 35 changed files. The new Tester agent and QA skill follow established patterns (skill structure, agent conventions, progressive disclosure, source citations). Phase numbering in both implement.md and implement-teams.md is correctly updated. The `devflow-frontend-design` to `devflow-ui-design` rename includes proper legacy migration support. The three issues found are: a duplicate step number in the README (likely a copy-paste oversight), a stale skill count in the same README, and a missing `qa` declaration in the ambient plugin.json that breaks the established convention for runtime-loaded skills.
