# Consistency Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent `log-paths` error handling across hooks** - `sidecar-capture:59`, `sidecar-evaluate:56` vs `pre-compact-memory:41`, `session-start-memory:38`, `session-start-context:47`, `sidecar-dispatch:45`
**Confidence**: 85%
- Problem: Two different error handling patterns exist for sourcing `log-paths`. The pre-existing hooks `sidecar-capture` and `sidecar-evaluate` use a hard-fail pattern: `source "$SCRIPT_DIR/log-paths" || { echo "..."; exit 1; }`. The newly added logging in `pre-compact-memory:41`, `session-start-memory:38`, `session-start-context:47`, and `sidecar-dispatch:45` all use a soft-fail pattern: `source "$SCRIPT_DIR/log-paths" || true`. This creates two camps within the same PR — the new hooks silently swallow source failures while the old hooks treat them as fatal.
- Fix: Pick one pattern. The soft-fail `|| true` is more appropriate for normal logging (logging failure should not kill the hook), so the new hooks have the better pattern. However, within this PR, the four newly-added `log-paths` invocations should match each other **and** the pre-existing hooks should be updated to match. Alternatively, document the distinction: `sidecar-capture`/`sidecar-evaluate` hard-fail because logging is critical to their diagnostics, while session-start hooks soft-fail because they are informational.

### MEDIUM

**Inconsistent `log()` function error suppression** - `sidecar-capture:61`, `sidecar-evaluate:59` vs `pre-compact-memory:44`, `session-start-memory:41`, `session-start-context:50`, `sidecar-dispatch:48`
**Confidence**: 88%
- Problem: The `log()` function definition differs between the newly-added hooks and the pre-existing ones. In `sidecar-capture:61` and `sidecar-evaluate:59`, `log()` writes without error suppression: `echo "..." >> "$LOG_FILE";`. In the four hooks that received new logging (`pre-compact-memory:44`, `session-start-memory:41`, `session-start-context:50`, `sidecar-dispatch:48`), `log()` adds `2>/dev/null || true` at the end. This creates a two-pattern split within the hook system.
- Fix: Choose one `log()` function pattern and apply it to all hooks. The `2>/dev/null || true` pattern is more defensive and appropriate for hooks that must never fail due to logging I/O — use it consistently across all seven hooks.

**Inconsistent `LOG_FILE` path computation** - `sidecar-capture:60` vs `pre-compact-memory:42-43`, `session-start-memory:39-40`, `session-start-context:48-49`, `sidecar-dispatch:46-47`
**Confidence**: 85%
- Problem: The newly-added logging uses a two-step pattern with an intermediate `LOG_DIR` variable and `/tmp` fallback: `LOG_DIR=$(devflow_log_dir "$CWD" 2>/dev/null || echo "/tmp")` + `LOG_FILE="$LOG_DIR/.hook-name.log"`. The pre-existing `sidecar-capture:60` uses a direct one-step pattern: `LOG_FILE="$(devflow_log_dir "$CWD")/.working-memory-update.log"` without a `/tmp` fallback. Both `sidecar-evaluate:57` and `sidecar-capture:60` lack the fallback. The new hooks are more defensive but diverge from the established pattern.
- Fix: Standardize on the defensive two-step pattern with `/tmp` fallback across all hooks. This is the better approach. Also consider giving `sidecar-capture` a hook-specific log file name (`.sidecar-capture.log`) instead of `.working-memory-update.log` for naming consistency with `sidecar-dispatch` and `sidecar-evaluate`.

**Missing `dbg` on feedback-loop exits in `sidecar-dispatch` and `sidecar-evaluate`** - `sidecar-dispatch:14-16`, `sidecar-evaluate:13-15`
**Confidence**: 82%
- Problem: In `sidecar-capture:21-23`, the feedback-loop guard checks include debug tracing: `if [ ... ]; then dbg "EXIT: bg_updater"; exit 0; fi`. But the equivalent guards in `sidecar-dispatch:14-16` and `sidecar-evaluate:13-15` exit without any `dbg` call. Since these guards fire *before* `devflow_debug_init` in `sidecar-dispatch`/`sidecar-evaluate`, the `dbg` would be a no-op anyway (the safe fallback), so the inconsistency is harmless at runtime. But `sidecar-capture` moved its feedback-loop guards *after* `devflow_debug_init`, creating a structural divergence in the ordering of: feedback-loop guard vs debug-init vs json-parse sourcing.
- Fix: For consistency, either (a) move `sidecar-dispatch` and `sidecar-evaluate` feedback-loop guards after `devflow_debug_init` (matching `sidecar-capture`), or (b) accept the ordering difference and document it — the feedback-loop guards are intentionally before debug-init for minimal overhead in sidecar subagents.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Missing `dbg "=== HOOK COMPLETE ==="` in `preamble`** - `preamble:44`
**Confidence**: 90%
- Problem: All six other hooks that received debug tracing end with `dbg "=== HOOK COMPLETE ==="`. The `preamble` hook does not. The hook's flow ends inside an `if/else` block without a final completion marker. This makes `preamble` the only hook missing the bookend debug trace.
- Fix: Add `dbg "=== HOOK COMPLETE ==="` at the end of `preamble`:
```bash
if [[ "$PROMPT" == *"## Goal"* ]] && [[ "$PROMPT" == *"## Steps"* ]] && [[ "$PROMPT" == *"## Files"* ]]; then
  dbg "EXECUTION_PLAN detected — injecting directive"
  json_prompt_output "EXECUTION_PLAN detected. Invoke \`devflow:implement\` via the Skill tool to execute this plan."
else
  dbg "No plan markers detected — no output"
fi

dbg "=== HOOK COMPLETE ==="
```

**Missing normal `log()` in `preamble`** - `preamble`
**Confidence**: 80%
- Problem: Four hooks received new normal logging (`log()` via `log-paths`) in this PR: `pre-compact-memory`, `session-start-memory`, `session-start-context`, `sidecar-dispatch`. The `preamble` hook was not given normal logging. While `preamble` is simpler (plan detection only), this creates an inconsistency where some hooks have both `dbg()` + `log()` and preamble has only `dbg()`.
- Fix: Either add normal logging to `preamble` for consistency, or explicitly document that `preamble` is too lightweight to warrant normal logging (it does no I/O beyond JSON output).

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`sidecar-capture` log file name does not follow hook-name convention** - `sidecar-capture:60`
**Confidence**: 85%
- Problem: All other hooks name their log files after the hook: `.sidecar-dispatch.log`, `.sidecar-evaluate.log`, `.session-start-memory.log`, `.session-start-context.log`, `.pre-compact-memory.log`. But `sidecar-capture` uses `.working-memory-update.log`. This predates this PR but is now more visually inconsistent with the newly added log files.

**Inconsistent feedback-loop guard syntax** - `sidecar-evaluate:13-15` vs `sidecar-capture:21-23` and `sidecar-dispatch:14-16`
**Confidence**: 82%
- Problem: `sidecar-evaluate` uses the compact `[ ... ] && exit 0` form while `sidecar-capture` and `sidecar-dispatch` use `if [ ... ]; then ... exit 0; fi`. Both are valid bash but represent different styles within the same hook system.

## Suggestions (Lower Confidence)

- **Internal variable `RESPONSE_TEXT` after field rename** - `sidecar-capture:46` (Confidence: 65%) -- The JSON field was renamed from `response_text` to `last_assistant_message`, but the internal bash variable is still `RESPONSE_TEXT`. Renaming the variable would improve traceability between the JSON field and the bash variable, though internal names are not contractual.

- **`sidecar-dispatch` logs CWD before `devflow_debug_set_cwd`** - `sidecar-dispatch:34` (Confidence: 70%) -- `dbg "CWD=$CWD PROMPT_LENGTH=${#PROMPT}"` fires before `devflow_debug_set_cwd` on line 38, meaning this message goes to the global fallback log. All other hooks log CWD *after* `devflow_debug_set_cwd`. The message is not lost (it goes to the Phase 1 global log), but the ordering diverges from the pattern used in other hooks.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 3 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Consistency Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The debug tracing system is well-designed — the `debug-trace` shared helper with two-phase logging (global then per-project) is clean and the `dbg()` no-op fallback pattern is applied uniformly across all 7 hooks. The `response_text` to `last_assistant_message` field rename is thorough — zero remnants of the old field names remain in hooks or tests (applies ADR-001: clean break, no compat shim for the old field name). The `stop_reason` filter removal is clean.

The consistency issues are all within the newly-added normal logging layer: the `log()` function definition, `log-paths` error handling, and `LOG_FILE` path computation use two different patterns depending on whether the hook is pre-existing (`sidecar-capture`/`sidecar-evaluate`) or newly instrumented. These should be unified before merge to prevent the hook system from developing two logging conventions.
