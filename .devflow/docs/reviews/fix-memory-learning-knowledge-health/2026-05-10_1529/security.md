# Security Review Report

**Branch**: fix/memory-learning-knowledge-health -> main
**Date**: 2026-05-10
**PR**: #211

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Diagnostic marker logs raw JSON key names from hook input to disk** - `scripts/hooks/stop-update-memory:52-59`
**Confidence**: 82%
- Problem: The one-time diagnostic block at lines 52-59 logs the raw field names of the hook's JSON input (`keys | join(",")`) to the working-memory log file. While only key names are logged (not values), this exposes the internal structure of the Claude Code hook contract to a world-readable log file. The log file is written to `~/.devflow/logs/{project-slug}/` with default umask permissions (typically 0644), meaning any local user can read it. If the hook input contract later includes sensitive field names (e.g., `api_key`, `auth_token`), the diagnostic would reveal their presence. Additionally, the `$INPUT` variable at this point still contains the full JSON payload in memory (including `response_text`, which is assistant output) -- a code change that replaces `keys` with `.` or removes the jq filter would leak content.
- Fix: Either remove the diagnostic entirely now that the `response_text` migration is confirmed working, or restrict the log file permissions. If the diagnostic must stay, ensure the log file is created with mode 0600:
```bash
# At log file creation (near line 44):
touch "$LOG_FILE" && chmod 600 "$LOG_FILE" 2>/dev/null
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Queue file (`QUEUE_FILE`) written and truncated without restrictive permissions** - `scripts/hooks/stop-update-memory:62-67,82-89`
**Confidence**: 83%
- Problem: The `.pending-turns.jsonl` queue file is created by appending (`>>`) with the process's default umask, which is typically 0022 on macOS, resulting in 0644 permissions. This file contains assistant response text, which may include code, instructions, or other contextual information from the user's session. Any local user can read the queue file contents. The auto-clean truncation at line 66 (`: > "$QUEUE_FILE"`) preserves existing permissions, which is fine, but the initial creation via `>> "$QUEUE_FILE"` on first append does not set restrictive permissions.
- Fix: Before the first append to the queue file, ensure it exists with mode 0600:
```bash
# Before first append (around line 82):
[ ! -f "$QUEUE_FILE" ] && touch "$QUEUE_FILE" && chmod 600 "$QUEUE_FILE" 2>/dev/null
```
Note: This is a pre-existing pattern across multiple hooks, but the new auto-clean logic at lines 62-67 now reads the queue file content (`grep` for role detection) in a new code path, making the permission gap more relevant in this diff.

**`ensure-features-init` does not validate its `$1` argument** - `scripts/hooks/ensure-features-init:6`
**Confidence**: 80%
- Problem: The script is `source`d with `$1` set to `$CWD`, which comes from parsing the hook's JSON input (`cwd` field). While the calling script (`session-end-knowledge-refresh`) checks `[ -z "$CWD" ]` at line 26, the `ensure-features-init` script itself performs no validation on `$1`. If `$1` is empty, `_FEATURES_DIR` becomes `/.features`, and `mkdir -p "/.features"` would attempt to create a directory at the filesystem root (likely failing due to permissions, but still an undesired filesystem operation). If sourced from a different caller in the future without the same guard, this becomes a path traversal risk.
- Fix: Add an early guard at the top of `ensure-features-init`:
```bash
[ -z "$1" ] && return 1
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`response_text` passed to `node` subprocess via command-line argument** - `scripts/hooks/stop-update-memory:87-88`
**Confidence**: 85%
- Problem: The node fallback path passes `$RESPONSE_TEXT` as `process.argv[1]` to the inline node script. On most Unix systems, command-line arguments are visible to all local users via `ps aux` or `/proc/PID/cmdline`. Since `RESPONSE_TEXT` may contain up to 2000 characters of assistant response content, this exposes session content to local process enumeration. The jq path (line 84) avoids this by using `--arg` which passes via environment, not argv. This is a pre-existing pattern (previously used `$ASSISTANT_MSG` the same way), but the rename does not fix it.
- Fix: Pass content via stdin instead of argv in the node fallback:
```bash
printf '%s' "$RESPONSE_TEXT" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    process.stdout.write(JSON.stringify({role:'assistant',content:d,ts:parseInt(process.argv[1])})+'\n')
  })" -- "$TS" >> "$QUEUE_FILE"
```

**`RESPONSE_TEXT` also passed as argv to `decisions-usage-scan.cjs` via stdin** - `scripts/hooks/stop-update-memory:106`
**Confidence**: 60% (below threshold -- actually uses stdin via pipe, not argv; this is correct)

## Suggestions (Lower Confidence)

- **Race condition window during orphan queue detection** - `scripts/hooks/stop-update-memory:63-67` (Confidence: 65%) -- Between the `grep` check at line 64 and the truncation at line 66, a concurrent `prompt-capture-memory` hook could append an assistant entry (if the user has rapid-fire sessions). The window is sub-millisecond and the consequence is benign (orphan detection triggers falsely, truncating a queue that just received its first assistant entry), but theoretically possible.

- **`ensure-features-init` gitignore appending is not atomic** - `scripts/hooks/ensure-features-init:19` (Confidence: 62%) -- The `grep -qxF ... || echo ... >>` pattern has a TOCTOU gap: two concurrent invocations could both find the entry missing and both append it. The `.gitignore-configured` marker prevents repeated checks across sessions, but within a single session if two hooks source this simultaneously (unlikely given hook serialization), duplicate entries could appear. The `.gitignore-configured` marker at line 21 provides eventual consistency.

- **`$INPUT` variable retains full hook payload in memory for script lifetime** - `scripts/hooks/stop-update-memory:20` (Confidence: 68%) -- The `INPUT=$(cat)` on line 20 reads the entire hook input (including `response_text`) into a shell variable that persists for the script's lifetime. While bash variables are process-local and not accessible to other users, clearing `INPUT` after field extraction (e.g., `unset INPUT`) would reduce the exposure window if the script were to crash and dump core.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Security Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The changes are structurally sound. The migration from `assistant_message` to `response_text` simplifies the extraction logic significantly (removing the complex content-array handling). The orphan queue auto-clean and diagnostic marker introduce no injection vectors -- all data flows through jq or node with proper quoting. The `ensure-features-init` script uses safe patterns (`mkdir -p`, `grep -qxF`, marker file idempotency). The `--dangerously-skip-permissions` usage in the TypeScript agents is pre-existing and intentional (background `claude -p` sessions must be non-interactive).

The HIGH finding (diagnostic logging) warrants attention because it is dead-weight code with a non-zero information-leakage surface. The MEDIUM findings around file permissions are pre-existing patterns amplified by the new auto-clean code path. None of these are merge-blocking given the local-user-only threat model, but the diagnostic marker should be removed or time-boxed once the `response_text` migration is confirmed.

No ADR or PF entries from the DECISIONS_CONTEXT index apply to these security findings. ADR-001 and PF-001 concern migration/compat code philosophy, which is orthogonal to the security surface of these bug fixes.
