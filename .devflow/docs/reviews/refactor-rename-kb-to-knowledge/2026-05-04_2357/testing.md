# Testing Review Report

**Branch**: refactor-rename-kb-to-knowledge -> main
**Date**: 2026-05-04

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Missing test for removeKnowledgeHook handling old `session-end-kb-refresh` hooks** - `src/cli/commands/knowledge/toggle.ts:10`
**Confidence**: 95%
- Problem: `KNOWLEDGE_HOOK_MARKER` is set to `'session-end-knowledge-refresh'`. The `removeKnowledgeHook` function only searches for this new marker. However, existing installations have `session-end-kb-refresh` in their settings.json. The init.ts "remove-then-add for upgrade safety" pattern (`removeKnowledgeHook(content)` at line 954) will NOT remove the old hook. After upgrade, users will have BOTH old and new hooks in SessionEnd, causing double background refreshes. The test suite (`tests/knowledge.test.ts`) only tests removal of the new hook name and does not exercise the upgrade scenario where an old `session-end-kb-refresh` entry exists.
- Fix: Either (a) update `removeKnowledgeHook` to also match `session-end-kb-refresh` (and add a test for this), or (b) add a dedicated test that documents the expected behavior that old hooks are cleaned up by the migration, and ensure the migration actually handles settings.json hook cleanup (currently `MIGRATION_RENAME_KB_TO_KNOWLEDGE` only renames `.features/` files and updates `.gitignore`, not settings.json hooks).

**No test coverage for `MIGRATION_RENAME_KB_TO_KNOWLEDGE` migration** - `src/cli/utils/migrations.ts:134`
**Confidence**: 92%
- Problem: The new migration (`rename-kb-to-knowledge`) renames 3 files in `.features/` and updates `.gitignore` entries. There are zero tests for this migration. Other migrations (`purge-legacy-knowledge-v2`, `purge-legacy-knowledge-v3`) similarly lack dedicated unit tests, but those are simpler (delete entries). This migration performs file renames and content replacement in `.gitignore`, which can fail silently if the `.replace()` patterns are wrong (e.g., regex-special characters in `.kb.lock` -- the dot is not escaped, though `String.replace` uses plain strings with `g` flag here, which is fine for this case). The migration also does not handle settings.json hook renaming, which is the actual dangerous backward-compat gap.
- Fix: Add a test file (e.g., `tests/migration-kb-to-knowledge.test.ts`) that exercises: (1) renaming `.features/.kb.lock` -> `.features/.knowledge.lock`, (2) renaming `.features/.kb-last-refresh` -> `.features/.knowledge-last-refresh`, (3) `.gitignore` content replacement, (4) no-op when files don't exist.

### MEDIUM

**No test for `devflow kb` CLI command alias / backward compat** - `src/cli/cli.ts:42`
**Confidence**: 82%
- Problem: The command was renamed from `kb` to `knowledge` with no CLI alias. Users with muscle memory for `devflow kb list` will get a "command not found" error. There is no test asserting that `devflow kb` still routes to the knowledge command (because no alias exists). The `kb.ts` shim only provides a TypeScript module-level re-export for internal callers (`import from './kb.js'`), but does not register a CLI alias.
- Fix: Either add a Commander alias (`.alias('kb')`) on the `knowledgeCommand` and add a test verifying `devflow kb list` still works, or document this as an intentional breaking change and remove the shim.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Test file still uses variable name `FEATURE_KB_CJS` after rename** - `tests/feature-knowledge/feature-knowledge.test.ts:505`
**Confidence**: 85%
- Problem: The constant is named `FEATURE_KB_CJS` but points to the new `feature-knowledge.cjs` path. While this is cosmetic and the test will pass, it creates confusion when the variable name contradicts its value. All other references in the test were properly renamed (`loadKnowledgeContent`, `listEntries`, etc.), but this one was missed.
- Fix: Rename `const FEATURE_KB_CJS` to `const FEATURE_KNOWLEDGE_CJS` and update the two references below it.

**No test for manifest `features.kb: true` with BOTH `kb` and `knowledge` fields present** - `tests/manifest.test.ts:119`
**Confidence**: 80%
- Problem: The backward-compat test (`should read features.kb as features.knowledge`) only tests the case where `features.knowledge` is absent and `features.kb` is present. It does not test the edge case where both fields exist (e.g., a manifest that was partially migrated), which should prefer `features.knowledge` over `features.kb`. The code in `manifest.ts` does handle this correctly (checks `features.knowledge` first), but a test documenting this priority would prevent regressions.
- Fix: Add a test case with `{ features: { kb: false, knowledge: true, ... } }` asserting that `knowledge` takes priority over `kb`.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Migration framework lacks unit tests** - `src/cli/utils/migrations.ts`
**Confidence**: 85%
- Problem: The `runMigrations` function and individual migration `run()` functions are not directly unit-tested. Only the higher-level init-logic integration tests exercise migrations indirectly. For a rename operation that affects file system state across all user projects, the absence of per-migration unit tests increases regression risk.

## Suggestions (Lower Confidence)

- **Test for hook double-registration on partial upgrade** - `src/cli/commands/init.ts:954` (Confidence: 75%) -- If a user runs `devflow init` after the rename but before the migration runs on a project, the old hook stays and the new hook is added. Consider adding an integration-level test simulating this scenario.

- **Shell hook test uses hardcoded env var `DEVFLOW_BG_KB_REFRESH`** - `tests/shell-hooks.test.ts:1528` (Confidence: 65%) -- The test correctly updated to `DEVFLOW_BG_KNOWLEDGE_REFRESH=1`, but there is no test verifying that the old env var `DEVFLOW_BG_KB_REFRESH=1` is NOT respected (ensuring old background processes from pre-upgrade don't interfere).

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | - | 0 | 2 | 0 |
| Pre-existing | - | - | 1 | 0 |

**Testing Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The test renames are mechanically consistent and the new backward-compat test for `features.kb` in manifest.test.ts is a good addition. However, there are two significant gaps: (1) the `removeKnowledgeHook` function cannot clean old `session-end-kb-refresh` entries from existing installations, and this gap is untested, creating a silent double-hook regression for all upgrading users; (2) the new `MIGRATION_RENAME_KB_TO_KNOWLEDGE` has zero test coverage despite performing file system mutations across all discovered projects.
