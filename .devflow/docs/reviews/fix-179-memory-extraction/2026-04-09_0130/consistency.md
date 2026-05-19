# Consistency Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

### HIGH

**Mtime extraction pattern inconsistency between stop-update-memory and background-memory-update** - `scripts/hooks/stop-update-memory:96-100`
**Confidence**: 92%
- Problem: `stop-update-memory` inlines the Linux/macOS `stat` mtime detection (lines 96-100), while `background-memory-update` uses a reusable `get_mtime()` function for the same operation. The same inline pattern also exists in `session-start-memory:32-34`. The codebase has two competing approaches for the identical operation and this PR perpetuates the inconsistency rather than converging.
- Fix: Extract `get_mtime()` into a shared sourced file (like `log-paths`) or use the existing `get_mtime()` from `background-memory-update` in both hooks. At minimum, the stop hook should define or source `get_mtime()` instead of inlining `stat` commands.

**JSON queue entry construction uses raw jq/node instead of existing json_construct helper** - `scripts/hooks/stop-update-memory:74-79`, `scripts/hooks/preamble:31-36`
**Confidence**: 85%
- Problem: Both the stop hook and preamble construct JSON objects using raw `jq -n -c --arg ... '{role: $role, ...}'` and the equivalent inline `node -e "..."` fallback. The `json-parse` library already provides `json_construct` which wraps exactly this pattern with the jq/node dual-path. Using the raw approach duplicates the abstraction layer and means future changes to JSON construction would need updating in 4 places instead of 2.
- Fix: Replace inline construction with `json_construct`:
  ```bash
  # In stop-update-memory (line 74-79):
  json_construct --arg role "assistant" --arg content "$ASSISTANT_MSG" --argjson ts "$TS" >> "$QUEUE_FILE"
  
  # In preamble (line 31-36):
  json_construct --arg role "user" --arg content "$_TRUNCATED_PROMPT" --argjson ts "$_TS" >> "$CWD/.memory/.pending-turns.jsonl"
  ```

### MEDIUM

**Queue overflow threshold/cap magic numbers duplicated without shared constant** - `scripts/hooks/stop-update-memory:85-86`, `scripts/hooks/background-memory-update:108-109`
**Confidence**: 82%
- Problem: Both scripts use the same overflow threshold (200 lines) and cap target (100 lines) for truncating JSONL files, but the values are hardcoded independently in each script. If one changes, the other may drift silently. The `background-learning` hook uses a configurable approach via its learning config.
- Fix: Define these as named constants at the top of each script (e.g., `QUEUE_MAX_LINES=200`, `QUEUE_KEEP_LINES=100`) to make the relationship explicit, or source them from a shared config.

**Removed test assertion for session-end-learning syntax check inclusion** - `tests/shell-hooks.test.ts` (removed lines)
**Confidence**: 80%
- Problem: The diff removes the test `'is included in bash -n syntax checks'` from the `session-end-learning structure` describe block. This test validated that the `HOOK_SCRIPTS` array contained `session-end-learning`, ensuring it would be covered by the syntax check loop. Without it, if `session-end-learning` were accidentally removed from the `HOOK_SCRIPTS` array, there would be no test to catch it. The test was not redundant -- it validated array membership, not syntax.
- Fix: Restore the removed assertion or add an equivalent check.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Preamble header comment now inaccurate** - `scripts/hooks/preamble:4-5`
**Confidence**: 84%
- Problem: The preamble script header still reads "Zero file I/O beyond stdin -- static injection only." but this PR adds file I/O by appending to `.pending-turns.jsonl`. The header comment is now factually incorrect.
- Fix: Update the header comment:
  ```bash
  # Injects a detection-only preamble. Classification rules only — skill mappings live in devflow:router.
  # Also captures user prompts to .memory/.pending-turns.jsonl for working memory.
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**get_mtime() function duplicated across background-memory-update and background-learning** - `scripts/hooks/background-memory-update:41-47`, `scripts/hooks/background-learning:46-52`
**Confidence**: 88%
- Problem: Identical `get_mtime()` function is copy-pasted in both background hook scripts. This pre-dates this PR but the new stop-update-memory inlining adds a third variant of the same logic.
- Fix: Extract to a shared sourced file alongside `log-paths`.

## Suggestions (Lower Confidence)

- **Inconsistent turn pairing assumption** - `scripts/hooks/background-memory-update:138` (Confidence: 70%) -- The comment says "each turn = 2 lines" when computing `MAX_LINES`, but the code correctly handles orphan user/assistant entries. The comment could mislead future maintainers about the actual data shape.

- **New .pending-turns files not in ensure-memory-gitignore** - `scripts/hooks/ensure-memory-gitignore` (Confidence: 65%) -- The `.pending-turns.jsonl` and `.pending-turns.processing` files live under `.memory/` which is already gitignored at directory level, so this is not a functional issue. However, the ensure script only manages directory-level entries, not file-level ones, so the pattern is consistent.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Consistency Score**: 6/10
**Recommendation**: CHANGES_REQUESTED
