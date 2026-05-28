# Documentation Review Report

**Branch**: feat-ambient-mode -> main
**Date**: 2026-05-25

## Issues in Your Changes (BLOCKING)

### HIGH

**"First message" claim contradicts hook behavior** - `shared/rules/commands.md:24`, `plugins/devflow-ambient/README.md:15`
**Confidence**: 92%
- Problem: Both the commands rule and the devflow-ambient README state the plan detection fires only on "the first message in a session" / "the first message". However, the preamble hook (`scripts/hooks/preamble:25`) checks every prompt for the `## Goal`, `## Steps`, and `## Files` markers with no first-message guard. The CLAUDE.md description is accurate (says "when a prompt contains"), making the commands rule and README actively misleading about when detection triggers.
- Fix: Remove the "first message" qualifier from both files. In `shared/rules/commands.md:24`, change "When the first message in a session is a structured implementation plan" to "When a prompt is a structured implementation plan". In `plugins/devflow-ambient/README.md:15`, change "When the first message contains" to "When a prompt contains".

**README rule count not updated after adding commands rule** - `README.md:56`
**Confidence**: 88%
- Problem: The README says "12 ultra-condensed engineering principles" but this PR adds `shared/rules/commands.md`, bringing the total to 13. The CLAUDE.md was correctly updated to say "Currently 13 rules: 4 core + 8 language/UI + 1 ambient-managed (commands)" but the README was not updated to match. Since this PR introduced the new rule, this is a code-comment drift introduced by the change. (applies ADR-001 — clean break philosophy means counts should be accurate, not backward-compatible)
- Fix: Update `README.md:56` to say "13" instead of "12", and optionally clarify the breakdown matches the CLAUDE.md description (e.g., "13 ultra-condensed engineering principle and command awareness rules").

### MEDIUM

**devflow-ambient README Skills section lists orch skills not triggered by ambient mode** - `plugins/devflow-ambient/README.md:39-47`
**Confidence**: 82%
- Problem: The Skills section lists 9 orch skills (implement:orch, debug:orch, explore:orch, plan:orch, review:orch, resolve:orch, research:orch, release:orch, pipeline:orch) as if they are all part of ambient mode functionality. However, the preamble hook only triggers `devflow:implement` (via Skill tool). The other 8 orch skills are available as regular skills but are not triggered by ambient mode's plan detection. Listing them here implies ambient mode routes to all of them, which is no longer true after removing the router/classification system. These skills are in the plugin.json manifest for distribution purposes but are not functionally part of ambient mode's behavior.
- Fix: Either (a) restrict the Skills section to only `implement:orch` (the one ambient mode actually triggers), or (b) add a clarifying note that these skills are distributed via the ambient plugin but are invoked via slash commands, not ambient detection.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**README "See it work" example no longer shows classification output** - `README.md:24-34`
**Confidence**: 85%
- Problem: The example was updated to remove the classification line (`Devflow: IMPLEMENT. Loading: devflow:implement:triage. Scope: ORCHESTRATED`) and added the parenthetical "(or use /implement for the full agent pipeline)". This is correct for the new architecture, but the example now shows the task executing with full agent pipeline output (Validator, Simplifier, Scrutinizer, Evaluator, Tester) after a plain text request "add rate limiting to the /api/upload endpoint". With the removal of the classification system, a plain text request would NOT auto-trigger the full pipeline. Only a structured plan with `## Goal`/`## Steps`/`## Files` or an explicit `/implement` command would. The example is misleading about what happens automatically vs explicitly.
- Fix: Either (a) change the example to show a structured plan handoff that triggers auto-execution, or (b) change the prompt line to `/implement add rate limiting to the /api/upload endpoint` to show explicit invocation, or (c) add clearer framing that the user invoked `/implement`.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**README skills count (41) does not match actual skill count (51)** - `README.md:52`
**Confidence**: 95%
- Problem: README says "41 skills grounded in expert material" but the actual count is 51 (and was 66 on main before this PR removed 15). The "41" count was already wrong before this PR; this PR reduced the total from 66 to 51 but did not update the README count. This may be an intentional distinction (41 = content/expertise skills vs. all skills), but no such distinction is documented.
- Fix: Update to the current count of 51, or clarify what subset "41" refers to.

## Suggestions (Lower Confidence)

- **CLAUDE.md ambient section could mention the commands rule is not part of the standard rules lifecycle** - `CLAUDE.md:47` (Confidence: 70%) -- The ambient mode section describes the commands rule and notes it is "managed by `ambient.ts` directly, not by the rules plugin system", but the rules section also says "13 rules" which includes this ambient-managed rule. A reader might expect `devflow rules --disable` to remove it, but it is managed separately.

- **skill-catalog.md file-type conditional skills section may need intent clarification** - `docs/reference/skill-catalog.md:21` (Confidence: 65%) -- The new text says "Orch skills and Coder agents load language/framework skills based on files touched" but it was previously documented that the orchestrator does not know which files will be touched. The note was removed in this PR but the nuance may still be relevant for understanding who loads file-type conditionals.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Documentation Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The documentation updates are thorough in scope — CLAUDE.md, README, cli-reference, skill-catalog, skills-architecture, file-organization, and plugin README were all updated to reflect the simplified ambient architecture. The main concern is the "first message" claim that contradicts the hook implementation, and the README rule count that was not updated despite this PR adding a new rule. The README example also implies auto-execution behavior that no longer exists without the classification pipeline.
