# Regression Review Report

**Branch**: feat/223-review-pipeline-convergence-detection -> main
**Date**: 2026-05-21_1458

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **review:orch lacks `--full` bypass documentation** - `shared/skills/review:orch/SKILL.md:61-87` (Confidence: 70%) — The command files (`code-review.md`, `code-review-teams.md`) document a `--full` bypass that skips Step 0d-ii entirely while still loading PRIOR_RESOLUTIONS for cross-cycle awareness. The `review:orch` Phase 2b does not document any `--full` bypass, which is intentional (ambient mode has no CLI flags), but the absence of an explicit note saying "no --full bypass here because ambient mode" could lead a future editor to add one for parity, breaking the ambient hard-stop design. Consider adding a brief comment.

- **Cross-cutting consistency test uses broad regex for cycle bound** - `tests/review/convergence-detection.test.ts:272-274` (Confidence: 65%) — The test for "maximum cycle bound documented in all orchestration surfaces" checks for `CYCLE_NUMBER >= 3` but the actual convergence warning threshold is `CYCLE_NUMBER >= 3` while the hard stop is `CYCLE_NUMBER > MAX_REVIEW_CYCLES (10)`. The test name says "maximum cycle bound" but validates the soft threshold (>=3), not the hard maximum (10). This could give false confidence about hard-stop parity.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 9
**Recommendation**: APPROVED

## Detailed Analysis

### 1. Lost Functionality Check

No exports, CLI options, API endpoints, or event handlers were removed. The changes are purely additive.

The helper refactoring (`tests/decisions/helpers.ts` -> `tests/helpers.ts`) preserves backward compatibility via re-export:

```typescript
// tests/decisions/helpers.ts (now)
export { ROOT, loadFile, extractSection } from '../helpers'
```

All existing consumers (`tests/decisions/command-adoption.test.ts`, `tests/resolve/decisions-citation.test.ts`, `tests/decisions/helpers.test.ts`) continue to import from the same path and function signatures are unchanged. The `ROOT` path resolution (`path.resolve(import.meta.dirname, '..')` from `tests/`) resolves to the same project root as the original (`path.resolve(import.meta.dirname, '../..')` from `tests/decisions/`). Verified: all 76 existing tests pass (48 new + 28 existing decisions-citation tests).

### 2. Broken Behavior Check

**Return types unchanged**: No function signatures were modified — the changes add new inputs (`PRIOR_RESOLUTIONS`, `CYCLE_NUMBER`) to agent and skill prompts, which are plain markdown template parameters, not programmatic APIs.

**Default values preserved**: All new inputs default to `(none)`, maintaining backward compatibility when prior resolutions are absent (first review cycle). The convergence gate is gated on `CYCLE_NUMBER >= 3`, meaning the first two cycles behave identically to pre-change behavior.

**Side effects preserved**: The review pipeline still writes to the same disk paths, still creates `.last-review-head`, still spawns the same reviewer agents. The convergence check is an additive gate inserted between incremental detection and reviewer spawning.

**Error handling preserved**: Parse failures gracefully degrade to `fp_ratio = 0` with a warning note, preserving forward progress. Read failures in the new self-verification step retain the finding at original confidence.

### 3. Intent vs Reality Check

**Commit messages vs code**: All 6 commits align with their stated purposes:
- `refactor(tests)`: moves helpers to shared location and wires PRIOR_RESOLUTIONS to Synthesizer — code matches
- `fix(review)`: aligns verb and edge case table across variants — verified consistent
- `docs(review)`: fixes edge case table wording and adds decision table — present in both command files
- `fix(review-orch)`: aligns Phase 2b with command-file convergence logic — verified consistent
- `refactor`: simplifies reviewer trust labeling and fixes Phase 2b checklist wording — checklist item present

**PR description vs implementation**: The PR states four goals:
1. Convergence gate (Step 0d / Phase 2b) -- present in all 3 orchestration surfaces
2. PRIOR_RESOLUTIONS fed back to reviewers -- present with containment markers in all 3 surfaces
3. Reviewer self-verification step -- present in reviewer.md step 9
4. Containment marker consistency -- verified: `<prior-resolution-summary>` tags used consistently

### 4. Incomplete Migration Check

**Cross-surface parity**: The convergence logic is implemented consistently across all three orchestration surfaces:

| Feature | code-review.md | code-review-teams.md | review:orch |
|---------|---------------|---------------------|-------------|
| Step 0d-i / Phase 2b load | Yes | Yes | Yes |
| Step 0d-ii / convergence warning | Yes | Yes | Yes |
| fp_ratio formula | Consistent | Consistent | Consistent |
| MAX_REVIEW_CYCLES = 10 | Yes | Yes | Yes |
| `--full` bypass | Yes | Yes | N/A (ambient) |
| PRIOR_RESOLUTIONS to reviewers | Yes | Yes | Yes |
| Containment markers | Yes | Yes | Yes |
| CYCLE_NUMBER to Synthesizer | Yes | Yes | Yes |
| Cross-reference NOTE | Yes | Yes | Yes |

**Edge case table parity**: Both command files have identical new edge case rows (5 new entries each).

**reviewer.md**: New `Cross-Cycle Awareness` section properly documents parse failure fallback and verification-against-current-code requirement.

**synthesizer.md**: New `Convergence Status` section in review mode output template, with conditional note for high FP ratio.

**Test coverage**: 48 tests across 6 groups (reviewer.md inputs, code-review.md gate, code-review-teams.md parity, review:orch phase, synthesizer.md status, cross-cutting consistency) verify structural parity.

### 5. Decisions Relevance

Scanned DECISIONS_CONTEXT (ADR-001 through ADR-003, PF-001 through PF-004). Read full bodies of all entries.

- **ADR-001** (clean break philosophy): Not triggered — this PR adds new convergence features, no migration/compat code.
- **PF-003** (post-migration hook path divergence): Not triggered — no path refactoring in this PR.
- **PF-004** (migration idempotency): Only change to pitfalls.md is adding PF-004 itself (a new observation from the decisions agent). No migration code involved.

No decisions or pitfalls are directly applicable to the regression analysis of this PR.
