# Consistency Review Report

**Branch**: feat/223-review-pipeline-convergence-detection -> main
**Date**: 2026-05-20_1914

## Issues in Your Changes (BLOCKING)

### HIGH

**Cross-Cycle Awareness verb inconsistency between command files** - `plugins/devflow-code-review/commands/code-review-teams.md:209`
**Confidence**: 92%
- Problem: The reviewer prompt template in `code-review-teams.md` says "check Cross-Cycle Awareness in reviewer.md" while the same prompt in `code-review.md:209` says "follow Cross-Cycle Awareness in reviewer.md" and `review:orch` (`shared/skills/review:orch/SKILL.md:147`) also uses "follow". The verb "check" is weaker than "follow" and could lead to agents treating the cross-cycle step as advisory rather than mandatory. This is a cross-surface inconsistency in a PR whose stated purpose is aligning convergence detection wording across all 3 surfaces.
- Fix: In `code-review-teams.md:209`, change "check" to "follow":
  ```
  If PRIOR_RESOLUTIONS is not (none), follow Cross-Cycle Awareness in reviewer.md.
  ```

**Edge case table contradicts Step 0d-ii body on parsing failure handling (2 occurrences)** -- Confidence: 90%
- `plugins/devflow-code-review/commands/code-review.md:311`, `plugins/devflow-code-review/commands/code-review-teams.md:414`
- Problem: The edge case table row says "Parsing failure on resolution-summary.md | Treat as first cycle, proceed normally" but Step 0d-ii (line 113 in both files) says "If parsing fails: fp_ratio = 0, skip warning; note in output: 'Warning: Could not parse Statistics table from prior resolution. FP ratio unavailable -- convergence tracking degraded.'" These are different behaviors: "treat as first cycle" implies resetting CYCLE_NUMBER to 1, while the step body preserves CYCLE_NUMBER and only zeroes fp_ratio. The edge case table was not updated to match the refined Step 0d-ii wording.
- Fix: Update the edge case table row in both files to match the step body:
  ```
  | Parsing failure on resolution-summary.md | fp_ratio = 0, convergence tracking degraded (see Step 0d-ii) |
  ```

### MEDIUM

**Phase 1 table column header inconsistency** - `plugins/devflow-code-review/commands/code-review-teams.md:130`
**Confidence**: 85%
- Problem: `code-review.md:130` uses "Adds Review" as the column header while `code-review-teams.md:130` uses "Adds Perspective". These describe the same table in functionally parallel files. While "Perspective" suits the teams/debate model, consistent naming across mirrored files reduces cognitive load.
- Fix: Align both files to the same column header. "Adds Perspective" is arguably more accurate for the teams variant but "Adds Review" matches the non-teams variant. Either is fine as long as both match, or the difference is intentional and documented.

**Degraded-parse warning absent from review:orch** - `shared/skills/review:orch/SKILL.md:74`
**Confidence**: 82%
- Problem: Both command files now document a user-facing warning message when parsing fails: "Warning: Could not parse Statistics table from prior resolution. FP ratio unavailable -- convergence tracking degraded." However, `review:orch` Phase 2b (line 74) simply says "If denominator=0 or parsing fails: fp_ratio=0" without the degraded warning note. Since review:orch is a lightweight variant, omitting verbose warnings is arguably intentional, but the PR commit message ("align convergence detection wording across all 3 orchestration surfaces") suggests all surfaces should exhibit the same behavior.
- Fix: Add the degraded-parse warning to review:orch Phase 2b step 5:
  ```
  5. Parse Statistics table: fp_ratio = fp_count / (fp_count + fixed_count + deferred_count)
     If denominator=0: fp_ratio=0
     If parsing fails: fp_ratio=0; note in output: "Warning: Could not parse Statistics table from prior resolution. FP ratio unavailable -- convergence tracking degraded."
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**review:orch lacks a cross-reference NOTE to command files** - `shared/skills/review:orch/SKILL.md:82`
**Confidence**: 82%
- Problem: Both command files now have a NOTE line cross-referencing their mirror and the parity test (e.g., `code-review.md:121` says "NOTE: Convergence logic mirrored in code-review-teams.md -- parity enforced by tests/..."). However, `review:orch` is a third surface with the same convergence logic and lacks any cross-reference. The parity tests (Group 6) do cover `review:orch`, so the test guard exists, but the in-file note that helps human readers is missing.
- Fix: Add a NOTE after step 8 in Phase 2b:
  ```
  NOTE: Convergence logic also present in code-review.md and code-review-teams.md -- parity enforced by tests/review/convergence-detection.test.ts (Group 6: Cross-cutting consistency).
  ```

**Synthesizer receives PRIOR_RESOLUTIONS in its Input contract but no orchestration surface passes it** - `shared/agents/synthesizer.md:23`
**Confidence**: 80%
- Problem: The synthesizer agent now declares `PRIOR_RESOLUTIONS` as an optional input (line 23) and references it in the review process (step 5, line 243: "cross-reference findings against PRIOR_RESOLUTIONS to note recurring vs new issues"). However, none of the three orchestration surfaces (`code-review.md:238-247`, `code-review-teams.md:301-304`, `review:orch:156`) pass `PRIOR_RESOLUTIONS` to the Synthesizer invocation. They only pass `CYCLE_NUMBER`. This means the synthesizer's cross-referencing step will always see PRIOR_RESOLUTIONS as absent, making the new input declaration dead code.
- Fix: Either pass `PRIOR_RESOLUTIONS` in the Synthesizer agent invocations across all three surfaces, or remove the PRIOR_RESOLUTIONS input from synthesizer.md if the cross-referencing is fully handled by reviewers. The reviewer already handles cross-cycle awareness, so having the synthesizer also cross-reference may be intentionally deferred. If deferred, add a comment to synthesizer.md noting that callers do not yet pass this field.

## Pre-existing Issues (Not Blocking)

(No CRITICAL pre-existing issues found.)

## Suggestions (Lower Confidence)

- **Convergence warning message wording inconsistency** - `shared/skills/review:orch/SKILL.md:80` vs `plugins/devflow-code-review/commands/code-review.md:116` (Confidence: 70%) -- review:orch says "in prior cycle ({N-1})" while command files say "in cycle {N-1}" (no "prior" qualifier). Minor wording drift.

- **Edge case table missing MAX_REVIEW_CYCLES row** - `plugins/devflow-code-review/commands/code-review.md:293` (Confidence: 65%) -- The edge case table documents convergence scenarios (FP ratio, --full bypass, first review) but does not document the new MAX_REVIEW_CYCLES=10 hard-stop behavior. This is a new edge case added in this PR that should appear in the table for completeness.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED
