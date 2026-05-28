# Reliability Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27
**Prior Cycle**: 10 fixed, 6 FP, 2 deferred. Size guard, chmod 700, error suppression, soft-fail sourcing all addressed.

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing 5MB size guard on Phase 2 per-project debug log** - `scripts/hooks/debug-trace:46-59`
**Confidence**: 92%
- Problem: `devflow_debug_init` (Phase 1) applies a 5MB size guard on the global log at line 32-40, but `devflow_debug_set_cwd` (Phase 2) switches to the per-project log at `~/.devflow/logs/{slug}/.hook-debug.log` without any size guard. Every hook invocation appends debug lines to this per-project log when `DEVFLOW_HOOK_DEBUG=1` is active. With 7 hooks firing per session turn (some multiple times), per-project logs can grow without bound. This is the same class of unbounded growth the 5MB guard was designed to prevent -- it protects one log path but not the other.
- Fix: Apply the same size guard pattern when switching to the per-project log in `devflow_debug_set_cwd`:
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
  # Size guard: same 5MB/2.5MB pattern as Phase 1
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

**No size guard on normal log files introduced by soft-fail log-paths pattern** - `scripts/hooks/sidecar-capture:60-62`, `scripts/hooks/sidecar-dispatch:45-48`, `scripts/hooks/sidecar-evaluate:56-59`, `scripts/hooks/session-start-context:47-50`, `scripts/hooks/session-start-memory:38-41`, `scripts/hooks/pre-compact-memory:41-44` (6 occurrences)
**Confidence**: 82%
- Problem: This branch changes `log-paths` sourcing from hard-fail to soft-fail (`|| true` with `/tmp` fallback) and introduces new `log()` function definitions in 6 hooks. Each hook now writes to its own dedicated log file (`.working-memory-update.log`, `.sidecar-dispatch.log`, `.sidecar-evaluate.log`, `.session-start-context.log`, `.session-start-memory.log`, `.pre-compact-memory.log`). None of these 6 normal log files have any size guard. While the debug log has a 5MB guard, these normal logs are unconditional (always active, not gated by `DEVFLOW_HOOK_DEBUG`). Over weeks/months of active use, especially in projects with frequent sessions, these can accumulate unboundedly. The prior `log-paths` sourcing was hard-fail which meant logging was less reliable but fewer log paths existed. This branch makes logging more reliable (soft-fail + `/tmp` fallback) while creating 6 new unbounded log streams.
- Fix: Extract a shared size-guarded `log()` factory function that applies a size cap (e.g., 2MB) per log file, or add a periodic truncation check. A pragmatic approach: add a size check to the `log()` function itself that truncates when log exceeds 2MB:
```bash
log() {
  if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)" -gt 2097152 ]; then
    tail -c 1048576 "$LOG_FILE" > "$LOG_FILE.tmp.$$" 2>/dev/null && mv "$LOG_FILE.tmp.$$" "$LOG_FILE" 2>/dev/null || rm -f "$LOG_FILE.tmp.$$" 2>/dev/null || true
  fi
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [$1] $2" >> "$LOG_FILE" 2>/dev/null || true
}
```

### MEDIUM

**`debug.ts` reads then writes `settings.json` without file locking -- concurrent CLI invocations can lose data** - `src/cli/commands/debug.ts:25-45`
**Confidence**: 85%
- Problem: The `--enable` and `--disable` paths perform a read-modify-write cycle on `settings.json` without any file locking or atomic write pattern. If two CLI invocations run concurrently (e.g., `devflow debug --enable` while another process is writing `settings.json`), the second write can overwrite the first. This is a TOCTOU race on a shared config file. Other devflow CLI commands that modify `settings.json` likely have the same pattern, but this is new code being added in this PR.
- Fix: Use an atomic write pattern (write to temp file, then rename) and/or add a brief advisory lock. At minimum, write to a temp file first:
```typescript
const tmpPath = settingsPath + '.tmp.' + process.pid;
await fs.writeFile(tmpPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
await fs.rename(tmpPath, settingsPath);
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`sidecar-evaluate` sets EXIT trap inside conditional block but clears it late -- early exit paths leave stale locks** - `scripts/hooks/sidecar-evaluate:177,234-235`
**Confidence**: 83%
- Problem: Line 177 sets `trap 'sidecar_lock_release ...' EXIT` inside the reinforcement lock block. If the hook exits unexpectedly between lines 177 and 235 (where `trap - EXIT` clears it), the trap fires correctly. However, the trap is scoped to the `.reinforce.lock` -- if a later section (learning or decisions) also acquires a lock and the hook exits unexpectedly, the EXIT trap from the reinforcement section may have already been cleared at line 235, leaving the later lock unreleased. The new `dbg` calls added throughout the learning and decisions sections don't change this risk, but they add new execution points where the hook could fail (though unlikely given `|| true` on append). The existing code pattern is: only the reinforcement section uses an EXIT trap, while the learning-batch and decisions locks rely on reaching their respective `sidecar_lock_release` calls. This asymmetry is a latent reliability concern. The `sidecar_lock_acquire` stale-lock breaker (30s threshold) provides defense-in-depth but 30 seconds of lock contention per stuck lock is still impactful.
- Fix: Consider using a consistent trap-based cleanup pattern for all lock acquisitions, or document the reliance on stale-lock breaking as the recovery mechanism. This is low-risk given the 30s stale breaker but worth noting for future hook modifications.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`sidecar_lock_acquire` uses `stat -f %m` which is macOS-specific** - `scripts/hooks/sidecar-lock:13`
**Confidence**: 88%
- Problem: `stat -f %m` is macOS-specific syntax. On Linux, `stat -c %Y` is the equivalent. If devflow is ever used on Linux (e.g., CI environments, Linux development machines), stale lock breaking will fail silently (stat returns error, `lock_age` defaults to current time minus 0, always exceeds threshold -- so stale locks are always broken). This means on Linux, lock contention is effectively ignored rather than respected, which could cause concurrent corruption.
- Fix: Use a portable stat approach:
```bash
lock_age=$(( $(date +%s) - $(stat -f %m "$lock_dir" 2>/dev/null || stat -c %Y "$lock_dir" 2>/dev/null || echo 0) ))
```

## Suggestions (Lower Confidence)

- **Debug log lines contain unsanitized CWD paths** - `scripts/hooks/debug-trace:42,57` (Confidence: 65%) -- The `dbg` function writes `$1` directly to a log file via append redirection. If CWD or other logged values contain unexpected characters, log parsing could be affected. Low practical risk since logs are machine-local diagnostic output.

- **`devflow_debug_init` size guard has TOCTOU between wc-c check and tail** - `scripts/hooks/debug-trace:33-39` (Confidence: 62%) -- Between checking file size and performing truncation, another hook process could also be truncating. The PID-unique temp file prevents data loss, but two concurrent truncations could each keep 2.5MB resulting in a 5MB file. Acceptable since the guard is approximate, not a hard limit.

- **`load_existing_ids` in sidecar-evaluate reads entire JSONL file into memory via jq -s** - `scripts/hooks/sidecar-evaluate:152` (Confidence: 70%) -- The jq pipeline first streams then slurps all IDs into a single JSON array with `jq -s`. For very large observation logs (thousands of entries), this could consume significant memory. The node fallback at line 156 does the same via `readFileSync`. Bounded by daily caps (max 5 learning + 3 decisions runs/day) which limit log growth rate.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Reliability Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The branch introduces solid defensive patterns (soft-fail sourcing, `/tmp` fallback, PID-unique temp files, error suppression on log writes, chmod 700 on directories). However, the 5MB size guard applied only to the Phase 1 global debug log but not the Phase 2 per-project debug log is a clear omission -- the same unbounded growth risk the guard was designed to prevent still exists on the per-project path. The 6 new normal log files also lack any size bounds. The `settings.json` read-modify-write race in `debug.ts` is a moderate concern given it modifies a shared config file. Applies ADR-001 (clean break -- no backward compat complexity in the new debug CLI). Avoids PF-003 (path-dependent writes -- debug-trace correctly uses the same slug computation as log-paths).
