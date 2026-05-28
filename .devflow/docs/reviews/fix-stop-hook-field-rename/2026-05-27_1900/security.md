# Security Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27
**Prior Cycle**: Resolved 20 issues (10 fixed, 6 FP, 2 deferred). Key fixes: chmod 700, log error suppression, guarded subshells, env type guard.

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Missing size guard on Phase 2 (per-project) debug log** - `scripts/hooks/debug-trace:46-59`
**Confidence**: 85%
- Problem: `devflow_debug_init` includes a 5MB size guard with tail-based truncation for the Phase 1 global log (line 33-40), but `devflow_debug_set_cwd` creates the Phase 2 per-project log without any size guard. When debug tracing is enabled, every hook invocation appends to the per-project log. Over extended debug sessions, this log can grow without bound, consuming disk space. This is a resource exhaustion vector -- not exploitable remotely, but a local denial-of-service risk for disk-constrained environments.
- Fix: Add the same 5MB size guard pattern in `devflow_debug_set_cwd` after setting `_DEVFLOW_DBG_LOG`:
```bash
devflow_debug_set_cwd() {
  local cwd="$1"
  if [ -z "$cwd" ] || [ "${DEVFLOW_HOOK_DEBUG:-}" != "1" ]; then return; fi
  local slug
  slug=$(echo "$cwd" | sed 's|^/||' | tr '/' '-')
  local project_log_dir="$HOME/.devflow/logs/$slug"
  mkdir -p "$project_log_dir" 2>/dev/null || true
  chmod 700 "$project_log_dir" 2>/dev/null || true
  _DEVFLOW_DBG_LOG="$project_log_dir/.hook-debug.log"
  # Size guard (same as Phase 1)
  if [ -f "$_DEVFLOW_DBG_LOG" ] && [ "$(wc -c < "$_DEVFLOW_DBG_LOG" 2>/dev/null || echo 0)" -gt 5242880 ]; then
    local _TAIL_TMP="$_DEVFLOW_DBG_LOG.tmp.$$"
    if tail -c 2621440 "$_DEVFLOW_DBG_LOG" > "$_TAIL_TMP" 2>/dev/null; then
      mv "$_TAIL_TMP" "$_DEVFLOW_DBG_LOG" 2>/dev/null || rm -f "$_TAIL_TMP" 2>/dev/null || true
    else
      rm -f "$_TAIL_TMP" 2>/dev/null || true
    fi
  fi
  dbg() {
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $_DEVFLOW_DBG_HOOK: $1" >> "$_DEVFLOW_DBG_LOG" 2>/dev/null || true
  }
}
```

**`/tmp` fallback for normal log files writes to world-readable directory with predictable filenames (6 hooks)** - `scripts/hooks/sidecar-capture:60`, `sidecar-dispatch:46`, `sidecar-evaluate:57`, `session-start-memory:39`, `session-start-context:48`, `pre-compact-memory:42`
**Confidence**: 80%
- Problem: All 6 hooks newly added `LOG_DIR=$(devflow_log_dir "$CWD" 2>/dev/null || echo "/tmp")`. When `devflow_log_dir` fails, `LOG_DIR` resolves to `/tmp`, producing predictable file paths like `/tmp/.working-memory-update.log`. On a multi-user system, another user could pre-create a symlink at that path pointing to a file the current user has write access to, causing log data to be appended to an unintended target (symlink attack). The risk is mitigated by: (a) log content is operational metadata (timestamps, char counts, task names) -- no secrets, prompts, or responses; (b) the `>> "$LOG_FILE" 2>/dev/null || true` pattern means symlink attacks produce a nuisance at most; (c) the fallback only triggers when `~/.devflow/logs/` creation fails, which is itself unusual.
- Fix: Use a user-private temp directory instead of bare `/tmp`:
```bash
LOG_DIR=$(devflow_log_dir "$CWD" 2>/dev/null || echo "${TMPDIR:-/tmp}")
```
`$TMPDIR` on macOS resolves to a per-user private directory (`/var/folders/.../T/`), eliminating the symlink attack surface on the primary deployment target. On Linux `TMPDIR` may not be set, but the fallback to `/tmp` is no worse than current behavior.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none -- prior cycle addressed chmod 700, log error suppression, and other pre-existing security items)

## Suggestions (Lower Confidence)

- **Non-atomic read-modify-write of settings.json** - `src/cli/commands/debug.ts:26-45` (Confidence: 65%) -- The read-parse-modify-write cycle on `settings.json` has a TOCTOU window where concurrent CLI invocations could overwrite each other's changes. This is a pre-existing pattern shared with `ambient.ts`, `flags.ts`, and `hud.ts`, so not attributable to this PR. Low practical risk since CLI commands are typically run interactively by a single user.

- **log-paths sourcing changed from hard-fail to soft-fail** - `scripts/hooks/sidecar-capture:59`, `sidecar-evaluate:56` (Confidence: 60%) -- Previously `source ... || { exit 1; }`, now `source ... || true`. If `log-paths` is missing or corrupt, the hook now continues with an undefined `devflow_log_dir` function, which means the `2>/dev/null || echo "/tmp"` fallback kicks in. This is intentional (resilience over strictness) and the fallback path is defended, but it widens the conditions under which `/tmp` logging can occur.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR demonstrates good security hygiene overall: chmod 700 on log directories (applies ADR-003 transient artifact protection), debug logging only captures metadata (lengths, key names, file paths) rather than user content, PID-unique temp files for atomic log rotation, restricted queue file permissions (umask 077), and session ID validation with path traversal guard in sidecar-evaluate. The two medium findings -- missing Phase 2 size guard and `/tmp` fallback with predictable filenames -- are low-risk in practice (single-user macOS CLI tool with no network surface) but should be addressed for defense in depth. The stop hook field rename (`response_text` -> `last_assistant_message`) correctly removes the dead `stop_reason` filter with no security regression. The `env` type guard in `debug.ts` properly validates the JSON-parsed object before mutation.

Conditions for merge: Fix the Phase 2 size guard gap (copy the existing 5MB rotation pattern). The `/tmp` fallback fix (`$TMPDIR` preference) is recommended but not blocking.
