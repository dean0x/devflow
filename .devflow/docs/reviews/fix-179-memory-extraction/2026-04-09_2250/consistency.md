# Consistency Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent JSON field extraction pattern across hooks** - `scripts/hooks/preamble:16-23`, `scripts/hooks/prompt-capture-memory:18-25`
**Confidence**: 90%
- Problem: The `preamble` and `prompt-capture-memory` hooks were refactored to use inline jq/node JSON extraction with `printf '%s'` and `cut -f` for CWD/PROMPT fields. However, `stop-update-memory:23` and `stop-update-memory:37` still use the `json_field` helper from `json-parse` for the same operation (`echo "$INPUT" | json_field "cwd" ""`). Other hooks (`session-start-memory:16`, `pre-compact-memory:17`, `session-start-classification:15`, `session-end-learning:27`) also continue using `json_field`. This creates two competing JSON extraction patterns in the same hook ecosystem for the same operation (extracting a field from stdin JSON).
- Fix: Either refactor all hooks to use the batched jq extraction pattern (extracting multiple fields in a single invocation) or keep using `json_field` everywhere. If the motivation is reducing subprocess spawns (2 `json_field` calls to 1 jq invocation), consider adding a `json_fields` multi-field helper to `json-parse` that all hooks can share.

### MEDIUM

**`get_mtime` detection logic changed during extraction** - `scripts/hooks/get-mtime:7-10`
**Confidence**: 85%
- Problem: The original inline `get_mtime` in both `stop-update-memory` and `background-memory-update` used `stat --version` to detect GNU vs BSD stat. The new extracted version in `get-mtime` uses a try-BSD-first approach (`stat -f %m "$file" 2>/dev/null`). While the new approach works, it changed the detection strategy silently during what is framed as a pure extraction refactor. The old approach tested for GNU stat first (`stat --version`); the new approach tries BSD first. On Linux, this means every call now silently fails BSD stat before falling back to GNU stat. Not a bug, but an inconsistency between the commit message (which implies pure extraction) and the actual behavior change.
- Fix: No code change needed if the try-BSD-first approach is intentional (it is arguably cleaner). Consider a brief comment noting the detection order was revised, or update the commit message to acknowledge the logic change.

**`hasMemoryHooks`/`countMemoryHooks` signature widened but sibling hook functions not widened** - `src/cli/commands/memory.ts:112`, `src/cli/commands/memory.ts:120`
**Confidence**: 82%
- Problem: `hasMemoryHooks` and `countMemoryHooks` now accept `string | Settings`, avoiding a redundant `JSON.parse` in `addMemoryHooks`. However, `hasAmbientHook` (ambient.ts:138) and `hasLearningHook` (learn.ts:140) still only accept `string`. This creates an API inconsistency across the three hook-management modules. The same pattern of "already-parsed settings object available, but forced to re-serialize to call the check function" exists in ambient.ts and learn.ts.
- Fix: Either widen `hasAmbientHook` and `hasLearningHook` to also accept `string | Settings` for consistency, or revert `hasMemoryHooks`/`countMemoryHooks` to `string`-only and keep the pattern uniform. The former is preferable since it avoids unnecessary parse/serialize cycles in all three modules.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`--clear` interactive-only with no non-TTY fallback** - `src/cli/commands/memory.ts:196-206`
**Confidence**: 80%
- Problem: The new `--clear` option always presents an interactive `p.select()` prompt, even in non-TTY environments. The existing patterns in `init.ts` (lines 560, 720-722, 816-822) check `process.stdin.isTTY` before interactive prompts and either fall back to defaults or error out with guidance. The `--enable` and `--disable` paths in the same file work without a TTY. `--clear` without TTY will hang or error.
- Fix: Add a non-TTY path that either defaults to "all projects" or requires an explicit `--local`/`--all` flag, matching the pattern in init.ts. For example: `if (!process.stdin.isTTY) { targets = allProjects; }`.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`stop-update-memory` still uses `echo "$INPUT" | json_field` while `preamble`/`prompt-capture-memory` use `printf '%s'`** - `scripts/hooks/stop-update-memory:23,37`
**Confidence**: 85%
- Problem: The stop hook continues to use `echo "$INPUT" | json_field "cwd" ""` for field extraction, while the two hooks modified in this PR now use `printf '%s' "$INPUT"`. Using `echo` with arbitrary JSON content can cause issues with strings containing escape sequences (e.g., `-n`, `-e`, backslashes), while `printf '%s'` is safe. This pre-existing pattern exists in 6 other hooks as well.

## Suggestions (Lower Confidence)

- **Test coverage gap for new `--clear` command path** - `tests/memory.test.ts` (Confidence: 70%) -- The old queue cleanup tests were removed (they tested the inline unlink logic from `--disable`), and no new tests were added for the `--clear` interactive flow. The new `countMemoryHooks` parsed-Settings tests are good, but the core new feature (`--clear`) has no test coverage.

- **Removed knowledge file format tests not replaced** - `tests/memory.test.ts` (Confidence: 65%) -- Eight tests covering knowledge file TL;DR parsing, ADR numbering, pitfall deduplication, and graceful degradation were removed. These tested real behaviors (file format parsing, regex extraction). If they were moved to another file, that is fine; if they were simply deleted, the coverage regression is notable.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Consistency Score**: 6/10
**Recommendation**: CHANGES_REQUESTED
