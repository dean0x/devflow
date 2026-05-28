# Architecture Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27
**PR**: #228

## Issues in Your Changes (BLOCKING)

### HIGH

**debug.ts duplicates settings.json read/write logic instead of using pure-function pattern** - `src/cli/commands/debug.ts:19-81`
**Confidence**: 88%
- Problem: The `debug.ts` command inlines the entire settings.json read-parse-mutate-write cycle directly inside its `action()` handler. Every other settings-mutating command in the codebase (`flags.ts`, `ambient.ts`, `hud.ts`) uses a pure-function pattern: `applyX(settingsJson: string): string` / `stripX(settingsJson: string): string` that accepts the raw JSON string and returns the transformed string. The caller handles file I/O separately. `debug.ts` instead couples file I/O, JSON parsing, env-object mutation, and file writing into a single monolithic action handler — violating both DIP and the established codebase convention.
- Impact: Cannot unit-test the env mutation logic without filesystem mocks. Cannot reuse the enable/disable logic from `devflow init` or other orchestrators. The test file (`debug.test.ts`) already demonstrates this pain: it duplicates the entire enable/disable/read logic as standalone functions (`applyEnable`, `applyDisable`, `readDebugState`) rather than importing them from the command, precisely because the command doesn't export testable pure functions.
- Fix: Extract `applyDebugTrace(settingsJson: string): string` and `stripDebugTrace(settingsJson: string): string` as pure functions in a utility (either `flags.ts` or a new `debug-utils.ts`), following the `applyFlags`/`stripFlags` pattern. The command action becomes a thin I/O wrapper calling these functions.

```typescript
// src/cli/utils/debug-trace.ts (or colocate in flags.ts)
export function applyDebugTrace(settingsJson: string): string {
  const settings = JSON.parse(settingsJson) as Record<string, unknown>;
  const env = (typeof settings.env === 'object' && settings.env !== null && !Array.isArray(settings.env))
    ? settings.env as Record<string, string>
    : {};
  env.DEVFLOW_HOOK_DEBUG = '1';
  settings.env = env;
  return JSON.stringify(settings, null, 2) + '\n';
}

export function stripDebugTrace(settingsJson: string): string {
  const settings = JSON.parse(settingsJson) as Record<string, unknown>;
  const env = (typeof settings.env === 'object' && settings.env !== null && !Array.isArray(settings.env))
    ? settings.env as Record<string, string>
    : {};
  delete env.DEVFLOW_HOOK_DEBUG;
  if (Object.keys(env).length === 0) delete settings.env;
  else settings.env = env;
  return JSON.stringify(settings, null, 2) + '\n';
}
```

**Test file duplicates production logic instead of importing it** - `tests/debug.test.ts:24-89`
**Confidence**: 85%
- Problem: The test file creates its own `applyEnable()`, `applyDisable()`, and `readDebugState()` functions that re-implement the settings.json manipulation logic from `debug.ts`. The test header explicitly acknowledges this: "These tests bypass the commander layer and directly exercise the settings.json read/write behavior expected from the debug command." This means the tests validate the duplicated logic, not the actual production code path. If the production code diverges, tests still pass.
- Impact: Tests provide false confidence — they test a copy, not the source. This is exactly the anti-pattern called out in the project's CLAUDE.md quality standards: "If tests need complex setup, the design is probably wrong."
- Fix: Once the pure functions are extracted (see finding above), tests import and call `applyDebugTrace`/`stripDebugTrace` directly — no duplication needed.

### MEDIUM

**Per-project debug logs lack the size guard present in global debug log** - `scripts/hooks/debug-trace:46-59`
**Confidence**: 82%
- Problem: `devflow_debug_init()` includes a 5MB size guard with tail-based truncation for the global `~/.devflow/logs/.hook-debug.log`. However, `devflow_debug_set_cwd()` creates per-project log files at `~/.devflow/logs/{slug}/.hook-debug.log` without any size guard. Since hooks fire on every turn and most of the hook execution happens after CWD is resolved (Phase 2), the per-project logs will accumulate the majority of debug output and grow without bound.
- Fix: Extract the size-guard logic into a reusable function and call it in both `devflow_debug_init` and `devflow_debug_set_cwd`:

```bash
_devflow_dbg_size_guard() {
  local log_file="$1"
  if [ -f "$log_file" ] && [ "$(wc -c < "$log_file" 2>/dev/null || echo 0)" -gt 5242880 ]; then
    local tmp="$log_file.tmp.$$"
    if tail -c 2621440 "$log_file" > "$tmp" 2>/dev/null; then
      mv "$tmp" "$log_file" 2>/dev/null || rm -f "$tmp" 2>/dev/null || true
    else
      rm -f "$tmp" 2>/dev/null || true
    fi
  fi
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Inconsistent feedback-loop guard placement across sidecar hooks** - `scripts/hooks/sidecar-dispatch:14-16` vs `scripts/hooks/sidecar-capture:21-23`
**Confidence**: 83%
- Problem: In `sidecar-capture`, the feedback-loop guards (`DEVFLOW_BG_UPDATER`, `DEVFLOW_BG_LEARNER`, `DEVFLOW_BG_KNOWLEDGE_REFRESH`) were moved after `debug-trace` sourcing and annotated with `dbg` calls. In `sidecar-dispatch` and `sidecar-evaluate`, the guards remain before `debug-trace` sourcing, so background sessions exit silently with no debug trace. This is an inconsistency in the hook initialization sequence that this PR introduced — the same pattern should be applied uniformly.
- Impact: When debugging sidecar feedback loops, `sidecar-capture` will show "EXIT: bg_updater" in the debug log, but `sidecar-dispatch` and `sidecar-evaluate` will show nothing — making it harder to trace why a hook exited early for background sessions.
- Fix: For `sidecar-dispatch` and `sidecar-evaluate`, move the feedback-loop guards after `debug-trace` sourcing and add `dbg` annotations, matching the `sidecar-capture` pattern. The early-exit behavior is unchanged (these are the first checks after init), but debug traceability becomes consistent.

**Dual logging system (dbg + log) without clear separation of responsibilities** - multiple hooks
**Confidence**: 80%
- Problem: Every hook now has two logging functions: `dbg()` for debug tracing and `log()` for normal operational logging. Both write to files under `~/.devflow/logs/{slug}/`. The debug log goes to `.hook-debug.log` and the operational log goes to per-hook files (`.sidecar-capture.log`, `.session-start-memory.log`, etc.). Several log statements are duplicated across both systems (e.g., `sidecar-capture` lines 137-138: `log "Queue overflow..."` then `dbg "Queue overflow..."`). The prior review cycle noted this as a deferred coupling concern, and this PR has not changed it — however, the new `dbg` additions further expand the overlap.
- Impact: Disk usage is doubled for shared messages. The two systems have different lifecycle management (debug has a 5MB truncation; operational logs have none). Developers must remember to add both calls when adding a new log point, creating maintenance overhead.
- Fix: This is deferred from the prior cycle (acknowledged). No blocking action needed. When addressing in the future: consider making `log()` forward to `dbg()` automatically when debug is enabled, eliminating the need for paired calls.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`sidecar-evaluate` is a 496-line monolithic script** - `scripts/hooks/sidecar-evaluate`
**Confidence**: 85%
- Problem: This script handles learning batching, decisions detection, and knowledge refresh — three independent features — in a single file. It was noted as deferred in the prior review cycle.
- Impact: Adding debug tracing to this script (22 `dbg` calls) further increases its cognitive load. Each feature section should be an independently sourceable module.
- Note: Deferred from prior cycle. Informational only.

## Suggestions (Lower Confidence)

- **Debug-trace `dbg()` redefinition pattern uses shell function override** - `scripts/hooks/debug-trace:41-43,56-58` (Confidence: 68%) -- `dbg()` is redefined by `devflow_debug_init` and again by `devflow_debug_set_cwd`, each creating a new function body with a different `_DEVFLOW_DBG_LOG` reference. This works because bash functions reference globals at call time, but the repeated function definitions are unusual and could confuse maintainers expecting a variable-based approach (e.g., just changing `_DEVFLOW_DBG_LOG` and having a single `dbg()` that reads it). The current approach works correctly but a single `dbg()` referencing the global variable would be simpler.

- **`debug.ts` env mutation does not use defensive copy** - `src/cli/commands/debug.ts:36-40` (Confidence: 62%) -- The `env` variable is cast directly from `settings.env` without spreading, so mutations to `env` (adding/deleting keys) mutate the original `settings.env` object in-place before the write. This works for the current flow but is fragile if the code is ever refactored to have conditional writes.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The core debug-trace infrastructure (shared helper, two-phase logging, size guards, safe fallbacks) is well-designed and follows the existing hook sourcing pattern. The stop hook field rename (`response_text` -> `last_assistant_message`) is clean and correctly removes the `stop_reason` filter.

The primary architectural concern is that `debug.ts` breaks the established pure-function pattern for settings.json mutation used by every other command (`applyFlags`/`stripFlags`, `addAmbientHook`/`removeAmbientHook`, `addHudStatusLine`/`removeHudStatusLine`). This results in untestable monolithic action handlers and test files that duplicate production logic. The per-project debug log size guard gap is a secondary concern (unbounded growth in the path that handles most debug output).

ADR-001 (clean break philosophy) is respected: the `response_text` -> `last_assistant_message` rename is a clean break with no backward compatibility shim. The `stop_reason` filter removal is architecturally sound since `last_assistant_message` presence is sufficient to gate capture.
