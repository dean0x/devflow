# Architecture Review Report

**Branch**: refactor-rename-kb-to-knowledge -> main
**Date**: 2026-05-04

## Issues in Your Changes (BLOCKING)

### HIGH

**Old hook marker not cleaned during upgrade** - `src/cli/commands/knowledge/toggle.ts:9`
**Confidence**: 92%
- Problem: `removeKnowledgeHook` only matches the new marker `session-end-knowledge-refresh`. During `devflow init` upgrade on existing installations, the remove-then-add pattern (init.ts:954) calls `removeKnowledgeHook` to strip the old hook before re-adding. However, existing installations have `session-end-kb-refresh` in their settings.json. The remove function will not find or remove it, leaving the old (now broken) hook entry alongside the new one. When Claude Code fires the stale SessionEnd entry, `run-hook session-end-kb-refresh` will fail because that script no longer exists at `~/.devflow/scripts/hooks/`.
- Fix: Follow the established pattern from `ambient.ts` which defines a `LEGACY_HOOK_MARKER` constant and handles both old and new markers in its filter predicate. Add legacy marker handling to `removeKnowledgeHook`:
```typescript
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

Similarly update `hasKnowledgeHook` to detect either marker for correct status reporting.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Compatibility shim comment references outdated callers** - `src/cli/commands/kb.ts:4`
**Confidence**: 82%
- Problem: The JSDoc comment states the shim is "preserved for callers that reference the old `commands/kb.js` path (e.g., tests, init.ts)." However, both `init.ts` and `uninstall.ts` have already been migrated to import from `./knowledge/index.js` directly, and no tests reference the old path. The comment creates a false impression that active callers exist.
- Fix: Update the comment to reflect the actual purpose (external consumers or cached imports from partial upgrade scenarios):
```typescript
/**
 * @deprecated Import from './knowledge/index.js' directly.
 * This module is a compatibility shim preserved for any cached
 * compiled imports referencing the old `commands/kb.js` path.
 */
export * from './knowledge/index.js';
```

## Pre-existing Issues (Not Blocking)

No pre-existing architectural issues identified.

## Suggestions (Lower Confidence)

- **Migration does not update manifest `features.kb` field to `features.knowledge` on disk** - `src/cli/utils/migrations.ts:135` (Confidence: 68%) -- The `rename-kb-to-knowledge` migration renames `.features/` sentinel files and updates `.gitignore`, but does not rewrite the manifest.json `features.kb` key to `features.knowledge`. The backward-compat layer in `readManifest` handles this at read-time, so it is not broken, but the manifest will carry the legacy key until the next `devflow init` run rewrites it.

- **`DEVFLOW_BG_KB_REFRESH` env var rename is a breaking change for running background processes** - `scripts/hooks/session-end-knowledge-refresh:6` (Confidence: 62%) -- If a background refresh was spawned by the old hook just before upgrade, the old process set `DEVFLOW_BG_KB_REFRESH=1`. The new hook checks `DEVFLOW_BG_KNOWLEDGE_REFRESH` for recursion prevention. This is a narrow race (background process finishes in ~180s), but theoretically the old process could trigger the new hook after upgrade before its PID exits. Practically negligible since init is not called mid-session.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The rename is executed cleanly across ~71 files with proper attention to:
- Manifest backward compatibility (read-time fallback from `features.kb` to `features.knowledge`)
- LEGACY_SKILL_NAMES additions for cleanup of old namespaced install dirs (`devflow:feature-kb`, `devflow:apply-feature-kb`)
- Per-project migration for `.features/` sentinel file renames and `.gitignore` updates
- Compatibility shim at `src/cli/commands/kb.ts` for potential external callers

The one blocking issue (old hook marker not cleaned during upgrade) follows a well-established pattern in the codebase (`ambient.ts` LEGACY_HOOK_MARKER) and is a straightforward fix. Without it, upgrading users will get a broken hook entry in their settings.json that causes runtime errors on every session end until they manually re-run `devflow init` or edit settings.json.
