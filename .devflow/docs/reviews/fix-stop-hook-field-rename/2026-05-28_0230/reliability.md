# Reliability Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**EXIT trap in eval-reinforce not scoped to lock lifetime -- trap leak on early `set -e` exit between trap-set and trap-clear** - `scripts/hooks/eval-reinforce:20`, `scripts/hooks/eval-learning:70`
**Confidence**: 82%

- Problem: Both `eval-reinforce` (line 20) and `eval-learning` (line 70) set a process-wide `trap ... EXIT` inside a lock-acquire block, then clear it with `trap - EXIT` at the end of the block. These modules are `source`d sequentially into `sidecar-evaluate`, which runs under `set -e`. If eval-reinforce's lock body succeeds and clears its trap (line 78), then eval-learning acquires its own lock and sets a new EXIT trap (line 70), this works correctly. However, if `set -e` causes an exit *inside* eval-reinforce's lock body (between lines 20-77), the EXIT trap fires and releases the reinforce lock -- this is the intended safety-net behavior. The concern is that the trap is `EXIT`-scoped, not function-scoped, meaning it persists across the entire remaining process lifetime until cleared. If a non-fatal path exits the `if` block without reaching `trap - EXIT` (e.g., the `cmp -s` branch at line 38-43 where the jq command fails and falls through to `rm -f`), the trap remains set when eval-learning later replaces it with its own trap, silently discarding the reinforce cleanup. In practice the lock *is* explicitly released at line 77 before the trap is cleared at line 78, so the trap is only a safety net, but the ordering -- explicit release then clear -- means if line 77 itself fails under `set -e`, the trap fires correctly. The real risk is that future maintenance adds code between trap-set and explicit-release that could exit the `if` branch without clearing the trap, leaving a stale trap handler for a lock that was already released.
- Fix: Use a subshell `()` for the lock body so the trap is naturally scoped, or use a single cleanup function registered once at the orchestrator level that tracks which locks are currently held. Alternatively, document the invariant that each eval-* module must always pair `trap ... EXIT` with `trap - EXIT` within the same conditional block and add a comment warning about the ordering constraint.

### MEDIUM

**hook-log-init uses `wc -c` subprocess for size guard instead of `stat`** - `scripts/hooks/hook-log-init:31`
**Confidence**: 85%

- Problem: The `debug-trace` file's `_devflow_dbg_size_guard` function uses `stat -f%z` (macOS) with `stat -c%s` (Linux) fallback and `wc -c` as last resort (line 29-31). But `hook-log-init` (line 31) uses `wc -c` directly for its 2MB size guard, forking a subprocess on every hook invocation where the log file exists. This is inconsistent with the optimization already applied in `debug-trace` and adds unnecessary overhead on the hot path (every hook call).
- Fix: Extract the stat-with-fallback pattern from `_devflow_dbg_size_guard` into a shared `_file_size` helper, or replicate the `stat` cascade in `hook-log-init`:
  ```bash
  _LOG_SIZE=$(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null || wc -c < "$LOG_FILE" 2>/dev/null || echo 0)
  if [ "${_LOG_SIZE:-0}" -gt 2097152 ]; then
  ```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Node fallback in `load_existing_ids` slurps entire JSONL file into memory** - `scripts/hooks/eval-helpers:51-56`
**Confidence**: 80%

- Problem: The jq path (line 48-49) streams line-by-line to avoid memory pressure, as the comment states. But the node fallback (lines 51-56) uses `readFileSync` to load the entire file into a string, then splits, parses each line, and collects IDs. For a large `learning-log.jsonl` or `decisions-log.jsonl`, this is unbounded allocation proportional to file size. This code was extracted from the old `sidecar-evaluate` monolith (not newly written), but it is now in a shared helper that could see broader use. Applies ADR-007 (single toggle covering all hooks means all hooks share this code path).
- Fix: Use Node's readline or line-by-line streaming in the fallback, or cap the file size before slurping (the log files are capped elsewhere but not at this call site).

## Suggestions (Lower Confidence)

- **`hook-log-init` TMPDIR fallback log path is world-readable** - `scripts/hooks/hook-log-init:27-28` (Confidence: 65%) -- When `devflow_log_dir` fails and falls back to `${TMPDIR:-/tmp}`, the log file `.${_HOOK_LOG_NAME}.log` is created with default permissions. The primary `~/.devflow/logs/` path gets `chmod 700`, but the fallback does not apply restrictive permissions. Low practical risk since the fallback is rare and log content is operational (not secrets).

- **`eval-knowledge` reads `.knowledge-last-refresh` via `tr` pipeline without size bound** - `scripts/hooks/eval-knowledge:19` (Confidence: 62%) -- `tr -dc '0-9' < "$_KNOW_MARKER_FILE"` reads the entire file through tr. If the marker file were corrupted to a large size, this would consume proportional memory. In practice this file contains a single epoch timestamp (~10 chars), so the risk is theoretical.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Reliability Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The decomposition from a monolithic `sidecar-evaluate` into focused `eval-*` modules is a structural reliability improvement -- each module has a single responsibility and clear contract (documented `Requires:` header). All lock acquisitions use bounded 3-second timeouts (avoids PF-006 class of silent hangs). The `${VAR:?}` fail-fast guards in `hook-bootstrap` and `hook-log-init` enforce preconditions at source-time rather than failing silently downstream. Log size guards (2MB/1MB in hook-log-init, 5MB/2.5MB in debug-trace) prevent unbounded log growth. The EXIT trap pairing in eval-reinforce/eval-learning is functional but fragile -- the HIGH finding documents the maintenance risk rather than a current bug. The `wc -c` vs `stat` inconsistency is a minor performance gap worth aligning. Overall the changes materially improve hook reliability.
