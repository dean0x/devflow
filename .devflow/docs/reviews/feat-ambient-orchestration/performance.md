# Performance Review Report

**Branch**: feat/ambient-orchestration -> main
**Date**: 2026-03-19 (re-review after 15849ce)
**PR**: #149

---

## Issues in Your Changes (BLOCKING)

### CRITICAL

No critical performance issues found.

### HIGH

**H1: Hook preamble grew 3x and is injected on every prompt -- undermines QUICK zero-overhead promise** - `scripts/hooks/ambient-prompt:34-51`
- Problem: The `PREAMBLE` string injected via the `UserPromptSubmit` hook grew from ~4 lines / ~40 words (on main) to ~18 lines / ~150 words on this branch. This preamble is injected as `additionalContext` on **every qualifying user prompt** (any prompt >= 2 words that is not a slash command). The majority of prompts in a typical session are QUICK-classified (chat, git ops, exploration), yet every one pays the cost of processing ~150 words of classification instructions that are immediately irrelevant. The preamble now contains full scope-based criteria, GUIDED instructions, ORCHESTRATED instructions, and conservatism rules -- all duplicating content already present in the `ambient-router` SKILL.md that is loaded in session context.
- Impact: Over a 50-prompt session (typical for a focused development block), ~7,500 input tokens are consumed by preamble injection alone. This adds latency to every prompt (LLM must process the preamble before responding) and cumulative cost. The design explicitly promises "QUICK: Zero overhead" but the hook preamble contradicts this -- QUICK prompts still receive the full classification preamble.
- Fix: Reduce the preamble to a minimal trigger that references the ambient-router skill already in context:
  ```bash
  PREAMBLE="AMBIENT MODE ACTIVE: Classify this prompt using the ambient-router skill in your session context.
  Default to QUICK. Only state classification for GUIDED/ORCHESTRATED."
  ```
  This cuts injection from ~150 words to ~25 words per prompt (~83% reduction). The full classification logic (intent tables, scope criteria, skill matrices) lives in the `ambient-router` SKILL.md which is already loaded.

**H2: IMPLEMENT pipeline has no agent budget cap -- asymmetry with DEBUG pipeline** - `shared/skills/implementation-orchestration/SKILL.md:66-76`
- Problem: The `debug-orchestration` skill correctly defines an explicit agent budget (hard cap of 8 Explore agents, with per-phase allocation). The `implementation-orchestration` skill has no equivalent budget. Its pipeline is: Coder -> Validator (retry 2x) -> Simplifier -> Scrutinizer -> Validator (re-validate) -> Shepherd (retry 2x). In the worst case (both Validator and Shepherd exhaust retries), this becomes: Coder + Validator + Coder-fix + Validator + Coder-fix + Validator + Simplifier + Scrutinizer + Validator + Shepherd + Shepherd + Shepherd = **12 agent invocations** for a single ambient prompt. The Iron Law states "there is no shortcut" which by design prohibits any fast-path.
- Impact: A single ORCHESTRATED/IMPLEMENT prompt can consume 300K-600K tokens and take 5-15 minutes. The debug pipeline with its 8-agent cap shows this was a recognized concern -- the implementation pipeline lacks the same discipline.
- Fix: Add an explicit agent budget to `implementation-orchestration/SKILL.md`:
  ```markdown
  ## Agent Budget

  Hard cap: **8 total agent spawns** across all phases.

  | Phase | Allocation |
  |-------|-----------|
  | Phase 3 (Coder) | 1 (+ up to 1 retry = 2 max) |
  | Phase 5 (Quality Gates) | Up to 5 (Validator + Simplifier + Scrutinizer + re-Validate + Shepherd) |
  | Phase 5 (Retries) | Retries consume from remaining budget |

  If budget is exhausted before pipeline completion, halt and report what passed and what failed.
  ```

### MEDIUM

**M1: Sequential quality gates run unconditionally with no scope-proportional fast-path** - `shared/skills/implementation-orchestration/SKILL.md:66-76`
- Problem: Once ORCHESTRATED/IMPLEMENT is triggered, the full 5-gate quality pipeline runs regardless of the actual scope of changes. A 3-file refactoring that modifies type signatures gets the same treatment as a 20-file architectural overhaul. There is no early-exit when Validator passes on first attempt and FILES_CHANGED is small.
- Impact: ~100K-200K tokens of quality gate overhead for straightforward changes. The classification conservatism ("prefer GUIDED over ORCHESTRATED") helps mitigate this, but when ORCHESTRATED is correctly triggered for a moderately-scoped task, the pipeline is still maximally expensive.
- Fix: Add a fast-path after Phase 4 (FILES_CHANGED detection):
  ```markdown
  **Fast path**: If FILES_CHANGED <= 3 AND Validator passes first try with zero failures:
  - Run Simplifier + Shepherd only (skip Scrutinizer + re-Validate)
  - Full pipeline for FILES_CHANGED > 3 or any Validator failure
  ```

**M2: Skill loading across ORCHESTRATED invocations has no session-level caching** - `shared/skills/ambient-router/SKILL.md:88-96`
- Problem: Step 4 states "BLOCKING REQUIREMENT: Invoke each selected skill using the Skill tool before proceeding." The edge case table (line 140) says "Multiple triggers per session: Each runs independently." This means if a user triggers 3 ORCHESTRATED/IMPLEMENT prompts in a session, skills like `implementation-orchestration` and `implementation-patterns` are loaded 3 times via the Skill tool. Each invocation reads and injects the full SKILL.md into context.
- Impact: Redundant context injection for skills already present in the session window. For 3 invocations with 2-3 skills each, this is 6-9 unnecessary Skill tool calls and ~3,000-6,000 tokens of redundant content.
- Fix: Add to Step 4: "If a skill was invoked earlier in this session and context compaction has not occurred since, skip re-invocation."

## Issues in Code You Touched (Should Fix)

### MEDIUM

**SF1: No mechanical backstop for classification conservatism** - `scripts/hooks/ambient-prompt:38-40`, `shared/skills/ambient-router/SKILL.md:58`
- Problem: Both the hook preamble and the ambient-router skill emphasize "default to QUICK" and "Classification conservatism: default to QUICK." However, this relies entirely on the LLM following instructions. There is no shell-level filtering for prompts that are obviously QUICK (e.g., "yes", "ok do it", "what about X?"). The current heuristic -- skip only single-word prompts and slash commands -- is a good start but leaves a gap: 2-4 word prompts that are clearly not implementation tasks ("sounds good, proceed", "ok let's do it", "what do you think?") still receive the full preamble.
- Impact: The false-positive cost of ORCHESTRATED is explicitly acknowledged as expensive ("5-6 agent spawns"). A mechanical pre-filter in the hook would catch the most obvious non-task prompts before the LLM even sees the classification instructions.
- Fix: Raise the word-count threshold for the skip filter from 2 to 4 words, or add signal-word detection:
  ```bash
  # Skip short prompts without task signal words (< 5 words, no signals)
  if [ "$WORD_COUNT" -lt 5 ]; then
    HAS_SIGNAL=$(echo "$PROMPT" | grep -ciE '\b(add|create|implement|build|write|make|fix|bug|broken|failing|error|design|architecture|refactor|debug|review|check)\b' || true)
    if [ "$HAS_SIGNAL" -eq 0 ]; then
      exit 0  # Skip preamble entirely for obvious non-task prompts
    fi
  fi
  ```

### LOW

**SF2: Triple JSON parse in ambient.ts enable/status paths** - `src/cli/commands/ambient.ts:33-103`
- Problem: `addAmbientHook` parses settings JSON, then internally calls `hasAmbientHook` which parses it again. The enable path also parses settings a third time to resolve `devflowDir` (line 149). The status path parses twice (once in `hasAmbientHook`, once for devflowDir).
- Impact: Negligible for a CLI command that runs once interactively. Settings files are tiny. This is a code smell, not a production concern.
- Fix: No change needed for this PR. If refactored later, pass parsed object instead of re-parsing the JSON string.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**PE1: Coder agent loads domain skills by reading SKILL.md files dynamically** - `shared/agents/coder.md` (not modified in this diff, but the agent is now invoked by the new ORCHESTRATED pipeline)
- Problem: The Coder agent reads up to 4-5 SKILL.md files dynamically based on DOMAIN hint. Pre-existing behavior, but newly relevant because the ORCHESTRATED/IMPLEMENT pipeline spawns Coder automatically.
- Impact: Each SKILL.md read adds latency to Coder startup within the ORCHESTRATED pipeline. For `fullstack` domain, this is 5+ sequential file reads.

### LOW

**PE2: `getAllSkillNames()` and `getAllAgentNames()` iterate all plugins on every call** - `src/cli/plugins.ts:208-229`
- Problem: These functions create a new Set and iterate all 17 plugins each time. Pre-existing.
- Impact: Negligible -- runs once during `devflow init`.

---

## Progress Since Previous Review

The previous performance review identified 2 HIGH, 3 MEDIUM blocking issues and 1 MEDIUM should-fix. Status:

| Previous Issue | Status | Notes |
|----------------|--------|-------|
| H1 (no light pipeline for IMPLEMENT) | **Open** | No scope gate added. Reissued as M1 (downgraded -- classification conservatism mitigates) |
| H2 (unbounded debug agent budget) | **Fixed** | Agent budget section added with 8-agent hard cap in `debug-orchestration/SKILL.md:34-42` |
| M1 (no skill caching) | **Open** | Reissued as M2 |
| M2 (preamble on every prompt) | **Worse** | Preamble grew from ~9 lines to ~18 lines. Elevated to H1 |
| M3 (7 agents bundled) | **Acknowledged** | Design trade-off, no action needed |
| SF1 (no mechanical enforcement) | **Open** | Reissued as SF1 |

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | - | 0 | 1 | 1 |
| Pre-existing | - | - | 1 | 1 |

**Performance Score**: 7/10

The branch introduces a well-structured three-tier ambient system with good design principles (classification conservatism, GUIDED-preferred defaults). The debug pipeline's agent budget cap (added in `15849ce`) shows proper performance awareness. However, two HIGH issues remain:

1. **H1**: The hook preamble is 3x larger than before and is injected on every prompt, contradicting the "zero overhead for QUICK" design principle. This is the highest-impact issue because it affects 100% of ambient-mode prompts, not just the rare ORCHESTRATED ones.

2. **H2**: The implementation pipeline lacks the agent budget cap that was correctly applied to the debug pipeline, creating asymmetric cost exposure.

The QUICK path is genuinely zero-overhead *after* the preamble is processed, and the classification conservatism provides a soft guardrail against expensive ORCHESTRATED invocations. The main performance risk is the preamble bloat (H1) which compounds across every prompt in a session.

**Recommendation**: CHANGES_REQUESTED

Address H1 (trim the preamble to a minimal trigger) and H2 (add agent budget to implementation-orchestration) before merge. The remaining MEDIUM issues are recommended improvements that can follow in a separate commit.
