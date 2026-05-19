# Reliability Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Scope**: Incremental diff (0f0ee8a7..HEAD) covering sidecar-capture, sidecar-dispatch, sidecar-evaluate, lib/transcript-filter.cjs

## Issues in Your Changes (BLOCKING)

### HIGH

**Concurrent queue append is not atomic — interleaved writes from simultaneous sessions** - `sidecar-capture:99-103`, `sidecar-dispatch:61-67`
**Confidence**: 85%
- Problem: Both `sidecar-capture` (line 99-103) and `sidecar-dispatch` (line 61-67) append to the same `$QUEUE_FILE` (`.pending-turns.jsonl`) using `>>`. When two concurrent Claude sessions target the same project, two shell processes may append simultaneously. While POSIX guarantees atomic writes for pipes under PIPE_BUF (4096 bytes on macOS/Linux), shell redirections with `>>` through `jq` or `node` do NOT open with `O_APPEND` atomically in all cases — the child process writes to stdout which the shell redirects. If two sessions produce entries concurrently, the file may contain interleaved partial JSON lines (corrupted JSONL). The `jq` path produces compact single-line output that is typically under PIPE_BUF, but the `node` path writes via `process.stdout.write()` which does not guarantee a single atomic kernel write for strings near the buffer boundary.
- Impact: Corrupted JSONL lines cause the memory updater to skip or crash on malformed entries. Data loss of pending turns.
- Fix: Use a per-session temp file and `cat tmpfile >> queue && rm tmpfile`, or serialize via flock:
  ```bash
  (
    flock -x 9
    jq ... >> "$QUEUE_FILE"
  ) 9>>"$QUEUE_FILE.lock"
  ```
  Alternatively, since individual entries are typically <2500 bytes (2000 char content + JSON envelope), the risk is low on macOS with PIPE_BUF=4096. Document this assumption or add a length guard.

**Queue overflow truncation races with concurrent appenders** - `sidecar-capture:107-113`
**Confidence**: 82%
- Problem: The overflow check at lines 107-113 reads `wc -l`, decides to truncate, runs `tail -100 > .tmp && mv .tmp QUEUE_FILE`. Between the `wc -l` check and the `mv`, another session's stop hook may have appended new entries to the original file. Those entries are lost when `mv` replaces the file.
- Impact: Loss of 1-2 recently appended queue entries during overflow truncation in concurrent session scenarios.
- Fix: Use atomic truncation with flock, or accept the rare data loss (queue entries are ephemeral, the updater processes them in batches anyway). If accepted, add a comment documenting the race window.

### MEDIUM

**jq reinforcement path stores entire UPDATED output in a shell variable** - `sidecar-evaluate:142-161`
**Confidence**: 85%
- Problem: Line 155 captures the entire `jq -c ... "$LEARNING_LOG"` output into the `$UPDATED` shell variable. For a large `learning-log.jsonl` (hundreds of observations, each with content fields), this could be several hundred KB held in shell memory. The subsequent `echo "$UPDATED" | grep` and `echo "$UPDATED" | jq` pipe it through two more processes. Unlike the node path (which writes directly to a temp file), the jq path holds the entire file content in a bash variable.
- Impact: On projects with very large learning logs, this could exhaust shell memory or hit ARG_MAX limits when passing to child processes via command-line expansion.
- Fix: Use the same temp-file pattern as the node path:
  ```bash
  jq -c ... "$LEARNING_LOG" > "$TEMP_LOG" 2>/dev/null
  if grep -qF '"_reinforced":true' "$TEMP_LOG" 2>/dev/null; then
    jq -c 'del(._reinforced)' "$TEMP_LOG" > "${TEMP_LOG}.2" && mv "${TEMP_LOG}.2" "$LEARNING_LOG"
  fi
  rm -f "$TEMP_LOG" "${TEMP_LOG}.2" 2>/dev/null || true
  ```

**`read_daily_cap` reads from stdin when file argument is missing or unreadable** - `sidecar-evaluate:97-99`
**Confidence**: 80%
- Problem: `cut -f1 "$runs_file"` and `cut -f2 "$runs_file"` read from the file. If the file exists but is empty (zero bytes — possible after a crash during write), `cut -f1` outputs an empty string, the `[ "$date_field" = "$TODAY" ]` comparison fails (correctly returns 0). However, if the file contains a single field with no tab separator (e.g., just "2026-05-17" without a tab and count), `cut -f2` returns the entire line (cut behavior when delimiter is absent), which after `tr -dc '0-9'` would extract digits from the date string, potentially yielding `20260517` — an enormously inflated run count that would permanently trigger the daily cap.
- Impact: A malformed runs-today file (missing tab separator) causes the daily cap to appear permanently reached, blocking learning/decisions evaluation until the next day or manual cleanup.
- Fix: Add delimiter presence check or validate the extracted count is reasonable:
  ```bash
  if grep -qF $'\t' "$runs_file" 2>/dev/null; then
    count=$(cut -f2 "$runs_file" 2>/dev/null | tr -dc '0-9')
  fi
  count="${count:-$default}"
  # Sanity bound: daily cap never exceeds 100
  [ "${#count}" -gt 2 ] && count="$default"
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`ls -t *.jsonl | head -1` in transcript discovery is fragile with spaces in paths** - `sidecar-evaluate:60`
**Confidence**: 80%
- Problem: Line 60 uses `ls -t "$PROJECTS_DIR"/*.jsonl 2>/dev/null | head -1`. If `$PROJECTS_DIR` contains spaces (e.g., a CWD with spaces in path segments), the glob expansion works correctly since the variable is quoted. However, `ls -t` output parsing is fragile if any `.jsonl` filename contained spaces or newlines (unlikely with session IDs, but not validated at this point).
- Impact: Minimal in practice since Claude session IDs are alphanumeric, but violates defensive coding principle.
- Fix: Use `find` with `-printf` or accept the practical safety since session IDs are validated as `[a-zA-Z0-9_-]+` at line 57.

**Marker write to `$SIDECAR_DIR/memory.json` is not atomic** - `sidecar-capture:149-160`
**Confidence**: 80%
- Problem: The `jq -n ... > "$SIDECAR_DIR/memory.json"` write (line 149-150 for jq, line 152-159 for node) is a direct redirect. If the shell is killed mid-write (SIGKILL), a partial JSON file remains. The sidecar-dispatch hook will later read this file and attempt to parse it, potentially dispatching a corrupted marker.
- Impact: A corrupted `memory.json` marker would cause the sidecar agent to receive invalid input. The next session's dispatch would attempt to process it.
- Fix: Write to `memory.json.tmp` then `mv` to `memory.json`:
  ```bash
  jq -n ... > "$SIDECAR_DIR/memory.json.tmp" && mv "$SIDECAR_DIR/memory.json.tmp" "$SIDECAR_DIR/memory.json"
  ```
  This pattern is already used for queue overflow and reinforcement temp files.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`LAST_REFRESH` from `cat` of knowledge throttle marker not sanitized** - `sidecar-evaluate:373`
**Confidence**: 82%
- Problem: Line 373 reads `LAST_REFRESH=$(cat "$KNOWLEDGE_MARKER" 2>/dev/null || echo "0")`. Line 374 then uses this in `AGE=$(( NOW - LAST_REFRESH ))`. If the file content is non-numeric (corrupted, or contains trailing newline with whitespace), the arithmetic expression under `set -e` will fail and kill the hook.
- Impact: A corrupted `.knowledge-last-refresh` file prevents knowledge evaluation from ever running until manually fixed.
- Fix: Sanitize like the daily cap values:
  ```bash
  LAST_REFRESH=$(cat "$KNOWLEDGE_MARKER" 2>/dev/null | tr -dc '0-9' || true)
  LAST_REFRESH="${LAST_REFRESH:-0}"
  ```

### LOW

**transcript-filter.cjs reads entire transcript file into memory** - `lib/transcript-filter.cjs:193`
**Confidence**: 85%
- Problem: `fs.readFileSync(filePath, 'utf8')` loads the entire transcript into a Node.js string. Claude transcripts for long sessions can be 10-50MB. The subsequent `.split('\n')` doubles memory usage temporarily.
- Impact: On very long sessions, this could cause Node.js to hit memory limits, resulting in an empty output (caught by `|| true` in callers). Not a crash risk for the hook, but a silent data loss risk for learning/decisions detection on unusually long sessions.
- Fix: Use streaming line-by-line parsing for transcripts above a size threshold, or document the practical limit. Current CAP_TURNS=80 mitigates the output size but not the input parsing cost.

## Suggestions (Lower Confidence)

- **Signal safety for temp files** - `sidecar-evaluate:139-161` (Confidence: 65%) — If SIGTERM arrives between writing `$TEMP_LOG` and `mv`, orphan `.tmp` files persist. The `rm -f "$TEMP_LOG"` at line 161 only runs in the success path. A `trap` cleanup for the temp file would prevent accumulation over many interrupted sessions.

- **JUST_RECOVERED string matching is O(n*m) for pathological cases** - `sidecar-dispatch:155` (Confidence: 60%) — The `case " $JUST_RECOVERED " in *" $BASENAME "*` pattern performs substring matching on a space-delimited string. With PROC_LIMIT=10 and a collection loop over all markers, this is bounded and fine in practice. No action needed.

- **`compgen -G` may be unavailable in minimal bash environments** - `sidecar-dispatch:88` (Confidence: 62%) — `compgen` is a bash built-in, so it requires bash (not sh/dash). The shebang is `#!/bin/bash`, so this is correct. Noted for documentation purposes only.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

**Reliability Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The sidecar system demonstrates good defensive practices: input sanitization for arithmetic (the primary fix in this diff), bounded loops with PROC_LIMIT, throttling with daily caps, and graceful fallbacks (`|| true`, `|| echo "0"`). The two HIGH findings relate to concurrent session races on the shared queue file — these are inherent to the append-based queue design without flock coordination. In practice, concurrent sessions targeting the same project directory are uncommon, and the consequence (corrupted/lost queue entries) is recoverable on the next session. The conditions for approval are:

1. Fix `read_daily_cap` to reject unreasonably large count values extracted from malformed files (the date-digit extraction bug).
2. Either document the concurrent-append race as accepted risk, or add flock serialization.
