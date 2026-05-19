# Consistency Review Report

**Branch**: fix/subagent-skill-preload -> main
**Date**: 2026-04-17

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent dynamic skill-loading strategy across agents (3 agents)** -- Confidence: 85%
- `shared/agents/designer.md:40`, `shared/agents/reviewer.md:59`, `shared/agents/coder.md:56`
- Problem: The PR introduces three different patterns for how agents handle dynamic (mode/domain/focus-specific) skills:
  1. **Designer** (`designer.md:40`): Skills are preloaded via frontmatter YAML list, body says "Apply mode skill -- Use the detection patterns from your **preloaded** mode skill". No Skill tool invocation at runtime.
  2. **Reviewer** (`reviewer.md:59`): Skills are NOT in frontmatter; body says "**First action -- load focus skill**: Before any analysis, invoke the Skill tool: `Skill(skill="devflow:{FOCUS}")`". Runtime loading via Skill tool.
  3. **Coder** (`coder.md:56`): Skills are NOT in frontmatter; body says "**First action -- load domain skills**: Before any analysis, invoke the Skill tool for each domain skill matching DOMAIN hint." Runtime loading via Skill tool.

  Designer preloads ALL mode skills (both gap-analysis and design-review) even though only one is used per invocation. Reviewer and Coder load dynamically at runtime. All three are new patterns introduced in this PR. A reader encountering any one agent would expect the others to follow the same strategy.
- Fix: Pick one canonical pattern and apply it uniformly. The Designer's preload approach is arguably preferable (guaranteed availability, no runtime failure mode), but then Reviewer and Coder should preload their dynamic skills too. Alternatively, if Reviewer/Coder must load dynamically (because the skill set is large/parameterized), document WHY Designer differs -- e.g., "Designer preloads both mode skills because there are only 2; Reviewer loads dynamically because there are 18 focus areas."

### MEDIUM

**Coder step 2 label says "First action" but it is step 2, not step 1** -- Confidence: 82%
- `shared/agents/coder.md:56`
- Problem: The new text reads `2. **First action -- load domain skills**: Before any analysis...`. The phrase "First action" conflicts with the step number `2.` -- step 1 is "Orient on branch state". The Reviewer uses the same "First action" label correctly at step 1 (`reviewer.md:59`). This inconsistency could confuse the agent about execution ordering.
- Fix: Either rename to `2. **Load domain skills**:` (dropping "First action"), or reorder so domain skill loading is step 1 and branch orientation is step 2 (matching Reviewer's pattern where skill loading is genuinely step 1).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Inconsistent error-handling instruction for Skill tool failures across agents** -- Confidence: 80%
- `shared/agents/coder.md:56`, `shared/agents/reviewer.md:59`, `shared/agents/designer.md:40`
- Problem: Coder says "If a Skill invocation fails, report BLOCKED to the orchestrator with the error and stop." Reviewer says the same. But Designer (preloaded pattern) has no failure-handling instruction at all -- if a preloaded skill somehow fails to inject, the agent has no guidance. The old Coder text said "If a Read fails (skill not installed), skip it silently and continue" which was a deliberate lenient policy for optional domain skills. The new text makes ALL skill failures blocking with no distinction between required and optional skills.
- Fix: For Coder, consider restoring lenient handling for optional domain skills (e.g., `devflow:accessibility` may not be installed). For Designer, add a sentence about what to do if preloaded skills are missing from context.

## Pre-existing Issues (Not Blocking)

### LOW

**Frontmatter field ordering inconsistency: `skills` before `model` in 2 of 12 agents** -- Confidence: 90%
- `shared/agents/simplifier.md:4-7`, `shared/agents/skimmer.md:4-7`
- Problem: 10 of 12 agents use `name > description > model > skills` ordering. Simplifier and Skimmer use `name > description > skills > model`. This predates the PR (the original comma-string lines were already in this position), but the conversion to block-list format makes the inconsistency more visually prominent since `skills:` now spans multiple lines.
- Fix: Reorder to `model` before `skills:` in simplifier.md and skimmer.md to match the other 10 agents. (Separate PR recommended.)

## Suggestions (Lower Confidence)

- **Missing integration test coverage for agents with only static skills** - `tests/integration/subagent-skill-preload.test.ts` (Confidence: 65%) -- The test covers 6 of 12 agents. Agents like Evaluator, Resolver, Synthesizer, Tester, Validator are not tested. While they don't have dynamic loading, confirming their static preloads work would complete the coverage matrix.

- **`getLatestSubagentPreloadedSkills` uses fragile transcript path heuristic** - `tests/integration/helpers.ts:231-298` (Confidence: 70%) -- The function reverse-engineers Claude Code's internal transcript storage path (`~/.claude/projects/-{encoded-path}/{sessionId}/subagents/`). If Claude Code changes this path structure, all 6 integration tests silently return empty arrays and pass vacuously. Consider adding a guard assertion (e.g., `expect(preloaded.length).toBeGreaterThan(0)`) in each test.

- **Plugin-local `designer.md` is exact duplicate of shared `designer.md`** - `plugins/devflow-plan/agents/designer.md` (Confidence: 60%) -- Both files are identical. Per CLAUDE.md, shared agents are the single source of truth and plugin copies are gitignored/generated at build time. This file being tracked in the diff suggests it may be committed directly rather than generated. Verify the build system handles this correctly.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 1 |

**Consistency Score**: 6/10
**Recommendation**: CHANGES_REQUESTED
