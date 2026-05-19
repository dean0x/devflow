# Testing Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17

## Issues in Your Changes (BLOCKING)

### HIGH

**Significant test coverage gap for sidecar-evaluate hook (328 lines of new shell logic)** - `scripts/hooks/sidecar-evaluate`
**Confidence**: 92%
- Problem: The new `sidecar-evaluate` hook is the most complex new component (328 lines) implementing learning batch evaluation, decisions detection, knowledge refresh scheduling, and session depth analysis. The only tests for it in `tests/sentinel.test.ts` verify basic exit conditions (no session_id, DEVFLOW_BG_LEARNER guard, missing .memory/). None of the core business logic is tested: daily cap enforcement, batch size counting, adaptive batch sizing (3 vs 5), session deduplication, learning/decisions/knowledge marker writing, or disabled-sentinel gating of individual features within the hook.
- Fix: Add integration tests for `sidecar-evaluate` covering:
  1. Learning batch counting: writes marker after N sessions accumulate
  2. Daily cap enforcement: skips learning when max_daily_runs reached
  3. Decisions evaluation: writes decisions.json marker when dialog pairs present
  4. Knowledge staleness: writes knowledge.json marker for stale slugs
  5. Feature-level config gating: each of learning/decisions/knowledge can be independently disabled via sidecar config
  6. Session depth guard: shallow sessions (<3 user turns) skip all evaluations

**Missing tests for sidecar-dispatch marker detection and SIDECAR directive output** - `scripts/hooks/sidecar-dispatch:63-111`
**Confidence**: 85%
- Problem: The `sidecar-dispatch` hook has a second responsibility beyond user turn capture: it checks `.memory/.sidecar/*.json` for pending markers and outputs a SIDECAR directive via `additionalContext`. This "marker dispatch" path is entirely untested. The existing `shell-hooks.test.ts` tests only exercise the user turn capture path. The stale `.processing` file retry logic (lines 71-87) is also uncovered.
- Fix: Add tests for:
  1. When pending markers exist (e.g., `learning.json`, `memory.json`), verify the hook outputs a SIDECAR directive containing the task names
  2. When no markers exist (only `config.json`), verify silent exit with no output
  3. Stale `.processing` file recovery: a `.processing` file older than 5 minutes is renamed back to `.json`

**No tests for sidecar-capture memory marker writing** - `scripts/hooks/sidecar-capture:117-155`
**Confidence**: 85%
- Problem: The `sidecar-capture` hook gained a new responsibility: writing `.memory/.sidecar/memory.json` when the working memory file is stale (>120s). Existing tests verify queue appending behavior and the throttle (not writing when WORKING-MEMORY.md is recent), but never verify that `memory.json` is actually created in the sidecar directory. The `.processing` marker guard (lines 119-123) is also untested.
- Fix: Add a test that:
  1. Creates a stale WORKING-MEMORY.md (>120s old)
  2. Runs sidecar-capture with a valid end_turn
  3. Asserts `.memory/.sidecar/memory.json` exists and contains expected fields (pendingTurnsFile, existingMemoryFile, model, timestamp)
  4. Also test: when `memory.processing` exists, marker is NOT written (throttle guard)

### MEDIUM

**sidecar-config.test.ts does not test concurrent write races** - `tests/sidecar-config.test.ts:136-181`
**Confidence**: 80%
- Problem: `updateFeature` performs a read-then-write cycle (`readConfig` followed by `writeConfig`). In real usage, multiple hooks could call `updateFeature` concurrently (e.g., `devflow memory --disable` and `devflow learn --disable` in rapid succession). There is no file-level locking or atomic compare-and-swap. While this is primarily an architecture concern, the test suite should at minimum document this limitation or verify that concurrent writes don't corrupt the JSON file.
- Fix: Add a test that fires two `updateFeature` calls in parallel and verifies the final config is valid JSON (even if one write wins over the other). Alternatively, document this known race in the test file as a design acknowledgment.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Deleted test suites (2171 lines) exceed replacement tests (218 lines) by 10x** - `tests/`
**Confidence**: 82%
- Problem: This PR deletes 8 test files (2555 lines removed) covering background-runner, decisions-agent, hook-management, run-background, knowledge toggle, and learning agent logic. Only 1 new test file was added (`sidecar-config.test.ts`, 218 lines). The deleted tests covered: background lock management, daily cap enforcement, batch message extraction, temporal decay, staleness checking, decisions agent structured output parsing, and learning agent observation processing. While the corresponding source code was also deleted (making these tests obsolete), the replacement shell hooks (`sidecar-evaluate`, `sidecar-dispatch`) now implement equivalent logic in bash without equivalent test coverage.
- Fix: The sidecar hooks have shifted complexity from TypeScript (where it was well-tested with unit tests) to bash (where only basic behavioral tests exist). Consider adding dedicated test suites for the three new hooks' core logic paths. Priority order:
  1. `sidecar-evaluate` — most complex (328 lines, 3 feature evaluators, batching, caps)
  2. `sidecar-dispatch` — marker detection and directive output (113 lines)
  3. `sidecar-capture` — memory marker writing logic (155 lines)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Missing test for `session-start-memory` sidecar config check** - `scripts/hooks/session-start-memory` (Confidence: 72%) -- The git diff shows 6 lines added to `session-start-memory` for the sidecar config check, but the sentinel.test.ts for this hook was not updated to test the new config-based gate (only the old `.working-memory-disabled` sentinel is tested in the pre-compact-memory section). Applies ADR-001 (no migration code needed, but the dual-check logic should be verified).

- **`formatLearningStatus` signature changed from union to boolean but no negative-path test** - `tests/learn.test.ts:110-185` (Confidence: 65%) -- The `formatLearningStatus` second parameter was changed from `'current' | 'legacy' | false` to `boolean`. The legacy upgrade message tests were deleted. While the function itself was simplified, there is no test verifying it handles unexpected input gracefully (e.g., `undefined`, which TypeScript allows if the parameter is optional elsewhere).

- **No test verifies `devflow memory --disable` writes sidecar config** - `src/cli/commands/memory.ts:334-345` (Confidence: 70%) -- The disable path now calls `updateFeature(gitRoot, 'memory', false)` instead of writing a sentinel file. Integration test coverage for the CLI command's disable path would confirm the sidecar config file is written correctly.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The new `sidecar-config.ts` is well-tested with thorough coverage of defaults, partial configs, malformed JSON, and feature toggling. However, the PR moves significant logic from well-tested TypeScript modules into 3 new bash hooks totaling ~596 lines, with only basic sentinel/exit-condition tests. The `sidecar-evaluate` hook (328 lines) is the most critical gap -- it implements batch counting, daily caps, session deduplication, and feature gating without corresponding tests. The deleted TypeScript tests previously covered these exact behaviors. The test suite should validate the core business logic of these hooks, not just their early-exit guards.
