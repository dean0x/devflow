# Complexity Review Report

**Branch**: fix/memory-learning-knowledge-health -> main
**Date**: 2026-05-10

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Orphan-clean grep pattern is fragile against JSON formatting variants** - `scripts/hooks/stop-update-memory:64`
**Confidence**: 82%
- Problem: The orphan queue detection uses `grep -q '"role":"assistant"'` which relies on jq/node producing no-space JSON. If a future code path or manual edit inserts a space (e.g., `"role": "assistant"`), the grep will miss it and the auto-clean will falsely truncate a healthy queue containing assistant entries.
- Fix: Use a more permissive grep pattern that tolerates optional whitespace:
  ```bash
  if ! grep -q '"role"[[:space:]]*:[[:space:]]*"assistant"' "$QUEUE_FILE" 2>/dev/null; then
  ```
  Alternatively, since both the jq and node serializers in this file produce compact JSON (no spaces around colons), this is acceptable if documented. Add a comment noting the format assumption.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Diagnostic block adds transient complexity for a one-time log** - `scripts/hooks/stop-update-memory:52-59` (Confidence: 68%) -- The 8-line diagnostic block (marker file, conditional jq call, touch) runs once per project then becomes dead code guarded by a marker check. Consider removing after the fix is validated in production, or add a comment with a removal target date.

- **`cut -d` delimiter approach adds a subprocess per field vs prior parameter expansion** - `scripts/hooks/stop-update-memory:31-33` (Confidence: 62%) -- The old code used bash parameter expansion (`${_FIELDS%%...}` / `${_FIELDS#*...}`) for 2 fields; the new code spawns 3 `printf | cut` pipelines. For a hook that fires every turn, this trades ~0ms bash builtins for 3 subshell forks. The tradeoff is justified (3 fields with a delimiter requires `cut` for the third `f3-` capture), but worth noting the marginal cost.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Complexity Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

## Analysis

### Complexity Successfully Reduced

The primary goal of this branch -- reducing stop hook complexity -- is clearly achieved (applies ADR-001: no migration/compat code for the old `assistant_message` format):

1. **Before**: 18 lines of complex jq content-array parsing with type filtering (`select(.type == "text")`), string-vs-array type dispatch, plus a full Node.js fallback doing the same logic. Cyclomatic complexity of the extraction block alone was ~5 (if/elif/else in jq, try/if/else in node).

2. **After**: 0 lines of extraction logic. The `response_text` field is read directly alongside `cwd` and `stop_reason` in the existing field-extraction block. Net deletion of ~18 lines of the most complex code in the hook.

3. **Nesting depth**: The old assistant_message extraction had 2 independent code paths (jq branch, node branch) each with internal conditionals. The replacement adds zero nesting.

### New Complexity Assessment

The orphan-clean block (lines 61-68) adds 8 lines with nesting depth 2 (if/if). This is well within acceptable limits:
- Cyclomatic complexity contribution: +2 (two conditionals)
- Clear single responsibility: detect and truncate user-only queues
- Idempotent and safe (truncates to empty, next append creates valid state)

The diagnostic block (lines 52-59) adds 8 lines with nesting depth 2 (if/if). This is one-time code gated by a marker file -- effectively dead after first execution. Acceptable for a health-check during rollout.

### `ensure-features-init` Script

22 lines, nesting depth 2, cyclomatic complexity 3. Clean, idempotent, well-documented. Uses marker file pattern (`/.gitignore-configured`) to avoid repeated work -- same pattern used elsewhere in the codebase. No concerns.

### `_stripMarkdownFences` Regex Hardening

The regex changes (`/^```json\n/` to `/^\s*```json\s*\n/`) add whitespace tolerance without increasing complexity. The function remains 4 lines with zero branching. Tests cover the new edge cases.

### Timeout Changes

Pure constant changes (180000 to 300000). Zero complexity impact.
