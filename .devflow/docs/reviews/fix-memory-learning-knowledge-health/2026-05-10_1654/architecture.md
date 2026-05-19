# Architecture Review Report

**Branch**: fix/memory-learning-knowledge-health -> main
**Date**: 2026-05-10

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Inconsistent permission hardening between peer hooks** - `scripts/hooks/stop-update-memory:74-76`
**Confidence**: 85%
- Problem: The new `chmod 600` guard (lines 74-76) ensures the queue file is created with restricted permissions when the stop hook creates it. However, the peer hook `prompt-capture-memory` (line 36) creates the same queue file via `>> "$CWD/.memory/.pending-turns.jsonl"` append redirect with no `chmod 600` guard. Since `prompt-capture-memory` fires on `UserPromptSubmit` (before the stop hook), in a fresh session the queue file is typically created by `prompt-capture-memory` first, inheriting the default umask (often 644). The `stop-update-memory` guard at line 74 then finds the file already exists and skips the `chmod`. This means the permission hardening only takes effect in the uncommon case where the stop hook fires before any prompt has been captured (e.g., a resumed session or a session that starts with a tool_use stop followed by an end_turn).
- Fix: Apply the same `touch && chmod 600` guard in `prompt-capture-memory` before the first append, or extract a shared `ensure-queue-file` helper sourced by both hooks:
```bash
# In prompt-capture-memory, before the append block:
QUEUE_FILE="$CWD/.memory/.pending-turns.jsonl"
if [ ! -f "$QUEUE_FILE" ]; then
  touch "$QUEUE_FILE" && chmod 600 "$QUEUE_FILE" 2>/dev/null || true
fi
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **SOH delimiter in response_text could theoretically corrupt field splitting** - `scripts/hooks/stop-update-memory:31-33` (Confidence: 60%) -- The `cut -d$'\001' -f3-` approach for `RESPONSE_TEXT` is correct for multi-SOH content (preserves everything from field 3 onward), but if `response_text` itself contained U+0001, `cut` would split it into spurious fields. ASCII SOH in LLM output is practically impossible, but the `json_extract_cwd_prompt` helper in `json-parse` uses the safer bash parameter expansion pattern (`${FIELDS%%...}` / `${FIELDS#*...}`) for the same delimiter. Consider aligning the stop hook with that pattern for consistency, or document the SOH-safety assumption.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Architectural Assessment

**ensure-features-init separation**: Well-bounded. The script follows the established `ensure-memory-gitignore` pattern exactly: sourced file, single `$1` argument (CWD), idempotent via marker file, `return 1` on failure (not `exit 1`, since it's sourced). It has exactly one caller (`session-end-knowledge-refresh`), the responsibility boundary is clean (filesystem init only, no JSON parsing or business logic), and the new `[ -z "$1" ] && return 1` guard closes the missing-argument edge case that `ensure-memory-gitignore` lacks. The `index.json` format (`{"version":1,"features":{}}`) now aligns with both `init.ts` and `toggle.ts` -- applies ADR-001 (no migration shim for the old `{}` format; clean break to the canonical structure).

**Auto-clean ordering**: Correct. The sequence is: (1) auto-clean orphan queues (lines 52-59), (2) skip-if-empty guard (lines 61-65), (3) truncation (lines 67-70), (4) chmod guard (lines 72-76), (5) append (lines 77-84). Cleaning before appending prevents the new assistant entry from making the orphan queue look healthy (it would contain an assistant role, defeating the orphan detection). The ordering also avoids a subtle bug: if append happened first and the queue contained only user entries plus the new assistant entry, the auto-clean would see an assistant entry and skip truncation, leaving stale orphan user entries in the queue. The current ordering is the only correct one.

**Diagnostic block removal**: Clean removal of a one-time diagnostic (lines 52-59 in the base). The diagnostic was write-once-per-project (marker file), served its purpose (confirming `response_text` field availability), and no longer provides value. No migration needed -- orphan `.stop-hook-diag-done` marker files are harmless (applies ADR-001).

**grep pattern relaxation** (`'"role":"assistant"'` to `'"role"[[:space:]]*:[[:space:]]*"assistant"'`): Architecturally sound defensive change. Both jq (`-c` compact) and node paths in the append code produce compact JSON (no whitespace around colons), so the strict pattern works for entries written by this codebase. However, the relaxed pattern correctly handles edge cases where the queue file may have been manually edited or written by a future code path that pretty-prints JSON. The `[[:space:]]*` pattern is POSIX-portable.

**Extraction simplification (cut vs parameter expansion)**: The `cut`-based extraction at lines 31-33 is pre-existing (not introduced in this PR). The PR description's mention of "cut instead of bash parameter expansion" refers to the broader field extraction pattern that was already in place. The only extraction-related change in this PR is the diagnostic block removal. The `cut -d$'\001' -f3-` pattern correctly captures the full `response_text` even if it contains the SOH delimiter (though this is practically impossible in LLM output).
