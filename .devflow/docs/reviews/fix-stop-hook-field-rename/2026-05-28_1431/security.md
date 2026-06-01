# Security Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28
**Reviewer Focus**: Security
**Cross-Cycle**: Cycle 2 (PRIOR_RESOLUTIONS available; 10 fixed, 1 deferred, 0 FPs)

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Debug trace logs may contain sensitive assistant response content** - `scripts/hooks/sidecar-capture:50`
**Confidence**: 82%
- Problem: The debug trace at line 50 (`dbg "RESPONSE_TEXT length=${#RESPONSE_TEXT}"`) only logs the length, which is safe. However, the INPUT keys trace at line 31 uses `jq -r 'keys | join(", ")'` which leaks field names, and the raw INPUT is read via `cat` at line 29. If a future contributor adds a `dbg "INPUT=$INPUT"` or `dbg "RESPONSE=$RESPONSE_TEXT"` line (following the established pattern of logging variable values seen throughout these hooks), assistant responses containing secrets, API keys, or credentials would be persisted to `~/.devflow/logs/` in plaintext. The current code does not log the actual content -- the risk is that the debug tracing pattern established here makes it trivially easy to accidentally introduce such leaks.
- Fix: Add a cautionary comment near the INPUT/RESPONSE_TEXT debug lines:
```bash
# SECURITY: Never log INPUT or RESPONSE_TEXT content — may contain secrets.
# Only log metadata (length, keys, presence checks).
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **TOCTOU in settings.json read-modify-write** - `src/cli/commands/debug.ts:98-112` (Confidence: 65%) -- The enable/disable paths read settings.json, parse, modify, and write back without file locking. A concurrent `devflow init` or `devflow flags` could race. Low practical risk since CLI commands are typically user-initiated sequentially, and this pattern matches the existing `applyFlags`/`stripFlags` approach.

- **Debug log directory permissions not enforced after truncation** - `scripts/hooks/debug-trace:36` (Confidence: 62%) -- After `_devflow_dbg_size_guard` truncates via `tail > tmp && mv`, the resulting file inherits the original permissions (which are correct since log writes append to an existing file). However, the initial file creation at line 57 (`echo ... >> "$_DEVFLOW_DBG_LOG"`) relies on umask for permissions rather than an explicit `chmod 600`. If the user's umask is permissive (e.g., 0022), log files could be world-readable. The directory is already `chmod 700` (line 52/69), which mitigates this.

- **Session transcript path derived from user-controlled CWD** - `scripts/hooks/sidecar-evaluate:65-66` (Confidence: 60%) -- `ENCODED_CWD` is computed from `$CWD` and used to build a path under `~/.claude/projects/`. A malicious CWD could theoretically include path traversal characters, but `sed 's|^/||' | tr '/' '-'` neutralizes `/` separators and the resulting path is under a fixed prefix. Effectively safe but worth noting.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Conditions

1. Add a security comment near the debug trace points in `sidecar-capture` warning against logging raw INPUT or RESPONSE_TEXT content (MEDIUM).

### Positive Security Observations

- **applies ADR-007**: The single-toggle debug tracing design via `DEVFLOW_HOOK_DEBUG=1` centralizes the attack surface for debug log exposure. No per-feature toggles means one disable command (`devflow debug --disable`) turns off all tracing.
- **avoids PF-006**: The `response_text` to `last_assistant_message` field rename is correctly applied. The dead `stop_reason` filter that caused silent data loss is removed. This directly fixes the silent failure documented in PF-006.
- The `chmod 700` on debug log directories (lines 52, 69 of `debug-trace`) restricts access to the owning user.
- Queue file creation uses `umask 077` (`sidecar-capture:110`) for restricted permissions.
- All temp files use PID-unique names (`*.tmp.$$`) preventing symlink attacks on predictable paths.
- Atomic write pattern (temp + mv) used consistently across all marker and log file writes.
- The `dbg() { :; }` no-op fallback defined before `set -e` in every hook means a missing `debug-trace` source file never causes hook failure -- correct defensive coding.
- The CLI `debug.ts` catches `SyntaxError` on malformed settings.json and refuses to write, preventing corruption of the settings file.
- Session ID validation (`grep -qE '^[a-zA-Z0-9_-]+$'` in `eval-learning:60`) prevents injection via malicious session IDs.
- CWD directory-existence check (`[ ! -d "$CWD" ]`) added to all hooks prevents operations on nonexistent paths.
