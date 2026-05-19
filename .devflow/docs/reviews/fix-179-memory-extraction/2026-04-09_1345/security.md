# Security Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Concurrent append to `.pending-turns.jsonl` without locking** - `scripts/hooks/prompt-capture-memory:34`, `scripts/hooks/stop-update-memory:85`
**Confidence**: 80%
- Problem: Two separate hooks (`prompt-capture-memory` on UserPromptSubmit and `stop-update-memory` on Stop) append to the same `.pending-turns.jsonl` file using shell `>>` redirection without any file locking or mutex. While these hooks fire at different lifecycle stages (prompt submission vs. stop), rapid user interactions or system timing quirks could cause concurrent appends. On POSIX systems, `>>` appends are generally atomic for writes under PIPE_BUF (4096 bytes on Linux/macOS) when the file descriptor is opened with O_APPEND, which shell `>>` does. Since each JSONL line is well under 4096 bytes (max ~2100 chars after truncation), line-level corruption is unlikely but not impossible under edge conditions (e.g., NFS-mounted home directories where O_APPEND atomicity is not guaranteed).
- Fix: This is low-risk for local filesystems. If NFS/network filesystems are a concern, consider using `flock` or the existing mkdir-based lock pattern from `background-memory-update`. Current risk is acceptable for the target environment (local developer machines).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`--dangerously-skip-permissions` in background-memory-update with user-controlled prompt content** - `scripts/hooks/background-memory-update:277`
**Confidence**: 82%
- Problem: The background updater invokes `claude -p --dangerously-skip-permissions` with a prompt that includes user-supplied content from the queue (`TURNS_TEXT` built from `.pending-turns.jsonl` entries). The `--dangerously-skip-permissions` flag gives the Haiku session unrestricted tool access. If a user's prompt or assistant response contains adversarial instructions (prompt injection), the Haiku model could be tricked into executing unintended file operations beyond writing `WORKING-MEMORY.md`. The prompt does instruct "Your ONLY job is to update the file at ${MEMORY_FILE}" but there is no permission sandbox enforcing this constraint.
- Fix: This is a pre-existing design choice (not introduced by this PR), but the PR expands the attack surface by adding the `prompt-capture-memory` hook which now feeds user prompts directly into the queue that gets passed to this unrestricted session. The mitigation is that: (1) user prompts are truncated to 2000 chars, (2) the content originates from the user's own session (not external input), and (3) `--dangerously-skip-permissions` is required for background `claude -p` to use the Write tool. The self-attack surface is limited but worth noting.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`--dangerously-skip-permissions` grants unrestricted tool access to background sessions** - `scripts/hooks/background-memory-update:277`, `scripts/hooks/background-learning:364`
**Confidence**: 85%
- Problem: Both background hooks (`background-memory-update` and `background-learning`) use `--dangerously-skip-permissions` which bypasses all permission checks. This is necessary for unattended `claude -p` invocations but means a compromised or prompt-injected Haiku/Sonnet session could perform arbitrary file operations on the developer's machine.
- Fix: This is a known architectural trade-off. Claude Code's `--dangerously-skip-permissions` is the only way to run background tool-using sessions. The risk is mitigated by: (1) 120s timeout watchdog, (2) restricted prompt scope, (3) content truncation, (4) user's own content only. No action needed -- this is inherent to the background agent pattern.

## Suggestions (Lower Confidence)

- **Queue file permissions** - `scripts/hooks/prompt-capture-memory:34` (Confidence: 65%) -- The `.pending-turns.jsonl` file is created with default umask permissions. On shared systems, other users could read session content. Consider explicit `chmod 600` after creation, though this is unlikely to matter on single-user developer machines.

- **CWD path traversal via crafted JSON input** - `scripts/hooks/prompt-capture-memory:18` (Confidence: 60%) -- The `cwd` field from stdin JSON determines the file write path. A malicious hook caller could supply a crafted `cwd` to write outside the project. Mitigated by: (1) the `[ ! -d "$CWD" ]` guard, (2) hooks are invoked by Claude Code itself (not externally), (3) append-only JSONL writes to a dotfile. Not exploitable in practice.

- **Node fallback `try {} catch {}` silently swallows parse errors** - `scripts/hooks/background-memory-update:169` (Confidence: 70%) -- The empty `catch {}` in the Node JSONL extraction silently drops malformed lines. While this is the correct behavior for resilience (skip bad lines), it could mask data corruption. Consider logging dropped lines to the existing log file.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR makes sound security improvements overall: CWD existence validation (`[ ! -d "$CWD" ]`) is added consistently across all hooks, the `--` flag is correctly added to `node -e` invocations to prevent argument injection, and prompt content is truncated to bound input size. The separation of prompt capture into its own hook reduces the preamble's attack surface (zero file I/O). The one blocking MEDIUM (concurrent append without locking) is low-risk on local POSIX filesystems and acceptable for merge. The `--dangerously-skip-permissions` concern is pre-existing and inherent to the background agent architecture.
