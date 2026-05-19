# Architecture Review Report

**Branch**: refactor/rename-knowledge-to-decisions -> main
**Date**: 2026-05-03

## Issues in Your Changes (BLOCKING)

### HIGH

**Migration ordering allows pre-v2 entries to survive the rename** - `src/cli/utils/migrations.ts:231-236`
**Confidence**: 82%
- Problem: The `MIGRATIONS` array runs `purge-legacy-knowledge-v2` and `purge-legacy-knowledge-v3` before `rename-knowledge-to-decisions`. Both purge functions now reference `.memory/decisions/` (updated in `legacy-knowledge-purge.ts:116`), but on a first-time upgrade from a pre-v2 install where `.memory/knowledge/` exists but `.memory/decisions/` does not, the purge runs first against the non-existent `decisions/` directory, no-ops, gets marked as applied, and then the rename moves `.memory/knowledge/` to `.memory/decisions/` — preserving any pre-v2 seeded entries inside.
- Impact: Users who skip intermediate versions and upgrade directly to this release retain stale seeded entries that were supposed to be purged. This is a narrow edge case (requires skipping all prior versions), but it violates the documented migration semantics where purge-v3 should sweep all pre-v2 entries.
- Fix: The rename migration should either (a) run the purge logic internally after the rename completes, or (b) be placed before the purge migrations in the array (though this conflicts with the append-only convention). The cleanest approach is to add a post-rename purge step inside `MIGRATION_RENAME_KNOWLEDGE_TO_DECISIONS.run()`:
```typescript
// After the rename, re-run purge logic against the new path
// (handles the skip-version edge case)
const { purgeAllPreV2KnowledgeEntries } = await import('./legacy-knowledge-purge.js');
const purgeResult = await purgeAllPreV2KnowledgeEntries({ memoryDir });
if (purgeResult.removed > 0) {
  infos.push(`Post-rename: purged ${purgeResult.removed} legacy entry(ies)`);
}
```

### MEDIUM

**Notification key `knowledge-capacity-*` not renamed** - `scripts/hooks/json-helper.cjs:1290,1782`, `src/cli/hud/notifications.ts:57-58`, `src/cli/commands/learn.ts:1184-1185,1252`
**Confidence**: 85%
- Problem: The notification keys `knowledge-capacity-decisions` and `knowledge-capacity-pitfalls` are stored in `.notifications.json` on disk and used as lookup keys across three files. They were not renamed to `decisions-capacity-*` in this PR. This creates a naming inconsistency where external-facing concepts say "decisions" but internal notification keys still say "knowledge-capacity".
- Impact: Functional correctness is unaffected (the strings are opaque keys), but this is a leaky abstraction that could confuse future contributors. The `notifications.ts:58` line `worst.key.replace('knowledge-capacity-', '')` would need updating if the key ever changes, and the current code self-documents incorrectly as using "knowledge" nomenclature.
- Fix: Add notification key migration to the rename migration (read `.notifications.json`, replace `knowledge-capacity-` keys with `decisions-capacity-`, write back). Update the 3 source files. This is a low-risk change but should be done for consistency. Alternatively, document this as an intentional "frozen key" in a code comment.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Internal type names in `legacy-knowledge-purge.ts` not renamed** - `src/cli/utils/legacy-knowledge-purge.ts:37,43,111`
**Confidence**: 80%
- Problem: The types `PurgeLegacyKnowledgeResult`, `KnowledgeFilePair`, and function `withKnowledgeFiles` retain "Knowledge" in their names despite operating on `.memory/decisions/`. The exported `purgeLegacyKnowledgeEntries` and `purgeAllPreV2KnowledgeEntries` function names also retain "Knowledge".
- Impact: Minor naming inconsistency. The file name (`legacy-knowledge-purge.ts`) establishes context, but new callers might be confused by the mismatch between function names (referencing "knowledge") and the paths they operate on (`.memory/decisions/`).
- Fix: This is a judgment call. The file is specifically about purging *legacy knowledge-era* entries, so the naming could be seen as historically accurate. If renaming, update the exported names and all callers (migrations.ts imports). Consider renaming the file too (`legacy-decisions-purge.ts`). However, this is purely cosmetic and can be deferred.

**Incomplete `knowledge-capacity-` rename in `learn.ts` dismiss handler** - `src/cli/commands/learn.ts:1252`
**Confidence**: 83%
- Problem: The `--dismiss-capacity` handler at line 1252 still uses `key.replace('knowledge-capacity-', '')` to extract the file type from the notification key. If the notification key is eventually renamed to `decisions-capacity-*`, this string extraction breaks silently (the replace would return the full key unchanged).
- Impact: Fragile coupling to the notification key format. Currently functional but creates a maintenance trap.
- Fix: Either rename the notification keys (see BLOCKING issue above) or add a code comment documenting that `knowledge-capacity-` is a frozen key format that must not change without updating this extraction logic.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Lock file rename race in migration** - `src/cli/utils/migrations.ts:182-189` (Confidence: 65%) -- The lock rename loop does not check if the new name already exists before calling `fs.rename()`. If both `.knowledge.lock` and `.decisions.lock` exist simultaneously (e.g., from a partial prior migration), `fs.rename()` will overwrite the destination on POSIX, potentially losing a legitimately held lock. Unlikely in practice since lock dirs are transient.

- **Regex-based path rewriting in manifest/log** - `src/cli/utils/migrations.ts:194,204` (Confidence: 62%) -- Using `.replace(/\.memory\/knowledge\//g, '.memory/decisions/')` on the manifest and log performs blind string replacement. If any observation's `details` or `evidence` field happens to contain `.memory/knowledge/` as a reference string, it would be incorrectly rewritten. A more targeted approach would parse JSONL line-by-line and only update `artifact_path` and `path` fields.

- **Both old and new dirs exist => orphaned content** - `src/cli/utils/migrations.ts:172-174` (Confidence: 68%) -- When both `.memory/knowledge/` and `.memory/decisions/` exist, the migration warns and skips the rename, but the old directory's content is silently orphaned. No merge or cleanup is attempted. This could leave stale `.memory/knowledge/` directories on disk indefinitely.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The rename is comprehensive and well-executed across 84 files. The migration is well-tested with 9 test cases covering core scenarios and edge cases. The primary architectural concern is the migration ordering issue where purge migrations now reference the new path but execute before the directory rename, creating a narrow edge case where pre-v2 entries can survive. The notification key inconsistency is a secondary concern -- functionally harmless but architecturally impure. Overall, the refactoring maintains separation of concerns and follows the established migration registry pattern correctly.
