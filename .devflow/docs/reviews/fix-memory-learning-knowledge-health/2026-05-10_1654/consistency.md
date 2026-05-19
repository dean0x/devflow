# Consistency Review Report

**Branch**: fix/memory-learning-knowledge-health -> main
**Date**: 2026-05-10

## Issues in Your Changes (BLOCKING)

### HIGH

**Queue file permission guard inconsistent between hooks** - `scripts/hooks/stop-update-memory:74-76`
**Confidence**: 90%
- Problem: The `stop-update-memory` hook now creates the queue file with `chmod 600` restricted permissions before first write (lines 74-76), but `prompt-capture-memory` appends to the same file (`$CWD/.memory/.pending-turns.jsonl`) via `>>` without any permission guard (line 36). Since `prompt-capture-memory` fires on UserPromptSubmit and typically runs before the first Stop hook, it will create the file with default umask permissions, making the 600 guard in `stop-update-memory` a no-op in practice.
- Fix: Either add the same `chmod 600` guard to `prompt-capture-memory` before its first write, or extract the pattern into the shared `ensure-memory-gitignore` script (which both hooks already source) so the queue file creation with restricted permissions happens in one place.

### MEDIUM

**Argument guard pattern inconsistent between `ensure-*` scripts** - `scripts/hooks/ensure-features-init:6`
**Confidence**: 85%
- Problem: `ensure-features-init` now has an explicit `[ -z "$1" ] && return 1` guard at line 6 before using `$1`. Its sibling script `ensure-memory-gitignore` uses `$1` immediately at line 6 (`_MEMORY_DIR="$1/.memory"`) without any empty-argument guard. Both scripts follow the same `source` pattern with the same calling convention (`source ensure-* "$CWD"`), so the defensive pattern should be consistent. The `ensure-memory-gitignore` script does happen to survive an empty `$1` because `mkdir -p` on `/.memory/decisions` fails and returns 1, but the failure mode is less explicit.
- Fix: Add `[ -z "$1" ] && return 1` as the first line of `ensure-memory-gitignore` to match the new pattern in `ensure-features-init`. This is a pre-existing gap exposed by the new guard -- categorize as Should-Fix below.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Missing `$1` guard in `ensure-memory-gitignore`** - `scripts/hooks/ensure-memory-gitignore:6`
**Confidence**: 85%
- Problem: As noted above, `ensure-memory-gitignore` lacks the `[ -z "$1" ] && return 1` guard that was added to `ensure-features-init`. Both are sourced scripts in the same `ensure-*` family with identical calling conventions. The new guard in `ensure-features-init` establishes a pattern that should be applied to its sibling.
- Fix: Add `[ -z "$1" ] && return 1` before line 6 of `ensure-memory-gitignore`.

## Pre-existing Issues (Not Blocking)

No pre-existing consistency issues at CRITICAL severity.

## Suggestions (Lower Confidence)

- **Queue file path used inline vs variable** - `scripts/hooks/prompt-capture-memory:36` (Confidence: 65%) -- `prompt-capture-memory` uses the inline path `$CWD/.memory/.pending-turns.jsonl` directly in the append command (line 36), while `stop-update-memory` assigns it to a `QUEUE_FILE` variable (line 53) and references that throughout. Using a variable is cleaner and matches `stop-update-memory`'s pattern.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

### Decisions Applied

- Reviewed ADR-001 (no migration code for devflow refactors) and PF-001 (migration code pitfall). Neither applies directly to this branch -- the changes are bug fixes and hardening, not refactors requiring migration code. The `ensure-features-init` index format change from `'{}'` to `'{"version":1,"features":{}}'` is a correctness fix (aligning with what `feature-knowledge.cjs` expects), not a migration -- applies ADR-001 (clean break, no backward compat shim for the old format).

### Positive Consistency Notes

- The `response_text` field naming follows the established UPPER_CASE bash convention (`RESPONSE_TEXT`) consistent with `CWD` and `STOP_REASON` patterns.
- No remaining `assistant_message` references exist anywhere in the codebase -- the rename is complete.
- The `_` prefix for unused mock parameters (`_args`, `_opts`) is now consistent across both `learning-agent.test.ts` and `decisions-agent.test.ts`.
- The `_FEATURES_DIR` underscore prefix for sourced-script variables matches the existing convention in `ensure-memory-gitignore` (`_MEMORY_DIR`), `json-parse` (`_HAS_JQ`, `_HAS_NODE`, `_JSON_AVAILABLE`, `_SCRIPT_DIR`, `_JSON_HELPER`), and `get-mtime` (`_GET_MTIME_STAT_TYPE`).
- The `logFile` indentation fixes in error-path test cases restore alignment consistency with all other test call sites in both files.
- The `debug` field was never part of the source `DecisionsAgentOpts` or `LearningAgentOpts` interfaces -- no source/test drift exists.
- The whitespace-tolerant grep pattern `'"role"[[:space:]]*:[[:space:]]*"assistant"'` is more robust and only appears in one location, so no cross-file pattern divergence.
