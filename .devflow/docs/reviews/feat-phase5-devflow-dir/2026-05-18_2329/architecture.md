# Architecture Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-18

## Issues in Your Changes (BLOCKING)

### HIGH

**Gitignore template content duplicated across 3 locations** -- Confidence: 85%
- `scripts/hooks/ensure-devflow-init:29-76`, `src/cli/utils/migrations.ts:57-103`, `.devflow/.gitignore:1-46`
- Problem: The `.devflow/.gitignore` content is maintained as verbatim copies in three locations: the committed `.devflow/.gitignore` file, the `ensure-devflow-init` shell hook heredoc, and the `DEVFLOW_GITIGNORE_CONTENT` constant in `migrations.ts`. Any change to gitignore rules requires updating all three in lockstep. This is a DRY violation that will lead to content drift as entries are added over time. The architecture skill flags this as inappropriate intimacy -- three modules share the same data without a single source of truth.
- Fix: Extract the gitignore content into a single canonical source. Options: (1) Generate `ensure-devflow-init`'s heredoc from a shared template at build time. (2) Have `ensure-devflow-init` source the content from the committed `.devflow/.gitignore` template in the repo. (3) Add the template to `project-paths.cjs` as `getDevflowGitignoreContent()` and have the shell hook delegate to `node project-paths.cjs --gitignore`. The migration constant could also reference the canonical source at build time.

### MEDIUM

**Dual-module (TS + CJS) synchronization relies on manual discipline** -- Confidence: 82%
- `src/cli/utils/project-paths.ts`, `scripts/hooks/lib/project-paths.cjs`
- Problem: The project-paths module exists as two manually-synchronized copies (TypeScript ESM and CommonJS). Each file's header says "must mirror this file exactly" and "keep them in sync when adding or changing functions." While parity tests (tests/project-paths.test.ts) catch runtime divergence, there is no build-time or CI-time structural check that both files export the same set of functions with the same signatures. Adding a function to one and forgetting the other will only be caught if someone runs the parity test suite. For a module that is the "single source of truth for path layout," this coupling model carries risk proportional to the number of future contributors.
- Fix: Consider a build-step that generates the CJS module from the TS source (e.g., `npm run build:plugins` could transpile `project-paths.ts` to CJS). Alternatively, add a CI check that diffs the export lists of both modules. The parity test is good but it is not a substitute for structural enforcement -- a new function added to only one module would not produce a test failure unless someone also adds a test row.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Migration ordering assumption: legacy purge runs before consolidation but targets new paths** -- Confidence: 80%
- `src/cli/utils/migrations.ts:689` (memoryDir resolution), `src/cli/utils/migrations.ts:472-477` (migration order)
- Problem: The `runPerProjectMigration` helper now computes `memoryDir = getMemoryDir(projectRoot)` which resolves to `.devflow/memory/`. This memoryDir is passed to purge-v2 and purge-v3 migrations. When `projectRoot` is provided (which it always is), the purge functions correctly use `getDecisionsDir(projectRoot)` = `.devflow/decisions/`. However, the purge migrations (positions 2 and 3) run before the consolidation migration (position 5). On an existing install that has never run *any* migration, the purge would look in `.devflow/decisions/` while the files are still at `.memory/decisions/`. The purge becomes a silent no-op (returns early when decisionsDir does not exist), and the consolidation then moves the files without them being purged. Since these migrations are tracked globally, the purge will never re-run. In practice this is low-impact because: (a) existing installs that already ran purge-v2/v3 are unaffected, and (b) new installs have no legacy entries to purge. The window is narrow (install that skipped all prior migrations) but the architectural coupling is worth documenting. Applies ADR-001 (clean break philosophy -- no backward-compat migration code).
- Fix: Reorder the MIGRATIONS array to place `MIGRATION_CONSOLIDATE_TO_DEVFLOW` before the purge and rename migrations, or have the consolidation migration run as a "pre-migration" step outside the registry. Alternatively, accept the narrow window and add a comment documenting the assumption.

**`purgeLegacyDecisionsEntries` retains stale `memoryDir` parameter** -- Confidence: 80%
- `src/cli/utils/legacy-decisions-purge.ts:153-160`
- Problem: The `purgeLegacyDecisionsEntries` and `purgeAllPreV2DecisionsEntries` functions accept both `memoryDir` and an optional `projectRoot`. When `projectRoot` is provided, `memoryDir` is ignored for path resolution but is still required as a parameter. The `PROJECT-PATTERNS.md` cleanup (line 188) still uses `memoryDir` directly: `path.join(memoryDir, 'PROJECT-PATTERNS.md')`. After consolidation, `memoryDir` is `.devflow/memory/` which is where the migration would have moved `PROJECT-PATTERNS.md`. However, the function's JSDoc still says `@param options.memoryDir - absolute path to the .memory/ directory`, and the parameter is vestigial for all other code paths when `projectRoot` is present. This is a DIP violation -- the function's contract is ambiguous about which parameter controls path resolution.
- Fix: Deprecate the `memoryDir` parameter in favor of `projectRoot` (make `projectRoot` required). Compute `PROJECT-PATTERNS.md` path as `path.join(getMemoryDir(projectRoot), 'PROJECT-PATTERNS.md')` for consistency with all other path resolution.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Shell hooks construct paths via string variables instead of centralized module** -- Confidence: 82%
- `scripts/hooks/sidecar-evaluate:23-30`, `scripts/hooks/session-start-context:28-32`, `scripts/hooks/sidecar-capture:39-41`
- Problem: While the CJS modules (json-helper.cjs, decisions-index.cjs, feature-knowledge.cjs) properly import from project-paths.cjs, the shell hooks (bash scripts) construct paths via manual string concatenation (e.g., `MEMORY_DIR="$DEVFLOW_DIR/memory"`). This is inherent to shell scripts -- they cannot import CJS modules. However, this means the ".devflow" path prefix is now hardcoded in ~8 shell scripts in addition to the centralized module, creating a second layer of path coupling. If the layout changes again, both layers need updating.
- Fix: Accept as a shell limitation. Alternatively, consolidate the path prefix into a single shell variable sourced from a shared script (similar to `ensure-devflow-init` being sourced into capture/dispatch). A `devflow-paths.sh` could export all directory variables from a single location.

## Suggestions (Lower Confidence)

- **`createDocsStructure` creates `status/compact` and `releases` directories not defined in project-paths** - `src/cli/utils/post-install.ts:510-512` (Confidence: 70%) -- The docs structure initialization creates subdirectories (status/compact, releases) that have no corresponding functions in project-paths.ts, suggesting either incomplete centralization or these paths are orphaned.

- **`decisions-usage-scan.cjs` checks `memoryDir` existence but the guard is vestigial** - `scripts/hooks/decisions-usage-scan.cjs:28` (Confidence: 65%) -- The script checks `if (!fs.existsSync(memoryDir))` where memoryDir is now `.devflow/memory/`. This gates a decisions usage scan that operates on `.devflow/decisions/`. The existence of the memory directory is not a meaningful prerequisite for decisions file operations -- the two directories are now siblings, not parent-child.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The core architectural decision -- centralizing all path construction into a single `project-paths` module consumed by both TS and CJS layers -- is sound and well-executed. The PR successfully applies the DIP principle by making every consumer depend on an abstraction (the path module) rather than hardcoded string concatenation. The consolidation migration is thorough, idempotent, and resumable. The parity test suite for TS/CJS sync is a strong design choice.

The conditions for approval are: (1) address the gitignore template triplication (HIGH -- this will cause drift), and (2) consider documenting or fixing the migration ordering assumption. The dual-module sync concern is mitigated by existing parity tests but would benefit from structural enforcement. Avoids PF-001 (clean break -- the migration is additive, not adding backward-compat shims for the rename).
