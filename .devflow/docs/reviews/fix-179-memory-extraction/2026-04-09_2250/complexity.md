# Complexity Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Duplicated JSON field extraction blocks across two hooks (2 occurrences)** - `scripts/hooks/preamble:16-24`, `scripts/hooks/prompt-capture-memory:18-26`
**Confidence**: 88%
- Problem: Identical 9-line jq/node branching block for extracting `cwd` and `prompt` fields from JSON input is copy-pasted across both UserPromptSubmit hooks. The previous pattern used a shared `json_field` helper for single-field extraction; the new batched approach loses that reuse. Any future change to the extraction pattern (e.g., adding a third field, changing the node fallback) must be applied in both places.
- Fix: Extract a shared helper function (e.g., `extract-input-fields`) sourced from `$SCRIPT_DIR`, similar to how `get-mtime` was extracted in this same PR. Both hooks would become a single `source "$SCRIPT_DIR/extract-input-fields"` call that sets `CWD` and `PROMPT` variables.

**`--clear` handler nests 4 levels of conditionals** - `src/cli/commands/memory.ts:177-228`
**Confidence**: 82%
- Problem: The `--clear` handler within the `.action()` callback introduces a 52-line block with 4 levels of nesting: `if (options.clear)` > `if (allProjects.length === 0)` > `p.select` > `for...of` with nested `if`. The function body of `.action()` now spans 120 lines across 4 code paths (no-flag, clear, status, enable/disable). While each path is individually readable, the growing action handler makes it harder to understand the full control flow at a glance.
- Fix: Extract the `--clear` block into a standalone `async function handleClear()` function, matching the pattern of `hasMemoryDir` and `filterProjectsWithMemory` that were already extracted as helpers. This would reduce the action handler to a dispatcher:
```typescript
if (options.clear) { await handleClear(); return; }
```

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**init.ts action handler remains a monolith** - `src/cli/commands/init.ts`
**Confidence**: 95%
- Problem: Already tracked as PF-002 in `.memory/knowledge/pitfalls.md`. The action handler is ~877 lines. This PR's removal of the queue cleanup block (5 lines, lines 1313-1317) is a small reduction, but the monolith remains. The `--clear` extraction in `memory.ts` is the right pattern -- but `init.ts` still concentrates all installation logic in one handler.
- Fix: Deferred per PF-002 -- extract into `collectInitChoices()`, `executeInstallation()`, `printSummary()` in a dedicated refactoring PR.

## Suggestions (Lower Confidence)

- **`allProjects.length > 0` check is always true** - `src/cli/commands/memory.ts:200` (Confidence: 72%) -- The spread `...(allProjects.length > 0 ? [...] : [])` in the select options is redundant since the function returns early on line 191 if `allProjects.length === 0`. The guard can be removed, simplifying the options array.

- **Magic numbers 200/100 for queue overflow** - `scripts/hooks/stop-update-memory:88`, `scripts/hooks/background-memory-update:109` (Confidence: 65%) -- The 200/100 overflow thresholds are duplicated across two scripts with only a code comment linking them. Consider defining them as variables in a shared sourced file, or at minimum using named constants at the top of each script.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Complexity Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR reduces complexity in several places (extracting `get-mtime` helper, removing inline queue cleanup from `init.ts` and `memory --disable`, accepting parsed `Settings` objects to avoid re-parsing). The two MEDIUM blocking issues are maintainability concerns (duplicated extraction blocks, growing action handler nesting) rather than correctness risks. The `--clear` feature is well-structured with clear early returns and good separation of concerns in the helper functions. Test coverage is solid with targeted additions for the new behavior.
