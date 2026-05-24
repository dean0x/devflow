# Testing Review Report

**Branch**: feat/223-review-pipeline-convergence-detection -> main
**Date**: 2026-05-21_1458

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**No negative/error-path tests for convergence edge cases** - `tests/review/convergence-detection.test.ts`
**Confidence**: 85%
- Problem: The convergence-detection test suite (292 lines, 37 tests) is entirely structural -- it verifies that specific strings and anchors exist in the markdown source files. This is a valid and useful testing strategy for contract enforcement across surfaces, but there are no tests for the actual behavioral edge cases documented in the Step 0d-ii decision table: denominator=0 yields fp_ratio=0, parsing failure yields fp_ratio=0 with a degraded note, `--full` bypasses convergence warning. These are the error-handling fallback paths most likely to cause regressions. The PR description specifically highlights "Error handling fallbacks" as a reviewer focus area, yet those fallbacks are only documented in markdown -- never exercised by a test.
- Fix: Since the convergence logic lives in orchestration markdown (not executable code), the structural tests are appropriate for pinning the documentation contract. However, the `fp_ratio` formula and the decision table paths are mechanical enough to test with a small pure function extracted from the markdown specification. Consider adding a `computeFpRatio(fp: number, fixed: number, deferred: number): number` utility and testing: `computeFpRatio(7, 1, 2) === 0.7`, `computeFpRatio(0, 0, 0) === 0` (denominator=0), `computeFpRatio(NaN, 1, 2) === 0` (parse failure). If extracting a utility is out of scope, add structural tests that verify the decision table text itself is present (e.g., assert the exact rows exist).

### MEDIUM

**`extractSection` helper tests moved but not extended for new usage patterns** - `tests/decisions/helpers.test.ts`, `tests/helpers.ts`
**Confidence**: 82%
- Problem: The `extractSection` helper was lifted to `tests/helpers.ts` and the convergence tests depend heavily on it for section boundary extraction (16 calls across the file). The helper test suite (7 tests) covers basic extraction, null endAnchor, missing anchors, and duplicate start anchors. However, the convergence tests use section boundaries like `('Step 0d-i', 'Step 0d-ii')` and `('## Phase 2b', '## Phase 3')` -- these are substring anchors within lines, not full-line headings. The existing helper tests only test full-line heading anchors (`## Section A`). If a markdown heading includes extra text after the anchor substring, `extractSection` would still match (correct behavior via `indexOf`), but this is not explicitly validated by tests.
- Fix: Add one test case to `tests/decisions/helpers.test.ts` with inline/substring anchors matching the actual convergence test usage pattern:
  ```typescript
  it('matches substring anchors within longer lines', () => {
    const content = '#### Step 0d-i: Load Prior\nstep content\n#### Step 0d-ii: Convergence\nmore'
    const result = extractSection(content, 'Step 0d-i', 'Step 0d-ii')
    expect(result).toContain('step content')
    expect(result).not.toContain('more')
  })
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Cross-cutting consistency tests assert presence but not equivalence** - `tests/review/convergence-detection.test.ts:239-291`
**Confidence**: 83%
- Problem: Group 6 ("Cross-cutting convergence consistency") correctly validates that all 3 orchestration surfaces contain `PRIOR_RESOLUTIONS`, containment markers, `(none)` defaults, and the FP ratio formula. This is good contract testing. However, the FP ratio consistency test (line 264-268) verifies each surface matches the same regex, but does not verify the surfaces are consistent with each other in the decision table paths (what happens when denominator=0, what happens on parse failure). The `maximum cycle bound` test (line 271-275) and `--full bypass` test (line 286-291) also only check presence, not cross-surface equivalence of the exact handling. For example, code-review.md uses `AskUserQuestion` for the convergence warning while review:orch uses a non-interactive warning -- the tests do not verify this intentional divergence is preserved.
- Fix: Add a comment in the test file documenting that cross-surface equivalence of error-handling paths is intentionally not tested because the surfaces have different interaction models (interactive vs ambient). Alternatively, add a test that explicitly asserts the divergence:
  ```typescript
  it('review:orch uses non-interactive warning (ambient mode)', () => {
    expect(reviewOrch).not.toContain('AskUserQuestion')
    expect(reviewOrch).toMatch(/non-interactive|ambient/)
  })
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**No tests for Synthesizer convergence output format** - `shared/agents/synthesizer.md`
**Confidence**: 80%
- Problem: The synthesizer test group (Group 5) validates that the review mode output template includes `## Convergence Status`, cycle number, FP ratio, and a conditional merge note. However, there are no tests that verify the synthesizer actually produces this output when given specific inputs -- the tests only verify the template text exists in the agent definition. The conditional logic at line 303 ("If CYCLE_NUMBER >= 3 and prior FP ratio > 70%: append...") is a behavioral rule embedded in prompt text, and the only validation is a structural check that the words exist.

## Suggestions (Lower Confidence)

- **Shared helper backward-compat shim could be a re-export barrel** - `tests/decisions/helpers.ts` (Confidence: 65%) -- The re-export shim works correctly, but adding a deprecation comment or `@deprecated` JSDoc tag would signal to future test authors that they should import from `../helpers` directly rather than through the decisions-scoped shim.

- **Test group comments could document the testing strategy** - `tests/review/convergence-detection.test.ts:1-6` (Confidence: 62%) -- Unlike `tests/resolve/decisions-citation.test.ts` which has a detailed header comment explaining strategy and test groups, the convergence test file has no header comment explaining why structural (markdown presence) testing was chosen over behavioral testing. A 3-line comment would help future contributors understand the design choice.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Testing Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The test suite is well-structured with a clear 6-group organization that maps 1:1 to the changed surfaces. The cross-cutting consistency tests (Group 6) are a strong pattern for enforcing parity across the three orchestration surfaces. The helper refactoring to a shared location is clean and backward-compatible. The main gap is the absence of behavioral tests for the convergence decision logic (fp_ratio computation, denominator=0, parse failure fallback), which are the highest-risk error paths in this feature. Since the logic is specified in markdown prompts rather than executable code, the structural tests provide reasonable coverage of the contract, but extracting and testing the fp_ratio computation as a pure function would significantly reduce regression risk.
