# Testing Review Report

**Branch**: refactor/remove-ambient-commands-rule -> main
**Date**: 2026-06-01_2352
**PR**: #233

## Scope

Verified `tests/ambient.test.ts` against the source refactor in
`src/cli/commands/ambient.ts`. The PR removes the `commands` awareness rule:
`COMMANDS_RULE_CONTENT` and `installCommandsRule()` are deleted, `removeCommandsRule()`
is renamed to `removeLegacyCommandsRule()`, and both `addAmbientHook`/`removeAmbientHook`
now *purge* the legacy rule (via `fs.unlink`) instead of writing it. All 40 tests in the
suite pass (`npx vitest run tests/ambient.test.ts` → pass: 40, fail: 0).

## Focus-Question Findings

**(1) Ordering-invariant test exercises the early-return path AND asserts unlink — CONFIRMED.**
`tests/ambient.test.ts:94-105`. The first `addAmbientHook('{}')` installs the preamble
hook. The second call passes `withHook`, so `hasPreamble` is true → the `if (!hasPreamble)`
block is skipped, `changed` stays `false`, `removeLegacyCommandsRule()` runs at
`ambient.ts:103` *before* the `if (!changed) return settingsJson` early-return at
`ambient.ts:105`. The test asserts `fs.unlink` was called with `COMMANDS_RULE_PATH`. This
genuinely guards the ordering invariant (purge-before-early-return) — if a future edit moved
the purge after the early-return, this test would fail. Good behavioral coverage.

**(2) removeLegacyCommandsRule tests are behavior-focused, not over-mocked — CONFIRMED.**
`tests/ambient.test.ts:324-345`. The three cases (unlink-on-exists, ENOENT swallow, EACCES
propagate) mock only the `fs.unlink` boundary — which is exactly the OS boundary the function
wraps — and assert observable contract behavior (call happened / resolves / rejects with code).
This is mock-at-the-boundary, not internal coupling. The ENOENT-swallow and EACCES-propagate
tests directly exercise the `if (code !== 'ENOENT') throw` branch at `ambient.ts:67`, covering
both branch arms. Appropriate use of stubs/spies per the taxonomy.

**(3) No meaningful coverage lost when installCommandsRule/COMMANDS_RULE_CONTENT suites were
deleted — CONFIRMED.** The deleted `describe('installCommandsRule')` and
`describe('COMMANDS_RULE_CONTENT')` suites tested symbols that no longer exist in source
(`installCommandsRule`, `COMMANDS_RULE_CONTENT` are both removed from `ambient.ts`). The
dual-source drift guard (`COMMANDS_RULE_CONTENT` === `shared/rules/commands.md`) is correctly
gone because both sides of the equality were deleted (`shared/rules/commands.md` confirmed
DELETED on disk). The new purge behavior (`removeLegacyCommandsRule` + the unconditional
purge in both add/remove paths) is fully covered: unlink-happy-path, ENOENT, EACCES, the
add-path ordering invariant, and the remove-path purge (exercised transitively by the
`removeAmbientHook` suite, whose `beforeEach` stubs `fs.unlink`). No behavioral gap.

**(4) No brittle mocking / implementation-coupling introduced by the flip — CONFIRMED, with
one minor observation.** The flip from `mkdir`+`writeFile` stubs to a single `unlink` stub is
correct and reduces mock surface. The assertion `fs.unlink` toHaveBeenCalledWith(COMMANDS_RULE_PATH)
asserts an observable filesystem side-effect (the function's documented contract: "delete the
legacy file"), not an internal code path — acceptable for a function whose entire purpose is a
side-effect. See the single MEDIUM observation below regarding the `vi.restoreAllMocks()` /
re-stub dance inside the ordering test.

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None at >=80% confidence.

## Pre-existing Issues (Not Blocking)

None.

## Suggestions (Lower Confidence)

- **In-test `vi.restoreAllMocks()` then re-stub is a mild smell** — `tests/ambient.test.ts:98-100`
  (Confidence: 70%) — The ordering test restores all mocks mid-body then re-stubs `fs.unlink`
  purely to reset the spy's call history before the asserted call. `vi.clearAllMocks()` (or
  `mockClear()` on the spy) would reset call history without tearing down and rebuilding the
  spy, making the intent ("ignore the first call, assert the second") clearer and less coupled
  to spy-lifecycle mechanics. Behavior is correct as written; this is readability only.

- **Add-path purge not asserted with explicit "exactly once" semantics** — `tests/ambient.test.ts:94-105`
  (Confidence: 62%) — The ordering test asserts the purge *happened* on the early-return path
  but does not pin that it runs exactly once per call. Low value given the function is a simple
  idempotent unlink; noted only for completeness.

## Summary

| Category     | CRITICAL | HIGH | MEDIUM | LOW |
|--------------|----------|------|--------|-----|
| Blocking     | 0        | 0    | 0      | -   |
| Should Fix   | -        | 0    | 0      | -   |
| Pre-existing | -        | -    | 0      | 0   |

**Testing Score**: 9/10
**Recommendation**: APPROVED

The test changes are a clean, behavior-focused mirror of the source refactor. Coverage of the
new purge behavior is complete (happy path, ENOENT, EACCES, and the load-bearing
purge-before-early-return ordering invariant). Deleted suites tested now-nonexistent symbols
and a dual-source guard whose second source was also deleted — no real coverage was lost.
Mocking stays at the `fs` boundary throughout. The only nits are stylistic (mock-reset
ergonomics) and do not block.
