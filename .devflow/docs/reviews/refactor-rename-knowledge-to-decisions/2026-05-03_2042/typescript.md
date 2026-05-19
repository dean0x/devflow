# TypeScript Review Report

**Branch**: refactor/rename-knowledge-to-decisions -> main
**Date**: 2026-05-03

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Stale comment referencing "knowledge" instead of "decisions"** - `src/cli/commands/learn.ts:936`
**Confidence**: 90%
- Problem: The comment reads `// partial progress (and log/knowledge stay consistent).` but the surrounding code and all other comments in this PR have been updated to say "decisions" instead of "knowledge". This stale comment creates an inconsistency with the rename refactor's intent.
- Fix:
```typescript
// partial progress (and log/decisions stay consistent).
```

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### LOW

**`withKnowledgeFiles`, `KnowledgeFilePair`, and `PurgeLegacyKnowledgeResult` retain old naming** - `src/cli/utils/legacy-knowledge-purge.ts:37,43,111`
**Confidence**: 82%
- Problem: The private function `withKnowledgeFiles`, internal type `KnowledgeFilePair`, and exported interface `PurgeLegacyKnowledgeResult` still use "knowledge" in their names. These are not user-facing strings, but they create naming drift within the codebase now that the concept has been renamed to "decisions".
- Note: This is a reasonable scope boundary decision -- these are legacy-purge-specific types operating on historical "knowledge" entries. Renaming would break the existing API contract (exported `PurgeLegacyKnowledgeResult` consumed by `migrations.ts` and tests). A separate follow-up is appropriate if desired.

## Suggestions (Lower Confidence)

- **`notification-key-prefix` still uses `knowledge-capacity-`** - `src/cli/commands/learn.ts:1184-1185`, `src/cli/hud/notifications.ts:57-58` (Confidence: 65%) -- The notification keys `knowledge-capacity-decisions` and `knowledge-capacity-pitfalls` are stored in `.notifications.json` on disk and read by both `json-helper.cjs` and the TS code. Renaming these would be a schema migration affecting persisted state files. The current approach (consistent old prefix on both read and write sides) is defensible, but a future pass could migrate them to `decisions-capacity-*` for full naming coherence.

- **Migration does not acquire `.decisions.lock` during manifest/log path rewriting** - `src/cli/utils/migrations.ts:191-209` (Confidence: 70%) -- The migration reads and rewrites both `.learning-manifest.json` and `learning-log.jsonl` without holding the decisions lock (`.decisions.lock`). If `background-learning` is concurrently running, it could write to these same files during the migration's read-rewrite window. In practice this is unlikely since migrations run during `devflow init` (user-triggered, not during active sessions), but the other migration helpers (`withKnowledgeFiles`) take a lock as standard practice.

- **Duplicated directory-existence check pattern** - `src/cli/utils/migrations.ts:147-160,162-167` (Confidence: 62%) -- The `oldDirExists` and `newDirExists` checks are each performed via try/catch around `fs.stat()` in separate blocks. The `newDirExists` check appears twice with identical logic (once on the early-exit path, once inside the `if (oldDirExists)` block). A helper like `async function exists(p: string): Promise<boolean>` would reduce the repetition, though this is a style concern in a one-shot migration function.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 1 |

**TypeScript Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The rename refactor is thorough and mechanically consistent across 33 TypeScript files. All function renames (`loadKnowledgeContext` -> `loadDecisionsContext`, `updateKnowledgeStatus` -> `updateDecisionsStatus`), import path updates, variable renames, comment updates, and test migrations are correctly applied. The new `rename-knowledge-to-decisions` migration is well-structured with proper idempotency, partial-state handling, and comprehensive test coverage (10 test cases covering fresh projects, directory renames, lock renames, manifest rewrites, log rewrites, idempotency, partial state, empty manifest, and mixed paths). No `any` types were introduced. No type safety regressions detected. The single blocking issue is a trivial stale comment.
