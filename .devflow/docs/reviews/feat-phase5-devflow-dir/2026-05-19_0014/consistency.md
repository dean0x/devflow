# Consistency Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-19

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Stale info message in rename-kb migration references old path** - `src/cli/utils/migrations.ts:232`
**Confidence**: 85%
- Problem: The info message logged on successful rename still says `.features/${oldName}` but after this PR, the features directory is at `.devflow/features/`. The `getFeaturesDir()` call on line 219 correctly resolves to `.devflow/features/`, so the rename itself operates on the right path, but the user-facing info string is inconsistent with the new layout.
- Fix:
```typescript
// Before
infos.push(`Renamed .features/${oldName} → .features/${newName}`);
// After
infos.push(`Renamed .devflow/features/${oldName} → .devflow/features/${newName}`);
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Cross-reference comment in TS says "CJS COUNTERPART" while CJS says "TS COUNTERPART" -- asymmetric labeling pattern** - `src/cli/utils/project-paths.ts:287`, `scripts/hooks/lib/project-paths.cjs:284`
**Confidence**: 82%
- Problem: The `getDevflowGitignoreContent()` JSDoc in the TS file says `CJS COUNTERPART: scripts/hooks/lib/project-paths.cjs must mirror this exactly` while the CJS file says `TS COUNTERPART: src/cli/utils/project-paths.ts must mirror this exactly`. Both claim the other must mirror them, but neither identifies itself as the canonical source. The file-level header comments (lines 15-16 in TS, 13-14 in CJS) similarly say "must mirror this file exactly" bidirectionally. This is fine for the file-level comment (generic sync instruction), but the per-function JSDoc should be consistent with the shell script's comment on line 37 of `ensure-devflow-init`, which correctly says `CANONICAL SOURCE: scripts/hooks/lib/project-paths.cjs`. The TS function is the one imported by `migrations.ts`, making it the primary consumer -- yet it labels itself as the counterpart rather than the source. This cross-reference asymmetry could confuse a maintainer deciding which copy to update first.
- Fix: Pick one as canonical (the TS module is the natural choice since it is the one imported by `migrations.ts`) and adjust the CJS comment to say "must mirror this" rather than "must mirror this exactly" bidirectionally. Alternatively, align with the shell script which already points to CJS as canonical -- either way, establish a single direction.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`ensure_docs_dir` change subtly alters semantics** - `shared/skills/docs-framework/SKILL.md:107` (Confidence: 70%) -- The old `ensure_docs_dir() { mkdir -p ".devflow/docs/"; }` took no argument; the new version `ensure_docs_dir() { mkdir -p ".devflow/docs/$1"; }` takes an argument. This changes the helper's contract (callers that pass no argument now create `.devflow/docs/` with a trailing empty string, which is harmless but inconsistent with usage examples that now require a subdirectory argument). This may be intentional, but no callers in the diff were updated.

- **`moveFile` mkdir-before-rename creates destination parent unconditionally** - `src/cli/utils/migrations.ts:20` (Confidence: 65%) -- When the source does not exist, the current code creates the parent directory of `dest` via `mkdir -p` before discovering that `src` is absent (ENOENT from rename). The old code checked source existence first, avoiding unnecessary directory creation. In practice this is harmless (the directories are all needed anyway by subsequent steps), but it is a behavioral change from the documented "attempt rename directly" approach.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Consistency Assessment

This PR demonstrates strong consistency across the codebase:

1. **Gitignore triplication eliminated** -- The three copies of the `.devflow/.gitignore` content (TS `getDevflowGitignoreContent()`, CJS `getDevflowGitignoreContent()`, and shell heredoc in `ensure-devflow-init`) are verified byte-identical. The canonical-source comment in the shell script and the cross-reference JSDoc comments establish a maintenance chain.

2. **TS/CJS path module parity** -- `getLearningLockDir()` was added to both `project-paths.ts` and `project-paths.cjs` with identical implementations and JSDoc comments. Both modules export the function in the same position within their respective export lists. The test file (`project-paths.test.ts`) was updated with coverage.

3. **MEMORY_SKIP_FILES refactored DRY** -- The old `MEMORY_SKIP_FILES` Set contained 26 entries that duplicated the memMap keys. The new approach (`MEMORY_LEGACY_SKIP_FILES` + derived set from `memMap.map(...)`) eliminates this duplication. Adding a new memMap entry automatically excludes it from the catch-all pass.

4. **Pattern consistency in migrations** -- The `consolidate-to-devflow-dir` migration follows the established patterns: `moveFile` for individual files, `moveDirContents` for directory migration, `Promise.all` for independent operations, and the standard `MigrationRunResult` return type.

5. **Decision context** -- This refactor introduces migration code (applies ADR-001's clean break philosophy in a nuanced way: the migration is necessary for the directory consolidation itself, not for backward compatibility shims). The migration is idempotent and resumable, consistent with the existing migration patterns. The `legacy-decisions-purge.ts` update to check both old and new paths for `PROJECT-PATTERNS.md` is a reasonable transitional concern (avoids PF-001 territory -- migration code is justified here since the consolidation migration must handle in-flight state).
