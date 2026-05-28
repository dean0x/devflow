# Regression Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

(none)

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED

## Detailed Analysis

### 1. Field Rename Migration: `response_text` -> `last_assistant_message` (Complete)

The core regression risk in this PR is the field rename in `sidecar-capture`. The migration is complete:

- **`sidecar-capture`**: Both the jq path and node fallback correctly read `.last_assistant_message` instead of `.response_text`. The internal variable name `RESPONSE_TEXT` is preserved (it is a local shell variable, not an external contract), which avoids cascading changes downstream in the same script.
- **Test migration**: All 15 test call sites in `shell-hooks.test.ts` and 4 in `sentinel.test.ts` updated from `{ stop_reason: 'end_turn', response_text: ... }` to `{ last_assistant_message: ... }`.
- **Codebase-wide search**: Zero remaining references to `response_text` or `stop_reason` in scripts, source, tests, docs, or shared assets. Migration is complete.

### 2. `stop_reason` Filter Removal (Correct)

The old code filtered `stop_reason !== 'end_turn'` to avoid processing mid-turn hook invocations. The PR description states that `last_assistant_message` is only populated on real assistant turns, making the filter redundant. This is consistent: if the field is empty/absent on non-end-turn stops, the existing `if [ -z "$RESPONSE_TEXT" ]` guard (line 74) provides equivalent protection. The test `empty last_assistant_message -- no queue append` (renamed from `stop_reason tool_use -- no queue append`) validates this path.

### 3. `cut` Field Index Shift (Correct)

The old code extracted 3 fields (cwd, stop_reason, response_text) using `cut -f3-` for response_text. The new code extracts 2 fields (cwd, last_assistant_message) using `cut -f2-`. This is correct -- removing the middle field means response text is now field 2, not field 3. Both jq and node paths are consistent.

### 4. Debug Tracing System (No Regression Risk)

All 7 hooks follow a consistent pattern: `dbg() { :; }` no-op fallback before `set -e`, then `source debug-trace || true`. When `DEVFLOW_HOOK_DEBUG` is unset (the default), `devflow_debug_init` redefines `dbg` as a no-op and returns immediately. This means:

- **Zero overhead in normal operation**: No mkdir, no file I/O, no subprocesses when debug is off.
- **Safe fallback**: If `debug-trace` fails to source, `dbg` remains a no-op -- hooks never fail.
- **No behavior changes**: All `dbg` calls are additive logging, not control flow changes.

### 5. Log-Paths Sourcing Moved Earlier in `sidecar-capture` (Improvement)

`log-paths` sourcing moved from after the memory gate to right after CWD resolution (line 59). This means `log()` is now available for the decisions usage scanner section (lines 86-94), which previously had no logging. No regression risk -- `log-paths` only requires `$CWD` which is already resolved.

### 6. Normal Logging Added to 4 Hooks (Additive)

`sidecar-dispatch`, `session-start-memory`, `session-start-context`, and `pre-compact-memory` now source `log-paths` and define a `log()` function. These are purely additive -- they write to per-project log files under `~/.devflow/logs/`. The `|| true` fallback on `log-paths` sourcing and `2>/dev/null || true` on `log()` prevent any hook failure from logging issues.

### 7. Test Coverage Verification

All 1571 tests pass. The renamed test cases accurately reflect the new behavior:
- `empty last_assistant_message -- no queue append` (was `stop_reason tool_use -- no queue append`)
- `last_assistant_message present -- appends assistant turn to queue` (was `stop_reason end_turn -- appends...`)

### 8. Decisions Relevance

- **applies ADR-001**: The field rename is a clean break (no backward compatibility layer for the old `response_text`/`stop_reason` fields). This aligns with the clean break philosophy -- the old fields are simply removed, not deprecated.
- **avoids PF-003**: The field rename is in hook scripts that are installed at init time. Users who update Devflow must run `devflow init` to pick up the new hook code. This is the existing install pattern, not a new risk introduced by this PR.
