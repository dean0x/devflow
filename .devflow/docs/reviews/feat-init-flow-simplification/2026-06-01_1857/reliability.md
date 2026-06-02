# Reliability Review Report

**Branch**: feat/init-flow-simplification -> main
**Date**: 2026-06-01_1857
**PR**: #232

## Scope

Reviewed the two-step plugin-selection retry loop and supporting pure helpers
(`combineSelection`, `shouldRetry`, `partitionSelectablePlugins`, `WORKFLOW_ORDER`)
in `src/cli/commands/init.ts` and `src/cli/plugins.ts`. Focus per orchestrator: verify
the re-prompt loop is bounded, terminates on exhaustion, handles `isCancel` on both
multiselects, and that the both-empty / language-only branches cannot infinite-loop
or crash. applies ADR-011 (bounded re-prompt loop — max 3 attempts, graceful cancel).

## Verification Findings (no issues — bounds confirmed)

The reliability Iron Law (every loop has a fixed upper bound, terminates explicitly)
is satisfied. Traced the loop at `init.ts:349-395`:

- **Bound**: `while (attempts < MAX_ATTEMPTS)` with `MAX_ATTEMPTS = 3` and `attempts++`
  as the first statement of the body. Fixed upper bound of 3 iterations. avoids the
  unbounded-retry anti-pattern.
- **Termination paths**: (1) `accepted` → `break` (line 387); (2) exhaustion →
  `process.exit(0)` via `!shouldRetry(...)` (lines 390-392); (3) natural `while`
  exit when `attempts` reaches 3. No fall-through to installation with an empty
  selection — `selectedPlugins` is only assigned inside the `accepted` branch.
- **Off-by-one check**: on the 3rd attempt `attempts === 3`, `shouldRetry(3, 3, false)`
  returns `3 < 3 === false`, so `!shouldRetry` is true and the flow exits. Confirmed
  exactly 3 prompts maximum, never a 4th, never a skipped exhaustion. Verified against
  the `shouldRetry` tests in `tests/init-logic.test.ts`.
- **isCancel handling**: both multiselects guard `p.isCancel` and call
  `p.cancel(...)` + `process.exit(0)` (Step 1 lines 361-364; Step 2 lines 376-379).
  No unhandled cancel sentinel can leak into `combineSelection`.
- **Language-only path**: when `workflowChoices.length === 0`, Step 1 is skipped and
  `workflowSelected` stays `[]`; Step 2 alone can satisfy `accepted`. `combineSelection`
  returns `accepted = plugins.length > 0`, so a language-only selection is accepted
  correctly and the loop terminates. No crash, no infinite loop.
- **Non-TTY fallback**: non-TTY without `--plugin` leaves `selectedPlugins = []`, which
  later resolves to `DEVFLOW_PLUGINS.filter(p => !p.optional)` (line 960). Defined,
  unchanged fallback — no undefined-deref risk.

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

None within the reliability lens for the changed regions.

## Suggestions (Lower Confidence)

None at reportable confidence. (See Cross-Cycle note below regarding the both-empty
precondition assert, which is intentionally omitted.)

## Cross-Cycle Awareness

Per `PRIOR_RESOLUTIONS` (Cycle 2), two findings were classified FALSE_POSITIVE and are
NOT re-raised:

1. Test re-declares the `EXCLUDED` set — intentional. Verified still intentional; not
   re-raised.
2. Precondition assert for the both-empty buckets case — the team decided the assert is
   noise over value. I independently traced the both-empty degenerate case: the loop
   skips both prompts, warns up to 3 times, then `process.exit(0)`. This is **bounded
   and terminating** (no Iron Law violation), so I found no new evidence of an
   unbounded or crashing path that would justify overriding the prior decision. Not
   re-raised.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Reliability Score**: 10
**Recommendation**: APPROVED
