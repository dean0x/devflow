# Reliability Review Report

**Branch**: feat/init-flow-simplification -> main
**PR**: #232
**Date**: 2026-06-01_1725
**Scope**: `src/cli/plugins.ts`, `src/cli/commands/init.ts`, `tests/plugins.test.ts`

## Iron Law Assessment

> Every operation must terminate and every resource must be bounded.

The two-step plugin-selection retry loop and `partitionSelectablePlugins` were audited
against the reliability rule (every loop/retry has an explicit fixed upper bound). Both
satisfy the Iron Law. Detailed verification below.

### Bounded selection loop — VERIFIED CORRECT

`src/cli/commands/init.ts:322-373`

- Fixed bound: `const MAX_ATTEMPTS = 3` (line 323); loop is `while (attempts < MAX_ATTEMPTS)`
  (line 326). No `while(true)`, no unbounded recursion.
- Counter placement: `attempts++` is the first statement of the body (line 327), so the
  guard at line 367 (`if (attempts < MAX_ATTEMPTS)`) compares the already-incremented value.
  Termination trace:
  - Iter 1: attempts=1, empty -> 1<3 true -> warn, continue
  - Iter 2: attempts=2, empty -> 2<3 true -> warn, continue
  - Iter 3: attempts=3, empty -> 3<3 false -> `p.cancel(...)` + `process.exit(0)`
  No off-by-one: a 4th attempt is impossible and the final-attempt warning/cancel branch
  fires exactly once. Non-empty selection breaks early (line 362-365).
- Dual termination guarantee (defense in depth): even if the `process.exit(0)` on the
  terminal branch were removed, the `while` condition still caps iterations at 3. Both
  guards agree on the same bound. Sound.

### isCancel handling — VERIFIED CLEAN

`src/cli/commands/init.ts:338-341`, `353-356`

- Both steps check `p.isCancel(...)` immediately after each `multiselect`, call
  `p.cancel('Installation cancelled.')`, then `process.exit(0)`.
- No partial state is committed: `selectedPlugins` is only assigned at line 363 after a
  successful non-empty `combined`. A cancel at step 1 or step 2 exits before any plugin
  state is persisted. The setup-mode `isCancel` (line 401-404) follows the same clean-exit
  pattern. No resource is left half-initialized.

### Empty-bucket guard — VERIFIED

`src/cli/commands/init.ts:331`, `347`

- Each `multiselect` is gated by `if (workflowChoices.length > 0)` / `if (languageChoices.length > 0)`.
- A bucket with zero choices is skipped, so `p.multiselect` is never invoked with an empty
  `options` array. This correctly avoids a @clack empty-options crash (the primary
  reliability hazard for this UI). The respective `*Selected` array defaults to `[]`, and
  `combined` aggregates whatever was selected.

### partitionSelectablePlugins — VERIFIED DETERMINISTIC

`src/cli/plugins.ts:719-737`

- Pure function: iterates the input once, pushes into two fresh local arrays, returns them.
  No mutation of the input (test `does not mutate the input array` confirms), no I/O, no
  hidden/module-level state. The `EXCLUDED` Set is constructed locally per call.
- Empty input: the `for` loop body never executes; returns `{ workflow: [], language: [] }`.
  Covered by test `returns empty buckets for empty input` (line 381-385).
- Determinism: output ordering follows input ordering (test `preserves DEVFLOW_PLUGINS
  ordering within each bucket`); buckets are disjoint and exhaustive over non-excluded
  plugins (tests `buckets are disjoint`, `workflow + language covers all selectable`).

### Test coverage — STRONG

`tests/plugins.test.ts` adds disjointness, exhaustiveness, ordering, no-mutation,
empty-input, and a `WORKFLOW_ORDER` regression guard ensuring every workflow command is
listed. This is appropriate behavior-focused coverage for the new pure function and the
display-order invariant.

## Issues in Your Changes (BLOCKING)

None. The bounded loop, isCancel handling, empty-bucket guard, and partition function all
satisfy the reliability rule.

## Issues in Code You Touched (Should Fix)

None at >=80% confidence.

## Pre-existing Issues (Not Blocking)

None within scope.

## Suggestions (Lower Confidence)

- **Both-buckets-empty produces three silent warnings** — `src/cli/commands/init.ts:326-373`
  (Confidence: 65%) — If both `workflowChoices` and `languageChoices` were empty, the loop
  runs all 3 iterations issuing `p.log.warn('Select at least one plugin.')` twice with no
  intervening prompt, then cancels. This is unreachable with the real `DEVFLOW_PLUGINS`
  registry (workflow plugins always exist), so it is not a defect today. An explicit
  precondition assert before the loop (e.g. assert at least one of the two buckets is
  non-empty) would convert a confusing degenerate path into a clear fail-fast, matching the
  reliability rule's "assert preconditions in production code" guidance.

- **Loop guard at line 367 is logically redundant with the `while` condition** —
  `src/cli/commands/init.ts:367` (Confidence: 60%) — Because the terminal branch calls
  `process.exit(0)`, the `attempts < MAX_ATTEMPTS` re-check is belt-and-suspenders. This is
  acceptable defensive style and need not change; noted only for awareness.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Reliability Score**: 9
**Recommendation**: APPROVED

Notes:
- DECISIONS_CONTEXT: PF-005 read and confirmed not applicable (it concerns assuming a
  capability does not exist before checking the agent roster — unrelated to loop bounds).
  No ADR/PF citation warranted.
- FEATURE_KNOWLEDGE (`cli-rules`): scoped to the rules system, no anti-patterns or gotchas
  bear on the plugin-selection loop. No findings derived from it.
- PRIOR_RESOLUTIONS: (none).
