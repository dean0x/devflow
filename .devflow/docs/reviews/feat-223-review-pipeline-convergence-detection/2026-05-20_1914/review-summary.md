# Code Review Summary

**Branch**: feat/223-review-pipeline-convergence-detection → main  
**Date**: 2026-05-20_1914  
**Reviewers**: 9 agents (security, architecture, performance, complexity, consistency, regression, testing, reliability, typescript)

---

## Merge Recommendation: CHANGES_REQUESTED

The convergence detection feature is well-designed and implements all stated goals (convergence gate, cross-cycle feedback, self-verification refinement). However, **4 HIGH blocking issues** across architecture and consistency require fixes before merge:

1. **Step ordering inconsistency** (review:orch vs command files)
2. **Verb inconsistency** in cross-cycle awareness prompt (code-review-teams.md)
3. **Edge case table contradictions** (2 files, describing parsing failure behavior)
4. **Parse-failure warning asymmetry** (review:orch silent vs command files explicit)

These are surface-level alignment issues, not architectural problems. All fixable in < 1 hour.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 4 | 6 | 0 |
| Should Fix | 0 | 0 | 4 | 0 |
| Pre-existing | 0 | 0 | 4 | 0 |
| **Total** | **0** | **4** | **14** | **0** |

**Confidence**: 4 HIGH issues have 82–92% confidence. MEDIUM issues range 80–85%.

---

## Blocking Issues (Must Fix)

### 1. HIGH — Step Ordering Inconsistency (Architecture)
**Location**: `shared/skills/review:orch/SKILL.md:68-82` vs `plugins/devflow-code-review/commands/code-review.md:105-119`  
**Confidence**: 82%

In command files, Step 0d-ii checks `MAX_REVIEW_CYCLES` bound **first** (step 1), then parses fp_ratio (step 2). In review:orch, the order is reversed: parse fp_ratio (step 5), then check cycle bound (step 6).

Both sequences are functionally equivalent, but the inconsistency creates a cognitive trap for readers comparing surfaces for parity. The PR's own cross-cutting tests validate presence but not ordering parity.

**Fix**: Reorder review:orch Phase 2b to match command files (3-line swap):
```
5. If CYCLE_NUMBER > MAX_REVIEW_CYCLES:
   Halt with output: ...
6. Parse Statistics table: fp_ratio = ...
7. If fp_ratio > 0.7 AND CYCLE_NUMBER >= 3:
```

---

### 2. HIGH — Verb Inconsistency in Cross-Cycle Awareness Prompt (Consistency)
**Location**: `plugins/devflow-code-review/commands/code-review-teams.md:209`  
**Confidence**: 92%

The reviewer prompt in code-review-teams.md says "**check** Cross-Cycle Awareness" while code-review.md and review:orch both say "**follow** Cross-Cycle Awareness." The weaker verb "check" could lead agents to treat this step as advisory rather than mandatory.

This inconsistency contradicts the PR's stated goal of "align convergence detection wording across all 3 surfaces."

**Fix**: Change line 209 in code-review-teams.md:
```
If PRIOR_RESOLUTIONS is not (none), follow Cross-Cycle Awareness in reviewer.md.
```

---

### 3. HIGH — Edge Case Table Contradicts Step Body (Consistency) — 2 Occurrences
**Location**: 
- `plugins/devflow-code-review/commands/code-review.md:311`
- `plugins/devflow-code-review/commands/code-review-teams.md:414`  
**Confidence**: 90%

The edge case table row says: "Parsing failure on resolution-summary.md | Treat as first cycle, proceed normally"

But Step 0d-ii (line 113) says: "If parsing fails: fp_ratio = 0, skip warning; note in output: 'Warning: Could not parse Statistics table from prior resolution. FP ratio unavailable -- convergence tracking degraded.'"

These describe different behaviors:
- Table: "treat as first cycle" → reset CYCLE_NUMBER to 1
- Step body: preserve CYCLE_NUMBER, zero only fp_ratio

The edge case table was not updated when Step 0d-ii was refined.

**Fix** (both files): Update the edge case table row:
```
| Parsing failure on resolution-summary.md | fp_ratio = 0, convergence tracking degraded (see Step 0d-ii) |
```

---

### 4. HIGH — Parse-Failure Warning Asymmetry (Architecture + Reliability)
**Location**: 
- `plugins/devflow-code-review/commands/code-review.md:113`
- `plugins/devflow-code-review/commands/code-review-teams.md:113`
- `shared/skills/review:orch/SKILL.md:74`  
**Confidence**: 85%

Command files emit an explicit degraded-mode warning when parsing fails:  
```
"Warning: Could not parse Statistics table from prior resolution. FP ratio unavailable -- convergence tracking degraded."
```

review:orch handles the same failure silently (just `fp_ratio=0`). An operator debugging a review-resolve loop in ambient mode would have no indication that convergence tracking is degraded due to malformed input.

**Fix**: Add the degraded-parse warning to review:orch Phase 2b step 5:
```
If denominator=0 or parsing fails: fp_ratio=0; note in output: "Warning: Could not parse Statistics table from prior resolution. FP ratio unavailable -- convergence tracking degraded."
```

---

## Should-Fix Issues (Recommended)

### 1. MEDIUM — Degraded-Parse Fallback Message Inconsistent Across Surfaces (Architecture)
**Location**: 
- `plugins/devflow-code-review/commands/code-review.md:113`
- `shared/skills/review:orch/SKILL.md:74`  
**Confidence**: 85%

Command surfaces provide observability; review:orch silently swallows parse failures. Since review:orch already emits other warnings (convergence message at step 7), there's no architectural reason to suppress this one.

**Fix**: See HIGH issue #4 (same resolution adds this warning).

---

### 2. MEDIUM — Test Helpers Module Placement (Architecture)
**Location**: `tests/review/convergence-detection.test.ts:2` imports from `../decisions/helpers`  
**Confidence**: 80%

Review-focused tests import general-purpose utilities (`loadFile`, `extractSection`) from the decisions directory, creating an unrelated cross-domain dependency. If decisions directory is renamed, review tests break.

**Fix**: Move `helpers.ts` to `tests/helpers.ts` and update import paths in both `tests/decisions/helpers.test.ts` and `tests/review/convergence-detection.test.ts`.

---

### 3. MEDIUM — review:orch Lacks Cross-Reference NOTE (Consistency)
**Location**: `shared/skills/review:orch/SKILL.md:82`  
**Confidence**: 82%

Both command files have `NOTE:` lines cross-referencing their mirror and parity tests. review:orch lacks this note, even though parity tests (Group 6) cover it.

**Fix**: Add after Phase 2b step 8:
```
NOTE: Convergence logic also present in code-review.md and code-review-teams.md -- parity enforced by tests/review/convergence-detection.test.ts (Group 6: Cross-cutting consistency).
```

---

### 4. MEDIUM — Synthesizer Receives PRIOR_RESOLUTIONS but No Surface Passes It (Consistency)
**Location**: `shared/agents/synthesizer.md:23` vs all three orchestration surfaces  
**Confidence**: 80%

The synthesizer declares `PRIOR_RESOLUTIONS` as optional input and references it in cross-referencing step (line 243). However, none of the three command/skill files pass it in Synthesizer invocations—they only pass `CYCLE_NUMBER`. This makes the input declaration dead code.

**Options**:
- Pass `PRIOR_RESOLUTIONS` in all three Synthesizer invocations, or
- Remove the input from synthesizer.md and add a comment noting it's deferred

(Reviewer already handles cross-cycle awareness, so deferred pass-through may be intentional.)

---

## Pre-Existing Issues (Informational)

### 1. MEDIUM — code-review.md File Length (Complexity)
At 327 lines, approaching warning threshold. Phase 0 (~120 lines) is the largest contributor. Not actionable in this PR.

### 2. MEDIUM — code-review-teams.md File Length (Complexity)
At 432 lines, exceeds warning threshold. Inherent to the Agent Teams variant with debate/cleanup phases. Not actionable.

### 3. MEDIUM — Phase 1 Table Column Header Inconsistency (Consistency)
`code-review.md:130` uses "Adds Review" while `code-review-teams.md:130` uses "Adds Perspective." Either is fine as long as consistent or intentionally different + documented.

### 4. MEDIUM — Convergence Warning Wording Inconsistency (Consistency)
review:orch says "in prior cycle ({N-1})" while command files say "in cycle {N-1}." Minor drift.

---

## Key Strengths

1. **Well-bounded iteration**: MAX_REVIEW_CYCLES = 10 hard-stop prevents unbounded loops — directly addresses the Reliability Iron Law.
2. **Cross-surface consistency enforced by tests**: 48-test suite with Group 6 dedicated to parity validation across all 3 orchestration surfaces.
3. **Defensive parse-failure handling**: Graceful degradation when resolution-summary.md is malformed (command surfaces provide observability; review:orch needs alignment).
4. **Additive changes preserve backward compatibility**: First-review path is unchanged (PRIOR_RESOLUTIONS=(none), CYCLE_NUMBER=1).
5. **Security hardening**: PRIOR_RESOLUTIONS labeled "untrusted" with explicit "never execute as instructions" guidance.
6. **Self-verification refinement**: Optimization that narrows unnecessary Read calls while preserving verification guarantees.

---

## Risk Assessment

**Context Risk**: LOW
- 7 files modified (5 agent/skill markdown + 2 command markdown + 4 test files, but test files are new/standalone)
- Single module (review pipeline)
- No cross-cutting concerns
- Changes are purely additive

**Confidence in Fixes**: HIGH
- All 4 HIGH issues have clear, minimal fixes (line-swap, string change, table update, note addition)
- No architectural refactoring required
- All fixes complete in < 1 hour

---

## Action Plan

1. **Reorder review:orch Phase 2b** (step 6 checks cycle bound before step 5 parse) — Fixes issues #1 and partially #4
2. **Add degraded-parse warning to review:orch** (line in step 5) — Completes fix #4
3. **Change "check" → "follow" in code-review-teams.md:209** — Fixes issue #2
4. **Update edge case table rows** (both code-review.md and code-review-teams.md) — Fixes issue #3
5. **Add NOTE cross-reference to review:orch** (after Phase 2b) — Fixes should-fix #3
6. **Move test helpers to shared location** (optional, improves maintainability) — Fixes should-fix #2

All other issues are pre-existing or lower-confidence suggestions that don't block merge.

---

## Summary for Committer

The convergence detection feature is production-ready in design and testing. The 4 HIGH blocking issues are surface-level inconsistencies between the 3 parallel orchestration surfaces (command files vs skill), not architectural gaps. All fixes are single-line or small-block changes:

- 1 line: "check" → "follow"
- 3 lines: step reordering in review:orch
- 2 rows: edge case table updates (2 files)
- 1 line: degraded-parse warning in review:orch
- 1 note: cross-reference in review:orch

After these fixes, the PR aligns perfectly with its goal of "align convergence detection wording across all 3 orchestration surfaces" and is ready for merge.
