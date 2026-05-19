# Regression Review Report

**Branch**: feat/108-unified-plan-command -> main
**Date**: 2026-04-07_2319

## Issues in Your Changes (BLOCKING)

### HIGH

**Stale agents in devflow-implement plugin manifest and plugins.ts** - `plugins/devflow-implement/.claude-plugin/plugin.json:20-21`, `src/cli/plugins.ts:70`
**Confidence**: 85%
- Problem: The implement command (`implement.md` and `implement-teams.md`) no longer spawns `Skimmer` or `Synthesizer` agents — all exploration/planning phases (old Phases 2-6) have been removed. However, both `plugin.json` and `plugins.ts` still declare `skimmer` and `synthesizer` as required agents for `devflow-implement`. This means the installer will continue to copy these agents into the implement plugin directory even though they are never used by the command. While this does not cause a runtime failure, it contradicts the principle that plugin manifests declare only the agents a plugin actually uses, and inflates the installed footprint unnecessarily.
- Fix: Remove `"skimmer"` and `"synthesizer"` from the `agents` array in both `plugins/devflow-implement/.claude-plugin/plugin.json` and the `devflow-implement` entry in `src/cli/plugins.ts`. The implement command now only spawns: Git, Coder, Simplifier, Scrutinizer, Evaluator, Tester, and Validator.

**Stale description in devflow-implement plugin.json** - `plugins/devflow-implement/.claude-plugin/plugin.json:3`
**Confidence**: 92%
- Problem: The `plugin.json` description still reads "orchestrates exploration, planning, coding, validation, and PR creation" but the implement command no longer performs exploration or planning — those responsibilities have moved to `/plan`. The `plugins.ts` description was correctly updated to "accepts plan documents, issues, or task descriptions" but the `plugin.json` was not updated to match.
- Fix: Change the description in `plugins/devflow-implement/.claude-plugin/plugin.json` to match `plugins.ts`:
  ```json
  "description": "Complete task implementation workflow - accepts plan documents, issues, or task descriptions"
  ```

### MEDIUM

**Implement command lost /implement without args fallback path for exploration** - `plugins/devflow-implement/commands/implement.md`, `plugins/devflow-implement/commands/implement-teams.md`
**Confidence**: 82%
- Problem: Previously, `/implement` with no plan document and no issue number would automatically explore the codebase (Skimmer, 4 Explore agents, Synthesize, 3 Plan agents, Synthesize) before coding. After this PR, `/implement` without a plan document defaults to SINGLE_CODER with no exploration context — the Coder receives `PATTERNS: {patterns from plan document or empty}` (empty) and `EXECUTION_PLAN: {full plan from setup context}` (only conversation context). This is an intentional design change (exploration moves to `/plan`), but users who previously ran `/implement "add rate limiting"` and got full exploration+planning will now get a less-informed Coder. The behavior change is documented in README and CLAUDE.md but represents a significant regression in the standalone `/implement` experience when no plan document is provided.
- Fix: This appears intentional per the architectural direction (plan-first design). Consider adding a brief note in the implement command's Phase 2 that explicitly states: "For best results when no plan document is provided, run `/plan` first to produce a design artifact, then pass it to `/implement`." This would make the behavioral change explicit to the orchestrating LLM rather than relying on the user knowing to chain commands.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Implement-teams.md still contains exploration/planning teams in the Architecture section reference** - `plugins/devflow-implement/commands/implement-teams.md`
**Confidence**: 80%
- Problem: The teams variant of implement removed the exploration and planning team phases but the Principles section was updated to mention "Team-based alignment" (principle 3). However, the teams variant only retains one team phase (Phase 7: Evaluator-Coder Dialogue). The old principles that referenced "Team-based exploration" were correctly removed, and the new principles are consistent. No actual regression here upon closer inspection — this is confirmed aligned.
- Fix: No action needed; confirmed consistent after review.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Plugin.json description for devflow-implement still says "exploration"** - `plugins/devflow-implement/.claude-plugin/plugin.json:3`
**Confidence**: 90%
- Problem: Already covered under Blocking. The `plugin.json` description was not updated in this PR despite the `plugins.ts` description being updated. This is a documentation drift issue in the plugin manifest.
- Fix: See blocking issue above.

## Suggestions (Lower Confidence)

- **Synthesizer "design" mode lacks explicit documentation of deduplicate behavior** - `shared/agents/synthesizer.md` (Confidence: 70%) — The new "design" mode says "boost confidence by 10% per additional agent" but doesn't specify whether this operates on file:line matching, issue-title matching, or semantic similarity. The "review" mode has clearer dedup semantics.

- **plan:orch Phase 8 persistence condition may be ambiguous** - `shared/skills/plan:orch/SKILL.md` (Confidence: 65%) — The condition ">10 implementation steps or HIGH/CRITICAL context risk" for writing to disk could lead to inconsistent behavior if the plan has exactly 10 steps and LOW risk; the threshold boundary is fuzzy. The `/plan` command always writes artifacts (no conditional), so the orch variant behaves differently.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The core regression risk in this PR is the removal of exploration/planning phases from `/implement` without fully cleaning up the agent manifests. The `plugin.json` and `plugins.ts` for devflow-implement still declare `skimmer` and `synthesizer` agents that are no longer used. The description in `plugin.json` also drifted. These are straightforward fixes. The behavioral regression (standalone `/implement` losing exploration) is intentional per the plan-first architecture but warrants explicit documentation in the command itself. No exports were removed, no files were deleted, and no return types were changed — the regression risk is contained to the implement command's standalone (no-plan) experience and stale metadata.
