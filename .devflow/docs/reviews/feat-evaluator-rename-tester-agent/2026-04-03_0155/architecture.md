# Architecture Review Report

**Branch**: feat/evaluator-rename-tester-agent -> main
**Date**: 2026-04-03

## Issues in Your Changes (BLOCKING)

### HIGH

**Duplicate step number in implement README workflow** - `plugins/devflow-implement/README.md:32-33`
**Confidence**: 95%
- Problem: The workflow section shows step 8 twice. After inserting the new "QA Testing" step as step 7, the original step 8 ("Simplification") was renumbered to 8, but "PR Creation" also remains as step 8 instead of becoming step 9. This documentation inconsistency misrepresents the pipeline to consumers of the README.
  ```
  7. **QA Testing** - Tester executes scenario-based acceptance tests
  8. **Simplification** - Simplifier refines code clarity
  8. **PR Creation** - Git agent creates pull request   <-- should be 9
  ```
- Fix: Change the second step 8 to step 9:
  ```
  9. **PR Creation** - Git agent creates pull request
  ```

### MEDIUM

**Tester agent at 195 lines exceeds agent size convention** - `shared/agents/tester.md`
**Confidence**: 85%
- Problem: CLAUDE.md states the agent target is "50-150 lines depending on type (Utility 50-80, Worker 80-120)." The Tester agent is 195 lines, which significantly exceeds even the upper bound of 120 lines for Worker agents. Large agent definitions increase context window consumption for every invocation. The Tester agent contains extensive procedural detail for dev server lifecycle management (lines 70-106) and browser execution (lines 108-125) that could be delegated to the `devflow:qa` skill's references.
- Fix: Extract the "Dev Server Lifecycle" and "Browser Execution" sections into `shared/skills/qa/references/browser-testing.md` and reference it from the agent with a brief summary and a `Read` instruction. This would bring the agent under 120 lines while keeping all the procedural knowledge accessible on demand. Example:
  ```markdown
  ## Dev Server Lifecycle & Browser Execution

  When web-facing changes detected, read `devflow:qa` skill references for dev server
  lifecycle and browser execution procedures:
  `Read ~/.claude/skills/devflow:qa/references/browser-testing.md`
  ```

**Missing `qa` skill in devflow-ambient plugin.json skills array** - `plugins/devflow-ambient/.claude-plugin/plugin.json`
**Confidence**: 82%
- Problem: The ambient plugin declares the `tester` agent (line 24) but does not declare the `qa` skill in its `skills` array (lines 31-52). While this works in practice because of universal skill installation (all skills from all plugins are installed), it violates the explicit-dependency principle: the plugin manifest should declare all skills its agents reference. The `implementation-orchestration` skill (which ambient uses) now spawns the Tester agent, which has `skills: devflow:qa` in its frontmatter. Every other skill referenced by ambient's agents IS declared in the manifest (e.g., `testing`, `review-methodology`, `security`). The `qa` skill is the sole exception.
- Fix: Add `"qa"` to the `skills` array in `plugins/devflow-ambient/.claude-plugin/plugin.json`:
  ```json
  "skills": [
    "ambient-router",
    ...
    "implementation-patterns",
    "knowledge-persistence",
    "qa",
    "worktree-support"
  ]
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Simplification step ordering inconsistency between implement.md and implement-teams.md** - `plugins/devflow-implement/commands/implement.md`, `plugins/devflow-implement/commands/implement-teams.md`
**Confidence**: 83%
- Problem: In the previous architecture, the pipeline was: Validate -> Simplify -> Scrutinize -> re-Validate -> Shepherd -> PR. The new pipeline inserts Tester after Evaluator: Validate -> Simplify -> Scrutinize -> re-Validate -> Evaluator -> Tester -> PR. However, the README shows a different ordering where Simplification (step 8) comes AFTER QA Testing (step 7), contradicting the command files where Simplify (Phase 9) comes BEFORE Evaluator (Phase 12) and Tester (Phase 13). The README workflow section does not match the actual phase ordering in either command file.
  - README: Exploration -> Planning -> Implementation -> Validation -> Self-Review -> Alignment -> QA -> **Simplification** -> PR
  - Actual commands: Exploration -> Planning -> Implementation -> Validation -> **Simplification** -> Self-Review -> Re-Validate -> Alignment -> QA -> PR
- Fix: Reorder the README workflow to match the actual command pipeline:
  ```markdown
  1. **Exploration** - Skimmer + Explore agents understand the codebase
  2. **Planning** - Plan agents design implementation approach
  3. **Implementation** - Coder agent implements on feature branch
  4. **Validation** - Validator runs build/test/lint checks
  5. **Simplification** - Simplifier refines code clarity
  6. **Self-Review** - Scrutinizer evaluates against 9-pillar framework
  7. **Alignment Check** - Evaluator validates against original request
  8. **QA Testing** - Tester executes scenario-based acceptance tests
  9. **PR Creation** - Git agent creates pull request
  ```

## Pre-existing Issues (Not Blocking)

No pre-existing CRITICAL issues found in the reviewed files.

## Suggestions (Lower Confidence)

- **Tester agent missing `tools` frontmatter** - `shared/agents/tester.md` (Confidence: 65%) -- The Tester agent executes Bash commands and potentially uses Chrome MCP tools but does not declare a `tools` frontmatter field. Most agents in this codebase also lack `tools` frontmatter (only Skimmer has it), so this follows the existing pattern, but for a security-sensitive agent that manages dev server processes, explicit tool declaration would improve least-privilege alignment.

- **SRP tension in Tester agent** - `shared/agents/tester.md` (Confidence: 70%) -- The Tester agent has three distinct responsibilities: scenario design, Bash-based CLI testing, and browser-based web testing (including dev server lifecycle management). The browser testing path involves process management (starting/killing dev servers), port detection, and Chrome MCP tool orchestration -- concerns quite different from scenario design and Bash execution. If browser testing grows in complexity, consider splitting into a dedicated WebTester agent. Currently manageable but worth monitoring.

- **CHANGELOG not updated for shepherd->evaluator rename** - `CHANGELOG.md` (Confidence: 60%) -- Historical CHANGELOG entries reference "Shepherd" (lines 76, 306). These are historical records and typically should not be retroactively changed, so this is informational only.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

### Assessment

This PR executes a well-structured architectural change: splitting the monolithic Shepherd agent into a focused Evaluator (alignment validation) and a new Tester (scenario-based QA). The decomposition follows the Single Responsibility Principle -- the Evaluator checks "did we build what was asked?" while the Tester checks "does it actually work from the user's perspective?" This is a clean separation of concerns.

The new `qa` skill follows the established 3-tier skill architecture with proper progressive disclosure (SKILL.md + references/). The skill is correctly backed by 12 canonical sources. The pipeline integration is thorough -- both `implement.md` and `implement-teams.md` variants, the `implementation-orchestration` skill, the ambient router, and all documentation surfaces have been updated consistently.

The rename from "shepherd" to "evaluator" is cleaner terminology that better communicates the agent's role. Legacy cleanup is properly handled via `LEGACY_AGENT_NAMES` and `LEGACY_PLUGIN_NAMES` registries.

The blocking issue is the duplicate step number in the README and the ordering inconsistency between README and the actual command pipeline phases. The `qa` skill should also be added to the ambient plugin manifest for explicit dependency tracking.
