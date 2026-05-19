# Security Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Scope**: Incremental (7 commits since d8e7670)

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Session ID dedup via `grep -qF` allows partial-match bypass** - `scripts/hooks/sidecar-evaluate:137`
**Confidence**: 82%
- Problem: The deduplication check `grep -qF "$SESSION_ID" "$SESSION_COUNT_FILE"` uses fixed-string substring matching, not line-anchored matching. A session ID like `abc` will match a line containing `abc-xyz`, causing the dedup to falsely report "already counted" and skip a legitimate new session. Conversely, a session ID that is a substring of an existing one will be incorrectly deduplicated. This is a logic correctness issue that undermines the batch-counting integrity. While the SESSION_ID is validated against `^[a-zA-Z0-9_-]+$` so it cannot inject regex metacharacters, the unanchored match means short IDs can collide with longer ones.
- Fix: Use line-anchored grep:
  ```bash
  if [ -f "$SESSION_COUNT_FILE" ] && grep -qxF "$SESSION_ID" "$SESSION_COUNT_FILE" 2>/dev/null; then
  ```
  The `-x` flag requires the entire line to match, preventing substring false positives.

---

**Retry count file not validated as integer before arithmetic** - `scripts/hooks/sidecar-dispatch:89`
**Confidence**: 80%
- Problem: `RETRY_COUNT=$(cat "$RETRY_FILE" 2>/dev/null || echo "0")` reads the file contents directly and then uses the value in `[ "$RETRY_COUNT" -ge "$MAX_RETRIES" ]` arithmetic comparison. If the `.retries` file is corrupted (e.g., contains non-numeric content from a partial write during a crash, or has trailing whitespace/newlines), the `-ge` comparison in bash will produce an error and the condition will evaluate to false, causing the retry loop to cycle indefinitely instead of marking as `.failed`. Under `set -e`, this could also abort the hook entirely.
- Fix: Sanitize to integer:
  ```bash
  RETRY_COUNT=$(cat "$RETRY_FILE" 2>/dev/null | tr -dc '0-9' | head -c 5)
  RETRY_COUNT="${RETRY_COUNT:-0}"
  ```
  Or validate before comparison:
  ```bash
  [[ "$RETRY_COUNT" =~ ^[0-9]+$ ]] || RETRY_COUNT=0
  ```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **SOH delimiter collision in sidecar-capture** - `scripts/hooks/sidecar-capture:27` (Confidence: 65%) -- The jq expression concatenates `cwd`, `stop_reason`, and `response_text` using literal SOH (U+0001) characters. If `response_text` ever contains a SOH byte (unlikely but possible in binary-adjacent content), the `cut` delimiter split at line 35 would misparse the fields. The node fallback at line 31 uses `\x01` which has the same limitation. Low practical risk since response_text is model-generated text.

- **TOCTOU in .processing file retry logic** - `scripts/hooks/sidecar-dispatch:77-100` (Confidence: 60%) -- The stale-retry logic reads mtime, checks retry count, then renames the file. If two concurrent sessions run sidecar-dispatch simultaneously (possible with multiple terminal sessions), both could see the same stale .processing file and race to rename it. The `mv` would succeed for one and silently fail for the other (`2>/dev/null || true`), but the `.retries` counter could be incremented twice. Practical impact is minimal given the retry cap is a safety measure, not a security boundary.

- **Queue file append without locking** - `scripts/hooks/sidecar-capture:95` (Confidence: 62%) -- Multiple concurrent hook invocations (e.g., rapid-fire stops from multiple sessions sharing a cwd) could interleave JSONL lines in `.pending-turns.jsonl`, producing malformed JSON lines. The downstream consumer would need to handle parse failures gracefully. The overflow-safety truncation at line 104 also has a TOCTOU window (another writer could append between the `wc -l` check and the `tail > tmp && mv` operation).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | - | 0 | 0 | 0 |
| Pre-existing | - | - | 0 | 0 |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The SESSION_ID path traversal fix (the primary security concern flagged in the PR description) is correctly implemented with the `^[a-zA-Z0-9_-]+$` regex guard at line 57. The `writeConfig` now correctly sets `mode: 0o600` for sensitive config files. The `Array.isArray` check prevents prototype pollution via JSON arrays. The node fallback now passes file paths via `process.argv` instead of shell interpolation, eliminating shell metacharacter injection.

The two MEDIUM findings are low-risk correctness issues (grep substring matching and unvalidated integer), not exploitable vulnerabilities. Both should be fixed for robustness but neither represents a security hole that an external attacker could exploit -- the inputs are from Claude Code's own hook system, not untrusted external sources.
