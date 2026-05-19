# Complexity Review Report

**Branch**: feat/evaluator-rename-tester-agent -> main
**Date**: 2026-04-03_0155

## Issues in Your Changes (BLOCKING)

### HIGH

**Tester agent exceeds agent line target (195 lines vs 80-120 target)** - `shared/agents/tester.md`
**Confidence**: 90%
- Problem: The new Tester agent is 195 lines, exceeding the project convention of 50-150 lines for agents (Worker type target: 80-120). The agent embeds three distinct concerns: (1) scenario design and execution logic, (2) dev server lifecycle management (lines 70-106), and (3) browser-based testing via Chrome MCP tools (lines 108-125). The dev server lifecycle alone (check running server, discover command, detect port, start, poll readiness, cleanup) is a 37-line procedural recipe that could live in a reference doc. The browser execution section (17 lines) is similarly procedural. CLAUDE.md states: "Target: 50-150 lines depending on type (Utility 50-80, Worker 80-120)".
- Fix: Extract the Dev Server Lifecycle and Browser Execution sections into `shared/skills/qa/references/browser-testing.md` and reference it from the agent: "For web-facing changes, follow the Dev Server Lifecycle and Browser Execution procedures in `devflow:qa/references/browser-testing.md`." This would bring the agent down to ~140 lines, within the 150-line upper bound. The core scenario design/execution/reporting logic should remain in the agent.

**implement-teams.md growing toward maintainability threshold (663 lines)** - `plugins/devflow-implement/commands/implement-teams.md`
**Confidence**: 82%
- Problem: The Teams variant of /implement grew from 620 to 663 lines with this PR (adding Phase 13 QA Testing + renumbering). While not yet critical, this command now orchestrates 16 phases, 3 Agent Teams with shutdown protocols, and 3 retry loops (validation, alignment, QA). Each new phase adds approximately 30-40 lines of boilerplate (spawn agent, handle PASS/FAIL, retry loop, validator re-check). The file is already the largest command in the project and is approaching the point where navigating between phases requires scrolling through hundreds of lines.
- Fix: No immediate fix needed -- this is a trajectory concern. Consider factoring the common retry-loop pattern (spawn agent -> if FAIL -> spawn Coder fix -> Validator -> loop) into a documented reusable pattern in the skill, since Phases 8, 12, and 13 all follow the identical structure. This would reduce each retry phase from ~30 lines to ~5 lines referencing the pattern.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**implement.md parallel variant also growing (473 lines, 16 phases)** - `plugins/devflow-implement/commands/implement.md`
**Confidence**: 80%
- Problem: The non-teams implement command grew from 430 to 473 lines. Both implement variants now have 16 phases (up from 15), and the two files share approximately 80% identical content (the only difference is Agent Teams vs parallel subagents in exploration/planning/alignment phases). Adding the Tester phase required duplicating the same QA Testing phase, retry logic, and phase renumbering in both files. Every future phase addition requires synchronized changes in both files.
- Fix: This is a pre-existing duplication issue (noted as a known architectural pattern in the codebase). No blocking action, but the duplication makes Phase 13 (QA Testing) appear identically in both files -- 26 lines copy-pasted. Consider whether a shared "QA Testing Phase" reference could reduce this duplication in a future refactor.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**init.ts action handler monolith (1081 lines)** - `src/cli/commands/init.ts`
**Confidence**: 85%
- Problem: Already tracked as PF-002 in pitfalls.md. This PR's changes to init.ts are minimal (import change for LEGACY_PLUGIN_NAMES, legacy name remapping in parsePluginSelection, plugin hint rename). The monolithic handler remains unchanged. Verified that the resolution from PF-002 ("Extract into collectInitChoices(), executeInstallation(), printSummary()") has NOT been applied yet.
- Fix: Deferred per PF-002 -- separate refactoring PR.

## Suggestions (Lower Confidence)

- **QA skill SKILL.md line count is healthy (136 lines) but references total 348 lines across 4 files** - `shared/skills/qa/` (Confidence: 65%) -- The total QA skill footprint including references is 484 lines. While each individual file is well within limits and the progressive disclosure pattern is correctly followed, this is the largest reference set of any skill. Worth monitoring if more templates are added.

- **Phase numbering fragility across implement variants** - `plugins/devflow-implement/commands/implement.md:Phase 14-16`, `plugins/devflow-implement/commands/implement-teams.md:Phase 13-16` (Confidence: 70%) -- Inserting Phase 13 (QA Testing) required renumbering Phases 13-15 to 14-16 in both files. The architecture diagram at the bottom of each file also required renumbering. If another phase is added in the middle, the same cascade of changes would be needed. Named phases (e.g., "QA Testing" instead of "Phase 13") referenced by name rather than number would be more maintainable, though this is a style preference.

- **Duplicate LEGACY_PLUGIN_NAMES block appears 3 times in diff output** - `src/cli/plugins.ts` (Confidence: 60%) -- The diff shows the LEGACY_PLUGIN_NAMES constant appearing to be defined multiple times. This appears to be a diff rendering artifact (git showing surrounding context from different hunks), not actual code duplication. Would need to verify the built output.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 1 | 0 |

**Complexity Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR is well-structured overall. The new QA skill follows the established progressive disclosure pattern correctly (136-line SKILL.md with 4 reference files). The evaluator.md rename is a clean 1:1 rename with no complexity change. The TypeScript changes (plugins.ts, manifest.ts, installer.ts) are minimal and well-tested with 3 new test cases covering legacy name migration.

The two HIGH findings are both about file length approaching project conventions. The Tester agent (195 lines) is the most actionable -- extracting the dev server lifecycle and browser execution procedures to a reference file would bring it within the 150-line agent target while preserving all the procedural detail. The implement command growth is a trajectory concern that does not block this PR but should inform future phase additions.

Conditions for approval:
1. Consider extracting Dev Server Lifecycle + Browser Execution from tester.md to a QA skill reference file (brings agent from 195 to ~140 lines)
