# Architecture Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09
**Diff range**: 33973c6...HEAD (2 commits: ada6344, 4ce11fd)

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Duplicated queue cleanup logic — inline in two locations instead of shared utility** - `src/cli/commands/memory.ts:213-215`, `src/cli/commands/init.ts:1413-1415`
**Confidence**: 85%
- Problem: The queue file cleanup logic (delete `.pending-turns.jsonl` and `.pending-turns.processing`) is implemented identically in both the `memoryCommand --disable` handler and the `init` command's `else` branch when `memoryEnabled` is false. Both use the same `.then(() => true).catch(() => false)` pattern on the same two file paths. This is a DRY violation that creates drift risk — if the queue format changes (e.g., a third file is added), one location could be missed.
- Impact: Moderate. Two locations to update, moderate drift risk as the queue mechanism evolves.
- Fix: Extract a shared utility function, e.g. in `src/cli/utils/post-install.ts`:
  ```typescript
  export async function cleanupQueueFiles(memoryDir: string): Promise<{ queue: boolean; processing: boolean }> {
    const queue = await fs.unlink(path.join(memoryDir, '.pending-turns.jsonl')).then(() => true).catch(() => false);
    const processing = await fs.unlink(path.join(memoryDir, '.pending-turns.processing')).then(() => true).catch(() => false);
    return { queue, processing };
  }
  ```

**Duplicated `get_mtime()` function across two shell scripts** - `scripts/hooks/stop-update-memory:30-36`, `scripts/hooks/background-memory-update:48-54`
**Confidence**: 85%
- Problem: The `get_mtime()` shell function (portable mtime extraction using GNU vs BSD `stat` detection) is copy-pasted identically in both `stop-update-memory` and `background-memory-update`. This is precisely the pattern called out in PF-005 (interface duplication) but for shell scripts.
- Impact: Moderate. Two locations to update if the portability logic needs changes. The scripts already share `json-parse` and `log-paths` via `source` — this function should follow the same pattern.
- Fix: Extract to a shared helper (e.g., `scripts/hooks/stat-helpers`) and `source` it in both scripts:
  ```bash
  # scripts/hooks/stat-helpers
  get_mtime() {
    if stat --version &>/dev/null 2>&1; then
      stat -c %Y "$1"
    else
      stat -f %m "$1"
    fi
  }
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Hardcoded `process.cwd()` for queue cleanup — ignores CWD argument or git root** - `src/cli/commands/memory.ts:213`
**Confidence**: 82%
- Problem: The disable handler constructs the memory directory path using `process.cwd()`. This works only when the user runs `devflow memory --disable` from the project root. Other devflow commands (e.g., init) use `getGitRoot()` or explicit path resolution for the `.memory/` directory. If a user runs the command from a subdirectory, the cleanup targets the wrong path.
- Impact: Queue files left behind on disable when run from a subdirectory.
- Fix: Use a consistent path resolution strategy. Either derive from `getGitRoot()` (if available) or use the same `process.cwd()` approach but with a note that it matches the project-root assumption used elsewhere in the codebase. The `init` command at line 1413 has the same assumption.

**Overflow threshold 200/100 is a magic number duplicated across scripts** - `scripts/hooks/stop-update-memory:92-93`, `scripts/hooks/background-memory-update:114-115`
**Confidence**: 80%
- Problem: The overflow threshold (200 lines trigger, 100 lines keep) is duplicated across two scripts. The `NOTE:` comments cross-reference each other, which is a positive signal of awareness, but a constant defined once would be more robust. This is a minor cohesion issue — both scripts operate on the same queue file and must agree on the threshold.
- Impact: Low. The cross-referencing comments mitigate the risk, but the pattern becomes more fragile as more scripts interact with the queue.
- Fix: Extract to a shared shell constant file or define in `json-parse` (which both scripts already source).

## Pre-existing Issues (Not Blocking)

### HIGH

**PF-005: HookEntry/HookMatcher/Settings interfaces duplicated 4x** - `src/cli/commands/memory.ts:8`, `src/cli/commands/learn.ts`, `src/cli/commands/ambient.ts`, `src/cli/commands/hud.ts`
**Confidence**: 95%
- Problem: Known pitfall PF-005 documents that `HookMatcher` and `Settings` types are duplicated across 4 command files. This PR added a new hook type (UserPromptSubmit) to `memory.ts`, which relied on the `HookMatcher` interface imported from `src/cli/utils/hooks.ts`. The import path shows the shared module now exists (`import type { HookMatcher, Settings } from '../utils/hooks.js'`), which indicates PF-005 has been partially resolved — `memory.ts` uses the shared module. Verify all 4 files import from the shared module rather than local definitions.

### MEDIUM

**PF-002: Init command monolith** - `src/cli/commands/init.ts`
**Confidence**: 90%
- Problem: Known pitfall PF-002 documents the init command as a monolith. This PR added 3 lines to it (queue cleanup in the else branch). The monolith pattern persists but this PR does not worsen it meaningfully.

## Suggestions (Lower Confidence)

- **Shared hook lifecycle abstraction** - `src/cli/commands/memory.ts`, `src/cli/commands/learn.ts` (Confidence: 65%) -- The `addMemoryHooks`/`removeMemoryHooks` pattern (iterate config map, match by marker substring, add/remove/count) is structurally identical to the learning hook management. A generic `HookManager` class parameterized by a config map could eliminate this structural duplication.

- **Queue file ownership ambiguity** - `scripts/hooks/prompt-capture-memory`, `scripts/hooks/stop-update-memory` (Confidence: 70%) -- Two separate hooks (`prompt-capture-memory` and `stop-update-memory`) both append to `.pending-turns.jsonl`. The queue file has no single owner — it is written by two producers and consumed by one consumer. The `>>` append operations are atomic on POSIX for lines under PIPE_BUF, but the design would benefit from a comment documenting this concurrency assumption.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 1 | 1 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The architectural decomposition is well-executed. Extracting prompt capture from the preamble hook into a dedicated `prompt-capture-memory` hook is the correct SRP application — the preamble is now zero-file-I/O (classification only) and the memory capture is a distinct concern with its own lifecycle (registered/removed with memory hooks). The single-pass jq/node extraction in `background-memory-update` properly addresses the per-line subprocess spawning issue (PF-006 pattern). The two MEDIUM blocking issues (DRY violations in cleanup logic and `get_mtime` duplication) are straightforward to resolve and would strengthen the maintainability of this otherwise clean decomposition.
