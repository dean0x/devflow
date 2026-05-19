# Security Review Report

**Branch**: fix/learning-validation-and-debug-logs -> main
**Date**: 2026-03-25
**PR**: #161

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Debug mode logs session content excerpts to disk** - `scripts/hooks/background-learning:641-646`
**Confidence**: 85%
- Problem: When `debug: true` is set in `learning.json`, the hook logs the first 500 characters of `USER_MESSAGES` (extracted from Claude session transcripts) and the full `EXISTING_OBS` (prior learning observations with evidence excerpts) to `~/.devflow/logs/{slug}/.learning-update.log`. Session transcripts may contain sensitive data such as API keys, credentials, database connection strings, or proprietary code that a user pastes into their Claude session. The raw model response is also logged at line 356-360, which could contain echoed-back sensitive content. While the log file lives in the user's home directory (not the project), it persists on disk without encryption, rotation is generous (500 lines in debug mode), and the file has default umask permissions (typically 644, world-readable on multi-user systems).
- Fix: (1) Restrict log file permissions at creation time with `umask 077` or explicit `chmod 600` on the log file. (2) Add a visible warning when debug mode is enabled (e.g., during `devflow learn --configure`) that session content will be written to disk. (3) Consider redacting obvious secret patterns (API keys, tokens) from debug output.

```bash
# After mkdir -p "$_LOG_DIR":
touch "$LOG_FILE"
chmod 600 "$LOG_FILE"
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Log file created with default umask (all 4 hook scripts)** - `scripts/hooks/background-learning:21-22`, `scripts/hooks/background-memory-update:21-22`, `scripts/hooks/stop-update-learning:36-37`, `scripts/hooks/stop-update-memory:35-36`
**Confidence**: 82%
- Problem: All four hook scripts create `~/.devflow/logs/{slug}/` with `mkdir -p` and write log files using shell redirection (`>>`). The resulting files inherit the process umask, which is typically 022 on macOS/Linux, making log files readable by all local users (mode 644). These logs contain timestamps, session IDs, and operational details. While not as sensitive as the debug-mode content above, session IDs could correlate to transcript files in `~/.claude/projects/`.
- Fix: Set restrictive permissions on the logs directory after creation:

```bash
mkdir -p "$_LOG_DIR"
chmod 700 "$_LOG_DIR"
```

**Validation inconsistency between shell and TypeScript purge logic** - `scripts/hooks/background-learning:253-257` vs `src/cli/utils/post-install.ts:620-624`
**Confidence**: 80%
- Problem: The shell script's contamination filter checks `id != "" and .type != "" and .pattern != ""`, while `post-install.ts` migration purge uses the truthiness check `obj.id && obj.type && obj.pattern`. The latter would also filter entries where these fields are `0`, `false`, or `null`, while the shell/jq version only filters empty strings. This inconsistency means the same learning-log.jsonl could be treated differently depending on which code path runs. While not exploitable per se, inconsistent validation is a defense-in-depth concern -- if a malformed entry with `type: 0` persists in one path but is rejected in another, it could cause unexpected behavior.
- Fix: Align both to use the stricter TypeScript `isLearningObservation()` type guard for the migration purge, which already validates type enum values and non-empty strings:

```typescript
// In post-install.ts, use parseLearningLog instead of manual filtering:
const { parseLearningLog } = await import('../commands/learn.js');
const valid = parseLearningLog(content);
```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Project slug path traversal via CWD** - `scripts/hooks/background-learning:19` (Confidence: 65%) -- The `_PROJECT_SLUG` is derived from `$CWD` using `sed 's|^/||' | tr '/' '-'`. While `CWD` comes from a positional argument (set by the calling stop-hook which reads it from the Claude Code hook context), a CWD containing `..` segments would produce a slug like `..-..-etc-passwd` which is benign since it is only used as a directory name under `~/.devflow/logs/`. No actual path traversal occurs because `tr '/' '-'` prevents directory separators. Low risk, noted for completeness.

- **Debug config is user-controlled boolean without strict parsing in shell** - `scripts/hooks/background-learning:100` (Confidence: 62%) -- The `DEBUG` variable is loaded via `json_field_file` which returns a raw string. If the config file contained `"debug": "true; rm -rf /"`, the jq-based extraction would safely return `false` (the `//` fallback), and the node fallback reads structured JSON. The `[ "$DEBUG" = "true" ]` comparison is an exact match, so injection is not possible. However, the TypeScript side enforces `typeof raw.debug === 'boolean'` while the shell side accepts any string value from jq. Minor type mismatch, no real exploit vector.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR introduces solid input validation improvements (empty field checks, type enum validation, id format enforcement, contaminated entry filtering) that meaningfully harden the learning system against malformed LLM output. The debug logging feature is the primary security surface area -- session content written to disk should use restrictive file permissions (chmod 600/700) and the validation logic between shell and TypeScript should be aligned. No critical or high severity issues found. The conditions for approval are:

1. Set restrictive permissions (700) on `~/.devflow/logs/{slug}/` directories across all 4 hook scripts
2. Consider adding a user-visible warning when debug mode is enabled via `--configure`
