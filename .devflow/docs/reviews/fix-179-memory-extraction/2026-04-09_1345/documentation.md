# Documentation Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

### HIGH

**`stop-update-memory` File column is misleading in hook table** - `docs/reference/file-organization.md:164`
**Confidence**: 85%
- Problem: The hook table lists `.memory/WORKING-MEMORY.md` as the File for `stop-update-memory`, but this hook no longer writes to WORKING-MEMORY.md directly. It appends to `.memory/.pending-turns.jsonl` and spawns a background updater. The Purpose column is accurate ("Captures assistant turns to queue. Throttled...Spawns background updater.") but the File column contradicts it.
- Fix: Change the File column to `.memory/.pending-turns.jsonl` to match the actual write target:
  ```markdown
  | `stop-update-memory` | Stop | `.memory/.pending-turns.jsonl` | Captures assistant turns to queue. Throttled (skips if <2min fresh). Spawns background updater. |
  ```

### MEDIUM

**`background-memory-update` omitted from file-organization.md hook listing** - `docs/reference/file-organization.md:45-55`
**Confidence**: 85%
- Problem: The directory tree in `docs/reference/file-organization.md` lists 9 hook entries but omits `background-memory-update`, which is a key part of the working memory pipeline (the background updater spawned by `stop-update-memory`). The new `prompt-capture-memory` was correctly added, but `background-memory-update` was not. Several other helper scripts (`ensure-memory-gitignore`, `log-paths`, `run-hook`, `session-start-classification`) are also absent, but those were pre-existing omissions.
- Fix: Add `background-memory-update` to the directory tree:
  ```
  │       ├── background-memory-update  # Background: queue-based WORKING-MEMORY.md updater
  ```

**`background-memory-update` omitted from CLAUDE.md hook listing** - `CLAUDE.md:60`
**Confidence**: 82%
- Problem: The parenthetical hooks listing in the Project Structure tree was updated to add `prompt-capture-memory` but still omits `background-memory-update`. This hook is central to the queue-based architecture described in the Working Memory paragraph above it.
- Fix: Add `background-memory-update` to the parenthetical list:
  ```
  │   └── hooks/              # Working Memory + ambient + learning hooks (prompt-capture-memory, stop-update-memory, background-memory-update, session-start-memory, session-start-classification, pre-compact-memory, preamble, session-end-learning, stop-update-learning [deprecated], background-learning)
  ```

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Shell script inline comments explain "what" not "why"** - `scripts/hooks/background-memory-update`, `scripts/hooks/stop-update-memory`
**Confidence**: 80%
- Problem: Multiple inline comments in both scripts describe what the code does rather than why. Examples: `# Portable mtime (GNU stat uses -c, BSD stat uses -f)` and `# Queue overflow safety: if >200 lines, keep last 100`. The cross-reference comment `# NOTE: same 200/100 threshold in background-memory-update` is a good pattern, but the primary comments could explain the rationale (e.g., why 200/100, why portability matters).
- Impact: New contributors may change thresholds without understanding the design rationale.

## Suggestions (Lower Confidence)

- **Hook table could document `session-start-classification`** - `docs/reference/file-organization.md:161-166` (Confidence: 65%) -- The Working Memory Hooks table documents 4 memory hooks and mentions the learning hook, but `session-start-classification` (ambient) is only in the directory tree, not in any hook table. A separate "Ambient Hooks" table would complete the picture.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Documentation Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The documentation updates are thorough and well-executed overall. CLAUDE.md, file-organization.md, memory.ts JSDoc comments, and test descriptions were all updated to reflect the 3-hook to 4-hook transition. The new `prompt-capture-memory` hook has clear header comments explaining its purpose and lifecycle. The main gaps are: (1) the File column for `stop-update-memory` in the hook table still says `.memory/WORKING-MEMORY.md` when the hook now writes to `.pending-turns.jsonl`, and (2) `background-memory-update` is missing from both directory tree listings despite being central to the new queue-based architecture.
