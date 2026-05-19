# Concurrency Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Focus**: Multi-session, multi-project race condition analysis

## Shared Resource Map

| Resource | Writers | Readers | Locking |
|----------|---------|---------|---------|
| `.memory/.pending-turns.jsonl` | sidecar-capture (append), sidecar-dispatch (append) | sidecar background agent (via skill) | None |
| `.memory/.sidecar/memory.json` | sidecar-capture (overwrite) | sidecar-dispatch (glob+read), model (rename) | None |
| `.memory/.sidecar/learning.json` | sidecar-evaluate (overwrite) | sidecar-dispatch (glob+read), model (rename) | None |
| `.memory/.sidecar/decisions.json` | sidecar-evaluate (overwrite) | sidecar-dispatch (glob+read), model (rename) | None |
| `.memory/.sidecar/knowledge.json` | sidecar-evaluate (overwrite) | sidecar-dispatch (glob+read), model (rename) | None |
| `.memory/.sidecar/config.json` | sidecar-config.ts writeConfig | sidecar-capture (read), sidecar-dispatch (read), sidecar-evaluate (read) | None |
| `.memory/.sidecar/*.processing` | model (rename from .json) | sidecar-dispatch (stale check), sidecar-capture (existence check) | Rename-as-claim |
| `.memory/.sidecar/*.retries` | sidecar-dispatch (overwrite) | sidecar-dispatch (read) | None |
| `.memory/.sidecar/.learning-runs-today` | sidecar-evaluate (overwrite) | sidecar-evaluate (read) | None |
| `.memory/.sidecar/.decisions-runs-today` | sidecar-evaluate (overwrite) | sidecar-evaluate (read) | None |
| `.memory/.sidecar/.learning-sessions` | sidecar-evaluate (append) | sidecar-evaluate (read+delete) | None |
| `.memory/learning-log.jsonl` | sidecar-evaluate reinforcement (read-modify-write) | sidecar-evaluate load_existing_ids, sidecar background agent | None |
| `.memory/decisions-log.jsonl` | sidecar background agent | sidecar-evaluate load_existing_ids | None |
| `.features/.knowledge-last-refresh` | sidecar-evaluate (overwrite) | sidecar-evaluate (read) | None |

---

## Issues in Your Changes (BLOCKING)

### CRITICAL

**Queue file append interleaving — `.memory/.pending-turns.jsonl`** - `sidecar-capture:100`, `sidecar-dispatch:63`
**Confidence**: 95%
- Problem: Two sessions on the same repo both append to `.pending-turns.jsonl` using shell `>>` redirection without any locking. On POSIX, `>>` with `O_APPEND` guarantees atomic writes only if the write is smaller than `PIPE_BUF` (typically 4096 bytes on macOS). Here, `jq` and `node` write a single JSON line that should fit within `PIPE_BUF` for truncated 2000-char content. However, the critical failure mode is the **queue overflow truncation** at `sidecar-capture:109-111`:
  ```bash
  tail -100 "$QUEUE_FILE" > "$QUEUE_FILE.tmp" && mv "$QUEUE_FILE.tmp" "$QUEUE_FILE"
  ```
  Session A starts the tail+mv while Session B appends. The `mv` atomically replaces the file, but Session B's `>>` redirection may have already opened a file descriptor to the old inode. Session B's append goes to the now-unlinked old file and is silently lost. Additionally, two concurrent overflow truncations could race: both read >200 lines, both write .tmp (the second `>` clobbers the first's .tmp), then both `mv` — one session's truncated output is lost entirely.
- Fix: Use a `mkdir`-based lock around the overflow truncation, or better yet, move the truncation into the sidecar background agent that processes the queue (since it already has exclusive access to the queue file at that point). If truncation must stay in the hook, use an atomic temp file with a unique name:
  ```bash
  TRUNC_TMP="$QUEUE_FILE.trunc.$$"
  tail -100 "$QUEUE_FILE" > "$TRUNC_TMP" && mv "$TRUNC_TMP" "$QUEUE_FILE"
  ```
  The PID-unique temp prevents two truncations from clobbering each other's temp file. This does not prevent the lost-append-to-old-inode race, but the window is very small and the data is eventually regenerated.

---

**Marker overwrite between sidecar-evaluate and model rename — `.memory/.sidecar/{task}.json`** - `sidecar-evaluate:272`, `sidecar-evaluate:338`, `sidecar-evaluate:397`, SKILL.md step 1a
**Confidence**: 92%
- Problem: The lifecycle is: (1) sidecar-evaluate writes `learning.json`; (2) sidecar-dispatch detects it next prompt; (3) model renames `learning.json` to `learning.processing` (atomic claim); (4) background agent processes and deletes `learning.processing`. The race: Session A ends and writes `learning.json`. Before Session B's next prompt triggers dispatch, Session B also ends and overwrites `learning.json` with its own data. Session A's learning analysis payload is silently lost — the marker is overwritten, not accumulated.

  This race window can be large. If a user has 3 sessions on the same repo and all end within a few seconds (e.g., closing a terminal window with multiple tabs), all 3 sidecar-evaluate instances run near-simultaneously and the last one to write `learning.json` wins. The first two sessions' learning data, decisions data, and knowledge data are all lost.

  The same race applies to `memory.json` (sidecar-capture:150), `decisions.json` (sidecar-evaluate:338), and `knowledge.json` (sidecar-evaluate:397).
- Fix: Use per-session marker filenames instead of per-task filenames. For example: `learning.{session_id}.json` or `learning.{timestamp}.{pid}.json`. The dispatch hook already globs `*.json` — it would need to match on prefix (e.g., `learning.*.json`) and batch them. The model renames all matching files to `.processing` before spawning the agent. This way, concurrent sessions create distinct markers that are all eventually processed.

### HIGH

**Daily run counter lost-update — `.learning-runs-today`, `.decisions-runs-today`** - `sidecar-evaluate:284`, `sidecar-evaluate:350`
**Confidence**: 90%
- Problem: The daily cap is enforced via read-then-write:
  ```bash
  RUNS_TODAY=$(read_daily_cap "$RUNS_FILE" 0)
  # ... work happens ...
  printf '%s\t%d\n' "$TODAY" "$((RUNS_TODAY + 1))" > "$RUNS_FILE"
  ```
  Two concurrent sidecar-evaluate instances (two sessions ending simultaneously) both read `RUNS_TODAY=2`, both write `3`. The cap (default 5) is effectively reduced by 1 for each concurrent collision. Worse: both sessions believe they are below the cap and both write markers, leading to one extra run beyond the intended cap.

  With 2-3 concurrent sessions, the daily cap can be exceeded by 1-2 runs per day. Over time this is a resource waste (extra Claude API calls) but not a correctness issue.
- Fix: Use an atomic increment pattern. The simplest bash approach:
  ```bash
  # Use a lock directory for the brief read-modify-write
  if mkdir "$RUNS_FILE.lock" 2>/dev/null; then
    RUNS_TODAY=$(read_daily_cap "$RUNS_FILE" 0)
    printf '%s\t%d\n' "$TODAY" "$((RUNS_TODAY + 1))" > "$RUNS_FILE"
    rmdir "$RUNS_FILE.lock"
  fi
  ```
  Or accept the small over-count as tolerable (document the intentional trade-off).

**Session count file append-then-read race — `.learning-sessions`** - `sidecar-evaluate:245`, `sidecar-evaluate:250`
**Confidence**: 88%
- Problem: Two sessions ending simultaneously both check if `SESSION_COUNT_FILE` exists, both append their session IDs (line 245), both count lines (line 250), and both may find `CURRENT_COUNT >= BATCH_SIZE`. Both then write `learning.json` — but as noted in the CRITICAL marker-overwrite issue above, one overwrites the other. Additionally, both call `rm -f "$SESSION_COUNT_FILE"` (line 287), clearing the file. The surviving marker was built from transcript data of only one session, but the count file is already cleared — the other sessions' accumulated IDs are lost.

  Concrete scenario with `BATCH_SIZE=3`: sessions A, B, C all end near-simultaneously. Each appends its ID. All three read `CURRENT_COUNT=3`. All three write `learning.json` (C wins the overwrite). All three delete `.learning-sessions`. Result: only session C's transcript is analyzed, A and B's learning signals are permanently lost, and the session counter is reset to 0 — the batch accumulated over 3 sessions is wasted.
- Fix: Use a lock around the check-and-clear:
  ```bash
  if mkdir "$SESSION_COUNT_FILE.lock" 2>/dev/null; then
    trap 'rmdir "$SESSION_COUNT_FILE.lock" 2>/dev/null' EXIT
    CURRENT_COUNT=$(wc -l < "$SESSION_COUNT_FILE" | tr -d ' ')
    if [ "$CURRENT_COUNT" -ge "$BATCH_SIZE" ]; then
      # ... write marker, clear file ...
    fi
    rmdir "$SESSION_COUNT_FILE.lock" 2>/dev/null
  fi
  ```

**Learning log reinforcement read-modify-write — `learning-log.jsonl`** - `sidecar-evaluate:143-163`
**Confidence**: 85%
- Problem: The artifact reinforcement section reads the entire `learning-log.jsonl`, transforms it, writes to `.tmp`, and renames back. Two concurrent sidecar-evaluate instances (or a sidecar-evaluate and a background learning agent both writing to the same file) can race. Session A reads the log, Session B reads the same log. Session A writes `.tmp` and renames. Session B writes `.tmp` (overwriting A's `.tmp`) and renames — Session A's reinforcement updates are lost.

  The node path is safer (uses `renameSync` from a unique `.tmp` path), but the jq path writes to the same `$TEMP_LOG` path (`${LEARNING_LOG}.tmp`) from both sessions, and only one survives the rename.
- Fix: Use a PID-unique temp file:
  ```bash
  TEMP_LOG="${LEARNING_LOG}.tmp.$$"
  ```
  This prevents the temp file clobber. The last-writer-wins issue on the final rename remains, but with PID-unique temps at least no data is silently discarded mid-write.

### MEDIUM

**Memory marker overwrite during rapid assistant turns — `memory.json`** - `sidecar-capture:141-161`
**Confidence**: 85%
- Problem: Within a single session, the Stop hook fires on every assistant turn. If two turns complete within 120 seconds of each other (the throttle), the second turn skips due to the throttle check. But across sessions: Session A and Session B both check `if [ -f "$PROCESSING_MARKER" ]` (line 120) — neither finds it. Both check `AGE -lt 120` — both find the WORKING-MEMORY.md is stale. Both write `memory.json`. The second write overwrites the first. The overwritten marker contained `timestamp` and path references from Session A.

  Impact: the memory update will use whichever session's context last wrote the marker, which may miss turns from the other session. However, the queue file (`pending-turns.jsonl`) accumulates all turns from all sessions, so the actual memory content is not lost — just the marker metadata (which session triggered it) is inaccurate. Downgrading from HIGH because the queue is the source of truth, not the marker.
- Fix: Accept as tolerable (the queue captures all turns regardless of which session's marker triggers the update), or use per-session marker filenames as suggested for the CRITICAL issue.

**Marker dispatch TOCTOU — sidecar-dispatch reads then model renames** - `sidecar-dispatch:129-164`, SKILL.md step 1a
**Confidence**: 82%
- Problem: sidecar-dispatch lists `*.json` files and outputs a `SIDECAR: task1,task2` directive. The model then reads the skill and renames `task1.json` to `task1.processing`. Between the dispatch hook listing the file and the model renaming it, a concurrent sidecar-dispatch (in another session) may also list the same file and output a duplicate `SIDECAR` directive. Both sessions' models then try to rename the same file; the second rename fails (file already moved), but the model proceeds with the now-missing marker.

  Impact: the second session's model attempts to read a `.processing` file that doesn't exist (the first session renamed it). The background agent either fails gracefully or is never spawned. This is a wasted directive, not data loss.
- Fix: The rename-to-`.processing` pattern is the standard solution for this. The model's rename acts as a claim — if it fails, the model should detect the missing file and skip. The SKILL.md should be explicit: "If the rename fails (file does not exist), skip this task — another session already claimed it." Currently the SKILL.md says "Rename ... (atomic claim)" but doesn't say what to do on failure.

---

## Issues in Code You Touched (Should Fix)

### HIGH

**`sidecar-config.ts` writeConfig is not atomic** - `sidecar-config.ts:51`
**Confidence**: 88%
- Problem: `writeConfig` uses `fs.writeFile` directly to `config.json`. If the process crashes or is killed mid-write (e.g., Ctrl+C during `devflow memory --disable`), `config.json` is left in a partially-written state. The next read by any hook sees corrupted JSON and falls back to defaults — silently re-enabling all features. The D1 comment acknowledges this is non-atomic but dismisses concurrent CLI commands as unlikely. However, process interruption mid-write is not a concurrency issue — it's a crash-safety issue.
- Fix: Write to a temp file, then rename:
  ```typescript
  const tmpPath = configPath + '.tmp.' + process.pid;
  await fs.writeFile(tmpPath, JSON.stringify(config, null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
  await fs.rename(tmpPath, configPath);
  ```

### MEDIUM

**`sidecar-config.ts` updateFeature read-modify-write race** - `sidecar-config.ts:65-72`
**Confidence**: 80%
- Problem: As documented in the D1 comment, `updateFeature` does `readConfig` then `writeConfig`. Two concurrent `devflow memory --disable` and `devflow learn --disable` commands could each read `{memory:true, learning:true}`, then one writes `{memory:false, learning:true}` and the other writes `{memory:true, learning:false}`. The last writer wins and the first toggle is lost.

  The D1 comment correctly identifies this as low-risk ("single-threaded user-initiated actions"). This is accurate for typical use. Upgrading to Should-Fix only because the config file is shared state read by hooks from multiple concurrent sessions — the write race is between CLI invocations, not hooks.
- Fix: Use file-level locking or accept the documented risk.

---

## Pre-existing Issues (Not Blocking)

None. All files are new to this branch.

---

## Suggestions (Lower Confidence)

- **Marker file namespace collision across projects** - `sidecar-evaluate:85` (Confidence: 65%) — The sidecar directory is project-scoped (`.memory/.sidecar/`) so cross-project isolation is correct. However, if a user has git worktrees sharing the same `.memory/` directory (unusual but possible with shared worktree roots), markers from different worktrees could collide. The knowledge marker includes `worktreePath` which helps, but learning/decisions markers don't include a worktree discriminator.

- **Queue file permission TOCTOU** - `sidecar-capture:93-95`, `sidecar-dispatch:56-58` (Confidence: 60%) — Both hooks check `if [ ! -f "$QUEUE_FILE" ]` then create with `umask 077`. Two concurrent first-time executions could race: both see the file missing, both create it. The `touch` with `umask 077` is idempotent so no harm is done — the second touch just updates mtime. This is a cosmetic race with no impact.

- **Stale .processing recovery could resurrect already-completed work** - `sidecar-dispatch:88-122` (Confidence: 70%) — If a background agent successfully processes a marker but crashes before deleting the `.processing` file, the stale-recovery logic renames it back to `.json`, causing a re-dispatch. The `MAX_RETRIES=3` limit prevents infinite cycling, but the work may be done twice. For memory updates this is idempotent; for learning/decisions, duplicate observations could be created. The `existingObservationIds` deduplication in the marker helps mitigate this.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 2 | 3 | 2 | - |
| Should Fix | - | 1 | 1 | - |
| Pre-existing | - | - | - | - |

**Concurrency Score**: 4/10

The sidecar system replaces the old hook-per-feature architecture with a cleaner marker-based design, but it **removed the `mkdir`-based locking** that the old `background-memory-update` hook had (visible at `main:scripts/hooks/background-memory-update:28-88`) without replacing it with an equivalent mechanism. The old system serialized concurrent memory updates via a lock directory with stale-lock detection and a 90-second acquisition timeout. The new system relies on last-writer-wins for all shared files.

The most severe issues are:
1. **Marker overwrite** (CRITICAL): Concurrent session-end events silently discard each other's learning/decisions/knowledge markers. Per-session filenames would fix this cleanly.
2. **Queue truncation race** (CRITICAL): The overflow truncation can lose appended data from concurrent sessions.
3. **Counter lost-updates** (HIGH): Daily caps can be exceeded by 1-2 runs per concurrent session collision.
4. **Learning batch race** (HIGH): The session-count check-and-clear is not atomic, leading to lost batches.

The rename-to-`.processing` claim pattern for dispatch is sound in principle but needs explicit failure handling documented in the skill.

**Recommendation**: CHANGES_REQUESTED
