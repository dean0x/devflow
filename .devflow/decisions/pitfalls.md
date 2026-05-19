<!-- TL;DR: 3 pitfalls. Key: PF-001, PF-002, PF-003 -->
# Known Pitfalls

Area-specific gotchas, fragile areas, and past bugs.

## PF-001: Adding migration code to a rename refactor without verifying user's clean-break philosophy

- **Area**: migrations.ts, manifest.ts fallback, kb.ts shim, deprecated --kb/--no-kb flags, .alias('kb')
- **Issue**: assistant planned and implemented a full backwards-compatibility layer (shim re-export, command alias, deprecated flags, manifest fallback, migration scripts) for a rename refactor without first confirming whether the user wanted backwards compat or a clean break
- **Impact**: entire backward-compat codebase had to be removed after review, wasting planning and implementation effort
- **Resolution**: before implementing any migration or compat code for a rename/refactor in devflow, explicitly confirm whether the user wants backwards compatibility or a clean break — the user's standing philosophy is 'clean break: start from scratch, users can be migrated manually if needed
- **Status**: Active
- **Source**: self-learning:obs_e5t2r8

## PF-002: Migration skip-list prevents directory cleanup — skipped legacy files block rmdir of old directories

- **Area**: `migrations.ts` — `consolidate-to-devflow-dir` Step 7
- **Issue**: Migration skip-list leaves legacy files in place (`.knowledge-usage.json`, `.working-memory-last-trigger`, `.gitignore-configured`, `knowledge/` subdir) preventing rmdir — old directories remain non-empty and are never cleaned up automatically
- **Impact**: Legacy `.memory/`, `.features/`, `.docs/` directories persist alongside new `.devflow/` structure across all user projects until manually removed. Caused 15+ projects to require manual cleanup sweeps.
- **Resolution**: Extend migration to explicitly delete all known legacy files before attempting rmdir, so old directories are emptied and removed completely. Skip-lists should be for files to migrate (move), not files to preserve indefinitely.
- **Status**: Active
- **Source**: self-learning:obs_wdyvxg

## PF-003: Post-migration hook writes land at old path when hooks are not rebuilt and reinstalled after a path refactor

- **Area**: Knowledge refresh hooks, `sidecar-evaluate`, any session-end hooks involving path-dependent writes
- **Issue**: After a migration moves data to a new path, background hooks still point to the old path if the new code has not been rebuilt (`npm run build`) and reinstalled (`devflow init`) on the affected machine. Hooks silently regenerate files at the legacy location with no errors.
- **Impact**: Data divergence between old and new paths — e.g., `knowledge refresh` updated `.features/portfolio-risk-flags/KNOWLEDGE.md` (236→268 lines) while `.devflow/features/` had the older version. Silent data divergence is hard to detect.
- **Resolution**: Any hook path refactor requires explicit rebuild and reinstall before hooks write to the correct new location. Document this dependency in migration notes. Add a post-migration validation step that checks hook install timestamps vs build timestamps.
- **Status**: Active
- **Source**: self-learning:obs_6rp5ri
