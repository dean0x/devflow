# Regression Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28

## Issues in Your Changes (BLOCKING)

### CRITICAL

No critical regression issues found.

### HIGH

No high-severity regression issues found.

## Issues in Code You Touched (Should Fix)

No should-fix regression issues found.

## Pre-existing Issues (Not Blocking)

No pre-existing regression issues found.

## Suggestions (Lower Confidence)

No lower-confidence suggestions.

## Analysis Notes

### Field Rename Migration (resolves PF-006)

The core change -- renaming `response_text` to `last_assistant_message` and removing the `stop_reason` filter in `sidecar-capture` -- is a complete migration:

1. **Old field references fully removed**: No remaining references to `response_text` or `stop_reason` in any production code (`scripts/hooks/`, `src/cli/`, `tests/`). The migration is complete across all consumers.

2. **Internal variable naming preserved**: The internal bash variable `RESPONSE_TEXT` is intentionally retained for readability within `sidecar-capture`. This is not a regression -- only the JSON input field name changed, not the internal variable name.

3. **`stop_reason` filter removal is intentional**: The old `stop_reason != "end_turn"` guard silently dropped valid assistant messages during tool-use turns. The new code gates capture on `last_assistant_message` presence only, which is the correct behavior. A dedicated regression test (sentinel.test.ts line 111-127) validates this.

4. **Test inputs updated**: All 6 test call sites in `sentinel.test.ts` updated from `{stop_reason: 'end_turn', response_text: ...}` to `{last_assistant_message: ...}`. Shell hook tests in `shell-hooks.test.ts` use the new field name throughout.

### Sidecar-Evaluate Modularization

The 465-line monolithic `sidecar-evaluate` was refactored into an orchestrator (120 lines) + 5 modules (`eval-helpers`, `eval-reinforce`, `eval-learning`, `eval-decisions`, `eval-knowledge`). Regression analysis:

1. **Behavioral equivalence verified**: Each module's logic is line-for-line identical to the corresponding section in the old monolith, with the following controlled changes:
   - Variables prefixed with `_REINF_`, `_LEARN_`, `_DEC_`, `_KNOW_` to prevent namespace collisions between sourced modules
   - Fail-fast guards (`${VAR:?}`) added at module top to catch orchestrator contract violations early
   - `_eval_release_lock()` shared EXIT trap helper replaces inline lock-release strings (prevents trap collision between modules)
   - Debug annotations (`dbg "..."`) added throughout

2. **No lost functionality**: All four feature evaluation paths (reinforcement, learning, decisions, knowledge) are sourced in the same order and produce identical marker files.

3. **No removed exports or APIs**: No functions, files, or CLI options were removed. The `debug` CLI command and its pure functions (`applyDebugTrace`, `stripDebugTrace`, `readDebugStatus`) are purely additive.

### Debug Tracing System (applies ADR-007)

The new debug tracing system (`debug-trace`, `hook-bootstrap`, `hook-log-init`) is purely additive and gated by `DEVFLOW_HOOK_DEBUG=1`. When the env var is absent (default), the `dbg()` function is a no-op (`{ :; }`), adding negligible overhead. No regression risk from the tracing infrastructure itself.

### Log File Rename

`sidecar-capture` log file changed from `.working-memory-update.log` to `.sidecar-capture.log`. CLAUDE.md updated to reflect this. This is a minor naming consistency improvement, not a behavioral regression. Old log files at the previous path will be orphaned but harmless.

### CWD Directory-Existence Guards

Added `[ ! -d "$CWD" ]` guard to `session-start-memory`, `session-start-context`, and `pre-compact-memory` (previously only checked `[ -z "$CWD" ]`). This is a strictly defensive improvement -- previously, a non-existent CWD directory would cause failures later in the hook. No regression.

### Test Coverage

All 200 tests pass. New tests include:
- `debug.test.ts`: 17 tests covering `applyDebugTrace`, `stripDebugTrace`, `readDebugStatus` pure functions
- `shell-hooks.test.ts`: Tests for `eval-helpers` functions (`read_daily_cap`, `atomic_increment_daily`, `load_existing_ids`, `_eval_release_lock`), bash syntax checks for all new scripts
- `sentinel.test.ts`: Regression test for `stop_reason` filter removal, log file creation test

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED

The field rename migration (resolves PF-006) is complete with zero remaining references to old field names. The sidecar-evaluate modularization preserves behavioral equivalence with improved namespace safety. The debug tracing system (applies ADR-007) is purely additive and properly gated. All 200 tests pass.
