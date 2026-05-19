# Performance Review Report

**Branch**: fix/learning-validation-and-debug-logs -> main
**Date**: 2026-03-25

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Debug logging writes unbounded model response to log file** - `scripts/hooks/background-learning:357-359`
**Confidence**: 85%
- Problem: When `DEBUG=true`, the raw model response (potentially many KB of JSON) is written to the log file via three separate `log` calls. The `log()` function appends to the log file once per call, meaning 3 separate file open/write/close cycles for what could be a large payload. Additionally, the `rotate_log` function now allows up to 500 lines in debug mode. Combined with verbose debug entries (raw response, user messages, existing observations), a single debug run could add 50+ lines to the log, and with 10 daily runs, the log can grow to 500+ lines between rotations.
- Fix: This is a background hook so user-facing latency is not affected. However, the unbounded response size piped through `log` could cause shell variable expansion issues for very large responses. Consider writing debug output directly to the file with `echo "$RESPONSE" >> "$LOG_FILE"` in a single operation, or truncating the response before logging:
  ```bash
  if [ "$DEBUG" = "true" ]; then
    log "--- DEBUG: Raw model response (first 2000 chars) ---"
    log "${RESPONSE:0:2000}"
    log "--- DEBUG: End raw response ---"
  fi
  ```

### LOW

**`rotate_log` called after `load_config` changes order — now reads DEBUG before config is loaded** - `scripts/hooks/background-learning:618-619`
**Confidence**: 82%
- Problem: The order was swapped from `rotate_log; load_config` to `load_config; rotate_log`. This is correct — `rotate_log` now depends on `DEBUG` which is set by `load_config`. However, the `rotate_log` function references `${DEBUG:-false}` with a fallback, meaning the old order would have silently worked (just always using the 100-line threshold). The new order is actually a performance improvement since it respects the configured thresholds. No issue here — this is a positive change.
- Fix: None needed. Noted for completeness.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Duplicate file reads in `--status` and `--list` commands** - `src/cli/commands/learn.ts:291-293`, `src/cli/commands/learn.ts:314-316`
**Confidence**: 82%
- Problem: Both `--status` and `--list` now read the full JSONL file, split it into lines, filter for non-empty, count them, then call `parseLearningLog` which splits and filters again. This means each command does `content.split('\n').filter(l => l.trim())` twice — once for `rawLineCount` and once inside `parseLearningLog`. For a learning log with ~100 entries, this is negligible. However, the pattern duplicates work.
- Fix: Extract a helper or modify `parseLearningLog` to return both valid entries and total line count:
  ```typescript
  function parseLearningLogWithStats(logContent: string): { observations: LearningObservation[]; rawLineCount: number } {
    const lines = logContent.split('\n').filter(l => l.trim());
    const observations = lines.flatMap(line => {
      try {
        const parsed = JSON.parse(line);
        return isLearningObservation(parsed) ? [parsed] : [];
      } catch { return []; }
    });
    return { observations, rawLineCount: lines.length };
  }
  ```

**Node.js fallback for filtering contaminated entries spawns a full Node process** - `scripts/hooks/background-learning:256`
**Confidence**: 80%
- Problem: When `jq` is not available, the script spawns a `node` process to filter observations with empty fields: `node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));..."`. This is a new `node` process spawn in the prompt-building path. Combined with the existing node spawns in `json_extract_messages`, `json_slurp_sort`, etc., this adds one more subprocess to the pipeline. Each node spawn has ~50-100ms startup overhead.
- Fix: This is consistent with the existing fallback pattern in the codebase (jq-preferred with node fallback), so it follows established conventions. The impact is low since this runs in a background process. However, if this filtering could be done with `grep -v` or shell string matching instead, it would avoid the subprocess:
  ```bash
  # Shell-only alternative (less precise but avoids node spawn)
  EXISTING_OBS=$(echo "$EXISTING_OBS" | node -e "..." )
  # Could be replaced with grep-based filtering if the JSON structure is predictable
  ```
  Given the established pattern, this is acceptable as-is.

## Pre-existing Issues (Not Blocking)

### HIGH

**PF-004: Background learning script is a 660-line god script** - `scripts/hooks/background-learning`
**Confidence**: 90%
- Problem: Known pitfall PF-004 identified this script as concentrating 7+ responsibilities. This PR adds ~60 more lines (validation, debug logging, contamination filtering), growing it from ~604 to ~662 lines. The per-line JSON processing in `apply_temporal_decay` (lines 196-227) spawns multiple `json_field`/`json_update_field_json` calls per line, each potentially spawning a `jq` or `node` subprocess. With 100 entries, this is 300-600 subprocess spawns.
- Fix: Already documented in PF-004 — move JSON-heavy logic to TypeScript. Not blocking for this PR.

### HIGH

**PF-006: Per-line jq/node spawning in hooks** - `scripts/hooks/background-learning:196-227`
**Confidence**: 90%
- Problem: Known pitfall PF-006 about per-line subprocess spawning. The `apply_temporal_decay` function reads each line and calls `json_field` 2 times + `json_update_field_json` 1 time per line. At 100 observations, this is 200-300 subprocess invocations. This is pre-existing and not modified in this PR.
- Fix: Already documented — use single-pass `jq -s` operations. Not blocking.

### MEDIUM

**`migrateMemoryFiles` calls `mkdir` inside a loop** - `src/cli/utils/post-install.ts:609`
**Confidence**: 82%
- Problem: The new log migration loop calls `await fs.mkdir(logsDir, { recursive: true })` inside the loop for each log file. With `{ recursive: true }`, this is a no-op if the directory already exists, but it still makes a syscall per iteration. With only 2 files in the `logMigrations` array, the impact is negligible.
- Fix: Move the `mkdir` before the loop. Minor optimization, not blocking:
  ```typescript
  await fs.mkdir(logsDir, { recursive: true });
  for (const name of logMigrations) { ... }
  ```

## Suggestions (Lower Confidence)

- **Double JSON serialization in purge** - `src/cli/commands/learn.ts:466` (Confidence: 65%) — The purge command calls `parseLearningLog` which parses each line, validates, and returns typed objects. Then `validLines` re-serializes each object with `JSON.stringify`. This round-trip means the output may differ from input formatting (field order, whitespace). For a maintenance command run rarely, this is acceptable.

- **Debug log size with 10 daily runs** - `scripts/hooks/background-learning:36-43` (Confidence: 70%) — With debug enabled, `max_lines=500` and `keep_lines=250`. Each debug run adds ~20-30 lines of debug output plus normal logging. At 10 runs/day, that is 200-300 lines/day. The 500-line cap means only ~2 days of debug history is retained. This seems intentional and reasonable for debugging scenarios.

- **mkdir -p on every hook invocation** - `scripts/hooks/background-learning:21`, `scripts/hooks/stop-update-learning:37`, `scripts/hooks/background-memory-update:22`, `scripts/hooks/stop-update-memory:36` (Confidence: 62%) — All four hook scripts now run `mkdir -p "$_LOG_DIR"` on every invocation to ensure the logs directory exists. After the first run, this is a no-op stat+return. The overhead is ~1-2ms per invocation, which is negligible for hooks that run at session boundaries.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 1 |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | 2 | 1 | - |

**Performance Score**: 8/10
**Recommendation**: APPROVED

This PR has minimal performance impact. All new code runs either in background hooks (not user-facing latency) or in CLI maintenance commands (`--status`, `--list`, `--purge`) that operate on small datasets (typically <100 JSONL entries). The debug logging feature is opt-in and properly gated behind a config flag. The `rotate_log` order fix is a net positive. The pre-existing performance concerns (PF-004, PF-006) about the god script and per-line subprocess spawning remain the dominant performance issues in this subsystem but are not introduced or worsened meaningfully by this PR.
