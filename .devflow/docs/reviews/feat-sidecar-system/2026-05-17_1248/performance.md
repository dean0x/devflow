# Performance Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Scope**: Incremental (7 new commits since d8e7670)

## Issues in Your Changes (BLOCKING)

### HIGH

**`devflow_log_dir` spawns 4 subprocesses on every stop hook invocation** - `scripts/hooks/sidecar-capture:56`
**Confidence**: 92%
- Problem: `devflow_log_dir` in `log-paths` runs `sed` + `tr` + `mkdir -p` + `chmod 700` every time it is called. This produces 4 subprocess forks + 2 syscalls on every assistant response. The `mkdir -p` and `chmod` are idempotent after the first call but still exec a binary each time. On the hot path (every response), this adds ~8-12ms of latency.
- Fix: Cache the computed log dir in a variable at script level. After the first call, `mkdir -p` and `chmod` are wasted work. Use a sentinel pattern:
```bash
# In log-paths, cache after first computation:
_DEVFLOW_LOG_DIR_CACHE=""
devflow_log_dir() {
  local cwd="$1"
  if [ -n "$_DEVFLOW_LOG_DIR_CACHE" ]; then
    echo "$_DEVFLOW_LOG_DIR_CACHE"
    return
  fi
  local slug=$(echo "$cwd" | sed 's|^/||' | tr '/' '-')
  local dir="$HOME/.devflow/logs/$slug"
  mkdir -p "$dir"
  chmod 700 "$dir"
  _DEVFLOW_LOG_DIR_CACHE="$dir"
  echo "$dir"
}
```

---

**`sidecar-dispatch` stale-retry loop runs `cat` + `get_mtime` per .processing file on every prompt** - `scripts/hooks/sidecar-dispatch:77-100`
**Confidence**: 85%
- Problem: On every user prompt, the stale-retry loop iterates up to 10 `.processing` files. For each file: one `stat` call (via `get_mtime`) and potentially one `cat "$RETRY_FILE"` (a subprocess fork). In the normal case with 0 processing files the glob matches nothing and the cost is negligible. But if even 1-2 stale files accumulate (e.g., after a crash), every subsequent prompt pays ~5-8ms per file in stat + cat subprocesses. The `NOW=$(date +%s)` call (line 73) also adds a subprocess that could be avoided when there are no .processing files.
- Fix: Gate the expensive work behind the glob match. Move `NOW=$(date +%s)` inside the loop (first iteration only) and read the retry count with shell builtins instead of `cat`:
```bash
# Only compute NOW if we actually have processing files
_STALE_NOW=""
for PROC_FILE in "$SIDECAR_DIR"/*.processing; do
  [ -f "$PROC_FILE" ] || continue
  [ -z "$_STALE_NOW" ] && _STALE_NOW=$(date +%s)
  PROC_COUNT=$(( PROC_COUNT + 1 ))
  [ "$PROC_COUNT" -gt "$PROC_LIMIT" ] && break
  PROC_MTIME=$(get_mtime "$PROC_FILE")
  PROC_MTIME="${PROC_MTIME:-0}"
  PROC_AGE=$(( _STALE_NOW - PROC_MTIME ))
  if [ "$PROC_AGE" -gt 300 ]; then
    BASE="${PROC_FILE%.processing}"
    RETRY_FILE="${BASE}.retries"
    RETRY_COUNT=0
    [ -f "$RETRY_FILE" ] && read -r RETRY_COUNT < "$RETRY_FILE" 2>/dev/null
    # ... rest unchanged
  fi
done
```
The `read -r RETRY_COUNT < "$RETRY_FILE"` avoids forking a `cat` subprocess for a single-line file.

---

### MEDIUM

**`sidecar-capture` reads queue file twice with `wc -l` then `grep` on the common path** - `scripts/hooks/sidecar-capture:85-86`
**Confidence**: 82%
- Problem: Lines 85-86 run `wc -l < "$QUEUE_FILE"` (one fork + full file read) and then immediately `grep -qF '"role":"assistant"' "$QUEUE_FILE"` (another fork + full file read). These are two sequential reads of the same file. For a 200-line queue file (the overflow cap), that is two full scans on every assistant response.
- Fix: Combine into a single pass. Since the intent is "if queue has lines but no assistant entry, truncate", you can skip the `wc -l` entirely — `grep -qF` already returns 1 on empty files:
```bash
if [ -f "$QUEUE_FILE" ] && [ -s "$QUEUE_FILE" ]; then
  if ! grep -qF '"role":"assistant"' "$QUEUE_FILE" 2>/dev/null; then
    log "Auto-clean: truncating orphan user-only queue"
    : > "$QUEUE_FILE"
  fi
fi
```
`[ -s "$QUEUE_FILE" ]` is a shell builtin (zero-cost stat check for non-empty). This saves one `wc -l` subprocess fork on every invocation.

---

**Config file re-read from disk on every hook invocation (no caching across prompt cycle)** - `scripts/hooks/sidecar-dispatch:34-36`, `scripts/hooks/sidecar-capture:44-46`
**Confidence**: 80%
- Problem: Both `sidecar-dispatch` and `sidecar-capture` open and parse `.memory/.sidecar/config.json` via `json_field_file` (one jq subprocess) on every invocation. A single prompt-response cycle reads this config file twice (once per hook). The file is user-modified only via `devflow` CLI commands (never mid-session), so its content is effectively static during the session.
- Fix: This is a structural limitation of hook-based architecture (each hook is a separate process). No fix within the current model. Documenting as a known cost (~2-3ms per read with jq). If this ever becomes a concern, consider writing a single-field `.memory/.sidecar/.memory-enabled` sentinel file that can be tested with `[ -f ... ]` (a syscall, not a subprocess).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`ensure-memory-gitignore` sourced unconditionally on every dispatch even when memory disabled would skip the write** - `scripts/hooks/sidecar-dispatch:40`
**Confidence**: 80%
- Problem: `source "$SCRIPT_DIR/ensure-memory-gitignore" "$CWD"` runs inside the `if [ "$MEMORY_ENABLED" = "true" ]` block, so it only executes when memory is enabled. However, the `ensure-memory-gitignore` script calls `mkdir -p` on every invocation (line 11 of the sourced file). After the first session, the `.gitignore-configured` marker exists, so only `mkdir -p` runs — which is fast but still a syscall fork on every prompt.
- Fix: Guard `mkdir -p` behind an existence check:
```bash
# In ensure-memory-gitignore:
[ -d "$_MEMORY_DIR/decisions" ] || mkdir -p "$_MEMORY_DIR/decisions" 2>/dev/null || return 1
```
This converts the common-path cost from a subprocess (`mkdir`) to a shell builtin (`[ -d ]`).

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`sidecar-capture` line 56: `devflow_log_dir` runs mkdir + chmod unconditionally** - `scripts/hooks/log-paths:8-10`
**Confidence**: 85%
- Problem: Pre-existing issue in `log-paths` — the function always calls `mkdir -p` and `chmod 700`, even though after the first call the directory exists. This is 2 subprocess forks for no reason on every subsequent invocation.
- Impact: ~4-6ms per call. Called once per `sidecar-capture` invocation = once per assistant response.

## Suggestions (Lower Confidence)

- **Multiple `date +%s` calls per hook** - `sidecar-capture:92`, `sidecar-dispatch:73` (Confidence: 70%) — Each `date +%s` is a subprocess fork (~2ms). Both hooks call it; sidecar-capture calls it even when it will exit early at the throttle check. Consider computing once at the top if the value is needed.

- **`source get-mtime` loaded eagerly in sidecar-dispatch even when sidecar dir may not exist** - `scripts/hooks/sidecar-dispatch:17` (Confidence: 65%) — The `get-mtime` helper is sourced unconditionally (line 17), but is only used in the stale-retry loop (line 81) which only executes when `.processing` files exist. In the common case (no stale files), the source is wasted overhead. Shell sourcing is cheap (~0.1ms), so this is minor.

- **Queue overflow check (`wc -l` + `tail` + `mv`) runs on every stop hook** - `scripts/hooks/sidecar-capture:102-107` (Confidence: 65%) — The `wc -l` on line 103 forks a subprocess on every response. In practice the queue rarely exceeds 200 lines (requires 100+ prompts without a memory update), so this fires almost never but costs ~2ms always.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Performance Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The hot-path hooks are generally well-designed with good early-exit patterns and jq-preferred paths. The main concerns are cumulative subprocess overhead from utility calls that could be avoided with shell builtins (`[ -s ]`, `[ -d ]`, `read`) and caching patterns. None are individually severe (~2-12ms each) but they compound: a single prompt-response cycle touches both hooks, totaling an estimated 30-50ms of avoidable subprocess overhead in the worst case. The changes in this PR (grep pre-filter for decisions scanner, bounded retry loop, `get_mtime` factoring) are net-positive performance improvements.
