# Security Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Reviewer focus**: Shell injection, path traversal, symlink attacks, TOCTOU races, untrusted input handling

## Issues in Your Changes (BLOCKING)

### HIGH

**Unsanitized arithmetic input from `.knowledge-last-refresh` file** - `scripts/hooks/sidecar-evaluate:374-376`
**Confidence**: 90%
- Problem: `LAST_REFRESH` is read from a file via `cat` and used directly in bash arithmetic `$(( NOW - LAST_REFRESH ))` without sanitization. The `.features/.knowledge-last-refresh` file is in the project working tree (not `.memory/`), making it accessible to any collaborator or tool. If the file contains non-numeric content (e.g., from corruption or malicious write), bash arithmetic evaluation under `set -e` will terminate the hook prematurely, preventing all subsequent evaluation (decisions, knowledge). Bash arithmetic can also interpret certain strings as variable references (e.g., `a[$(cmd)]` can execute arbitrary commands in some bash versions).
- Fix: Sanitize `LAST_REFRESH` the same way `RETRY_COUNT` is sanitized in `sidecar-dispatch:106`:
```bash
LAST_REFRESH=$(cat "$KNOWLEDGE_MARKER" 2>/dev/null | tr -dc '0-9' || true)
LAST_REFRESH="${LAST_REFRESH:-0}"
```

**Predictable temp file path without symlink protection in queue truncation** - `scripts/hooks/sidecar-capture:110`
**Confidence**: 82%
- Problem: `tail -100 "$QUEUE_FILE" > "$QUEUE_FILE.tmp"` uses shell redirection to a predictable path (`$QUEUE_FILE.tmp`). Shell `>` follows symlinks — if a symlink exists at `$QUEUE_FILE.tmp` pointing to another file, the redirection overwrites the symlink target. While the `.memory/` directory uses 600-permission files, the directory itself is not restricted (it must be writable for the hooks), and the `.tmp` path is predictable from the known queue file path. Contrast with `decisions-usage-scan.cjs` which correctly uses `O_EXCL` flag (`wx`) for its `.tmp` writes.
- Fix: Use `mktemp` or add symlink check:
```bash
TMPFILE=$(mktemp "$QUEUE_FILE.XXXXXX") && tail -100 "$QUEUE_FILE" > "$TMPFILE" && mv "$TMPFILE" "$QUEUE_FILE"
```

### MEDIUM

**Marker expiry only enforced when jq is available** - `scripts/hooks/sidecar-dispatch:142`
**Confidence**: 85%
- Problem: The 24-hour marker expiry logic is wrapped in `if [ "$_HAS_JQ" = "true" ]` with no `else` branch. When `jq` is absent (node-only fallback path), markers never expire. An expired marker would cause the sidecar skill to be loaded and a background agent spawned for stale work on every user prompt indefinitely. This is a resource consumption vector — stale markers trigger unnecessary LLM API calls.
- Fix: Add a node fallback for timestamp extraction, or use `stat`-based file-age expiry as a secondary guard:
```bash
else
  # Fallback: expire markers by file modification time when jq unavailable
  MARKER_MTIME=$(get_mtime "$MARKER_FILE")
  MARKER_MTIME="${MARKER_MTIME:-0}"
  FILE_AGE=$(( NOW - MARKER_MTIME ))
  if [ "$FILE_AGE" -gt 86400 ]; then
    rm -f "$MARKER_FILE" 2>/dev/null || true
    continue
  fi
fi
```

**No `O_EXCL` protection on memory marker write** - `scripts/hooks/sidecar-capture:150,159`
**Confidence**: 80%
- Problem: The memory marker is written with shell `>` redirection (`> "$SIDECAR_DIR/memory.json"`) and node `>` redirect. Shell redirection follows symlinks. If a symlink were placed at `memory.json` before the write, it would overwrite the target. The risk is limited because `.sidecar/` is inside `.memory/` which has restricted permissions, but the pattern is inconsistent with the safer `O_EXCL` pattern used in `decisions-usage-scan.cjs`.
- Fix: Write to a temp file first, then `mv`:
```bash
jq -n ... > "$SIDECAR_DIR/memory.json.tmp" && mv "$SIDECAR_DIR/memory.json.tmp" "$SIDECAR_DIR/memory.json"
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`json_field` interpolates field name directly into jq filter string** - `scripts/hooks/json-parse:29,40`
**Confidence**: 82%
- Problem: `json_field` and `json_field_file` build jq filter expressions via string interpolation: `jq -r ".$field // \"$default\""`. If `$field` or `$default` ever contained jq metacharacters (e.g., `"; system("cmd")`), this would be a jq filter injection. Currently all call sites in the sidecar hooks use hardcoded field names (`"cwd"`, `"memory"`, `"true"`), so this is not exploitable today. However, the function is in a shared library sourced by multiple hooks — a future caller passing untrusted input would be vulnerable.
- Fix: Use jq's `--arg` for the field name and default:
```bash
jq -r --arg f "$field" --arg d "$default" '.[$f] // $d' 2>/dev/null
```
Note: this changes `.$field` (direct path access) to `.[$f]` (dynamic key lookup), which is functionally identical for top-level fields.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **CWD not validated as absolute path in sidecar-evaluate** - `scripts/hooks/sidecar-evaluate:20-21` (Confidence: 65%) — `sidecar-capture` and `sidecar-dispatch` check `[ ! -d "$CWD" ]` which provides implicit validation, but `sidecar-evaluate` only checks for empty. The `MEMORY_DIR` existence check at line 24 gates most operations, but `CWD` flows into `devflow_log_dir` (line 42) and `ENCODED_CWD`/`PROJECTS_DIR` (lines 49-50) before that check. Adding `[ ! -d "$CWD" ] && exit 0` after line 21 would be consistent with the other two hooks.

- **No `set -o pipefail` in any sidecar hook** (Confidence: 65%) — All three hooks use `set -e` but not `set -o pipefail`. Pipeline failures (e.g., `cat "$RETRY_FILE" | tr -dc '0-9'` where `cat` fails) silently succeed, potentially passing empty or default values to arithmetic operations. This is partially mitigated by `|| true` guards on most pipelines.

- **`ls -t` glob expansion for transcript fallback** - `scripts/hooks/sidecar-evaluate:60` (Confidence: 60%) — `ls -t "$PROJECTS_DIR"/*.jsonl` could produce unexpected results with filenames containing spaces or special characters. Since this path is under `~/.claude/projects/` and Claude Code controls the naming, practical risk is negligible.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Security Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The sidecar hooks demonstrate strong security awareness overall: `SESSION_ID` path traversal is properly guarded with regex validation (line 57), config values from JSON files are sanitized with `tr -dc '0-9'` before arithmetic use, `RESPONSE_TEXT` and `PROMPT` are safely passed to node/jq via `--arg`/`process.argv` (never string interpolation), the `decisions-usage-scan.cjs` uses `O_EXCL` for atomic temp writes, and the feedback loop breakers prevent recursive hook invocation. The two HIGH findings (unsanitized arithmetic input, predictable temp path) are straightforward fixes that would bring the security posture to a solid 9/10.
