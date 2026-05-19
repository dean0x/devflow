# Architecture Review Report

**Branch**: feat/ambient-pipeline-flow -> main
**Date**: 2026-04-07

## Issues in Your Changes (BLOCKING)

### HIGH

**Stale `Task` in `allowed-tools` frontmatter across all orchestration skills** - `shared/skills/implement:orch/SKILL.md:5`, `shared/skills/pipeline:orch/SKILL.md:5`, `shared/skills/debug:orch/SKILL.md:5`, `shared/skills/explore:orch/SKILL.md:5`, `shared/skills/plan:orch/SKILL.md:5`, `shared/skills/resolve:orch/SKILL.md:5`, `shared/skills/review:orch/SKILL.md:5`
**Confidence**: 95%
- Problem: The `allowed-tools` frontmatter in all 7 orchestration skills still lists `Task` as a permitted tool, while the skill bodies have been updated to reference `Agent(subagent_type=...)` instead of `Task(subagent_type=...)`. The `Task` tool name in the frontmatter is now stale. If the Claude Code platform enforces `allowed-tools` as a whitelist, the `Agent` tool would be blocked while `Task` (the old name) would be permitted but unused.
- Fix: Update all 7 orchestration skill frontmatter lines from `Task` to `Agent`:
  ```yaml
  # implement:orch, pipeline:orch (no AskUserQuestion)
  allowed-tools: Read, Grep, Glob, Bash, Agent

  # debug:orch, explore:orch, plan:orch, resolve:orch, review:orch
  allowed-tools: Read, Grep, Glob, Bash, Agent, AskUserQuestion
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**GUIDED PLAN row includes `devflow:test-driven-development` in router but classification-rules.md has no TDD signal** - `shared/skills/router/SKILL.md:23`
**Confidence**: 82%
- Problem: The router SKILL.md GUIDED table lists `devflow:test-driven-development` for PLAN intent, but the classification-rules.md PLAN signals are "how should", "plan", "design", "architecture", "approach", "strategy" -- none of which involve code changes. TDD enforcement during planning is structurally misplaced: planning produces design documents, not code. The skill catalog `references/skill-catalog.md` confirms "plans must account for test-first workflow" but this is a documentation concern, not a runtime skill dependency.
- Fix: Consider removing `devflow:test-driven-development` from the GUIDED PLAN row, or documenting why a planning-only intent needs TDD loaded. The ORCHESTRATED PLAN row correctly omits it (delegates to `plan:orch` which handles its own concerns).

**Router GUIDED EXPLORE has empty skill set but GUIDED EXPLORE still dispatches Skimmer + Explore agents** - `shared/skills/router/SKILL.md:20`
**Confidence**: 80%
- Problem: The GUIDED table shows `EXPLORE | ---` (no skills), and the skill-catalog.md says GUIDED EXPLORE loads `devflow:explore:orch`. This is a divergence: the lean router SKILL.md says no skills for GUIDED EXPLORE, while the detailed skill-catalog.md reference says to load `explore:orch`. The router's inline text at line 12 says "GUIDED EXPLORE: spawn Skimmer + Explore agents, then analyze directly" -- but if no skills are loaded, the agent spawn instructions come from where? The previous (deleted) router version loaded `explore:orch` for GUIDED EXPLORE.
- Fix: Either add `devflow:explore:orch` to the GUIDED EXPLORE row (matching the skill-catalog.md reference) or update the skill-catalog.md to say "no skills for GUIDED EXPLORE -- instructions are in router inline text." Currently they contradict.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**PF-005: HookEntry/HookMatcher/Settings still duplicated in `hud.ts`** - `src/cli/utils/hooks.ts`
**Confidence**: 85%
- Problem: The new shared `src/cli/utils/hooks.ts` module (introduced in this branch or a prior one) correctly extracts HookEntry/HookMatcher/Settings interfaces and `ambient.ts` now imports from it. However, pitfall PF-005 notes that `hud.ts` uses a "structurally different Settings type" and is intentionally excluded. The comment in `hooks.ts` line 6 documents this. This is a known deferred item already tracked as PF-005.

### LOW

**`pipeline:orch` still references `Task` in allowed-tools (pre-existing from shared concern above)** - `shared/skills/pipeline:orch/SKILL.md:5`
**Confidence**: 90%
- Problem: Same as the blocking `Task` vs `Agent` issue, but noting this file was already present before this branch. The `pipeline:orch` changes in this branch modify the Iron Law and phase descriptions, bringing it into scope.

## Suggestions (Lower Confidence)

- **Router SKILL.md duplicated content** - `shared/skills/router/SKILL.md` (Confidence: 70%) -- The diff appears to show the router SKILL.md content duplicated (frontmatter + tables appear twice in the file). This may be a diff rendering artifact from the three-layer refactoring, but if the actual file contains duplicate content blocks, it would cause unpredictable Skill tool behavior. Verify the installed file has no duplication.

- **Classification-rules.md depth bias shift** - `shared/skills/router/references/classification-rules.md:22-24` (Confidence: 65%) -- The new rules say "Default to ORCHESTRATED for substantive work" whereas the old router said "prefer GUIDED -- escalate only when scope clearly exceeds main-session capacity." This is an intentional design shift (classification conservatism changed direction), but the CLAUDE.md still describes the depth tiers using the old framing. If this shift was intentional, CLAUDE.md ambient description should be updated to match.

- **`devflow:test-driven-development` removed from ORCHESTRATED DEBUG row** - `shared/skills/router/SKILL.md:31` (Confidence: 60%) -- The old router loaded `devflow:debug:orch, devflow:test-driven-development, devflow:software-design` for ORCHESTRATED DEBUG. The new lean router loads only `devflow:debug:orch`. TDD and software-design skills for debugging are now delegated to the debug:orch skill itself. This is architecturally cleaner (orchestration skills own their dependencies) but shifts the TDD enforcement contract from the router to the orchestration skill.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 1 | 1 |

**Architecture Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The three-layer architecture refactoring (SessionStart classification rules, lean preamble, on-demand router) is a strong architectural improvement. It cleanly separates concerns: deterministic classification rules injected once per session, a minimal per-message preamble that triggers classification, and a lean lookup-table router loaded only when needed. The `Task` -> `Agent` rename is consistent across all skill and command bodies. The `filterHookEntries` generalization from hardcoded `UserPromptSubmit` to a parameterized `eventName` is a clean DIP-compliant refactoring. The `pipeline:orch` change from user gates to auto-proceed is consistent with its new Iron Law. The one blocking issue (stale `Task` in `allowed-tools` frontmatter) is a straightforward fix across 7 files.
