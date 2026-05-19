# Regression Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-18

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Stale JSDoc comment references `.memory/` path in `purgeLegacyDecisionsEntries`** - `src/cli/utils/legacy-decisions-purge.ts:149`
**Confidence**: 85%
- Problem: The JSDoc on line 149 still says `@param options.memoryDir - absolute path to the '.memory/' directory` but the function now receives `.devflow/memory/` when called from the migration framework (via `getMemoryDir(projectRoot)`). The comment misleads future maintainers about what `memoryDir` actually contains.
- Fix: Update the JSDoc to reference `.devflow/memory/` or add a note that this is the canonical memory subdirectory (not necessarily `.memory/`).

```typescript
// Before:
 * @param options.memoryDir - absolute path to the `.memory/` directory

// After:
 * @param options.memoryDir - absolute path to the memory directory (`.devflow/memory/`)
```

**`PROJECT-PATTERNS.md` cleanup uses `memoryDir` which may miss the file during fresh migration** - `src/cli/utils/legacy-decisions-purge.ts:188`
**Confidence**: 82%
- Problem: The orphan `PROJECT-PATTERNS.md` cleanup at line 188 constructs its path as `path.join(memoryDir, 'PROJECT-PATTERNS.md')`. When called from the migration framework, `memoryDir` is now `.devflow/memory/`. However, `PROJECT-PATTERNS.md` is NOT in the explicit `MEMORY_SKIP_FILES` set (and is NOT in the explicit `memMap`), so it falls through to the catch-all `moveDirContents` on line 406 of `migrations.ts` -- but only if the `consolidate-to-devflow-dir` migration runs AFTER this purge migration. Since `purge-legacy-knowledge-v2` runs before `consolidate-to-devflow-dir` in the `MIGRATIONS` array, on a first-time run: (a) the purge tries to delete from `.devflow/memory/PROJECT-PATTERNS.md` which doesn't exist yet, (b) then consolidation moves it from `.memory/PROJECT-PATTERNS.md` to `.devflow/memory/PROJECT-PATTERNS.md`. The file survives the purge. On subsequent runs, the purge migration is already marked applied so it never retries. Net effect: `PROJECT-PATTERNS.md` survives migration for users who have it. This is wrapped in try/catch so it's non-fatal, but it's an orphan artifact that was meant to be cleaned.
- Fix: Either add `PROJECT-PATTERNS.md` to the `consolidate-to-devflow-dir` migration's cleanup step, or add it to `MEMORY_SKIP_FILES` and handle it explicitly in the consolidation migration. Alternatively, since this is a legacy cleanup that only matters for a narrow window of users, accept the minor regression.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Stale comments reference `.features/` in `feature-knowledge.cjs` (6 occurrences)** - Confidence: 84%
- `scripts/hooks/lib/feature-knowledge.cjs:4` - "Feature knowledge bases live under .features/{slug}/KNOWLEDGE.md"
- `scripts/hooks/lib/feature-knowledge.cjs:5` - "index at .features/index.json"
- `scripts/hooks/lib/feature-knowledge.cjs:108` - "Load and parse .features/index.json from a worktree path."
- `scripts/hooks/lib/feature-knowledge.cjs:306` - "Follows the same pattern as .memory/.decisions.lock."
- `scripts/hooks/lib/feature-knowledge.cjs:414` - "if .features/ is absent."
- `src/cli/utils/knowledge-agent.ts:52` - "`.features/{slug}/{sidecarName}`"
- Problem: Module-level DESIGN comments and JSDoc still reference the old `.features/` and `.memory/` paths even though the actual code now uses `project-paths.cjs` functions that resolve to `.devflow/features/` and `.devflow/decisions/`. These stale comments create a mismatch between documentation and behavior.
- Fix: Update all path references in comments to use `.devflow/features/` and `.devflow/decisions/`.

**Stale JSDoc comment in `post-install.ts`** - `src/cli/utils/post-install.ts:504`
**Confidence**: 82%
- Problem: JSDoc says "Create .docs/ directory structure" but the function now creates under `.devflow/docs/`. The user-facing log message on line 514 also says `.docs/ structure ready` instead of `.devflow/docs/`.
- Fix: Update JSDoc and log message:

```typescript
// Before:
/**
 * Create .docs/ directory structure for Devflow artifacts.
 */
// ...
p.log.success('.docs/ structure ready');

// After:
/**
 * Create .devflow/docs/ directory structure for Devflow artifacts.
 */
// ...
p.log.success('.devflow/docs/ structure ready');
```

**Stale JSDoc in `purgeAllPreV2DecisionsEntries`** - `src/cli/utils/legacy-decisions-purge.ts:215-220`
**Confidence**: 82%
- Problem: JSDoc on lines 215 and 220 still reference "`.memory/decisions/`" for both the function description and `@param options.memoryDir`. Same issue as the v2 purge function above.
- Fix: Update to reference `.devflow/decisions/` (or `.devflow/memory/` for the `memoryDir` param).

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Uninstall command does not clean up lingering `.memory/`, `.features/`, `.docs/` directories** - `src/cli/commands/uninstall.ts:300` (Confidence: 65%) -- If a user's `consolidate-to-devflow-dir` migration partially failed or never ran, the old directories could linger. The uninstall now only checks for `.devflow/`. Consider adding a best-effort cleanup of the old directories during full uninstall.

- **Migration ordering dependency between purge and consolidation is undocumented** - `src/cli/utils/migrations.ts:472-478` (Confidence: 68%) -- The `MIGRATIONS` array ordering creates an implicit dependency: purge-legacy-knowledge-v2/v3 now rely on `projectRoot` being passed to find decisions files at `.devflow/decisions/`, but the files may still be at `.memory/decisions/` if `consolidate-to-devflow-dir` hasn't run yet. The fallback path (`memoryDir` without `projectRoot`) handles this case, but the dependency is subtle and undocumented.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | - | 0 | 3 | 0 |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The path consolidation is thorough and well-executed. The centralized `project-paths.ts`/`project-paths.cjs` modules are a strong architectural improvement that reduces regression risk for future path changes. The migration is comprehensive with explicit file-by-file moves and idempotent design. All 741+ tests pass. The `consolidate-to-devflow-dir` migration correctly handles the old-to-new transition (applies ADR-001 -- this is data migration, not backward-compat code, which is appropriate).

The blocking MEDIUM issues are stale documentation/comments and a minor `PROJECT-PATTERNS.md` cleanup miss -- neither introduces runtime regression. The stale comments should be fixed to maintain consistency between code and documentation, but they do not affect behavior (avoids PF-001 -- the actual code uses the centralized path module correctly; these are only comment/JSDoc drift).

No exports removed. No return type changes. No CLI options removed. No behavior changes in error handling. Migration is additive (new `consolidate-to-devflow-dir`) with no modifications to existing migration behavior. Deleted shell hooks (`ensure-features-init`, `ensure-memory-gitignore`) are fully replaced by the new `ensure-devflow-init` hook with equivalent functionality.
