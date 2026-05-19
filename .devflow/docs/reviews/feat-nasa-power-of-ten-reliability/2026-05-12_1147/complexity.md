# Complexity Review Report

**Branch**: feat-nasa-power-of-ten-reliability -> main
**Date**: 2026-05-12_1147

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent core reviewer count across orchestration paths** - `shared/skills/review:orch/SKILL.md:106`, `plugins/devflow-code-review/commands/code-review.md:134`
**Confidence**: 92%
- Problem: `review:orch/SKILL.md` was updated to list 8 core reviewers (adding `reliability`), but the label on line 106 still reads "**7 core reviewers**". More critically, the `/code-review` command (`code-review.md:134`) was not updated at all — it still lists only 7 core reviewers and does not include `reliability` in its table. This creates two divergent orchestration paths: ambient review spawns 8 reviewers, `/code-review` spawns 7. The CLAUDE.md overview (`line 183`) also still reads "7-11 Reviewer agents".
- Fix: Three changes needed:
  1. `shared/skills/review:orch/SKILL.md:106`: Change `**7 core reviewers**` to `**8 core reviewers**`
  2. `plugins/devflow-code-review/commands/code-review.md`: Add `reliability` row to the core reviewer table and update "Always run 7 core reviews" to "Always run 8 core reviews"
  3. `CLAUDE.md:183`: Update "7-11 Reviewer agents" to "8-12 Reviewer agents"

### MEDIUM

**Content duplication between complexity and reliability skills** - `shared/skills/complexity/SKILL.md:112-135`
**Confidence**: 85%
- Problem: The newly added "Section 5: Reliability Patterns" in the complexity SKILL.md (lines 112-135) duplicates material that now has its own dedicated skill (`shared/skills/reliability/SKILL.md`). The bounded retry example and solution in complexity section 5 are nearly identical to reliability category 1. Both skills will be loaded by reviewer agents during code review — the complexity reviewer sees section 5, the reliability reviewer sees its entire SKILL.md. This duplication increases token cost for every review run (both skills are loaded into context) and creates a maintenance burden where changes to the canonical retry pattern must be applied in two places.
- Fix: Replace the full "Section 5: Reliability Patterns" in complexity/SKILL.md with a brief cross-reference:

  ```markdown
  ### 5. Reliability Patterns

  Operations that risk non-termination or resource exhaustion. See `devflow:reliability` for
  full coverage of bounded iteration, assertion density, allocation discipline, and indirection limits.
  Complexity-relevant: unbounded loops increase cyclomatic complexity and make termination reasoning harder.
  ```

  This keeps the complexity skill aware of the reliability dimension without duplicating the examples and patterns.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Reliability skill SKILL.md slightly over target line count** - `shared/skills/reliability/SKILL.md` (153 lines)
**Confidence**: 80%
- Problem: CLAUDE.md states "Target: ~120-150 lines per SKILL.md with progressive disclosure to `references/`". At 153 lines, this skill is slightly above the upper target. The references directory already exists with good progressive disclosure (patterns.md: 151 lines, violations.md: 125 lines, detection.md: 66 lines, sources.md: 27 lines). Most of the SKILL.md content is code examples which could be moved to references.
- Fix: Move the longer violation/solution code blocks for categories 3-5 (Allocation Discipline, Indirection Limits, Metaprogramming Restraint) from SKILL.md to the existing `references/violations.md` and `references/patterns.md`. Keep only a one-line violation description and solution hint in SKILL.md, referencing the extended examples. This would bring SKILL.md closer to ~120 lines.

## Pre-existing Issues (Not Blocking)

(No critical pre-existing issues found.)

## Suggestions (Lower Confidence)

- **Severity table overlap between complexity and reliability skills** - `shared/skills/complexity/SKILL.md:155-156`, `shared/skills/reliability/SKILL.md:146-153` (Confidence: 70%) — Both skills now define severity criteria for "unbounded loop on external I/O" (CRITICAL) and "retry with no max" (HIGH). If these thresholds ever diverge, reviewer agents would assign different severities to the same issue depending on which focus area catches it. Consider having complexity defer reliability-specific severity thresholds to the reliability skill.

- **Review:orch Phase 5 core reviewer count is prose, not computed** - `shared/skills/review:orch/SKILL.md:106` (Confidence: 65%) — The "7 core reviewers" / "8 core reviewers" label is a manually maintained prose string that must be updated each time a core reviewer is added. The actual reviewer list on line 107 is the authoritative source. Consider removing the count from the label or rephrasing to "Core reviewers (always):" to avoid future drift.

- **Detection patterns use grep -B which may not work in all contexts** - `shared/skills/reliability/references/detection.md:50-54` (Confidence: 62%) — The "Allocation in Hot Paths" detection patterns use `grep -B5` to find allocations near loops, but this approach checks lines *before* the allocation, not the surrounding loop context. An allocation inside a loop would have the loop *above* it, which `-B5` would catch, but the heuristic is fragile for deeply nested code.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Complexity Score**: 8/10
**Recommendation**: CHANGES_REQUESTED
