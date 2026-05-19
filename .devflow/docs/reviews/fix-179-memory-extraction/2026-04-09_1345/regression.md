# Regression Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09
**Commits reviewed**: 33973c6...HEAD (8 commits: 926cde6, 4ce11fd, ada6344, 0e984f4, 4c81701, 911c1e1, 5cb3441, a50aea0)

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**`addMemoryHooks` always re-serializes JSON even when no hooks were added (partial state)** - `src/cli/commands/memory.ts:27-61`
**Confidence**: 82%
- Problem: The `changed` flag was removed from `addMemoryHooks`. Previously, when all hooks were already present except in partial states (e.g., 3 of 4 hooks present), the function would track whether it actually added anything and return `settingsJson` unchanged if not. Now, the early return on line 27 only covers the "all 4 present" case. If all hooks happen to be present but `hasMemoryHooks()` returns false due to a count mismatch (impossible in current code but fragile), the function would re-serialize the JSON unnecessarily, potentially reformatting user-edited settings.json whitespace. The `addMemoryHooks` idempotency test passes because `hasMemoryHooks` catches the "all present" case, but the design lost a defensive layer.
- Fix: The current behavior is functionally correct because the `hasMemoryHooks(settingsJson)` early return on line 27 covers full-presence. The loop's `alreadyPresent` check prevents duplicate entries. However, consider restoring the `changed` guard as defense-in-depth:
```typescript
let changed = false;
for (const [hookType, marker] of Object.entries(MEMORY_HOOK_CONFIG)) {
  // ...existing logic...
  if (!alreadyPresent) {
    // ...add hook...
    changed = true;
  }
}
if (!changed) return settingsJson;
return JSON.stringify(settings, null, 2) + '\n';
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Existing users on 3-hook installs will see "partial" status until re-init** - `src/cli/commands/memory.ts:177-186` (Confidence: 70%) -- Users who installed memory with the old 3-hook system (no UserPromptSubmit) will now see `partial (3/4 hooks)` from `devflow memory --status`. The `--enable` command correctly adds the missing hook, but there is no automatic migration path beyond re-running `devflow init` or `devflow memory --enable`. This is documented behavior and not a bug, but worth noting for release communication.

- **`prompt-capture-memory` sources `ensure-memory-gitignore` which auto-creates `.memory/`** - `scripts/hooks/prompt-capture-memory:21` (Confidence: 65%) -- The old preamble hook only captured prompts when `.memory/` already existed (`[ -d "$CWD/.memory" ]`). The new dedicated hook sources `ensure-memory-gitignore` which auto-creates the directory. This is an intentional improvement (confirmed by the test "creates it via ensure-memory-gitignore"), but changes the precondition behavior: the new hook is more aggressive about creating `.memory/` than the old code path. If a user has memory hooks registered but has manually deleted `.memory/`, the new hook will silently recreate it.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Regression Checklist

- [x] No exports removed without deprecation
- [x] Return types backward compatible
- [x] Default values unchanged (or documented)
- [x] Side effects preserved (events, logging) -- prompt capture moved from preamble to dedicated hook; same behavior, different file
- [x] All consumers of changed code updated -- memory.ts, init.ts, CLAUDE.md, docs, tests all updated from 3->4 hooks
- [x] Migration complete across codebase -- no stale "3 hook" references remain in src/
- [x] CLI options preserved or deprecated -- `--enable`/`--disable`/`--status` unchanged
- [x] API endpoints preserved or versioned -- N/A
- [x] Commit messages match implementation -- verified: extraction, hardening, test additions all match
- [ ] Breaking changes documented in CHANGELOG -- N/A (no CHANGELOG in this project)

### Key Observations

1. **Prompt capture extraction is clean**: The code removed from `preamble` (lines 502-518 of old file) is faithfully reproduced in `prompt-capture-memory` with identical truncation logic (2000 chars), identical JSONL format, and identical jq/node fallback paths. The `--` separator added to the `node -e` call in `prompt-capture-memory:37` is an improvement that prevents prompt content starting with `-` from being interpreted as a node flag.

2. **Preamble is now zero-I/O**: Verified that the preamble hook no longer writes to `.pending-turns.jsonl`. Tests explicitly confirm this ("preamble does NOT write to queue -- zero file I/O").

3. **4-hook system is well-tested**: New tests cover the upgrade path (3-hook to 4-hook), ambient preamble coexistence, toggle cycle idempotency, content-array handling, and queue overflow.

4. **PF-006 partially addressed**: The per-line subprocess spawning issue (PF-006) is addressed in `background-memory-update` with single-pass jq/node extraction. The while-read loop now processes pre-extracted TSV rather than spawning subprocesses per line.

5. **CWD validation added consistently**: All three hooks (`preamble`, `prompt-capture-memory`, `stop-update-memory`) and `background-memory-update` now validate that CWD exists as a directory before proceeding. This is a defensive improvement.

6. **All 121 tests pass**: 51 memory tests + 70 shell-hooks tests verified green.
