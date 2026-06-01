# Security Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28
**Diff**: `git diff 58f594605fd0178491c685482bfade8b0969bbf3...HEAD`
**Prior Resolutions**: Cycle 2 — 22 issues, 15 fixed, 2 FP, 5 deferred (DRY/decomposition scope)

## Issues in Your Changes (BLOCKING)

### HIGH

**Temp file race in hook-log-init size guard uses wc subprocess instead of stat** - `scripts/hooks/hook-log-init:31`
**Confidence**: 82%
- Problem: The size guard in `hook-log-init` uses `wc -c < "$LOG_FILE"` to check file size, which forks a subprocess. The corresponding size guard in `debug-trace:_devflow_dbg_size_guard` was explicitly refactored (commit 83bd685) to use `stat -f%z`/`stat -c%s` with `wc -c` as last-resort fallback — both for performance and to avoid TOCTOU windows where the file could change between size check and truncation. The new `hook-log-init` helper was written after that refactoring but does not follow the same pattern.
- Fix: Apply the same stat-first pattern from `_devflow_dbg_size_guard`:
```bash
_LOG_SIZE=$(stat -f%z "$LOG_FILE" 2>/dev/null) \
  || _LOG_SIZE=$(stat -c%s "$LOG_FILE" 2>/dev/null) \
  || _LOG_SIZE=$(wc -c < "$LOG_FILE" 2>/dev/null) \
  || _LOG_SIZE=0
if [ "${_LOG_SIZE:-0}" -gt 2097152 ]; then
```

## Issues in Code You Touched (Should Fix)

_No issues found at the should-fix threshold._

## Pre-existing Issues (Not Blocking)

_No critical pre-existing security issues detected in reviewed files._

## Suggestions (Lower Confidence)

- **EXIT trap stacking in eval-learning/eval-reinforce** - `scripts/hooks/eval-learning:70`, `scripts/hooks/eval-reinforce:20` (Confidence: 72%) — Both modules set `trap '...' EXIT` when acquiring their respective locks, then `trap - EXIT` after release. Because these modules are sourced sequentially in the same shell, an early exit between `trap '...' EXIT` and `trap - EXIT` within one module could leave a stale lock. However, the existing lock-acquire timeout (3s) and `sidecar_lock_acquire` failure path make this unlikely in practice. The prior review cycle 2 already deferred this (EXIT trap asymmetry) as low-risk.

- **Transcript content used in grep pattern** - `scripts/hooks/eval-reinforce:14` (Confidence: 65%) — `grep -oE 'self-learning[:/][a-z0-9-]+'` runs against the transcript file. The regex is anchored to a known prefix (`self-learning`) and restricted to `[a-z0-9-]+`, which limits injection surface. However, the transcript file is an untrusted input containing raw user/assistant content. The fixed regex character class mitigates this risk.

- **Log file name derived from hook argument without validation** - `scripts/hooks/hook-log-init:24` (Confidence: 63%) — `_HOOK_LOG_NAME="${1:-hook}"` is used directly in `LOG_FILE="$LOG_DIR/.${_HOOK_LOG_NAME}.log"`. All callers pass hardcoded string literals (e.g., `"sidecar-capture"`), so this is not exploitable in the current codebase. Would become a concern only if the parameter were ever derived from external input.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The branch is a large DRY refactor of shell hook scripts (decomposing a 501-line monolith, extracting shared helpers) plus a TypeScript pure-function refactoring of `debug.ts`. From a security perspective, the changes are well-structured:

1. **Path traversal guard preserved** (avoids PF-006): `sidecar-evaluate:72` validates session_id with `grep -qE '^[a-zA-Z0-9_-]+$'` before using it in file paths -- carried over correctly from the pre-refactor code.
2. **Session ID validation preserved**: `eval-learning:53` continues to validate session ID format before appending to the session count file.
3. **Queue file permissions preserved**: `sidecar-capture:110` and `sidecar-dispatch:73` both create queue files with `umask 077`.
4. **Atomic file writes preserved**: All marker writes use temp+mv pattern with PID-unique temp files throughout the new eval-* modules.
5. **Debug log directories use restricted permissions**: `chmod 700` on log directories in `debug-trace:52,69` (applies ADR-007).
6. **TypeScript pure functions** (`applyDebugTrace`/`stripDebugTrace`/`readDebugStatus`): The refactoring correctly handles malformed JSON by letting `JSON.parse` throw, caught by the command's try/catch. No injection vectors.

The single blocking item (inconsistent size guard pattern in `hook-log-init`) is low-severity from a pure security standpoint but flagged HIGH because it introduces a TOCTOU inconsistency that was explicitly addressed elsewhere in this same branch.
