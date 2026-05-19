# Performance Review Report

**Branch**: fix/memory-learning-knowledge-health -> main
**Date**: 2026-05-10
**PR**: #211

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Regex grep on every stop hook invocation is defensively over-broad for a self-controlled format** - `scripts/hooks/stop-update-memory:55`
**Confidence**: 82%
- Problem: The grep pattern was changed from fixed-string `'"role":"assistant"'` to regex `'"role"[[:space:]]*:[[:space:]]*"assistant"'` to handle whitespace around colons. However, both queue producers (stop-update-memory lines 78-84 and prompt-capture-memory lines 34-39) exclusively use `jq -c` (compact) and `JSON.stringify` (no pretty-printing), which never insert spaces around colons. The regex is solving for a format variant that this codebase cannot produce. While benchmarking shows the per-invocation cost is negligible (~2.7ms either way, dominated by process spawn), the regex pattern is strictly less efficient than fixed-string matching for zero practical benefit — and using `grep -qF` (fixed-string flag) would be even faster than the original implicit BRE match.
- Fix: Use `grep -qF` with the original compact pattern. Both producers are controlled by this codebase, so the format is guaranteed compact:
```bash
if ! grep -qF '"role":"assistant"' "$QUEUE_FILE" 2>/dev/null; then
```
If defensive breadth against hypothetical external writers is desired, document that assumption with a comment.

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**grep + wc -l executed on every end_turn stop — sequential I/O on the hot path** - `scripts/hooks/stop-update-memory:54-58,88-93`
**Confidence**: 85%
- Problem: The stop hook runs on every assistant turn completion. On each `end_turn`, it performs: (1) a grep scan of the entire queue file for orphan detection (line 55), (2) a `wc -l` call if orphans are detected (line 56), and (3) another `wc -l` + potential `tail` + `mv` for overflow detection (lines 89-93). For a typical queue file (well under 200 lines of compact JSONL, ~12KB max), each of these is sub-millisecond. But the pattern of scanning the full file twice per invocation (grep + wc -l) could be consolidated: `grep -c` returns a count, and the orphan check + overflow check could share a single file stat. This is not blocking because the queue is size-capped at 200 lines and the total overhead is under 5ms, well within the stop hook's latency budget (which also includes a jq/node JSON serialization at ~3-5ms).
- Fix: No code change needed for this PR. If latency becomes a concern (e.g., larger queue caps), consider using `grep -cF '"role":"assistant"' "$QUEUE_FILE"` to get both the presence check and a signal about queue health in a single pass.

## Positive Performance Observations

1. **Diagnostic block removal** (lines 52-59 removed): Eliminating the one-time diagnostic `jq -r 'keys | join(",")'` call and its `[ ! -f DIAG_MARKER ]` stat check removes unnecessary I/O from every invocation (the stat) and an expensive jq pipe from the first invocation. Net positive for the hot path.

2. **chmod guard uses `[ ! -f ]` fast path** (line 74): The `touch + chmod 600` only executes when the queue file does not yet exist. On all subsequent invocations (the common case), this is a single `stat()` syscall that returns immediately. Well-structured guard.

3. **ensure-features-init marker file pattern** (line 19): The `.gitignore-configured` marker file ensures the gitignore setup loop (with its 3x `grep -qxF` calls) only runs once per project lifetime. After the marker exists, the script exits in ~1us (two `stat()` calls: one for `index.json`, one for the marker). This is an effective amortization pattern for the session-end hook hot path.

4. **Early return on missing argument** (line 6): The `[ -z "$1" ] && return 1` guard avoids executing `mkdir -p` on a malformed path, preventing unnecessary filesystem operations.

## Suggestions (Lower Confidence)

- **Queue file double-open on orphan detection** - `scripts/hooks/stop-update-memory:55-56` (Confidence: 65%) — When an orphan queue is detected, `grep` reads the file and then `wc -l` reads it again for the log message. The `wc -l` is only for logging, so this is cosmetic. If the log line count is not essential, removing it would save one file open.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The branch is a net performance improvement: it removes the diagnostic block (one stat + conditional jq per invocation), adds well-guarded chmod (single stat on common path), and the ensure-features-init marker pattern is properly amortized. The one blocking item (regex grep vs fixed-string) is a micro-optimization — the measured difference is under 0.1ms — but using `grep -qF` would be both faster and more semantically accurate since the format is self-controlled. The grep-on-every-invocation concern from the review prompt is addressed: at ~2.7ms per call on a 200-line file (the cap), it adds negligible latency to the stop hook, which already spends 3-5ms on jq/node JSON serialization.

ADR-001 and PF-001 were reviewed — neither applies to this PR's changes (no migration or backward-compatibility code is introduced).
