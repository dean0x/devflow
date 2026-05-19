# TypeScript Review Report

**Branch**: refactor-rename-kb-to-knowledge -> main
**Date**: 2026-05-04

## Issues in Your Changes (BLOCKING)

### HIGH

**Old hook marker not removed during upgrade -- orphaned `session-end-kb-refresh` entry in settings.json** - `src/cli/commands/knowledge/toggle.ts:10`
**Confidence**: 95%
- Problem: `KNOWLEDGE_HOOK_MARKER` is set to `'session-end-knowledge-refresh'`, which means `removeKnowledgeHook()` only removes entries matching the NEW marker. Users upgrading from a previous version will have `session-end-kb-refresh` in their `settings.json`. The init.ts upgrade path (line 954: `removeKnowledgeHook(content)`) will NOT remove the old entry. The result is two hooks in SessionEnd: the old one pointing to a non-existent script (`session-end-kb-refresh` was renamed to `session-end-knowledge-refresh`) and the newly added one. The old entry will cause a shell error on every session end because the script no longer exists on disk (`scripts/hooks/session-end-kb-refresh` was deleted in this PR).
- Impact: Every session end triggers a failed hook invocation for all users who upgrade from a previous version. Depending on Claude Code's error handling for failed hooks, this could surface as a user-visible error or silently fail.
- Fix: The `removeKnowledgeHook` function (or the init upgrade path) must also strip entries matching the OLD marker `session-end-kb-refresh`. The cleanest approach is to make `removeKnowledgeHook` match both markers:

```typescript
// toggle.ts
const KNOWLEDGE_HOOK_MARKER = 'session-end-knowledge-refresh';
const LEGACY_KB_HOOK_MARKER = 'session-end-kb-refresh';

export function removeKnowledgeHook(settingsJson: string): string {
  const settings: Settings = JSON.parse(settingsJson);
  let changed = false;

  const matchers = settings.hooks?.SessionEnd;
  if (matchers) {
    const filtered = matchers.filter(
      (m) => !m.hooks.some((h) =>
        h.command.includes(KNOWLEDGE_HOOK_MARKER) ||
        h.command.includes(LEGACY_KB_HOOK_MARKER)
      ),
    );
    // ... rest unchanged
  }
  // ...
}
```

Alternatively, add the old hook removal to the `MIGRATION_RENAME_KB_TO_KNOWLEDGE` migration, but this requires the migration to have access to `~/.claude/settings.json` (which per-project migrations currently don't handle). The toggle.ts approach is simpler and more robust since it runs on every init.

The `hasKnowledgeHook` function should similarly check both markers to avoid `addKnowledgeHook` incorrectly determining the hook is absent when only the old marker is present (which would lead to a duplicate entry).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Redundant type assertion on already-narrowed `features`** - `src/cli/utils/manifest.ts:50`
**Confidence**: 82%
- Problem: Line 50 casts `(features as Record<string, unknown>).kb`, but `features` is already typed as `Record<string, unknown>` (line 33) and narrowed through the guard at lines 38-46. The `as Record<string, unknown>` assertion is redundant.
- Impact: No runtime effect; minor readability issue. The cast suggests the developer was unsure about the type, which could confuse future readers.
- Fix: Remove the redundant cast:
```typescript
const legacyKb = features.kb;
```

**Non-null assertion on lazy-loaded module** - `src/cli/commands/knowledge/shared.ts:35`
**Confidence**: 80%
- Problem: `return _featureKnowledge!;` uses a non-null assertion. While this is safe at runtime (the `if (!_featureKnowledge)` guard ensures assignment before the return), `_require` returns `any`, so the assignment may resolve to `undefined` if the CJS module fails to export the expected shape. The `!` silences TS without guaranteeing the module loaded correctly.
- Impact: If `feature-knowledge.cjs` is corrupted or missing exports, the assertion masks the undefined and defers the error to the call site (harder to debug).
- Fix: This is a pre-existing pattern (was `_featureKb!` before the rename). A proper fix would validate the require result, but that's out of scope for a rename PR. Flagging for awareness.

## Pre-existing Issues (Not Blocking)

No critical pre-existing issues found in the reviewed TypeScript files.

## Suggestions (Lower Confidence)

- **`warnings` array never populated in migration** - `src/cli/utils/migrations.ts:141` (Confidence: 65%) -- The `warnings` array is declared but never used in `MIGRATION_RENAME_KB_TO_KNOWLEDGE`. While this satisfies the `MigrationRunResult` interface correctly, the `fs.access` + `fs.rename` pattern could produce permission errors that are silently swallowed; consider pushing permission-denied errors to `warnings` instead of ignoring them.

- **`kb.ts` compat shim may outlive its usefulness** - `src/cli/commands/kb.ts` (Confidence: 60%) -- The deprecated re-export shim `kb.ts` preserves the old import path for callers that reference `commands/kb.js`. Since `init.ts` and `uninstall.ts` in this PR already import from `./knowledge/index.js`, and tests import from the new paths, no production code appears to still use the shim. It could be removed in a follow-up to reduce dead code, unless external callers depend on it.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 0 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The rename is thorough and well-executed across ~71 files. Type renames (`KbIndex` -> `KnowledgeIndex`, `KbEntry` -> `KnowledgeEntry`, `FeatureKbModule` -> `FeatureKnowledgeModule`) are complete with no orphan references. The backward-compat code in `manifest.ts` correctly falls back from `features.knowledge` to the legacy `features.kb` field with proper `typeof` narrowing. No `as any` casts were introduced. The one blocking issue is the missing cleanup of the old hook marker `session-end-kb-refresh` during upgrades, which would leave an orphaned entry pointing to a deleted script.
