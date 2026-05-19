# Complexity Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

_No blocking complexity issues found._

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Duplicated `get_mtime` function across two shell scripts** - `scripts/hooks/background-memory-update:48`, `scripts/hooks/stop-update-memory:30`
**Confidence**: 90%
- Problem: The identical `get_mtime()` function (GNU/BSD portable `stat` wrapper) is now defined in both `background-memory-update` and `stop-update-memory`. This PR added the function to `stop-update-memory` (replacing inline stat calls), but the same function already exists in `background-memory-update`. Two copies of the same function in the same directory increases maintenance cost -- a bug fix in one will miss the other.
- Fix: Extract `get_mtime` into a shared helper (similar to `json-parse` or `log-paths`) that both scripts source:
  ```bash
  # scripts/hooks/portable-stat
  get_mtime() {
    if stat --version &>/dev/null 2>&1; then
      stat -c %Y "$1"
    else
      stat -f %m "$1"
    fi
  }
  ```
  Then `source "$SCRIPT_DIR/portable-stat"` in both scripts.

**Duplicated queue overflow threshold as magic numbers (200/100)** - `scripts/hooks/stop-update-memory:92-98`, `scripts/hooks/background-memory-update:115-119`
**Confidence**: 85%
- Problem: Both scripts independently implement the same overflow logic with hardcoded `200` and `100` thresholds. The `# NOTE:` comments cross-referencing the other file acknowledge this duplication but do not eliminate it. If thresholds need tuning, two files must be updated in sync.
- Fix: Define shared constants at the top of each script or in a sourced helper:
  ```bash
  QUEUE_MAX_LINES=200
  QUEUE_TRIM_LINES=100
  ```
  Alternatively, extract the overflow check into a shared function in a sourced helper.

## Pre-existing Issues (Not Blocking)

### HIGH

**`init.ts` action handler is a 1093-line monolith** - `src/cli/commands/init.ts`
**Confidence**: 95%
- Problem: The `init` command action handler is a single function spanning 1093 lines. This PR adds 5 more lines to it (queue cleanup on disable). This is already tracked as PF-002 in pitfalls.md with an acknowledged resolution to extract into `collectInitChoices()`, `executeInstallation()`, `printSummary()`. The PR correctly defers this refactoring and only makes a minimal, necessary change.
- Note: Informational only. The 5-line addition is clean and well-placed. The monolith is a pre-existing issue.

### MEDIUM

**`background-memory-update` at 313 lines with 7+ responsibilities** - `scripts/hooks/background-memory-update`
**Confidence**: 90%
- Problem: This script handles locking, crash recovery, queue parsing, turn pairing, git state gathering, prompt building, claude invocation, timeout watchdog, and cleanup. Already tracked as PF-004 in pitfalls.md. This PR improves it (replacing per-line subprocess spawning with single-pass extraction), but the overall script remains complex. The new single-pass extraction block (lines 155-172) is itself well-structured.
- Note: Informational only. The changes in this PR reduce complexity (eliminating per-line subprocesses), which is the right direction.

## Suggestions (Lower Confidence)

- **Queue cleanup logic duplicated in init.ts and memory.ts** - `src/cli/commands/init.ts:1413-1415`, `src/cli/commands/memory.ts:213-215` (Confidence: 70%) -- The `.pending-turns.jsonl` and `.pending-turns.processing` cleanup is implemented identically in two places. Could be extracted to a utility function in `post-install.ts` or a new `queue-utils.ts`.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 1 | 1 | 0 |

**Complexity Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR meaningfully reduces complexity in the hot path (eliminating per-line subprocess spawning in `background-memory-update`). The new `prompt-capture-memory` hook is clean and focused (40 lines, single responsibility). The separation of prompt capture from `preamble` into its own hook is a good architectural move that simplifies both components. The two should-fix items are minor duplication introduced across the hooks directory. No blocking issues.
