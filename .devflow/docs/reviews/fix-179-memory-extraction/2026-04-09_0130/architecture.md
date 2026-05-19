# Architecture Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

### HIGH

**Concurrent append race on `.pending-turns.jsonl` between preamble and stop hooks** - `scripts/hooks/preamble:33`, `scripts/hooks/stop-update-memory:76`
**Confidence**: 85%
- Problem: Both `preamble` (UserPromptSubmit) and `stop-update-memory` (Stop) append to the same `.pending-turns.jsonl` file using shell `>>` redirection. While POSIX guarantees atomic appends for small writes on local filesystems, the `jq -n -c ... >> file` and `node -e ... >> file` patterns produce output of variable length. Concurrent invocations (e.g., rapid-fire user prompts overlapping with end_turn stops) could interleave partial lines on systems where `O_APPEND` atomicity breaks above `PIPE_BUF` (typically 4096 bytes on Linux, 512 on some macOS versions). The 2000-char truncation limit helps, but the full JSON line with escaping can approach that boundary.
- Impact: A corrupted JSONL line would cause `json_field` to fail silently during the `while IFS= read -r line` loop in `background-memory-update`, dropping that turn. Not catastrophic (stale memory, not data loss), but defeats the purpose of the queue.
- Fix: Use a write-to-tempfile-then-rename pattern for each append, or use `flock` (Linux) / file-descriptor locking. Alternatively, since the 2000-char limit keeps entries well under `PIPE_BUF` on Linux, document this assumption explicitly and note the macOS caveat.

**Per-line `json_field` calls in while-read loop spawn subprocesses per entry** - `scripts/hooks/background-memory-update:151-152`
**Confidence**: 88%
- Problem: Lines 148-181 iterate over `$ENTRIES` using `while IFS= read -r line` and call `json_field` twice per line (once for `role`, once for `content`). Each `json_field` invocation spawns either a `jq` or `node` subprocess. With the 20-line cap (10 turns x 2 entries), this is 40 subprocess spawns. This is the exact same anti-pattern documented in PF-006 (per-line jq spawning adds latency).
- Impact: 40 subprocess forks per background updater invocation. Acceptable at the 20-line cap but introduces the same class of problem flagged in PF-006. If `MAX_TURNS` is ever raised, this becomes a measurable bottleneck.
- Fix: Replace the while-read loop with a single-pass `jq -s` slurp operation that transforms the entire JSONL into the formatted turns text in one invocation. Example:
  ```bash
  TURNS_TEXT=$(tail -"$MAX_LINES" "$PROCESSING_FILE" | jq -rs '
    [foreach .[] as $e (
      {user: null, n: 0, out: []};
      if $e.role == "user" then
        (if .user then .n += 1 | .out += ["Turn \(.n):\nUser: \(.user)"] else . end)
        | .user = $e.content
      elif $e.role == "assistant" then
        .n += 1 |
        if .user then .out += ["Turn \(.n):\nUser: \(.user)\nAssistant: \($e.content)"] | .user = null
        else .out += ["Turn \(.n):\nAssistant: \($e.content)"]
        end
      else . end;
      .
    )] | last | .out | join("\n\n")
  ')
  ```

### MEDIUM

**SRP drift: preamble hook now has two unrelated responsibilities** - `scripts/hooks/preamble:23-39`
**Confidence**: 82%
- Problem: The preamble hook was previously a single-responsibility component: inject ambient classification context. This PR adds a second concern — capturing user prompts for the working memory queue. These two responsibilities have different failure modes (queue append failure should never affect classification output), different lifecycle concerns (memory can be disabled independently of ambient), and different consumers (memory updater vs. Claude session). The subshell `( ... ) 2>/dev/null || true` wrapper does isolate failures, but the conceptual coupling remains.
- Impact: Future changes to either memory capture or ambient classification must modify the same file. Testing one concern requires accounting for the other. The hook's comment header still says "Zero file I/O beyond stdin" (line 5), which is now factually incorrect.
- Fix: Extract the queue-capture logic into a dedicated function in a sourced helper (e.g., `capture-turn-to-queue`), or use a separate UserPromptSubmit hook dedicated to memory capture. At minimum, update the file header comment to reflect the new responsibility.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Stale header comment claims "Zero file I/O beyond stdin"** - `scripts/hooks/preamble:5`
**Confidence**: 95%
- Problem: Line 5 reads `# Zero file I/O beyond stdin — static injection only.` but the new code at lines 23-39 appends to `.memory/.pending-turns.jsonl`, which is file I/O.
- Impact: Misleading documentation for future maintainers who rely on header comments to understand hook behavior without reading the full script.
- Fix: Update to: `# Captures user prompt to working memory queue, then injects classification preamble.`

## Pre-existing Issues (Not Blocking)

### MEDIUM

**PF-004 pattern continues: `background-memory-update` remains a monolithic shell script** - `scripts/hooks/background-memory-update`
**Confidence**: 80%
- Problem: PF-004 (documented in pitfalls.md) identifies that background hook scripts concentrate too many responsibilities in one file. This PR does improve the script's architecture (removing transcript extraction, adding queue-based processing), but the file still handles locking, crash recovery, queue parsing, turn formatting, prompt construction, LLM invocation, and result validation in a single 289-line shell script.
- Impact: The while-read loop turn-pairing logic (lines 147-190) is non-trivial state machine code that is difficult to unit test in bash. The crash recovery logic (lines 97-119) is similarly complex.
- Fix: Per PF-004's resolution, move JSON-heavy logic to TypeScript over time. Not blocking for this PR.

## Suggestions (Lower Confidence)

- **Queue file as implicit contract between 3 scripts** - `scripts/hooks/preamble:33`, `stop-update-memory:72`, `background-memory-update:23` (Confidence: 70%) -- The `.pending-turns.jsonl` format (fields: `role`, `content`, `ts`) is an implicit schema shared across three scripts with no validation or schema definition. A format change in one script silently breaks the others.

- **No maximum age for crash-recovery `.processing` file** - `scripts/hooks/background-memory-update:98` (Confidence: 65%) -- A `.processing` file from a crash could persist indefinitely across sessions. If the file contains stale turns from days ago, they would still be fed to the LLM on next recovery. Consider adding a max-age check (e.g., skip `.processing` files older than 1 hour).

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The fundamental architectural decision -- replacing transcript-scraping with a queue-based turn-capture model -- is a significant improvement. It decouples the updater from Claude Code's transcript format, eliminates the fragile `grep | tail | while-read | json_extract_messages` pipeline, and enables multi-turn context where the old design only captured the last exchange. The `mv`-based atomic handoff and crash recovery are well-designed patterns.

The two HIGH findings both relate to the same concern: the queue file is a shared-write concurrent resource. The append race is low-probability given the 2000-char truncation, but should be explicitly documented or mitigated. The per-line subprocess spawning directly reintroduces PF-006's anti-pattern in a new location. Neither is blocking for correctness, but both should be addressed before merge to avoid carrying forward known pitfall patterns.
