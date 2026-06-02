<!-- TL;DR: 14 decisions. Key: ADR-010, ADR-011, ADR-012, ADR-013, ADR-014 -->
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

## ADR-004: /bug-analysis must be a completely separate workflow from the Evaluator

- **Date**: 2026-05-23
- **Status**: Accepted
- **Context**: The Evaluator agent already performs intent-vs-implementation comparison inside the implement pipeline (receives ORIGINAL_REQUEST, EXECUTION_PLAN, FILES_CHANGED, ACCEPTANCE_CRITERIA and performs goal-backward verification). When designing /bug-analysis, the question arose whether to integrate with the Evaluator or build a separate workflow.
- **Decision**: Create `/bug-analysis` as a completely independent post-pipeline workflow rather than extending the Evaluator.
- **Consequences**: Three non-substitutable properties make them distinct — (1) Timing: Evaluator sees pre-review code, bug-analysis sees the final post-resolve code; (2) Persistence: Evaluator findings are ephemeral (not written to disk), bug-analysis writes reports to `.devflow/docs/bug-analysis/`; (3) Circularity: Evaluator shares session/model with the Coder, while bug-analysis is fully independent. Separation avoids conflating mid-pipeline quality checks with final-state bug detection.
- **Source**: self-learning:obs_686xoq

## ADR-005: Bug analysis scope includes business logic bugs via upstream plan/PRD intent

- **Date**: 2026-05-23
- **Status**: Accepted
- **Context**: Initial research scoped out business logic bugs as undetectable by static analysis tools. Devflow's post-pipeline position (after plan→implement→review→resolve) means bug-analysis agents can access plan documents and PRD intent — information no general-purpose static tool has.
- **Decision**: Bug analysis must include business logic bugs, functional usability bugs, and integration bugs by providing LLM agents with upstream plan/PRD context alongside the code, enabling plan-intent vs implementation comparison.
- **Consequences**: Devflow gains a unique capability not present in any surveyed tool — LLM agents compare "the plan says X should happen when Y" against "the code does Z when Y". This is only possible because bug-analysis runs post-pipeline with access to the full artifact chain. Bug categories: security, functional, integration, usability, and business logic.
- **Source**: self-learning:obs_3pp5sq

## ADR-006: Bug analysis uses hybrid static analysis + LLM semantic reasoning architecture

- **Date**: 2026-05-23
- **Status**: Accepted
- **Context**: Three independent research streams (codebase, external, academic) converged on the same architecture. Semgrep (~10s, single-file pattern matching) and CodeQL (minutes, cross-file data flow) each cover different threat classes. LLM semantic reasoning alone without static candidates has high false-negative rates.
- **Decision**: Use a hybrid approach: Semgrep and CodeQL run in parallel as static candidate generators producing structured alerts, which are then fed to LLM semantic reasoning agents that filter false positives and reason about business logic, feasibility, and intent.
- **Consequences**: Static tools provide speed and breadth of coverage while LLM agents handle semantic reasoning neither tool can do alone. Multi-agent consensus prevents model-specific error amplification. Production deployment (Tencent LLM4PFA) reports 94-98% false positive reduction using this pattern.
- **Source**: self-learning:obs_dwm8fa

## ADR-007: Hook debug tracing must be a single global toggle (devflow debug) covering all hooks

- **Date**: 2026-05-27
- **Status**: Accepted
- **Context**: Adding debug tracing to `sidecar-capture` raised the question of whether the toggle should be per-feature (e.g., `devflow memory --debug`) or a single global flag. The system has 7 hooks across 4 feature areas (memory, learning, decisions, knowledge).
- **Decision**: Implement a single global `DEVFLOW_HOOK_DEBUG=1` env var toggle exposed as `devflow debug --enable/--disable/--status`, covering ALL hooks via a shared `scripts/hooks/debug-trace` helper script. Stored in `~/.claude/settings.json` env block so it survives reinstalls.
- **Consequences**: When debugging any hook issue, all hooks emit traces simultaneously — enabling cross-hook interaction visibility. Per-feature toggles would require enabling multiple flags and could miss interactions between hooks (e.g., sidecar-capture writing a queue entry that sidecar-dispatch reads). The shared helper means debug tracing is consistent across all hooks and can be updated in one place.
- **Source**: self-learning:obs_h9bw3c

## ADR-008: LLM-vs-plumbing principle: artifact content must be LLM-authored — deterministic scripts must not write memory, observations, ADR/PF bodies, or knowledge bases

- **Date**: 2026-06-01
- **Status**: Accepted
- **Context**: investigation found dead deterministic promotion code (process-observations, calculateConfidence, tryImmediatePromotion) that was writing artifact files via threshold calculations — contradicting the system design
- **Decision**: all artifact content (working memory, learning observations, ADR/PF bodies, knowledge bases) MUST be authored by an LLM agent
- **Consequences**: artifact quality requires semantic intelligence that deterministic thresholds cannot provide
- **Source**: self-learning:obs_7xk9qm

## ADR-009: Sidecar processor must be spawned at SessionStart — not via additionalContext injection — because soft context directives are unreliably acted upon when a user task is present

- **Date**: 2026-06-01
- **Status**: Accepted
- **Context**: original sidecar design injected SIDECAR directives via additionalContext (UserPromptSubmit hook) and relied on the model to spawn a background processor
- **Decision**: move processor spawning entirely to SessionStart (session-start-context hook) — a clean hook event where no competing user task is present
- **Consequences**: SessionStart fires before any user turn is visible to the model — there is no competing user request, so the spawn directive receives full attention
- **Source**: self-learning:obs_p3r8wn

## ADR-010: Interactive devflow init always installs on user scope — interactive scope prompt removed, --scope flag retained

- **Date**: 2026-06-01
- **Status**: Accepted
- **Context**: devflow init interactively prompted user vs local/project install scope, adding unwanted friction since user scope is the intended default for interactive installs
- **Decision**: remove the interactive Installation scope prompt and hardcode interactive scope to user, while keeping the --scope CLI flag and non-TTY auto-detection unchanged so scripted and local installs (--scope local) continue to work
- **Consequences**: interactive users effectively always want user scope (~/.claude) so the prompt was noise
- **Source**: self-learning:obs_scopeu1

## ADR-011: Interactive plugin selection split into two sequential multiselects (workflow then language plugins); custom grid rejected

- **Date**: 2026-06-01
- **Status**: Accepted
- **Context**: the single interactive plugin multiselect conflated workflow/command plugins (plan, implement, code-review) with language/ecosystem plugins (typescript, react, go), making selection unclear
- **Decision**: present interactive plugin selection as two sequential @clack multiselects — Step 1 workflow plugins, Step 2 language plugins — partitioned by a pure partitionSelectablePlugins helper
- **Consequences**: clearer mental model and discoverability
- **Source**: self-learning:obs_plug2st

## ADR-012: .devflow/ knowledge artifacts must be committed to git as shared project-level data

- **Date**: 2026-06-02
- **Status**: Accepted
- **Context**: after PR #233 fixes were complete, the user clarified that .devflow/ knowledge artifacts are project-level shared data that should be committed and pushed with the branch
- **Decision**: .devflow/decisions/decisions.md, .devflow/decisions/pitfalls.md, .devflow/features/*/KNOWLEDGE.md, .devflow/docs/ design/review artifacts are committed to git and shared across all collaborators — they are the project knowledge base
- **Consequences**: decisions, pitfalls, and feature knowledge bases accumulate institutional knowledge about the project — committing them makes this knowledge available to all contributors and persists across developer machine changes
- **Source**: self-learning:obs_devd01x

## ADR-013: Preamble hook ambient mode redesigned: first-word keyword dispatch replaces three-marker structured-plan detection

- **Date**: 2026-06-02
- **Status**: Accepted
- **Context**: preamble UserPromptSubmit hook previously detected structured implementation plans (## Goal + ## Steps + ## Files markers) and injected a directive
- **Decision**: add first-word keyword dispatch as the primary detection path — if the first word of a prompt is implement/explore/research/debug/plan (any case) followed by at least one additional word and the prompt does not end in ?, inject a directive to invoke the matching devflow:<keyword> skill via the Skill tool; the three-marker structured-plan detection (## Goal + ## Steps + ## Files) is retained as a coexisting elif fallback path that fires only when the keyword path does not match
- **Consequences**: simpler UX (users type natural commands like implement fix the login bug instead of constructing a structured plan), broader coverage (five keywords instead of one structured-plan path), and the two detection paths coexist — keyword dispatch takes precedence, structured-plan detection remains available as a fallback
- **Source**: self-learning:obs_preamble1

## ADR-014: Preamble hook test plan must cover four independent suites: functionality truth table, JSON API contract, security fuzz for prompt injection, and performance bounded by methodology

- **Date**: 2026-06-02
- **Status**: Accepted
- **Context**: preamble hook test plan design after ambient mode keyword-dispatch redesign
- **Decision**: test the preamble hook with four independent suites — (1) functionality truth table (prompt→expected output for all keyword variants, case permutations, non-matching inputs, boundary cases), (2) API contract (JSON schema assertions on hookSpecificOutput and hookEventName keys, zero-byte output on no-match, exit-0 on all paths, file-I/O snapshot, bash-4-construct guard), (3) security/fuzz (hostile prompt tails including backticks, command substitution, IFS injection, 200KB payload — assert output equals fixed template proving no user text leaks into the directive), (4) performance (length-independence methodology: compare 1KB vs 200KB payload, assert bounded delta/ratio — no absolute ms assertions, plus static no-subprocess check)
- **Consequences**: the four suites map directly to the four risk dimensions of the hook — correctness, API stability, security injection, and performance predictability
- **Source**: self-learning:obs_preamble2
