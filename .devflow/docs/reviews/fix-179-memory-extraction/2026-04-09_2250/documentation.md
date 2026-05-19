# Documentation Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

### HIGH

**`get-mtime` helper missing JSDoc-style description of return value** - `scripts/hooks/get-mtime:3`
**Confidence**: 82%
- Problem: The usage comment says `mtime=$(get_mtime "/path/to/file")` but does not document what the return value is (Unix epoch seconds). A developer unfamiliar with `stat` output would need to read the function body to understand the units.
- Fix: Add a return-value description to the header comment:
```bash
# Portable file mtime extraction (BSD/GNU stat compatible)
# Usage: source "$SCRIPT_DIR/get-mtime"  then  mtime=$(get_mtime "/path/to/file")
# Returns: Unix epoch seconds (integer) of the file's last modification time.
#          Empty string if file does not exist.
```

### MEDIUM

**New `--clear` subcommand undocumented in CLI help description** - `src/cli/commands/memory.ts:157`
**Confidence**: 85%
- Problem: The `memoryCommand` `.description()` text says "Enable or disable working memory (session context preservation)" but the command now also supports `--clear` for queue cleanup. The description does not reflect this capability.
- Fix: Update the description to mention the new subcommand:
```typescript
.description('Enable, disable, or clean up working memory (session context preservation)')
```

**`filterProjectsWithMemory` and `hasMemoryDir` missing JSDoc** - `src/cli/commands/memory.ts:146-153`
**Confidence**: 80%
- Problem: Two new utility functions (`hasMemoryDir`, `filterProjectsWithMemory`) were added without JSDoc comments. All other exported and significant functions in this file have JSDoc (`addMemoryHooks`, `removeMemoryHooks`, `hasMemoryHooks`, `countMemoryHooks`). This creates an inconsistency in the module.
- Fix: Add JSDoc to both functions:
```typescript
/** Check whether a project root contains a .memory/ directory. */
async function hasMemoryDir(root: string): Promise<boolean> {

/** Filter a list of git roots to only those containing a .memory/ directory. */
async function filterProjectsWithMemory(gitRoots: string[]): Promise<string[]> {
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`stop-update-memory` File column in hook table now says `.pending-turns.jsonl` but the hook also writes to WORKING-MEMORY.md indirectly** - `docs/reference/file-organization.md` (hooks table)
**Confidence**: 80%
- Problem: The file-organization table was updated to change `stop-update-memory`'s File column from `.memory/WORKING-MEMORY.md` to `.memory/.pending-turns.jsonl`. This is more accurate for the stop hook itself (it now only appends to the queue), but might confuse readers who previously relied on the table to understand the full data flow. The new `background-memory-update` row handles the gap, but the conceptual shift is subtle.
- Fix: No code change required. The documentation is technically correct after the update since the stop hook now only writes to the queue, and the new `background-memory-update` row documents who actually writes WORKING-MEMORY.md. This is informational only.

## Pre-existing Issues (Not Blocking)

_None at CRITICAL severity._

## Suggestions (Lower Confidence)

- **Preamble and prompt-capture-memory share identical JSON-extraction block** - `scripts/hooks/preamble:16-24`, `scripts/hooks/prompt-capture-memory:18-26` (Confidence: 65%) -- The duplicated jq/node fallback for extracting `cwd` and `prompt` fields could benefit from a shared helper (similar to how `get-mtime` was extracted), but this is a code concern rather than a documentation concern.

- **CLAUDE.md hooks list getting long and hard to scan** - `CLAUDE.md` Project Structure section (Confidence: 62%) -- The inline parenthetical listing of hook names in the Project Structure tree is growing (now 11 items). At this size it may be more readable as a reference to the file-organization doc rather than an inline list, but this is a stylistic preference.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Documentation Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The documentation changes are well-aligned with the code changes. CLAUDE.md, file-organization.md, and the hook table were all updated to reflect the new `background-memory-update` script, `get-mtime` helper, and the `--clear` / `--disable` behavior separation. The conditions are minor: add return-value docs to the new shell helper, update the CLI description string, and add JSDoc to the two new utility functions for consistency with existing conventions.
