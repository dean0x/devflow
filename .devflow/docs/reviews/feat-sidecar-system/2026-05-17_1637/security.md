# Security Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Scope**: Incremental (0f0ee8a7..HEAD) — sidecar-capture, sidecar-dispatch, sidecar-evaluate, lib/transcript-filter.cjs

## Issues in Your Changes (BLOCKING)

### HIGH

**Unquoted variable in jq field interpolation allows jq injection** - `scripts/hooks/json-parse:29,40`
**Confidence**: 82%
- Problem: `json_field_file` (line 40) interpolates the `$default` variable directly into a jq program string: `"if (.$field | type) == \"null\" then \"$default\" else ..."`. If a config file contained a field with a crafted value that is absent (triggering the default path), or if a caller passes a default containing jq metacharacters, the jq expression could be subverted. In practice, all callers in the sidecar hooks pass literal string defaults ("true", "5", "3") so exploitation is unlikely, but the pattern is unsafe by construction.
- Impact: A malicious `config.json` or crafted default could inject arbitrary jq expressions.
- Fix: Use `--arg` for defaults:
  ```bash
  jq -r --arg d "$default" "if (.$field | type) == \"null\" then \$d else (.$field | tostring) end" "$file" 2>/dev/null
  ```
  Note: This is pre-existing code (json-parse helper), not introduced in this diff, but is exercised by new code on lines 47, 209-210, 311 of the sidecar hooks.

**Queue file overflow truncation has TOCTOU race** - `scripts/hooks/sidecar-capture:107-112`
**Confidence**: 83%
- Problem: Between checking `LINE_COUNT` (line 108-109) and the `tail ... > .tmp && mv` (line 110), another concurrent hook invocation (e.g., a second Claude session in the same project) could append to the queue. The tail+mv then discards those appended lines. With `set -e` active, if the `mv` fails the `.tmp` file is leaked.
- Impact: Data loss of captured turns during concurrent sessions. Not a security vulnerability per se but a reliability issue under the "assume hostile timing" principle.
- Fix: Use a lock (mkdir-based) around the truncation, or accept the race as benign (it caps at 200 lines, so worst case is extra turns lost during overflow):
  ```bash
  # Atomic cap: use a lockdir
  LOCK="$MEMORY_DIR/.queue-cap.lock"
  if mkdir "$LOCK" 2>/dev/null; then
    trap 'rmdir "$LOCK" 2>/dev/null' RETURN
    LINE_COUNT=$(wc -l < "$QUEUE_FILE" | tr -d ' ')
    if [ "$LINE_COUNT" -gt 200 ]; then
      tail -100 "$QUEUE_FILE" > "$QUEUE_FILE.tmp" && mv "$QUEUE_FILE.tmp" "$QUEUE_FILE"
    fi
  fi
  ```

### MEDIUM

**Transcript file path partially attacker-influenced via CWD encoding** - `scripts/hooks/sidecar-evaluate:49-50`
**Confidence**: 80%
- Problem: Line 49 encodes CWD into a path segment: `ENCODED_CWD=$(echo "$CWD" | sed 's|^/||' | tr '/' '-')`. CWD comes from the hook input JSON (`json_field "cwd" ""`). While the hook does validate `[ ! -d "$MEMORY_DIR" ] && exit 0` (line 24) confirming CWD points to a real directory with a `.memory/` subdirectory, the encoded path is used to construct `PROJECTS_DIR` (line 50) which feeds into `ls -t` and file reads. If an attacker could influence the cwd field in the hook JSON to contain characters like `*`, `?`, or whitespace, the `ls -t` glob on line 60 could expand unexpectedly. However, the `[ ! -d "$CWD" ]` guard at line 21 (via `json_field` returning to the calling check) and the `[ -d "$PROJECTS_DIR" ]` guard at line 55 provide defense in depth.
- Impact: Low practical risk — CWD must resolve to a real directory. Primarily a defense-in-depth concern.
- Fix: Quote the `echo` on line 49 to prevent glob expansion (it is already quoted, but the `$CWD` in line 49 is safe because `echo` receives it quoted). No action needed beyond awareness.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Session ID validation inconsistency across files** - `scripts/hooks/sidecar-evaluate:57,238`
**Confidence**: 85%
- Problem: Line 57 validates `SESSION_ID` with `grep -qE '^[a-zA-Z0-9_-]+$'` before using it in a path (`$PROJECTS_DIR/${SESSION_ID}.jsonl`). This is correct and prevents path traversal. However, line 238 repeats the same validation before appending to a file. If the validation regex were ever relaxed in one place but not the other, a traversal could open. The validation is currently sound.
- Impact: No current vulnerability. This is a maintenance risk — the regex is duplicated.
- Fix: Extract to a function:
  ```bash
  is_valid_session_id() { echo "$1" | grep -qE '^[a-zA-Z0-9_-]+$'; }
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**json_field jq expression interpolates field name unsafely** - `scripts/hooks/json-parse:29`
**Confidence**: 85%
- Problem: `jq -r ".$field // \"$default\""` — if `$field` contained jq metacharacters (e.g., `foo"; halt_error`), the expression would be corrupted. All current callers pass literal field names ("cwd", "memory", "max_daily_runs"), so this is safe in practice but brittle.
- Impact: Defense-in-depth concern. No current caller passes attacker-controlled field names.
- Fix: Use `--arg` and `getpath`: `jq -r --arg f "$field" --arg d "$default" 'getpath([$f]) // $d'`

**Temporary file in reinforcement uses predictable path** - `scripts/hooks/sidecar-evaluate:139`
**Confidence**: 80%
- Problem: `TEMP_LOG="${LEARNING_LOG}.tmp"` — the temp file is at a known, predictable path inside `.memory/`. In a shared-filesystem scenario (unlikely for `.memory/`), an attacker could pre-create a symlink at this path to redirect writes. The `rm -f "$TEMP_LOG"` on line 140 mitigates symlink pre-planting, and the directory is user-owned, so practical risk is minimal.
- Impact: Very low — `.memory/` is inside user's project directory with 700 permissions on queue files.
- Fix: Use `mktemp` within the directory: `TEMP_LOG=$(mktemp "${LEARNING_LOG}.XXXXXX")`

## Suggestions (Lower Confidence)

- **Log file injection via response text** - `scripts/hooks/sidecar-capture:115` (Confidence: 65%) — The `log` function writes `${#RESPONSE_TEXT}` (a number) so it is safe, but if the log format ever changed to include content, shell metacharacters in `RESPONSE_TEXT` could inject into the log. Currently not exploitable.

- **Unquoted glob in `compgen -G`** - `scripts/hooks/sidecar-dispatch:88` (Confidence: 62%) — The pattern `"$SIDECAR_DIR/*.processing"` is quoted so it is passed literally to `compgen -G` which performs its own glob. This is correct usage, but if `SIDECAR_DIR` contained spaces it could misbehave. The directory path is constructed from `$CWD/.memory/.sidecar` which is validated as an existing directory.

- **`ls -t` parsing fragility** - `scripts/hooks/sidecar-evaluate:60` (Confidence: 70%) — Filenames with newlines or special characters in `$PROJECTS_DIR` could confuse `ls -t | head -1`. The directory is Claude's own project directory (`~/.claude/projects/...`) with system-generated `.jsonl` filenames, so this is safe in practice.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The sidecar hooks demonstrate good security hygiene overall:
- Session ID validation prevents path traversal (line 57)
- Queue files are created with restricted permissions (umask 077)
- Input sanitization via `tr -dc '0-9'` on arithmetic inputs
- Feedback-loop guards prevent recursive hook invocation
- `2>/dev/null || true` patterns prevent error information leakage

The two HIGH findings are: (1) a pre-existing jq interpolation pattern that the new code exercises more heavily, and (2) a TOCTOU race in queue overflow handling that could lose captured turns under concurrent sessions. Neither is exploitable by an external attacker given the trust boundaries (hook input comes from Claude Code itself), but both represent defense-in-depth improvements worth addressing.
