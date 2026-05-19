# Regression Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09_0130

## Issues in Your Changes (BLOCKING)

### CRITICAL

No critical issues found.

### HIGH

No high-severity issues found.

### MEDIUM

**Stale comment claims "Zero file I/O" but hook now writes to queue file** - `scripts/hooks/preamble:5`
**Confidence**: 85%
- Problem: Line 5 reads `# Zero file I/O beyond stdin -- static injection only.` but the new code at lines 23-39 appends to `.memory/.pending-turns.jsonl` on every user prompt. This is documentation drift introduced by this PR -- the comment was accurate before the change but is now misleading.
- Impact: Future maintainers may rely on the "zero I/O" guarantee when reasoning about preamble performance or side effects, leading to incorrect assumptions.
- Fix: Update the comment to reflect the new behavior:
  ```bash
  # Injects a detection-only preamble. Classification rules only -- skill mappings live in devflow:router.
  # Queues user prompt to .memory/.pending-turns.jsonl for working memory, then injects classification preamble.
  ```

## Issues in Code You Touched (Should Fix)

No should-fix issues found.

## Pre-existing Issues (Not Blocking)

No pre-existing issues found.

## Suggestions (Lower Confidence)

- **Concurrent append race on `.pending-turns.jsonl`** - `scripts/hooks/preamble:33`, `scripts/hooks/stop-update-memory:76` (Confidence: 65%) -- Both the preamble hook and the stop hook append to the same `.pending-turns.jsonl` without file-level locking. On POSIX systems, small `>>` appends below PIPE_BUF (typically 4096 bytes) are atomic, and the truncated content (2000 chars max + JSON wrapper) stays well within this limit. However, if two hooks fire in close succession on macOS, there is a theoretical interleaving risk. The `mv`-based atomic handoff in the background updater mitigates data loss, and corrupted lines would simply fail `json_field` parsing silently. Likely safe in practice, but worth noting.

- **Removed test: `session-end-learning` array membership check** - `tests/shell-hooks.test.ts` (Confidence: 60%) -- The PR removes the `it('is included in bash -n syntax checks', ...)` test for `session-end-learning`. This test was redundant since `session-end-learning` remains in the `HOOK_SCRIPTS` array (line 13) and is covered by the bash -n loop (lines 23-31). No actual coverage regression.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Regression Checklist

- [x] No exports removed without deprecation (N/A -- shell scripts, no exports)
- [x] Return types backward compatible (N/A -- shell scripts)
- [x] Default values unchanged or documented
- [x] Side effects preserved -- memory updates still occur, now via queue instead of transcript extraction
- [x] All consumers of changed code updated -- `stop-update-memory` spawns `background-memory-update` with new 2-arg interface; no other callers exist
- [x] Migration complete across codebase -- no references to old 4-arg invocation or `extract_last_turn` remain
- [x] CLI options preserved (N/A -- no CLI changes)
- [x] API endpoints preserved (N/A)
- [x] Commit message matches implementation -- accurately describes queue-based capture replacing transcript extraction
- [x] Breaking changes documented -- CLAUDE.md Working Memory section updated to reflect new architecture
- [x] Tests pass -- 65/65 tests pass including 5 new queue behavior tests

### Architecture Assessment

The change is a clean replacement of the unreliable transcript extraction approach with a queue-based capture system. The old `extract_last_turn` function (which grepped session transcripts for user/assistant text) is entirely removed and replaced by two capture points: the preamble hook captures user prompts and the stop hook captures assistant messages. The background updater's interface is simplified from 4 arguments to 2 (removing `SESSION_ID` and `MEMORY_FILE` which are now derived or unnecessary). The `sleep 3` transcript flush wait is eliminated. Crash recovery via `.processing` file is well-designed. The `mv`-based atomic handoff prevents data loss during concurrent access.
