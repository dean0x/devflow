# Testing Review Report

**Branch**: feat-223-review-pipeline-convergence-detection -> main
**Date**: 2026-05-20

## Issues in Your Changes (BLOCKING)

### HIGH

**Tests are purely structural (content-presence) with no behavioral or logic coverage** - `tests/review/convergence-detection.test.ts:1-269`
**Confidence**: 85%
- Problem: All 39 tests verify that specific strings exist in markdown instruction files (e.g., `expect(content).toContain('PRIOR_RESOLUTIONS')`). This is the right approach for markdown specification contracts, and this project consistently uses structural tests for instruction files (see `tests/resolve/decisions-citation.test.ts`, `tests/decisions/apply-decisions-skill.test.ts`). However, the convergence feature introduces a non-trivial formula (`fp_count / (fp_count + fixed_count + deferred_count)`) and a threshold-based branch (`CYCLE_NUMBER >= 3 && FP ratio > 70%`). These are testable logic that currently exists only as prose in markdown. If the formula is ever extracted to a helper (as the `filterDecisionsContext` function was for decisions), there would be zero unit tests ready for it.
- Fix: This is not blocking because the logic currently lives in markdown instructions (not executable code). But if/when fp_ratio computation or convergence gating is extracted into a module (like `scripts/hooks/lib/decisions-index.cjs` was for decisions), add unit tests covering:
  - `fp_ratio` formula: `fp_count=0` yields 0, `fp_count=total` yields 1.0, denominator zero returns 0
  - Cycle threshold: `CYCLE_NUMBER < 3` skips FP warning, `>= 3 && ratio > 0.7` triggers it
  - The `--full` bypass behavior

### MEDIUM

**No negative/error-path structural tests** - `tests/review/convergence-detection.test.ts:1-269`
**Confidence**: 82%
- Problem: The test suite verifies the "happy path" — that all convergence elements are present and ordered correctly. But it does not test any guard/fallback behavior documented in the markdown. For example, `reviewer.md` line 110 says "If PRIOR_RESOLUTIONS cannot be parsed: proceed without cross-cycle awareness, note in report." The `extractSection` helper throws on missing anchors, but no test verifies that the fallback-on-parse-failure instruction is actually documented. Similarly, there is no test that the `(none)` sentinel triggers the skip path in Cross-Cycle Awareness.
- Fix: Add 2-3 structural tests:
  ```typescript
  it('documents fallback when PRIOR_RESOLUTIONS cannot be parsed', () => {
    const crossCycle = extractSection(reviewer, '## Cross-Cycle Awareness', '## Issue Categories')
    expect(crossCycle).toMatch(/cannot be parsed.*proceed without/i)
  })

  it('documents verify-against-current-code guard', () => {
    const crossCycle = extractSection(reviewer, '## Cross-Cycle Awareness', '## Issue Categories')
    expect(crossCycle).toMatch(/verify.*current code/i)
  })
  ```

**Redundant assertions across Group 2/3 and Group 6 (cross-cutting)** - `tests/review/convergence-detection.test.ts:51-268`
**Confidence**: 80%
- Problem: Group 6 ("Cross-cutting convergence consistency") intentionally re-tests properties already covered by per-file groups (Groups 2-5). For example, Group 2 test at line 87-91 checks `PRIOR_RESOLUTIONS` and `prior-resolution-summary` in `code-review.md`, and Group 6 at lines 223-233 checks the same assertions across all three surfaces including `code-review.md`. This means a failure in `code-review.md` would show up in both Group 2 and Group 6 — the cross-cutting group is the semantically correct place for consistency checks, but the per-file duplicates add noise. This is a minor structural concern, not a correctness issue.
- Fix: Consider removing the per-file `PRIOR_RESOLUTIONS` presence checks from Groups 2/3 and keeping only the Group 6 cross-cutting consistency assertions. Alternatively, keep both for defense-in-depth but document the intentional overlap in a comment.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`extractSection` helper has no test coverage of its own** - `tests/decisions/helpers.ts:15-22`
**Confidence**: 82%
- Problem: The `extractSection` helper is imported by multiple test files (decisions tests, resolve tests, and now convergence tests). It performs non-trivial logic — `indexOf` with chained slicing and explicit throw on missing anchors. Yet it has no dedicated unit tests. Any bug in this shared helper would cause false passes/failures across many test suites. The helper was not introduced in this PR (it pre-exists), but convergence tests add a 7th test file that depends on it, increasing its blast radius.
- Fix: Add a small test file `tests/decisions/helpers.test.ts`:
  ```typescript
  import { describe, it, expect } from 'vitest'
  import { extractSection } from './helpers'

  describe('extractSection', () => {
    const doc = '## A\nfoo\n## B\nbar\n## C\nbaz'

    it('extracts between two anchors', () => {
      expect(extractSection(doc, '## B', '## C')).toBe('## B\nbar\n')
    })

    it('extracts to end when endAnchor is null', () => {
      expect(extractSection(doc, '## C', null)).toBe('## C\nbaz')
    })

    it('throws on missing start anchor', () => {
      expect(() => extractSection(doc, '## X', '## B')).toThrow('Anchor not found')
    })

    it('throws on missing end anchor', () => {
      expect(() => extractSection(doc, '## A', '## Z')).toThrow('End anchor not found')
    })
  })
  ```

## Pre-existing Issues (Not Blocking)

### LOW

**File-level `const content = loadFile(...)` outside `describe` blocks may cause confusing errors** - `tests/review/convergence-detection.test.ts:9,52,104,145,187,217-221`
**Confidence**: 80%
- Problem: Each `describe` block loads its target file at the top level of the block scope (e.g., `const content = loadFile('shared/agents/reviewer.md')` at line 9). This is a pattern consistent with other test files in the project (e.g., `tests/decisions/apply-decisions-skill.test.ts`). However, `loadFile` performs synchronous I/O via `readFileSync` and will throw `ENOENT` at test-discovery time if any file is missing or renamed. Unlike `beforeEach`-based loading, this gives a stack trace pointing at module evaluation rather than a specific test case. Since this matches the project's established pattern, it is not actionable — just documenting the tradeoff.

## Suggestions (Lower Confidence)

- **Missing test for `reviewer.md` self-verification downgrade-to-Suggestions behavior** - `tests/review/convergence-detection.test.ts:27-35` (Confidence: 72%) -- Tests verify self-verification exists and mentions MEDIUM, but do not check the documented downgrade path ("downgrade to Suggestions or drop").

- **No test for convergence gate's FP ratio threshold value (0.5 / 50%)** - `tests/review/convergence-detection.test.ts:72-74` (Confidence: 65%) -- Tests verify the formula shape but not the documented threshold at which convergence triggers early termination. If the threshold is documented as a specific number in the orchestration surfaces, a structural test could pin it.

- **Group 5 tests could verify synthesizer handles `CYCLE_NUMBER >= 3` independently from `FP ratio > 70%`** - `tests/review/convergence-detection.test.ts:254-256` (Confidence: 64%) -- The test checks that `CYCLE_NUMBER >= 3` exists in synthesizer.md, but the two conditions (cycle count and FP ratio) are documented as a conjunction. No test verifies the conjunction shape.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 1 |

**Testing Score**: 6/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The test suite correctly validates the convergence detection feature's structural contracts across 5 files and 6 groups, with a strong cross-cutting consistency group (Group 6) that catches drift between the three orchestration surfaces. Tests follow the project's established pattern for markdown specification testing. The conditions for approval are: (1) add 2-3 negative/guard-path structural tests for the Cross-Cycle Awareness fallback behavior documented in reviewer.md, and (2) when fp_ratio computation is eventually extracted to executable code, backfill unit tests for the formula and thresholds.
