# Regression Review Report

**Branch**: chore/init-flow-improvements -> main
**Date**: 2026-03-22
**PR**: #157

## Issues in Your Changes (BLOCKING)

### CRITICAL

No critical issues found.

### HIGH

No high issues found.

### MEDIUM

No medium issues found.

## Issues in Code You Touched (Should Fix)

No issues found.

## Pre-existing Issues (Not Blocking)

No regression-relevant pre-existing issues found.

## Suggestions (Lower Confidence)

- **`gitignore` and `docs` extras no longer opt-out for local scope** - `src/cli/commands/init.ts:757-762` (Confidence: 65%) -- The old code allowed TTY users to deselect `gitignore` and `docs` via the extras multiselect. The new code always runs `updateGitignore` and `createDocsStructure` for local scope. Both operations are idempotent and low-risk, but this is a deliberate behavior change worth noting for users who intentionally skipped these.

- **`discoverProjectGitRoots` reads undocumented `history.jsonl` format** - `src/cli/utils/post-install.ts:430` (Confidence: 60%) -- The function parses `~/.claude/history.jsonl` and assumes entries have a `project` string field. If Claude CLI changes this file format, project discovery silently returns empty. The function handles this gracefully (returns `[]`), but the dependency on an undocumented file format is worth tracking.

## Detailed Regression Analysis

### Removed Exports

| Export | File | Status |
|--------|------|--------|
| `buildExtrasOptions` | `init.ts` | Removed -- function and type `ExtraId` deleted |
| `isAlreadyInstalled` (import) | `init.ts` | Removed from import, but never re-exported -- still exported from `safe-delete-install.ts` |
| `removeAmbientHook`, `hasAmbientHook` (imports) | `init.ts` | Removed from import, but still re-exported on line 34 |
| `hasMemoryHooks` (import) | `init.ts` | Removed from import, but still re-exported on line 35 |
| `hasHudStatusLine` (import) | `init.ts` | Removed from import, but still re-exported on line 36 |

**`buildExtrasOptions` and `ExtraId`**: These were exported from `init.ts` and consumed by `tests/init-logic.test.ts`. The tests have been properly removed alongside the function. No other consumers exist in the codebase (verified via grep). No regression.

**Re-exports preserved**: The `init.ts` re-export lines for `ambient.js`, `memory.js`, and `hud.js` remain unchanged -- all six functions (`add*`, `remove*`, `has*`) are still re-exported even though only the `add*` variants are imported for local use. This is correct; the re-exports exist for external consumers.

### Changed Signatures

| Function | Change | Backward Compatible |
|----------|--------|---------------------|
| `installClaudeignore` | Return type `Promise<void>` -> `Promise<boolean>` | Yes -- callers that ignore the return value are unaffected |

### New Export

| Export | File | Purpose |
|--------|------|---------|
| `discoverProjectGitRoots` | `post-install.ts` (re-exported via `init.ts`) | Reads Claude history to find git project roots |

### Behavior Changes

| Area | Old Behavior | New Behavior | Risk |
|------|-------------|--------------|------|
| Extras multiselect | Users chose from settings, claudeignore, gitignore, docs, safe-delete | Individual prompts with explanatory notes for each feature | Low -- all features still available, just prompted individually |
| Settings install | Gated by extras selection | Always runs | None -- was always pre-selected anyway |
| `.claudeignore` (user scope) | Installed in current project only | Discovers all projects via history.jsonl and batch-installs | Low -- user is prompted with project list |
| `gitignore`/`docs` (local scope) | Opt-out via extras multiselect | Always applied | Low -- idempotent operations |
| Safe-delete | Prompt appeared after install spinner | Prompt appears before install begins (prompt-then-execute pattern) | None -- same functionality, better UX |
| Managed settings sudo | Prompted inside extras handler | Two-phase: confirm intent during prompts, execute during install | None -- same outcome, clearer user flow |
| Agent Teams hint | "No (Recommended)" / "Yes" | "Not yet" / "Yes" with explanatory note | None -- cosmetic |
| Plugin hints | Full `pl.description` in multiselect | Shorter hints from `pluginHints` map | None -- cosmetic |
| `--hud` flag | Missing (only `--no-hud` existed) | Added for explicit enable | None -- backward compatible |

### Test Coverage

| Change | Tests |
|--------|-------|
| `buildExtrasOptions` removed | 5 tests removed -- appropriate |
| `ambient hook re-exports` removed | 3 tests removed -- still re-exported, but re-export verification was redundant |
| `memory hook re-exports` removed | 3 tests removed -- still re-exported, but re-export verification was redundant |
| `discoverProjectGitRoots` added | 7 new tests covering: sorted output, non-git skip, non-existent skip, missing file, empty file, malformed JSON, deduplication |
| `installClaudeignore` return value | 2 new tests covering: new creation returns true, existing returns false |

All 49 tests pass.

### Pitfalls Check

**PF-001** (Synthesizer glob): Not relevant to this change set -- no modifications to synthesizer or review command files.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED

### Rationale

This is a well-executed UX refactoring of the init flow. The key structural change replaces a single "extras" multiselect with individual feature prompts, each preceded by an explanatory `p.note()`. The prompt-then-execute pattern (collecting all choices before starting installation) is a clear improvement.

From a regression perspective:
- No public exports were removed without proper consumer cleanup
- The one signature change (`installClaudeignore` return type) is backward-compatible
- Non-TTY behavior is preserved (all features default to enabled)
- All re-exports remain intact for external consumers
- New functionality (`discoverProjectGitRoots`) is well-tested with 7 test cases covering edge cases
- The removed test cases covered deleted code (`buildExtrasOptions`) and redundant re-export verification
