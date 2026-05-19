# Security Review Report

**Branch**: feat-learning-wave2-quality -> main
**Date**: 2026-03-25
**PR**: #162

## Issues in Your Changes (BLOCKING)

### HIGH

**Race condition in batch file handoff (TOCTOU)** - `scripts/hooks/session-end-learning:190-192`
**Confidence**: 85%
- Problem: The `cp` + `rm -f` sequence on lines 190-192 is not atomic. If two concurrent sessions trigger the SessionEnd hook simultaneously and both reach the "batch is full" check, the second invocation can read a stale or partially-written `.learning-session-count` file between the first's `cp` and `rm`. This could result in a duplicate batch run or lost session IDs.
  ```bash
  cp "$SESSION_COUNT_FILE" "$BATCH_IDS_FILE"   # line 190
  rm -f "$SESSION_COUNT_FILE"                    # line 192
  ```
- Impact: Duplicate LLM invocations (wasted API calls, redundant observations) or silently dropped session IDs from the batch. Not exploitable externally, but a data integrity concern in concurrent usage.
- Fix: Use `mv` instead of `cp` + `rm` to make the handoff atomic:
  ```bash
  mv "$SESSION_COUNT_FILE" "$BATCH_IDS_FILE"
  ```
  This is an atomic rename on the same filesystem, eliminating the race window.

### MEDIUM

**Model-generated `ART_DESC` interpolated unescaped into YAML frontmatter** - `scripts/hooks/background-learning:632,640`
**Confidence**: 82%
- Problem: `ART_DESC` comes from LLM output (Sonnet response) and is interpolated directly into YAML frontmatter via `printf` without escaping double quotes or special YAML characters. If the model returns a description containing `"`, `\`, or YAML-significant characters, the generated artifact file will have malformed frontmatter.
  ```bash
  printf '%s\n' "description: \"$ART_DESC\"" ...
  ```
  While `ART_NAME` is sanitized (line 592), `ART_DESC` is not.
- Impact: Malformed YAML frontmatter in auto-generated skills/commands. Claude Code may fail to parse the skill or silently ignore it. Not a direct security exploit, but model output is an untrusted boundary that should be sanitized. An adversarial session transcript could craft messages that cause the model to emit descriptions with YAML injection payloads.
- Fix: Escape double quotes in `ART_DESC` before interpolation:
  ```bash
  ART_DESC=$(echo "$ART_DESC" | sed 's/"/\\"/g' | tr -d '\n')
  ```

**Session IDs appended to file without validation** - `scripts/hooks/session-end-learning:162`
**Confidence**: 80%
- Problem: `SESSION_ID` is extracted from hook JSON input (line 72) and appended directly to `.learning-session-count` (line 162). While the hook JSON comes from Claude's runtime (trusted source), the session ID is not validated to contain only expected characters (UUID-like alphanumeric + hyphens). If the JSON were ever malformed, a crafted session_id could inject newlines or other content into the file.
  ```bash
  echo "$SESSION_ID" >> "$SESSION_COUNT_FILE"
  ```
- Impact: Low practical risk since the source is Claude's runtime, but violates the defense-in-depth principle. A malformed session ID with embedded newlines could inflate the batch count, causing premature batch triggers.
- Fix: Validate session ID format before appending:
  ```bash
  if ! echo "$SESSION_ID" | grep -qE '^[a-zA-Z0-9_-]+$'; then
    log "Invalid session ID format, skipping"
    exit 0
  fi
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`ART_NAME` sanitization is incomplete** - `scripts/hooks/background-learning:592`
**Confidence**: 83%
- Problem: The path traversal sanitization strips `/` and `..` but does not handle other dangerous characters that could affect file paths or shell behavior in the generated path, such as spaces, backticks, semicolons, or shell metacharacters. The `sed 's/\.\.//g'` also only strips literal `..` pairs -- it would not catch `....` (which after one pass becomes `..`).
  ```bash
  ART_NAME=$(echo "$ART_NAME" | tr -d '/' | sed 's/\.\.//g')
  ```
  This is pre-existing code but is directly touched in this PR's diff (the create_artifacts function was modified) and the naming rules were changed.
- Impact: While exploitation requires a compromised LLM response, a name like `....` would be reduced to `..` after one sed pass, creating a relative path escape. Similarly, names with spaces or special characters could cause issues with `mkdir -p` or `grep -F` operations downstream.
- Fix: Use a stricter allowlist approach matching the naming rules stated in the prompt (kebab-case):
  ```bash
  ART_NAME=$(echo "$ART_NAME" | tr -cd 'a-z0-9-')
  if [ -z "$ART_NAME" ] || [ ${#ART_NAME} -gt 50 ]; then
    log "Skipping artifact with empty/invalid name"
    continue
  fi
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**User transcript messages embedded directly in LLM prompt (indirect prompt injection surface)** - `scripts/hooks/background-learning:292`
**Confidence**: 85%
- Problem: `$USER_MESSAGES` (extracted from session transcripts) is interpolated verbatim into the Sonnet prompt. An attacker who controls content that ends up in a user's session transcript (e.g., via a malicious README or error output that gets pasted) could craft messages that manipulate the pattern detection agent's output, potentially generating malicious artifacts (commands/skills with arbitrary content).
- Impact: The blast radius is limited because: (1) artifact creation requires the observation to reach "ready" status (3 observations, 24h+ spread), (2) the `ART_NAME` sanitization prevents path traversal, and (3) artifacts don't auto-execute. However, a persistent attacker could inject misleading skill content over multiple sessions.
- Note: This is an inherent limitation of the pattern-from-transcript design and was pre-existing. The PR's changes (batch mode reading multiple sessions) slightly increase the surface area by aggregating more transcripts into a single prompt.

## Suggestions (Lower Confidence)

- **Log file as world-readable** - `scripts/hooks/session-end-learning:55` (Confidence: 65%) -- Debug logs append to `$LOG_FILE` which is created with default umask. If the log directory is shared or the umask is permissive, session transcript excerpts could leak. Consider explicit `umask 077` or `chmod 600` on log files.

- **No `disown` after background process spawn** - `scripts/hooks/session-end-learning:200-201` (Confidence: 70%) -- The `nohup ... &` spawn does not call `disown`, unlike the original `stop-update-learning` which used `disown`. If the parent shell process receives SIGHUP before the hook script exits, the background learner could be terminated. This is a reliability concern rather than a security one.

- **Batch IDs file readable by any local user** - `scripts/hooks/session-end-learning:190` (Confidence: 62%) -- `.learning-batch-ids` contains session IDs which, combined with the known Claude projects path structure, could let another local user identify transcript file locations. Low risk on single-user dev machines.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Security Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The codebase demonstrates good security awareness overall -- guard clauses for feedback loops, path traversal sanitization on model-generated names, `printf %s` for safe content writing, and `safePath` in the Node helper. The main blocking concern is the TOCTOU race in the batch file handoff (trivially fixed with `mv`). The ART_DESC escaping and session ID validation issues are medium-severity defense-in-depth improvements that should be addressed given this code processes LLM output.
