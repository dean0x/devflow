# Reliability Review Report

**Branch**: feat-223-review-pipeline-convergence-detection -> main
**Date**: 2026-05-20

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**No upper bound on CYCLE_NUMBER / directory scan** - `shared/skills/review:orch/SKILL.md:71`, `plugins/devflow-code-review/commands/code-review.md:102`, `plugins/devflow-code-review/commands/code-review-teams.md:102`
**Confidence**: 85%
- Problem: Phase 2b computes `CYCLE_NUMBER = count + 1` by counting all timestamped directories that contain `resolution-summary.md`. The convergence warning fires only at `CYCLE_NUMBER >= 3 AND fp_ratio > 0.7`, but there is no hard upper bound on cycle count. A long-lived branch with many review-resolve cycles (e.g., 20+) accumulates unbounded directories that must all be scanned each run. More critically, the convergence gate only warns -- it never halts. In `review:orch` (ambient mode), the system will continue issuing reviews indefinitely even at 100% false-positive rates because the warning says "Continue with review (do NOT halt)." In `/code-review`, the user can choose to stop, but there is no automatic escalation or circuit breaker at any cycle count.
- Fix: Add an explicit maximum cycle bound (e.g., `MAX_REVIEW_CYCLES = 10`). If `CYCLE_NUMBER > MAX_REVIEW_CYCLES`, halt with a message like "Review pipeline has run {N} cycles. Halting to prevent infinite review-resolve loop. Use --full to reset." This follows the Bounded Iteration principle from reliability patterns. At minimum, document this as an intentional design choice if unbounded cycling is desired. For the directory scan, cap the directory listing to the most recent N directories (e.g., 20) to prevent unbounded filesystem enumeration on branches with long review histories.

### MEDIUM

**Convergence gate parsing failure silently degrades to CYCLE_NUMBER=1** - `plugins/devflow-code-review/commands/code-review.md:107`, `plugins/devflow-code-review/commands/code-review-teams.md:107`
**Confidence**: 82%
- Problem: Step 0d-ii documents "If parsing fails: treat as CYCLE_NUMBER=1, skip warning." This means a malformed or structurally changed `resolution-summary.md` silently resets the convergence counter, losing awareness of how many review-resolve cycles have already occurred. This degrades the convergence gate -- if the resolution-summary format changes slightly, the pipeline will never trigger the convergence warning, even after dozens of cycles.
- Fix: When parsing fails, preserve the directory-count-based `CYCLE_NUMBER` (which does not depend on parsing the Statistics table) and only set `fp_ratio = 0` (skip the FP-based warning). Add a note in the output: "Warning: Could not parse Statistics table from prior resolution. Convergence tracking degraded." This separates cycle counting (always reliable, based on directory enumeration) from FP ratio computation (depends on parsing).

**review:orch Phase 2b Requires annotation is incomplete** - `shared/skills/review:orch/SKILL.md:64`
**Confidence**: 80%
- Problem: Phase 2b declares `**Requires:** BRANCH_INFO` but the implementation at line 66 needs `branch_slug` (derived from BRANCH_INFO) to locate `.devflow/docs/reviews/{branch_slug}/`. While `branch_slug` is a component of `BRANCH_INFO`, the Phase Protocol pattern documented in other phases is more specific. More importantly, Phase 2b implicitly requires that Phase 2 has already created the review directory (line 59), but does not declare a dependency on `REVIEW_DIR` or `TIMESTAMP`. If Phase 2b were ever reordered before Phase 2, the convergence check would scan for resolution summaries without the review directory existing yet -- which would succeed (it searches existing directories) but could create confusion.
- Fix: Update the Requires annotation to `**Requires:** BRANCH_INFO, REVIEW_DIR` to make the ordering dependency explicit. This matches the Phase Protocol convention observed in other phases (e.g., Phase 3 explicitly requires REVIEW_DIR).

## Issues in Code You Touched (Should Fix)

**Inconsistent convergence behavior between ambient (review:orch) and interactive (code-review.md) modes** - `shared/skills/review:orch/SKILL.md:74-77`, `plugins/devflow-code-review/commands/code-review.md:108-113`
**Confidence**: 82%
- Problem: The convergence gate behaves differently across the three orchestration surfaces in a way that may not be intentional. In `review:orch` (ambient): warns and continues unconditionally ("do NOT halt"). In `code-review.md` (interactive): warns via `AskUserQuestion` with Merge/Review/Stop options, allowing the user to halt. In `code-review-teams.md`: mirrors `code-review.md`. The asymmetry is partially documented (ambient mode cannot use AskUserQuestion), but the consequence is that ambient-mode reviews have no termination condition for the review-resolve cycle. A sidecar or automated pipeline using ambient mode could loop indefinitely.
- Fix: For `review:orch`, add a hard-stop condition at a higher cycle threshold (e.g., `CYCLE_NUMBER >= 5 AND fp_ratio > 0.7` → halt with message). The interactive commands can keep the lower threshold with user prompting, while ambient mode gets a higher but still bounded threshold. Document this asymmetry explicitly in the review:orch error handling section.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **PRIOR_RESOLUTIONS content size is unbounded** - `shared/agents/reviewer.md:26-31` (Confidence: 70%) -- The resolution-summary.md content is read in full and passed as `PRIOR_RESOLUTIONS` to every reviewer agent. A large resolution summary from a complex review could consume significant context in each of 8-19 reviewer agent spawns. Consider documenting a maximum expected size or truncation strategy.

- **Directory listing sort order not explicitly specified as filesystem-safe** - `shared/skills/review:orch/SKILL.md:67` (Confidence: 65%) -- "List timestamped directories sorted descending" assumes lexicographic sort works for timestamp-prefixed directory names (YYYY-MM-DD_HHMM format), which is correct. However, no explicit sort command is specified. Different implementations might use different sort strategies. Consider specifying the exact sort mechanism (e.g., `ls -r` or `sort -r`).

- **Test file uses `extractSection` with anchors that could break on minor heading changes** - `tests/review/convergence-detection.test.ts:28` (Confidence: 65%) -- The test helper `extractSection` throws if anchors are not found, which is good for detection. But several tests rely on exact section heading ordering (e.g., `extractSection(content, '## Input', '## Focus Areas')`). If a new section is inserted between these headings, the extracted content changes silently without test failure. This is a minor brittleness concern, not a reliability issue.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Reliability Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The convergence detection feature is well-designed with good defensive defaults (fp_ratio=0 on parse failure, (none) defaults, --full bypass). The cross-cutting consistency is solid -- the convergence formula, containment markers, and bypass logic are consistent across all three orchestration surfaces, validated by 39 passing tests. However, the lack of an upper bound on review-resolve cycles (the core reliability concern) means the system can loop indefinitely in ambient mode. Adding a hard cycle cap would bring this to APPROVED. The parsing-failure degradation to CYCLE_NUMBER=1 is a secondary concern that could mask runaway cycles.
