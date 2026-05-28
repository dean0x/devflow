# Consistency Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27

## Issues in Your Changes (BLOCKING)

### HIGH

**Feedback-loop guards: inconsistent debug tracing across sidecar hooks (3 occurrences)** - Confidence: 88%
- `scripts/hooks/sidecar-dispatch:14-16`, `scripts/hooks/sidecar-evaluate:13-15`
- Problem: `sidecar-capture` moved its feedback-loop guards (`DEVFLOW_BG_*` checks) after `debug-trace` sourcing and added `dbg` exit annotations. The other two sidecar hooks (`sidecar-dispatch`, `sidecar-evaluate`) keep their guards before `debug-trace` with no `dbg` calls. The PR description states "all hooks now follow same debug-trace sourcing pattern" but these two hooks deviate. `sidecar-dispatch` also uses `if [...]; then exit 0; fi` syntax while `sidecar-evaluate` uses `[...] && exit 0` for the same logical pattern.
- Fix: Two options (both valid):
  - **Option A** (match sidecar-capture): Move feedback-loop guards after `debug-trace` sourcing and add `dbg "EXIT: bg_*"` to each:
    ```bash
    # sidecar-dispatch and sidecar-evaluate:
    source "$SCRIPT_DIR/debug-trace" || true
    devflow_debug_init "sidecar-dispatch"
    dbg "=== HOOK START ==="

    if [ "${DEVFLOW_BG_UPDATER:-}" = "1" ]; then dbg "EXIT: bg_updater"; exit 0; fi
    if [ "${DEVFLOW_BG_LEARNER:-}" = "1" ]; then dbg "EXIT: bg_learner"; exit 0; fi
    if [ "${DEVFLOW_BG_KNOWLEDGE_REFRESH:-}" = "1" ]; then dbg "EXIT: bg_knowledge"; exit 0; fi
    ```
  - **Option B** (performance-first): Keep guards before debug-trace (avoids sourcing debug-trace in background agent sessions), but make the guard syntax consistent (`if [...]; then exit 0; fi` everywhere, not `[...] && exit 0`).

**`devflow_debug_set_cwd` called before CWD validation in sidecar-capture** - `scripts/hooks/sidecar-capture:48` - Confidence: 85%
- Problem: In `sidecar-capture`, `devflow_debug_set_cwd "$CWD"` is called at line 48, before the CWD validation at line 52 (`if [ -z "$CWD" ] || [ ! -d "$CWD" ]`). All other 6 hooks validate CWD first, then call `devflow_debug_set_cwd`. When CWD is empty, this attempts to create a log directory at `~/.devflow/logs/-/` (from `sed 's|^/||'` on empty string). The function has an early-return guard for empty CWD, but the ordering breaks the established pattern.
- Fix: Move `devflow_debug_set_cwd` after the CWD validation:
  ```bash
  CWD=$(printf '%s' "$_FIELDS" | cut -d$'\001' -f1)
  RESPONSE_TEXT=$(printf '%s' "$_FIELDS" | cut -d$'\001' -f2-)

  if [ -z "$CWD" ] || [ ! -d "$CWD" ]; then dbg "EXIT: bad CWD"; exit 0; fi

  devflow_debug_set_cwd "$CWD"
  dbg "CWD=$CWD"
  dbg "RESPONSE_TEXT length=${#RESPONSE_TEXT}"
  ```

### MEDIUM

**CWD validation strictness varies across hooks** - Confidence: 82%
- `scripts/hooks/sidecar-capture:52`, `scripts/hooks/sidecar-dispatch:36`, `scripts/hooks/preamble:30` vs `scripts/hooks/sidecar-evaluate:29`, `scripts/hooks/session-start-memory:25`, `scripts/hooks/session-start-context:30`, `scripts/hooks/pre-compact-memory:28`
- Problem: Three hooks validate both emptiness and directory existence (`-z "$CWD" || ! -d "$CWD"`), while four hooks only check emptiness (`-z "$CWD"`). This was pre-existing but the new dbg annotation work touched all of these exit paths, making this a reasonable time to unify. The UserPromptSubmit/Stop hooks check `-d` (CWD could be a deleted temp dir), while SessionStart/PreCompact hooks don't.
- Fix: Apply `[ -z "$CWD" ] || [ ! -d "$CWD" ]` consistently. The `-d` check is defensive and costs one stat syscall.

**sidecar-dispatch missing `dbg` exit annotations on early exit points** - `scripts/hooks/sidecar-dispatch:26,36` - Confidence: 84%
- Problem: `sidecar-dispatch` line 26 (`_JSON_AVAILABLE = false`) and line 36 (`-z CWD || ! -d CWD`) exit silently without `dbg` annotations, while `sidecar-capture` annotates every equivalent exit path. Within the scope of this PR's goal ("all hooks now follow same debug-trace sourcing pattern"), these are missed.
- Fix: Add `dbg` to each:
  ```bash
  if [ "$_JSON_AVAILABLE" = "false" ]; then dbg "EXIT: no json"; exit 0; fi
  # ...
  if [ -z "$CWD" ] || [ ! -d "$CWD" ]; then dbg "EXIT: bad CWD"; exit 0; fi
  ```

**CLI option processing order: debug.ts differs from learn.ts/decisions.ts** - `src/cli/commands/debug.ts:42-77` - Confidence: 80%
- Problem: `debug.ts` processes options as `enable -> disable -> status`, while `learn.ts` processes them as `status -> enable -> disable`. Since status is read-only and the most common diagnostic operation, the established pattern puts it first.
- Fix: Reorder to `status -> enable -> disable` to match existing commands.

## Issues in Code You Touched (Should Fix)

_None._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**sidecar-evaluate feedback-loop guard syntax uses `[...] && exit 0` while all other hooks use `if [...]; then exit 0; fi`** - `scripts/hooks/sidecar-evaluate:13-15` - Confidence: 85%
- Problem: Pre-existing style inconsistency. `sidecar-evaluate` uses the terse `[ ... ] && exit 0` form for its feedback-loop guards, while `sidecar-capture` and `sidecar-dispatch` both use `if [ ... ]; then exit 0; fi`. Under `set -e`, the `&& exit 0` form is functionally equivalent but visually inconsistent.
- Fix: Normalize to `if [...]; then exit 0; fi` for consistency with the other sidecar hooks.

## Suggestions (Lower Confidence)

- **preamble lacks normal logging (log-paths/log function)** - `scripts/hooks/preamble` (Confidence: 65%) -- All other hooks that write output now have both `dbg()` and `log()`. Preamble only has `dbg()`. This may be intentional given preamble's minimal scope, but deviates from the pattern established by the other 6 hooks.

- **debug-trace dbg() function body duplicated in `devflow_debug_init` and `devflow_debug_set_cwd`** - `scripts/hooks/debug-trace:41-43,56-58` (Confidence: 62%) -- The `dbg()` function body is defined identically in two places (lines 41-43 and 56-58), differing only in which `_DEVFLOW_DBG_LOG` they close over. A single definition using the variable dynamically (`>> "$_DEVFLOW_DBG_LOG"`) would avoid the duplication, but the current approach may be intentional for shell scoping reasons.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The debug-trace integration is well-structured and the field rename (`response_text` -> `last_assistant_message`, removal of `stop_reason` filter) is clean and complete. The two-step LOG_DIR/LOG_FILE pattern and soft-fail log-paths sourcing are now consistent across all 6 hooks that use logging (applies ADR-001 -- clean break from old hard-fail pattern). However, the PR's stated goal of "all hooks now follow same debug-trace sourcing pattern" has a few remaining deviations: feedback-loop guard placement relative to debug-trace differs between `sidecar-capture` and the other two sidecar hooks, and `sidecar-dispatch` is missing `dbg` exit annotations that the other hooks have. The `devflow_debug_set_cwd` ordering bug in `sidecar-capture` (called before CWD validation) should also be fixed for pattern consistency.
