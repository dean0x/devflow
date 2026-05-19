# Security Review Report

**Branch**: fix/memory-learning-knowledge-health -> main
**Date**: 2026-05-10

## Issues in Your Changes (BLOCKING)

### HIGH

**TOCTOU race in chmod 600 — queue file created world-readable before chmod** - `scripts/hooks/stop-update-memory:74-75`
**Confidence**: 85%
- Problem: The `touch "$QUEUE_FILE" && chmod 600 "$QUEUE_FILE"` pattern creates the file with the default umask (typically 644 on macOS), then changes permissions in a separate syscall. Between `touch` and `chmod`, another process or user could read the file. The queue contains assistant response content which may include sensitive project data (API discussions, architecture decisions, code snippets).
- Impact: On shared systems or multi-user environments, the queue file is briefly world-readable. Practical risk is low on single-user developer machines but violates defense-in-depth.
- Fix: Use a restrictive `umask` before file creation to ensure the file is never created with permissive permissions:
```bash
if [ ! -f "$QUEUE_FILE" ]; then
  (umask 077 && touch "$QUEUE_FILE") 2>/dev/null || true
fi
```
This creates the file with 600 permissions atomically — no window where the file exists with broader permissions.

### MEDIUM

**chmod 600 not applied by prompt-capture-memory — inconsistent permission enforcement** - `scripts/hooks/prompt-capture-memory:36`
**Confidence**: 90%
- Problem: The stop hook (`stop-update-memory:74-75`) creates the queue file with `chmod 600`, but `prompt-capture-memory` appends directly to `$CWD/.memory/.pending-turns.jsonl` (lines 36, 39) without any permission check. If the prompt-capture hook runs first and creates the file, it inherits the default umask (typically 644). The chmod 600 in the stop hook only applies to file creation (`[ ! -f "$QUEUE_FILE" ]`), so it never retroactively fixes a file created by prompt-capture.
- Impact: The security hardening is bypassed whenever the user prompt hook fires before the first assistant response in a session (which is the normal flow — user speaks first).
- Fix: Apply the same restricted-creation pattern in `prompt-capture-memory` before the first append:
```bash
QUEUE_FILE="$CWD/.memory/.pending-turns.jsonl"
if [ ! -f "$QUEUE_FILE" ]; then
  (umask 077 && touch "$QUEUE_FILE") 2>/dev/null || true
fi
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Auto-clean grep pattern accepts crafted payloads that look like assistant entries** - `scripts/hooks/stop-update-memory:55`
**Confidence**: 82%
- Problem: The grep pattern `'"role"[[:space:]]*:[[:space:]]*"assistant"'` matches anywhere in the line, not just the JSON key position. A user prompt containing the literal string `"role" : "assistant"` (e.g., someone discussing queue format, pasting JSON examples, or asking about the hook itself) would cause the grep to match a user-only queue as containing assistant entries, skipping the auto-clean. This is a defense-in-depth concern — the queue becomes unbounded with orphan entries until the 200-line overflow cap triggers.
- Impact: Low-to-moderate. The auto-clean is a hygiene mechanism; the overflow guard provides a safety net. However, a crafted or coincidental user prompt could accumulate ~200 orphan entries before cleanup, consuming disk and increasing background updater processing time.
- Fix: This is acceptable given the overflow guard at line 88-94. If stricter matching is desired, anchor the pattern to the start of the JSON object:
```bash
if ! grep -q '^{"role"[[:space:]]*:[[:space:]]*"assistant"' "$QUEUE_FILE" 2>/dev/null; then
```
However, jq-generated output is compact (no leading whitespace), making `^{` a reliable anchor for all entries in this queue.

## Pre-existing Issues (Not Blocking)

### HIGH

**ensure-memory-gitignore lacks the same argument guard added to ensure-features-init** - `scripts/hooks/ensure-memory-gitignore:6`
**Confidence**: 92%
- Problem: The PR correctly adds `[ -z "$1" ] && return 1` to `ensure-features-init` to prevent creating `/.features/` at filesystem root when called with an empty argument. However, the analogous `ensure-memory-gitignore` script has no such guard — if `$1` is empty, `_MEMORY_DIR` becomes `/.memory` and `mkdir -p "/.memory/decisions"` attempts to create directories at the filesystem root. On macOS this fails (root filesystem is read-only), but on Linux it could succeed as root.
- Impact: Path traversal to filesystem root. Mitigated by callers always checking `$CWD` before sourcing, but the pattern is fragile — the same bug that motivated the `ensure-features-init` fix exists here.
- Fix: Add the same guard:
```bash
[ -z "$1" ] && return 1
```

## Suggestions (Lower Confidence)

- **Queue file permissions not verified on existing files** - `scripts/hooks/stop-update-memory:74` (Confidence: 65%) — The chmod 600 only runs on file creation. If the file already exists with 644 (created by prompt-capture or a previous version), permissions are never tightened. Consider adding a periodic permission check or applying chmod unconditionally.

- **No file permission tests in test suite** - `tests/shell-hooks.test.ts` (Confidence: 70%) — The new chmod 600 behavior is not verified by any test. The test at line 1380 ("auto-clean with empty queue file") tests the auto-clean logic but does not assert file permissions. Adding `expect(fs.statSync(queueFile).mode & 0o777).toBe(0o600)` would catch regressions.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 1 | 0 | 0 |

**Security Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The chmod 600 hardening is a good security improvement, but it has two issues that undermine its effectiveness: (1) a TOCTOU race where `touch` + `chmod` is not atomic, and (2) the prompt-capture hook bypasses the permission enforcement entirely since it can create the queue file first with default umask. Both are straightforward fixes. The argument guard on `ensure-features-init` is correctly implemented and sufficient for its purpose.
