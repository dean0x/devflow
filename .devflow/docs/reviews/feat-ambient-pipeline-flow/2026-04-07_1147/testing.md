# Testing Review Report

**Branch**: feat/ambient-pipeline-flow -> main
**Date**: 2026-04-07

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Integration test `DEBUG/GUIDED` expected skills list includes `test-driven-development` not listed in README GUIDED table** - `tests/integration/ambient-activation.test.ts:89`
**Confidence**: 82%
- Problem: The integration test asserts `const expected = ['test-driven-development', 'software-design', 'testing']` for DEBUG/GUIDED. The router SKILL.md table confirms this is correct. However, `plugins/devflow-ambient/README.md` line 48 lists DEBUG GUIDED skills as only `software-design, testing` -- missing `test-driven-development`. This discrepancy between documentation and the source of truth (router SKILL.md) means the README is stale, and the structural validation test (`integration test expectations align with router skill tables`) does not catch README drift because it only cross-references the integration test file against the router tables, not the README.
- Fix: Either add a drift-detection test for the README GUIDED table against the router SKILL.md, or update the README to match. The README's GUIDED Behavior table at line 48 should read: `| DEBUG | test-driven-development, software-design, testing | Investigate, diagnose, fix | ...`

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

_No issues found._

## Suggestions (Lower Confidence)

- **`removeAmbientHook` lacks a test for removing SessionStart classification when no UserPromptSubmit hooks exist** - `tests/ambient.test.ts` (Confidence: 70%) -- All existing `removeAmbientHook` tests assume both UserPromptSubmit and SessionStart hooks are present. A test with only SessionStart classification hook (no preamble) would validate the independent removal path introduced by the refactored `filterHookEntries(settings, eventName, ...)`.

- **`parseRouterTables` helper is duplicated in the diff output** - `tests/ambient.test.ts:444,566` (Confidence: 65%) -- The diff shows what appears to be the `parseRouterTables` and `parseClassificationIntents` helper functions and the `router structural validation` describe block appearing multiple times in the file. If this is actually present in the file (the test run shows 46 tests passing so likely a diff artifact), there is no issue. But if duplicate blocks exist, they would cause silent test duplication. Verified the actual file has exactly one copy of each -- this is confirmed as a diff rendering artifact only.

- **Integration tests have no negative assertion for RESOLVE/GUIDED or PIPELINE/GUIDED** - `tests/integration/ambient-activation.test.ts` (Confidence: 62%) -- The structural validation test in `ambient.test.ts` verifies RESOLVE and PIPELINE have no GUIDED rows in the router table. But the integration test suite does not verify that a RESOLVE-like prompt at small scope still classifies as ORCHESTRATED (not GUIDED). This would catch classification regressions where the model incorrectly assigns GUIDED depth to an always-ORCHESTRATED intent.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Rationale

The test suite is well-structured and demonstrates strong testing practices:

1. **Behavior-focused**: Tests validate observable behavior (hook add/remove, classification detection, structural alignment) rather than implementation details.
2. **Excellent AAA structure**: Each test has clear arrange-act-assert, with minimal setup (all under 10 lines).
3. **Smart cross-validation**: The `router structural validation` describe block is a standout -- it programmatically parses the router SKILL.md markdown tables and validates them against both shared/skills directory entries and integration test expectations. This catches drift between three artifacts automatically.
4. **Two-tier assertion strategy**: Integration tests use hard assertions (router skill loaded = system works) with soft logging for specific skill matching. This prevents flaky failures from LLM non-determinism while still surfacing quality signals.
5. **Good edge case coverage**: Idempotency, legacy migration, upgrade paths (preamble-exists-but-no-classification), and coexistence with other hooks are all tested.
6. **New SessionStart hook thoroughly tested**: 7 new unit tests cover the classification hook across add, remove, preserve, idempotency, and upgrade scenarios.

The one blocking MEDIUM issue is the README skills table drift, which is a documentation-test synchronization gap rather than a code defect. The tests themselves correctly validate against the router SKILL.md source of truth.
