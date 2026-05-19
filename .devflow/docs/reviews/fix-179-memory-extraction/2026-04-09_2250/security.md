# Security Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

No CRITICAL or HIGH issues found.

### MEDIUM

**Queue file deletion race condition with background updater** - `src/cli/commands/memory.ts:215-218`
**Confidence**: 82%
- Problem: The new `--clear` command deletes `.pending-turns.jsonl` and `.pending-turns.processing` without checking whether a background updater is currently running. If `background-memory-update` has already performed the `mv` atomic handoff but has not yet finished processing, `--clear` could delete the `.processing` file mid-run, causing the updater to lose queued turns silently. The background updater holds a `mkdir`-based lock but `--clear` does not check it.
- Fix: Before deleting queue files in a project, attempt to acquire (or check for) the lock directory at `{project}/.memory/.working-memory.lock`. If the lock exists and is not stale (< 5 minutes old), skip that project or warn the user.
```typescript
// Before unlink calls, check for active lock
const lockDir = path.join(memDir, '.working-memory.lock');
try {
  const lockStat = await fs.stat(lockDir);
  const ageMs = Date.now() - lockStat.mtimeMs;
  if (ageMs < 300_000) { // 5 min stale threshold
    p.log.warn(color.dim(`Skipped ${project}: background updater active`));
    continue;
  }
} catch { /* no lock — safe to proceed */ }
```

## Issues in Code You Touched (Should Fix)

No issues found.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`--dangerously-skip-permissions` in background updater** - `scripts/hooks/background-memory-update:268`
**Confidence**: 85%
- Problem: The background updater invokes `claude -p --dangerously-skip-permissions`, which grants the spawned Haiku session unrestricted tool access (including Bash, Write, etc.) without any user confirmation. While this is an existing pattern (not introduced by this PR), the flag name itself signals the risk. A compromised or malformed WORKING-MEMORY.md or queue content injected into the prompt could cause the Haiku session to execute arbitrary commands.
- Impact: The prompt content includes user-supplied text from the queue (user prompts and assistant responses), which flows unsanitized into the `claude -p` invocation. This is mitigated by the fact that the background process runs as the same user, but the permission bypass is still broader than needed.
- Fix: This is an architectural concern beyond this PR's scope. Consider scoping the permission bypass to only the Write tool in a future iteration if Claude CLI supports per-tool permission grants.

## Suggestions (Lower Confidence)

- **Shell variable expansion in jq arguments** - `scripts/hooks/prompt-capture-memory:41`, `scripts/hooks/stop-update-memory:77` (Confidence: 65%) -- User prompt content is passed via `--arg content "$PROMPT"` / `"$ASSISTANT_MSG"` to jq. The `--arg` flag treats the value as a string (not JSON), so this is safe against JSON injection. However, extremely large content (near ARG_MAX) could cause jq invocation to fail silently. The 2000-char truncation mitigates this.

- **`get-mtime` detection order changed from GNU-first to BSD-first** - `scripts/hooks/get-mtime:7-10` (Confidence: 62%) -- The original inline `get_mtime` tested `stat --version` (GNU) first. The new shared helper tries `stat -f %m` (BSD) first and falls back to `stat -c %Y` (GNU). On GNU Linux, the BSD-style `stat -f %m` could match a different flag meaning (`-f` is "filesystem" on some GNU stat versions), potentially returning incorrect mtime values. The `2>/dev/null` suppresses errors, and the fallback line runs regardless if the first succeeds, so in practice the `return` statement prevents double-output. Low confidence because GNU stat with `-f` typically exits non-zero for missing `%m` format on filesystem mode.

- **Non-interactive TTY guard missing for `--clear`** - `src/cli/commands/memory.ts:196` (Confidence: 70%) -- The `--clear` handler uses `p.select()` for interactive prompt but has no `process.stdin.isTTY` guard. In non-interactive (CI/pipe) environments, the select prompt will hang or fail. Other handlers in the codebase (init.ts) explicitly guard interactive prompts with TTY checks.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The changes are predominantly refactoring (extracting `get_mtime` to a shared helper, optimizing JSON parsing from 2 calls to 1, moving queue cleanup from `--disable` to a dedicated `--clear` command). The security surface is narrow -- shell hooks processing JSON from Claude Code's hook system (trusted input boundary) and a new CLI subcommand that deletes known ephemeral files. The one blocking MEDIUM finding (race with background updater during `--clear`) is low-impact since the worst case is losing a few queued turns, not data corruption or privilege escalation. The pre-existing `--dangerously-skip-permissions` flag is worth tracking but is not introduced by this PR.
