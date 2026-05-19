<!-- TL;DR: 3 decisions. Key: ADR-001, ADR-002, ADR-003 -->
# Architectural Decisions

Append-only. Status changes allowed; deletions prohibited.

## ADR-001: No migration code for devflow refactors — clean break philosophy

- **Date**: 2026-05-06
- **Status**: Accepted
- **Context**: Phase 2 rename refactor (kb→knowledge) was implemented with a full backward-compat layer including a shim re-export, .alias('kb'), deprecated --kb/--no-kb flags, manifest fallback, and migration scripts
- **Decision**: remove all compat code except one-time cleanup items (legacy hook file removal, manifest self-heal write-back)
- **Consequences**: 'Don't want to start accumulating backward compatible code. And we don't really have that many users of devflow yet' — avoid polluting codebase with compat cruft when user base is small
- **Source**: self-learning:obs_c9d3m1

## ADR-002: Migrations must leave a clean house — delete all legacy artifacts, not just move new-path files

- **Date**: 2026-05-19
- **Status**: Accepted
- **Context**: The `consolidate-to-devflow-dir` migration moved files from `.memory/`, `.features/`, `.docs/` to `.devflow/` subdirectories, but deliberately skipped certain legacy files (`.knowledge-usage.json`, `.working-memory-last-trigger`, `.gitignore-configured`, `knowledge/` subdir) and then only attempted rmdir if directories were empty — which they never were
- **Decision**: Migrations must explicitly delete all legacy files (including those previously in skip-lists) and clean up old empty directories. The goal is a fully clean post-migration state, not just successful file movement.
- **Consequences**: Users get a clean slate after migration with no residual legacy directories alongside the new structure. Eliminates confusion from parallel old/new directory presence and removes the risk of stale writes from non-reinstalled hooks targeting legacy paths.
- **Source**: self-learning:obs_u8elbu

## ADR-003: .devflow/.gitignore template must exclude transient per-developer artifacts

- **Date**: 2026-05-19
- **Status**: Accepted
- **Context**: After migrating Alefy project to `.devflow/` layout, `learning/debug/` and `WORKING-MEMORY.md` appeared as untracked files in git status, causing confusion and risk of accidental commits of ephemeral session data
- **Decision**: The `.devflow/.gitignore` template (applied at `devflow init` time) must explicitly exclude all transient per-developer artifacts (`learning/debug/`, runtime logs, in-progress state files) while still tracking project-level artifacts (`features/` knowledge bases, `decisions/`, sidecar markers).
- **Consequences**: Clean git status after init across all projects. No accidental commits of session-transient data. Template is the single place to maintain this exclusion list.
- **Source**: self-learning:obs_okp1fh
