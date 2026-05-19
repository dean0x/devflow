# Consistency Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-18

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing centralized getter for `.learning.lock` path — inconsistent with `.decisions.lock` pattern** - `src/cli/commands/learn.ts:378`, `src/cli/commands/learn.ts:578`, `scripts/hooks/json-helper.cjs:1535`
**Confidence**: 85%
- Problem: The `project-paths` modules provide `getDecisionsLockDir()` for the `.decisions.lock` path, but there is no equivalent `getLearningLockDir()` for the `.learning.lock` path. Three call sites construct this path inline via `path.join(getMemoryDir(cwd), '.learning.lock')`. This is an inconsistency with the established pattern where all paths are centralized in the `project-paths` module, which is the stated design goal of this PR.
- Fix: Add `getLearningLockDir(projectRoot)` to both `project-paths.cjs` and `project-paths.ts` returning `path.join(projectRoot, '.devflow', 'memory', '.learning.lock')`. Update the three inline constructions to use the centralized getter. Note: the learning lock lives under `.devflow/memory/` while the decisions lock lives under `.devflow/decisions/` — the asymmetry in placement is fine, but both should be centralized.

### MEDIUM

**Stale user-facing message in `createDocsStructure`** - `src/cli/utils/post-install.ts:514`
**Confidence**: 88%
- Problem: The verbose log message reads `.docs/ structure ready` but the actual path is now `.devflow/docs/`. This is a user-visible string that was not updated to reflect the new layout, despite the function itself being changed to use `getDocsDir(process.cwd())`.
- Fix: Change the message to `.devflow/docs/ structure ready`.

**Misleading variable name `memoryDir` in `decisions-append` case** - `scripts/hooks/json-helper.cjs:1829`
**Confidence**: 82%
- Problem: The `decisions-append` handler derives `projectRoot` by walking up from the decisions file path. The intermediate variable on line 1829 is named `memoryDir` but it actually represents the `.devflow/` root directory (one level above `decisions/`). Under the old layout (`.memory/decisions/`), the name was accurate; under the new layout (`.devflow/decisions/`), it is misleading. This risks confusion for future maintainers.
- Fix: Rename the variable from `memoryDir` to `devflowDir`:
  ```javascript
  const decisionsDir = path.dirname(decisionsFile);
  const devflowDir = path.dirname(decisionsDir);
  const projectRoot = path.dirname(devflowDir);
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Stale JSDoc path references in `legacy-decisions-purge.ts`** - `src/cli/utils/legacy-decisions-purge.ts:147`, `src/cli/utils/legacy-decisions-purge.ts:149`, `src/cli/utils/legacy-decisions-purge.ts:215`, `src/cli/utils/legacy-decisions-purge.ts:220`
**Confidence**: 85%
- Problem: The function-level JSDoc comments for `purgeLegacyDecisionsEntries` and `purgeAllPreV2DecisionsEntries` still reference `.memory/` and `.memory/decisions/` in their documentation. The function signatures were updated to accept `projectRoot` and use the centralized getters, but the doc comments were not updated to match. This is inconsistent with the thorough comment updates applied elsewhere in the PR (e.g., hook scripts, sidecar skill, CLAUDE.md).
- Fix: Update the JSDoc `@param` descriptions to reference `.devflow/memory/` (for the legacy `memoryDir` param) and note that `projectRoot` is the preferred parameter for new callers.

**Stale comment referencing `.memory/.decisions.lock`** - `scripts/hooks/lib/feature-knowledge.cjs:306`
**Confidence**: 82%
- Problem: The JSDoc for `acquireMkdirLock` in `feature-knowledge.cjs` references `.memory/.decisions.lock` as the pattern source. The PR changed this file (lines 1-21 of the diff add `project-paths.cjs` imports and update path construction), so this comment is in touched code that was not fully updated.
- Fix: Update the comment to reference `.devflow/decisions/.decisions.lock`.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`--keep-docs` flag semantic drift** - `src/cli/commands/uninstall.ts:120` (Confidence: 65%) — The flag name `--keep-docs` now controls preservation of the entire `.devflow/` directory (docs, memory, decisions, features), not just docs. The description was updated ("Keep .devflow/ directory and project data") but the flag name is a leftover. Consider renaming to `--keep-data` in a future release (applies ADR-001: this is a separate concern, not migration code for this refactor).

- **Three copies of `.devflow/.gitignore` content** - `scripts/hooks/ensure-devflow-init:29-76`, `src/cli/utils/migrations.ts:57-103`, `.devflow/.gitignore` (Confidence: 70%) — The gitignore content is maintained in three places: the committed `.devflow/.gitignore`, the `ensure-devflow-init` shell heredoc, and the `DEVFLOW_GITIGNORE_CONTENT` constant in `migrations.ts`. Currently all three are identical, but future edits must update all three. Consider extracting to a shared template file or generating from a single source.

- **`PROJECT-PATTERNS.md` orphan cleanup path mismatch** - `src/cli/utils/legacy-decisions-purge.ts:188` (Confidence: 62%) — After the consolidation migration runs, `memoryDir` points to `.devflow/memory/` but the orphan `PROJECT-PATTERNS.md` would have been moved there by the catch-all `moveDirContents`. The cleanup works by accident (the file happens to be in the right place post-migration), but the intent is fragile — it depends on migration ordering. A comment noting this dependency would help.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The PR achieves its primary consistency goal exceptionally well: 120 files were updated to use centralized `project-paths` modules, with near-perfect TS/CJS parity (tested), consistent `.devflow/.gitignore` content across three entry points, and thorough path migration in hooks, CLI commands, skills, and agents. The centralization pattern (every path through a getter function) is correctly applied across both the CJS hook layer and the TypeScript CLI layer. The migration code itself is well-structured, idempotent, and correctly ordered (applies ADR-001 clean-break philosophy — migration moves data rather than shimming old paths).

The one blocking item is the missing `getLearningLockDir` centralized getter, which breaks the pattern established by `getDecisionsLockDir` and leaves three inline path constructions that bypass the module. The remaining issues are stale comments/messages that should be fixed for completeness but are not blocking.
