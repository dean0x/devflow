# Complexity Review Report

**Branch**: feat/init-flow-simplification -> main
**Date**: 2026-06-01 18:57
**PR**: #232

## Scope

Reviewed the init-flow simplification changes in `src/cli/commands/init.ts` and
`src/cli/plugins.ts`. Focus per orchestrator: the interactive two-step selection
loop and the new pure helpers (`partitionSelectablePlugins`, `combineSelection`,
`shouldRetry`, `WORKFLOW_ORDER`). applies ADR-011 (two-step plugin selection,
bounded re-prompt max 3, combined non-empty validation).

Cross-cycle note: prior resolution (cycle 2) already performed a loop-clarity
refactor (separated "got selection" from "out of attempts"), extracted
`combineSelection`/`shouldRetry`/`toChoice`. The two prior false positives
(test re-declares EXCLUDED set; precondition assert for both-empty buckets)
were NOT re-raised — verified neither was re-introduced.

## Issues in Your Changes (BLOCKING)

### CRITICAL
None.

### HIGH
None.

### MEDIUM
None.

## Issues in Code You Touched (Should Fix)

None at >=80% confidence.

The new code is well-factored for complexity:

- **`partitionSelectablePlugins`** (`plugins.ts:719-741`) — single loop, one
  early `continue`, nesting depth 2, ~22 lines, cyclomatic complexity ~3.
  Pure, documented, deterministic. Within all metric thresholds. applies ADR-011.
- **`combineSelection`** (`init.ts:129-135`) — 3 lines of logic, complexity 1.
- **`shouldRetry`** (`init.ts:144-147`) — 2 branches, complexity 2.
- **Bounded selection loop** (`init.ts:349-395`) — explicit `MAX_ATTEMPTS = 3`
  bound (avoids unbounded-loop reliability pitfall), max nesting depth 3
  (`while` -> `if bucket non-empty` -> `if isCancel`), ~46 lines including two
  symmetric multiselect blocks. The two `if (p.isCancel(...))` blocks are
  near-duplicates but consolidating them would require wrapping `p.multiselect`,
  which would reduce clarity more than the duplication costs — not worth flagging.

## Pre-existing Issues (Not Blocking)

**`initCommand.action()` handler is very long (~1150 lines)** — `init.ts:193-1347`
**Confidence**: 95%
- Problem: The `.action()` callback is a single ~1150-line function far exceeding
  the >50-line CRITICAL threshold, with the Recommended/Advanced branch spanning
  hundreds of lines of inline prompt construction.
- Category: Pre-existing — this PR adds only ~50 net lines to a function that was
  already this size; the length is not introduced by this change.
- Per the Iron Law (never block for pre-existing issues) and the consolidation
  rule (pre-existing reported only if CRITICAL), this is informational. A future
  refactor could extract `collectAdvancedFeatureChoices()` and
  `applyRecommendedDefaults()` to bring the handler under control, but that is
  out of scope for this PR and should be a separate effort.

## Suggestions (Lower Confidence)

- **`shouldRetry`'s `accepted` parameter is dead at its sole callsite** -
  `init.ts:390` (Confidence: 65%) — The only caller invokes `shouldRetry` after
  an `if (accepted) break`, so `accepted` is always `false` there, making the
  `if (accepted) return false` branch unreachable in production. The parameter
  exists for standalone unit-testing of the predicate (intentional per prior
  cycle's extraction), so this is a deliberate testability tradeoff, not a defect.
  No change recommended.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 1 | 0 |

**Complexity Score**: 9
**Recommendation**: APPROVED

The changes reduce complexity rather than add it: the prior single conflated
multiselect is replaced by two clearly-named steps backed by small pure helpers,
all within complexity/length/nesting thresholds. The retry loop is explicitly
bounded. No blocking or should-fix complexity issues in the diff. The only
notable item (the giant `.action()` handler) is pre-existing and informational.
