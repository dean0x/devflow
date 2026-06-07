<!-- TL;DR: 11 pitfalls. Key: PF-007, PF-008, PF-009, PF-010, PF-011 -->
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

## PF-006: Claude Code hook API changed silently — Stop hook field rename broke working memory across all projects

- **Area**: `sidecar-capture` Stop hook, Claude Code hook API compatibility, `scripts/hooks/sidecar-capture`
- **Issue**: Claude Code renamed `response_text` → `last_assistant_message` and removed `stop_reason` from Stop hook JSON input (mid-May 2026). `sidecar-capture` silently exited on every turn because (a) the absent `stop_reason` caused the `!= end_turn` guard to always exit, and (b) absent `response_text` meant assistant turns were captured as empty strings. No errors were emitted.
- **Impact**: Systemic — working memory frozen across all 3+ projects for weeks. Pending queues accumulated 1,640 user-only entries with zero assistant turns captured. Background memory agent never dispatched. Projects stuck at sessions from 6+ weeks earlier.
- **Resolution**: Changed `sidecar-capture` to read `last_assistant_message` instead of `response_text`; removed the dead `stop_reason` guard. After any Claude Code version update, verify hook input schemas against current docs. Add startup validation of required hook fields so failures surface immediately rather than silently.
- **Status**: Active
- **Source**: self-learning:obs_k7mx2p

## PF-007: Editing globally installed hook scripts directly instead of source + rebuild + reinstall

- **Area**: `scripts/hooks/` (source), `~/.devflow/scripts/hooks/` (installed), devflow development workflow
- **Issue**: When debugging hook failures, the assistant repeatedly edited globally installed hook files (`~/.devflow/scripts/hooks/`) instead of source files (`scripts/hooks/`). Changes to installed copies are silently overwritten on the next `devflow init`, and they are never committed to the repository.
- **Impact**: Debug changes appeared to work but were not committed to source. Required an additional rebuild+reinstall cycle after the user caught the error. Creates divergence between what is installed and what is in source control.
- **Resolution**: Always edit source files (`scripts/hooks/`), run `npm run build`, then run `devflow init` to reinstall. Never directly edit installed copies at `~/.devflow/scripts/` or `~/.claude/`. The same rule applies to any other installed artifact (commands, agents, skills).
- **Status**: Active
- **Source**: self-learning:obs_n4rs8t

## PF-008: Using additionalContext for critical maintenance directives — models deprioritize soft context when competing with an active user task, causing markers to silently accumulate

- **Area**: sidecar consumption architecture, Claude Code hook additionalContext
- **Issue**: injecting critical background directives via additionalContext (system-reminder) relies on the model to act on them when a user question is also present — in practice the model almost always prioritizes answering the user, leaving maintenance markers unprocessed
- **Impact**: markers accumulated for weeks across all projects (alefy, autobeat, devflow) with no errors surfaced — purely silent backlog growth
- **Resolution**: anchor critical directives to hook events where no user task competes (SessionStart is the correct hook)
- **Status**: Active
- **Source**: self-learning:obs_m5v2xt

## PF-009: A subsystem rename leaves stale references and dead paths in untracked-by-grep places — reference docs, the runtime .gitignore template, and knowledge-base referencedFiles — that a code-only rename pass misses

- **Area**: large subsystem/path renames (sidecar->Dream), reference docs, runtime templates, feature knowledge bases
- **Issue**: a rename that focuses on source code and primary docs reliably leaves stragglers in lower-visibility surfaces — narrative reference docs (docs/working-memory.md, file-organization.md), the .devflow/.gitignore template, and knowledge-base index referencedFiles / .create-result.json — which a single grep-and-fix pass under-counts
- **Impact**: user-facing docs describe a name that no longer exists, the gitignore silently stops ignoring transient state under the new name, and the KB staleness check tracks deleted files
- **Resolution**: after any rename, sweep ALL surfaces — case-insensitive grep across tracked files for both the old name and any concept it renamed (e.g. processor), plus the runtime .gitignore template, every reference doc, and every feature KB referencedFiles list
- **Status**: Active
- **Source**: self-learning:obs_renamemiss1

## PF-010: An init-time legacy-cleanup list (LEGACY_HOOK_FILES) contained a still-active hook file, so devflow init deleted the worker it had just installed

- **Area**: devflow init install/cleanup, LEGACY_HOOK_FILES removal list, background-memory-update worker
- **Issue**: the legacy-hook removal list (LEGACY_HOOK_FILES, also removeMemoryHooks) carried the name of a hook file that is part of the CURRENT install set (background-memory-update) — so devflow init deleted the worker immediately after installing it, leaving memory refresh permanently broken with no error
- **Impact**: a ship-blocking self-deleting install — the feature appeared installed but the worker file was gone after every init
- **Resolution**: removed background-memory-update from LEGACY_HOOK_FILES and added an install-survival test that asserts the worker exists on disk after init
- **Status**: Active
- **Source**: self-learning:obs_leghook1

## PF-011: A watchdog that escalates to a process-group SIGKILL kills its own process group (self-kill) unless the supervised worker is isolated into a separate group with set -m

- **Area**: background-memory-update watchdog, shell process-group signaling (kill -- -PGID), set -m job control
- **Issue**: the first watchdog hardening escalated a timeout to a process-group kill (kill negative-PGID) but the watchdog and the worker shared a process group, so the group-kill also terminated the watchdog/parent itself — a self-kill regression
- **Impact**: the timeout-escalation path could kill the wrong processes including its own supervisor, defeating the watchdog and risking the parent shell
- **Resolution**: enable job control with set -m so the worker is launched in its OWN process group, making the group-targeted SIGKILL hit only the worker subtree
- **Status**: Active
- **Source**: self-learning:obs_wdogkill1
