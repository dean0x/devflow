<!-- TL;DR: 5 pitfalls. Key: PF-001, PF-002, PF-003, PF-004, PF-005 -->
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

## PF-004: Migration idempotency means buggy-run projects are never re-swept — manual cross-project cleanup required when fixing migration bugs after first run

- **Area**: `migrations.ts` idempotency, `consolidate-to-devflow-dir`, cross-project sweeps
- **Issue**: Migration idempotency (tracked in `~/.devflow/migrations.json`) correctly prevents re-running migrations, but projects that ran a buggy migration version are never automatically re-swept when the bug is fixed. Legacy data including decisions/pitfalls stored in `.memory/knowledge/decisions.md` must be manually merged into `.devflow/decisions/`.
- **Impact**: 15+ projects required a manual cleanup sweep after the `consolidate-to-devflow-dir` migration bug was fixed — legacy `.memory/` directories persisted and legacy ADR/PF content had to be manually merged into the new structure per-project.
- **Resolution**: When fixing a migration bug post-release, either bump the migration version to force a re-sweep (e.g., `consolidate-to-devflow-dir-v2`) or document and execute a manual sweep script. Include a legacy decisions/pitfalls merge step in the sweep runbook.
- **Status**: Active
- **Source**: self-learning:obs_qmt7kz

## PF-005: Assuming a capability doesn't exist without checking the existing agent roster first

- **Area**: Workflow design, research phase, new feature planning (bug-analysis, any new orch command)
- **Issue**: Research concluded "no tool performs plan-intent vs implementation comparison" and proceeded to design this as a novel capability — without first checking devflow's own Evaluator agent, which already does exactly this (receives ORIGINAL_REQUEST, EXECUTION_PLAN, FILES_CHANGED, ACCEPTANCE_CRITERIA and performs goal-backward verification). The gap was only caught by user pushback.
- **Impact**: Wasted design effort framing a capability as unique when it already existed. Risk of implementing a duplicate agent or workflow that conflicts with existing ones.
- **Resolution**: Before designing any new capability that conceptually overlaps with existing agents (Evaluator, Scrutinizer, Reviewer, Resolver), explicitly read the existing agent roster and their input/output contracts. Check `shared/agents/` and the agent roster section of CLAUDE.md before claiming a gap exists.
- **Status**: Active
- **Source**: self-learning:obs_3vt99r
