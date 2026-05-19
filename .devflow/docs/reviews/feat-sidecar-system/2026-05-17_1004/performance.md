# Performance Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17

## Issues in Your Changes (BLOCKING)

### HIGH

**`jq -s` slurps entire JSONL files into memory without size cap** - `scripts/hooks/sidecar-evaluate:155`, `scripts/hooks/sidecar-evaluate:238`
**Confidence**: 82%
- Problem: `jq -s '[.[].id // empty]' "$MEMORY_DIR/learning-log.jsonl"` and the equivalent for `decisions-log.jsonl` read the entire file into memory as a single JSON array. These JSONL files are append-only and grow unboundedly over time. For a project with months of usage, these files could contain thousands of entries. The `jq -s` (slurp) mode parses the whole file into RAM before extracting IDs.
- Impact: On long-lived projects, the SessionEnd hook will consume increasing amounts of memory proportional to total historical observations. With typical JSONL line sizes of ~500 bytes, 5000 observations = ~2.5MB parsed into a single jq array. The node fallback (`readFileSync` + `split('\n')`) has the same issue.
- Fix: Extract only IDs without slurping. Replace `jq -s` with streaming:
  ```bash
  # jq streaming approach — processes line-by-line without holding full array in memory
  EXISTING_IDS=$(jq -c '.id // empty' "$MEMORY_DIR/learning-log.jsonl" 2>/dev/null | jq -s '.' 2>/dev/null || echo "[]")
  ```
  This processes each line independently (O(1) memory per line) and only slurps the small ID strings at the end. Alternatively, add a line-count guard and only process the last N entries (e.g., `tail -500`).

**`stat --version` probe runs inside the stale-retry loop on every user prompt** - `scripts/hooks/sidecar-dispatch:75`
**Confidence**: 85%
- Problem: The stale-retry loop at lines 71-87 runs on every `UserPromptSubmit` hook invocation (i.e., every user message). Inside the loop, `stat --version 2>/dev/null | grep -q GNU` spawns a subprocess and pipes to grep — for every `.processing` file found. On macOS, `stat --version` prints to stderr and fails, so this always falls through to the BSD path. The platform detection should be hoisted outside the loop (or cached once at script top).
- Impact: For the common case (0-1 processing files), the overhead is negligible (~5ms). But this runs on every single user prompt, and the approach spawns 2 subprocesses per iteration when the check could be done once.
- Fix: Hoist the GNU/BSD detection above the loop:
  ```bash
  # Detect stat flavor once
  _STAT_IS_GNU=false
  if command -v stat &>/dev/null && stat --version 2>/dev/null | grep -q GNU; then
    _STAT_IS_GNU=true
  fi

  for PROC_FILE in "$SIDECAR_DIR"/*.processing; do
    [ -f "$PROC_FILE" ] || continue
    if [ "$_STAT_IS_GNU" = "true" ]; then
      PROC_MTIME=$(stat -c %Y "$PROC_FILE" 2>/dev/null || echo "0")
    else
      PROC_MTIME=$(stat -f %m "$PROC_FILE" 2>/dev/null || echo "0")
    fi
    # ...
  done
  ```

### MEDIUM

**`grep -qF` scans entire queue file on every stop hook invocation** - `scripts/hooks/sidecar-capture:85`
**Confidence**: 80%
- Problem: The orphan-queue auto-clean at line 85 runs `grep -qF '"role":"assistant"' "$QUEUE_FILE"` on every assistant turn capture. The queue file can grow up to 200 lines (the overflow cap). This means every stop hook does a linear scan of up to 200 lines to check for assistant entries before appending.
- Impact: Low absolute cost (~1ms for 200 lines), but this is on the hot path (every assistant turn) and the check is redundant — the script is about to append an assistant turn, so after the append the invariant is always satisfied. The grep only serves to detect queues that somehow accumulated only user turns without assistant turns (edge case from a crash).
- Fix: Move the orphan check to be conditional on queue age or size, not on every invocation:
  ```bash
  # Only check for orphan queue if it's suspiciously large (>20 lines without an assistant turn)
  if [ -f "$QUEUE_FILE" ]; then
    LINE_COUNT_QUICK=$(wc -l < "$QUEUE_FILE" 2>/dev/null | tr -d ' ')
    if [ "${LINE_COUNT_QUICK:-0}" -gt 20 ]; then
      if ! grep -qF '"role":"assistant"' "$QUEUE_FILE" 2>/dev/null; then
        log "Auto-clean: truncating orphan user-only queue"
        : > "$QUEUE_FILE"
      fi
    fi
  fi
  ```

**Redundant `command -v stat` check inside the per-file loop** - `scripts/hooks/sidecar-dispatch:74`
**Confidence**: 83%
- Problem: `command -v stat &>/dev/null` is checked inside the `for PROC_FILE` loop body (line 74). If stat is not available, the entire loop body is skipped — but the glob still runs and `[ -f "$PROC_FILE" ]` still runs for each match. The stat availability check should be a guard before entering the loop.
- Impact: Minor — `command -v` is a shell builtin (fast), but the structure is confusing and prevents the loop from short-circuiting early.
- Fix: Move `command -v stat` before the loop as a guard:
  ```bash
  if command -v stat &>/dev/null; then
    # Detect GNU vs BSD once
    ...
    for PROC_FILE in "$SIDECAR_DIR"/*.processing; do
      ...
    done
  fi
  ```

**Node subprocess spawned for `decisions-usage-scan.cjs` on every assistant turn** - `scripts/hooks/sidecar-capture:114`
**Confidence**: 80%
- Problem: Line 114 spawns `node "$SCANNER" --cwd "$CWD"` on every stop hook invocation where `decisions/.disabled` is absent. This pipes the (up to 2000-char) response text to a Node.js process that parses it for ADR/PF citations. Node startup time is ~50-100ms.
- Impact: Adds ~50-100ms to every assistant response latency on the stop hook path. The hook has a 10-second timeout so this is not a correctness risk, but it's pure overhead per-turn. Since citations are rare (most assistant turns don't reference ADR-NNN/PF-NNN), a simple shell grep pre-check would eliminate most Node spawns.
- Fix: Add a fast pre-filter before spawning node:
  ```bash
  if printf '%s' "$RESPONSE_TEXT" | grep -qE 'ADR-[0-9]+|PF-[0-9]+' 2>/dev/null; then
    printf '%s' "$RESPONSE_TEXT" | node "$SCANNER" --cwd "$CWD" 2>/dev/null || true
  fi
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`sidecar-config.ts` performs read-modify-write without lock for `updateFeature`** - `src/cli/utils/sidecar-config.ts:58-65`
**Confidence**: 82%
- Problem: `updateFeature` calls `readConfig` then `writeConfig` without any filesystem lock between them. If two CLI invocations run concurrently (e.g., `devflow memory --disable` and `devflow decisions --disable`), one write could overwrite the other's change (lost update).
- Impact: Race condition window is small (CLI commands are typically user-initiated), but the config file is also written by hooks and background processes. A concurrent read-modify-write could silently revert a feature toggle.
- Fix: Use atomic write with a lock directory pattern (consistent with existing `.working-memory.lock` pattern in this codebase), or use a single `writeConfig` that reads-and-writes atomically via a temp file + rename within a mkdir lock.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`ls -t *.jsonl | head -1` glob expansion in transcript discovery** - `scripts/hooks/sidecar-evaluate:59`
**Confidence**: 80%
- Problem: `ls -t "$PROJECTS_DIR"/*.jsonl 2>/dev/null | head -1` performs a glob expansion + sort-by-time for all JSONL files in the projects directory. For users with many sessions, this directory could contain hundreds of transcript files. `ls -t` must stat each file for mtime comparison.
- Impact: For the typical case (10-50 transcripts), this is <50ms. For power users with 500+ sessions it could take noticeably longer. This is pre-existing behavior from the old hooks.

## Suggestions (Lower Confidence)

- **Duplicate transcript filtering** - `scripts/hooks/sidecar-evaluate:147,230` (Confidence: 70%) — The transcript is processed twice by `node "$FILTER_LIB"`: once for `user-signals` and once for `dialog-pairs`. If the filter module were invoked once returning both channels, it would halve the Node startup cost (~100ms saved). However, this depends on the filter's CLI interface which is pre-existing code.

- **Queue overflow check runs unconditionally after every append** - `scripts/hooks/sidecar-capture:101-107` (Confidence: 65%) — `wc -l` is run after every single append to check if the queue exceeds 200 lines. Since the queue is capped at 200, and each turn adds 1 line, the overflow can only trigger after 200 turns. A cheaper approach would be to check only every Nth append (e.g., modulo session counter) or use file size as a proxy.

- **`isFeatureEnabled` in TypeScript reads and parses full config for single boolean** - `src/cli/utils/sidecar-config.ts:70-76` (Confidence: 62%) — Each call to `isFeatureEnabled` does a full file read + JSON parse + type validation. If multiple features are checked in sequence (e.g., during init), this re-reads the file each time. A batch `readConfig` + field access would be more efficient.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | - | 0 | 1 | 0 |
| Pre-existing | - | - | 1 | 0 |

**Performance Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The sidecar architecture is a significant improvement over the old model (replacing 8 shell scripts + background `claude -p` processes with 3 unified hooks + in-session subagents). The per-turn overhead is reasonable (the hooks are lightweight shell scripts with early-exit guards). The two HIGH issues are the `jq -s` unbounded slurp pattern (which will degrade over project lifetime) and the repeated subprocess spawning in the stale-retry loop. Both have straightforward fixes. The MEDIUM issues are minor optimizations on the hot path (every user/assistant turn) that would reduce per-interaction overhead by ~100-150ms total.

Note: applies ADR-001 — the clean break from the old hook system (deleting 8 scripts, 3 TS utilities) avoids carrying forward the old system's performance characteristics (separate background `claude -p` processes per feature). The new sidecar marker-file approach is architecturally leaner.
