# Devflow Development Guide

Instructions for developers and AI agents working on Devflow. For user docs, see README.md.

## Purpose

Devflow enhances Claude Code with intelligent development workflows. Modifications must:
- Maintain brutal honesty in review outputs (no sycophancy)
- Preserve context across sessions
- Enhance developer empowerment without replacing judgment
- Ensure all commands are self-documenting

## Architecture Overview

Plugin marketplace with 21 plugins (12 core + 9 optional language/ecosystem), each following the Claude plugins format (`.claude-plugin/plugin.json`, `commands/`, `agents/`, `skills/`).

| Plugin | Purpose | Teams Variant |
|--------|---------|---------------|
| `devflow-implement` | Complete task implementation lifecycle | Optional |
| `devflow-plan` | Unified design planning with gap analysis | Optional |
| `devflow-code-review` | Comprehensive code review | Optional |
| `devflow-resolve` | Review issue resolution | Optional |
| `devflow-debug` | Competing hypothesis debugging | Optional |
| `devflow-explore` | Codebase exploration with knowledge base creation | Optional |
| `devflow-research` | Multi-type research with trust-aware synthesis | Optional |
| `devflow-release` | Adaptive project release with learned configuration | Optional |
| `devflow-self-review` | Self-review (Simplifier + Scrutinizer) | No |
| `devflow-bug-analysis` | Proactive bug finding with static and semantic analysis | No |
| `devflow-ambient` | Ambient mode — plan auto-detection | No |
| `devflow-core-skills` | Auto-activating quality enforcement | No |
| `devflow-audit-claude` | Audit CLAUDE.md files (optional) | No |
| `devflow-typescript` | TypeScript language patterns (optional) | No |
| `devflow-react` | React framework patterns (optional) | No |
| `devflow-accessibility` | Web accessibility patterns (optional) | No |
| `devflow-ui-design` | UI design patterns (optional) | No |
| `devflow-go` | Go language patterns (optional) | No |
| `devflow-python` | Python language patterns (optional) | No |
| `devflow-java` | Java language patterns (optional) | No |
| `devflow-rust` | Rust language patterns (optional) | No |

Commands with Teams Variant ship as `{name}.md` (parallel subagents) and `{name}-teams.md` (Agent Teams with debate). The installer copies the chosen variant based on `--teams`/`--no-teams` flag.

**Build-time asset distribution**: Skills and agents are stored once in `shared/skills/` and `shared/agents/`, then copied to each plugin at build time based on `plugin.json` manifests. This eliminates duplication in git.

**LLM-vs-plumbing principle**: The LLM does all detection, semantic matching, materialization, and curation. Deterministic code is plumbing only: hooks, locks, throttles, file I/O, id-keyed JSONL records, `decisions-append` numbering, and `merge-observation` writes. No detection or judgment logic lives in shell or TypeScript.

**Working Memory**: Three shell-script hooks (`scripts/hooks/`) replace the old 8-hook system with a background-maintenance (Dream) architecture. Toggleable via `devflow memory --enable/--disable/--status` or `devflow init --memory/--no-memory`. Feature state is stored in `.devflow/dream/config.json` (primary source of truth); runtime sentinel `.devflow/memory/.working-memory-disabled` provides defense-in-depth. `dream-capture` (Stop hook) — captures user/assistant turns to `.devflow/memory/.pending-turns.jsonl` queue; after the 120s throttle (keyed by `.working-memory-last-trigger` mtime), spawns `background-memory-update` as a detached `nohup` worker (`claude -p --model haiku`); touches `.working-memory-last-trigger` BEFORE spawning to prevent double-spawn; uses mkdir-based locking for queue overflow truncation across concurrent sessions. `background-memory-update` (Stop-hook worker, not a hook itself) — drains `.pending-turns.jsonl`, calls `claude -p` (prompt on stdin, never argv), rewrites `WORKING-MEMORY.md` with `<!-- memory-head: <sha> branch: <name> -->` on line 1, touches `.last-refresh-ok` on success; holds a 300s-stale worker lock; user-only queue truncated without LLM run. `dream-dispatch` (UserPromptSubmit hook) — **capture-only**: appends the user turn to `.pending-turns.jsonl`; it does NOT emit any directive. `dream-evaluate` (SessionEnd hook) — orchestrator that sources `eval-helpers` + 3 feature modules (`eval-decisions`, `eval-knowledge`, `eval-curation`) after shared setup; each module uses `${VAR:?}` fail-fast guards and `_MODULENAME_` variable prefixes for namespace isolation; evaluates whether to write decisions, knowledge, or curation dream markers; writes per-session marker files using atomic temp+mv; uses mkdir-based locking (`dream-lock`) to serialize operations across concurrent sessions. Always-on SessionStart hook (`session-start-context`) — recovers stale `.processing` markers (via `dream-recover` → `dream_recover_stale`), collects pending markers (via `dream-collect-tasks`), and emits a **DREAM MAINTENANCE** directive instructing the main model to spawn background `Dream` agents; directive emission is throttled to 120s. `dream-collect-tasks` unconditionally deletes orphaned `learning.*` AND `memory.*` markers (both pipelines removed from Dream subagent). The Dream agent processes decisions/knowledge/curation only — memory is NOT a Dream task. SessionStart hook (`session-start-memory`) → injects previous memory with git-reconciled header (3-state: A in-sync / B drifted / C refresh-failing) + optional pre-compact snapshot as `additionalContext`; stamp `<!-- memory-head: <sha> branch: <name> -->` on line 1 drives drift detection; no raw-turns dump. PreCompact hook → saves git state + WORKING-MEMORY.md snapshot. Memory sections: `## Now`, `## Progress`, `## Decisions`, `## Context`, `## Session Log`. The background-memory-update worker uses rename-to-claim for queue consumption (atomically renames `.pending-turns.jsonl` → `.pending-turns.processing`). Disabling memory writes `memory: false` to dream config — hooks remain registered (shared across features). `removeMemoryHooks` (used by `devflow init --no-memory`) also removes pre-dream legacy hooks. Use `devflow memory --clear` to clean up pending queue files across projects. Zero-ceremony context preservation.

**Ambient Mode**: Single-component system for zero-overhead session enhancement. UserPromptSubmit hook (`preamble`) uses two coexisting detection paths, both controlled by the same single toggle (`devflow ambient --enable/--disable/--status` or `devflow init`). **First-word keyword detection** — when a prompt's first word (case-insensitive) is one of `implement`, `explore`, `research`, `debug`, or `plan`, followed by at least one additional word, the hook outputs a directive instructing the model to briefly announce the workflow then invoke the matching `devflow:<keyword>` skill via the Skill tool. **3-marker plan detection** — when a prompt contains `## Goal`, `## Steps`, and `## Files` markers (and the keyword path did not fire), it outputs a directive to invoke `devflow:implement`. Zero overhead for normal prompts — hook outputs nothing. Any legacy `commands.md` rule left by prior installs is auto-removed on every `devflow ambient --enable/--disable` or `devflow init`.

**Decisions pipeline** (`eval-decisions` SessionEnd module → `decisions.{session_id}.json` marker → Dream agent): The `eval-decisions` module runs every session, extracts DIALOG_PAIRS from the transcript, and writes a decisions marker. At SessionStart the Dream agent claims the marker, detects **decision** and **pitfall** observation types via LLM analysis of the dialog pairs, and materializes entries via `decisions-append` (internally self-locks `.decisions.lock`; assigns ADR-NNN/PF-NNN numbers, writes TL;DR + `- **Source**:` marker). Observations accumulate in `.devflow/decisions/decisions-log.jsonl`. No deterministic thresholds or confidence formulas — the LLM determines whether an observation warrants a new entry or should be merged with an existing one. Global config: `~/.devflow/decisions.json`. Project config: `.devflow/decisions/decisions.json`. Runtime sentinel: `.devflow/decisions/.disabled` — the decisions sections in `session-start-context` skip if present; `devflow decisions --enable` removes it, `devflow decisions --disable` creates it. Toggleable via `devflow decisions --enable/--disable/--status` or `devflow init --decisions/--no-decisions`. Management subcommands: `devflow decisions list`, `devflow decisions --configure`, `devflow decisions --clear/--reset`.

Debug logs stored at `~/.devflow/logs/{project-slug}/`.

**Debug Tracing**: Single global toggle covering all hooks. Enabled via `devflow debug --enable/--disable/--status` CLI or by setting `DEVFLOW_HOOK_DEBUG=1` in `~/.claude/settings.json` env block (survives reinstalls). All hooks share the `scripts/hooks/debug-trace` helper script (sourced via `hook-bootstrap`) so tracing behavior is consistent and updated in one place. Two-phase logging: pre-CWD traces go to global `~/.devflow/logs/.hook-debug.log`; post-CWD traces go to per-project `~/.devflow/logs/{project-slug}/.hook-debug.log`. A 5MB size guard prevents unbounded growth. applies ADR-007

**Claude Code Flags**: Typed registry (`src/cli/utils/flags.ts`) for managing Claude Code feature flags (env vars and top-level settings). Pure functions `applyFlags`/`stripFlags`/`getDefaultFlags` follow the `applyTeamsConfig`/`stripTeamsConfig` pattern. Flags (17 total): default ON — `tui`, `tool-search`, `lsp`, `prompt-caching-1h`, `show-turn-duration`, `clear-context-on-plan`; default OFF — `brief`, `thinking-summaries`, `subprocess-env-scrub`, `disable-nonessential-traffic`, `forked-subagents`, `disable-adaptive-thinking`, `always-thinking`, `disable-git-instructions`, `disable-compact`, `disable-1m-context`, `disable-autoupdater`. Manageable via `devflow flags --enable/--disable/--status/--list`. Stored in manifest `features.flags: string[]`. View mode (`default`/`verbose`/`focus`) stored in manifest `features.viewMode?: string` and applied to `settings.json` as the `viewMode` key; `applyViewMode`/`stripViewMode` utilities colocated in `flags.ts`.

**Feature Knowledge Bases**: Per-feature `.devflow/features/` directory containing KNOWLEDGE.md files that capture area-specific patterns, conventions, architecture, and gotchas. Knowledge bases are created as side-effects of implementation (`/implement` Phase 12), loaded automatically across all workflows via `FEATURE_KNOWLEDGE` variable (companion to `DECISIONS_CONTEXT`), and use staleness detection via git log against `referencedFiles`. Index at `.devflow/features/index.json` (object keyed by slug). Managed via `devflow knowledge list|create|check|refresh|remove`. Knowledge agent (sonnet) structures exploration outputs into KNOWLEDGE.md. `apply-feature-knowledge` skill provides consumption algorithm for agents. `.devflow/features/.knowledge.lock` is gitignored (transient lock directory for concurrent index writes, added automatically by `devflow init`). `devflow knowledge list` — List all feature knowledge bases with staleness status. `devflow knowledge create <slug>` — Create a new knowledge base via claude -p exploration. `devflow knowledge check` — Check all knowledge bases for staleness. `devflow knowledge refresh [slug]` — Refresh stale knowledge base(s). `devflow knowledge remove <slug>` — Remove a knowledge base and its index entry. Note: `/debug` keeps FEATURE_KNOWLEDGE orchestrator-local (investigation workers examine code without pre-loaded context). Toggleable via `devflow knowledge --enable/--disable/--status` or `devflow init --knowledge/--no-knowledge`. SessionEnd hook auto-refreshes stale knowledge bases (throttled to once per 2 hours, max 3 per run). `.devflow/features/.disabled` sentinel gates Phase 12 generation and refresh hook.

**Rules**: Ultra-concise, always-on engineering principle files (~10-15 lines each) installed to `~/.claude/rules/devflow/` as flat `.md` files. Claude Code loads them automatically on every prompt — no hooks required — filling the guidance gap for quick edits that don't trigger a full skill pipeline. Rules flow through the same four-stage pipeline as skills: authored in `shared/rules/`, distributed to `plugins/*/rules/` at build time, installed (or shadowed) at runtime, and activated automatically. Unlike skills (which install universally from all plugins), rules are **plugin-scoped**: only rules belonging to selected plugins are installed. This keeps core rules (`security`, `engineering`, `quality`, `reliability` from `devflow-core-skills`) always present, and language/ecosystem rules (`typescript`, `react`, `go`, etc.) present only when the user has that plugin installed. Shadow overrides: `~/.devflow/rules/{name}.md` overrides the Devflow source. Toggleable via `devflow rules --enable/--disable/--status/--list` or `devflow init --rules/--no-rules`. Stored in manifest `features.rules: boolean` (self-heals to `true` on old manifests). Currently 12 rules: 4 core + 8 language/UI. `paths: []` YAML frontmatter must remain — it signals Claude Code to apply the rule globally.

**Two independent background pipelines** (both toggleable separately):
- `devflow decisions --enable/--disable` — Decisions pipeline (decision + pitfall detection, materialized by Dream agent from DIALOG_PAIRS)
- `devflow knowledge --enable/--disable` — Feature knowledge bases (codebase area exploration)

**Two-Mode Init**: `devflow init` offers Recommended (sensible defaults, quick setup) or Advanced (full interactive flow) after plugin selection. `--recommended` / `--advanced` CLI flags for non-interactive use. Recommended applies: ambient ON, memory ON, decisions ON, rules ON, HUD ON, teams OFF, default-ON flags, .claudeignore ON, auto-install safe-delete if trash CLI detected, user-mode security deny list, viewMode preserved from existing settings.json. Advanced path adds a view mode selector (default/verbose/focus) after Claude Code flags. Use `--decisions/--no-decisions` to toggle the decisions agent independently. Use `--rules/--no-rules` to toggle rules independently.

**Migrations**: Run-once migrations execute automatically on `devflow init`, tracked at `~/.devflow/migrations.json` (scope-independent; single file regardless of user-scope vs local-scope installs). Registry: append an entry to `MIGRATIONS` in `src/cli/utils/migrations.ts`. Scopes: `global` (runs once per machine, no project context) vs `per-project` (sweeps all discovered Claude-enabled projects in parallel). Failures are non-fatal — migrations retry on next init. Currently registered per-project migrations include `purge-legacy-knowledge-v2` (removes 4 hardcoded pre-v2 ADR/PF IDs and orphan `PROJECT-PATTERNS.md`), `purge-legacy-knowledge-v3` (v3: sweeps all remaining pre-v2 seeded entries using the `- **Source**: self-learning:` format discriminator — any ADR/PF section lacking this marker is removed; entries the user edited to include the marker survive), `purge-orphaned-sidecar-judgment-state` (per-project; removes orphaned `.learning-manifest.json`, `.decisions-manifest.json`, `.decisions-notifications.json` — judgment-state files written by the now-removed deterministic render/reconcile layer), `purge-learning-pipeline-v1` (per-project; removes `.devflow/learning/` directory, learning dream markers, `learning` key from dream/sidecar config, `.claude/commands/self-learning/`, and auto-generated skills), `purge-stale-memory-markers-v1` (per-project; removes stale `dream/memory.*` markers left by the old Dream-subagent memory pipeline now that `background-memory-update` handles memory refresh — ENOENT-idempotent, rethrows non-ENOENT errors). Global migration `purge-learning-global-v1` removes `~/.devflow/learning.json`. **D37 edge case**: a project cloned *after* migrations have run won't be swept (the marker is global, not per-project). Recovery: `rm ~/.devflow/migrations.json` forces a re-sweep on next `devflow init`.

## Project Structure

```
devflow/
├── shared/skills/          # 45 skills (single source of truth)
├── shared/agents/          # 16 shared agents (single source of truth)
├── shared/rules/           # 12 rules (single source of truth; flat .md files)
├── plugins/devflow-*/      # 21 plugins (12 core + 9 optional language/ecosystem)
├── docs/reference/         # Detailed reference documentation
├── scripts/                # Helper scripts (statusline, docs-helpers)
│   └── hooks/              # Dream + ambient + memory hooks (dream-capture, dream-dispatch [capture-only], background-memory-update [Stop-hook worker], dream-recover, dream-collect-tasks, dream-evaluate, dream-lock, session-start-memory, session-start-context, pre-compact-memory, preamble, get-mtime, hook-bootstrap, hook-log-init, eval-helpers, eval-decisions, eval-knowledge, eval-curation)
├── src/cli/                # TypeScript CLI (init, list, uninstall, ambient, decisions, flags, knowledge, rules, debug)
├── .claude-plugin/         # Marketplace registry
├── .devflow/               # All per-project runtime data (docs, memory, decisions, features)
│   ├── docs/               # Project docs (reviews, design)
│   ├── memory/             # Working memory files
│   ├── dream/              # Dream marker files
│   ├── decisions/          # Decisions agent observations and ADR/PF files
│   └── features/           # Per-feature knowledge bases (committed to git)
├── .release/               # Release configuration (lazy-init)
│   ├── RELEASE-FLOW.md     # Learned release process config
│   ├── .gitignore          # Excludes .progress.json, .lock/
│   └── .progress.json      # Mid-release checkpoint (transient)
```

**Install paths**: Commands → `~/.claude/commands/devflow/`, Agents → `~/.claude/agents/devflow/`, Skills → `~/.claude/skills/devflow:*/` (namespaced), Rules → `~/.claude/rules/devflow/` (flat, plugin-scoped), Scripts → `~/.devflow/scripts/`

## Development Loop

```bash
# 1. Edit source files
vim plugins/devflow-code-review/commands/code-review.md  # Commands/agents in plugins
vim shared/skills/security/SKILL.md   # Skills in shared/

# 2. Build (compiles CLI + distributes skills/agents to plugins)
npm run build

# 3. Reinstall to global context
node dist/cli.js init                       # All plugins
node dist/cli.js init --plugin=code-review       # Single plugin

# 4. Test immediately
/code-review
```

**Build commands**: `npm run build` (full), `npm run build:cli` (TypeScript only), `npm run build:plugins` (skill/agent distribution only)

## Documentation Artifacts

All generated docs live under `.devflow/docs/` in the project root:

```
.devflow/docs/
├── reviews/{branch-slug}/              # Review reports per branch
│   ├── .last-review-head              # HEAD SHA for incremental reviews
│   └── {timestamp}/                   # Timestamped review directory
│       ├── {focus}.md                 # Reviewer reports (security.md, etc.)
│       ├── review-summary.md          # Synthesizer output
│       └── resolution-summary.md      # Written by /resolve
├── bug-analysis/{branch-slug}/         # Bug analysis reports per branch
│   ├── .last-analysis-head            # HEAD SHA for incremental analysis
│   └── {timestamp}/                   # Timestamped analysis directory
│       ├── {focus}.md                 # Analyzer reports (security.md, functional.md, etc.)
│       ├── static-findings.md         # Raw static analysis tool output
│       ├── bug-analysis-summary.md    # Synthesizer output
│       └── resolution-summary.md      # Written by /resolve (when resolving bug-analysis issues)
├── design/                            # Design artifacts from /plan
└── research/{topic-slug}/             # Research artifacts per topic
    └── {YYYY-MM-DD_HHMM}/            # Timestamped research directory
        ├── {type}.md                  # Researcher outputs (codebase.md, external.md, etc.)
        └── research-summary.md        # Synthesizer output
```

Per-project runtime files live under `.devflow/`:

```
.devflow/
├── memory/
│   ├── WORKING-MEMORY.md             # Auto-maintained by background-memory-update worker (claude -p haiku)
│   ├── backup.json                   # Pre-compact git state snapshot
│   ├── .working-memory-disabled      # Runtime sentinel — memory hooks skip when present
│   ├── .pending-turns.jsonl          # Queue of captured user/assistant turns (JSONL, ephemeral)
│   ├── .pending-turns.processing     # Atomic handoff during background processing (transient, D56c)
│   ├── .working-memory-last-trigger  # Mtime = last worker spawn time (120s throttle key, transient)
│   ├── .last-refresh-ok              # Mtime = last successful WORKING-MEMORY.md write (transient)
│   └── .working-memory.lock/         # Worker lock dir — 300s stale-break (transient, never tracked)
├── dream/                        # Dream state: config.json (feature toggles), per-session markers (decisions.{session}.json, knowledge.{session}.json, curation.{session}.json), .processor-spawned-at (120s spawn throttle), .curation-last (7-day curation throttle)
├── decisions/
│   ├── decisions-log.jsonl       # Decision/pitfall observations (JSONL, one entry per line)
│   ├── decisions.json            # Project-level decisions agent config (max runs, throttle, model, debug)
│   ├── .decisions-runs-today     # Daily run counter for decisions agent (date + count)
│   ├── .decisions.lock           # Lock directory for decisions-append writers (transient)
│   ├── .decisions-usage.json     # Citation counts written by decisions-usage-scan.cjs Stop hook
│   ├── decisions.md              # Architectural decisions (ADR-NNN, append-only) — written by Dream agent via decisions-append
│   ├── pitfalls.md               # Known pitfalls (PF-NNN, area-specific gotchas) — written by Dream agent via decisions-append
│   └── .disabled                 # Runtime sentinel — decisions sections in session-start-context skip if present
└── features/                     # Per-feature knowledge bases (committed to git)
    ├── {slug}/KNOWLEDGE.md
    ├── index.json
    ├── .disabled                 # Sentinel — gates Phase 12 generation and refresh hook
    ├── .knowledge.lock           # Transient lock directory for concurrent index writes (gitignored)
    └── .knowledge-last-refresh   # Epoch timestamp of last auto-refresh

~/.devflow/logs/{project-slug}/
├── .dream-capture.log                 # dream-capture (Stop hook) log
└── .background-memory-update.log      # background-memory-update worker log
```

**Naming conventions**: Timestamps as `YYYY-MM-DD_HHMM`, branch slugs replace `/` with `-`, topic slugs are lowercase-dashes.

**Persisting agents**: Reviewer → `.devflow/docs/reviews/{branch-slug}/{timestamp}/{focus}.md`, Synthesizer → `.devflow/docs/reviews/{branch-slug}/{timestamp}/review-summary.md` (review mode) / `.devflow/docs/research/{topic-slug}/{timestamp}/research-summary.md` (research mode) / `.devflow/docs/bug-analysis/{branch-slug}/{timestamp}/bug-analysis-summary.md` (bug-analysis mode), Researcher → `.devflow/docs/research/{topic-slug}/{timestamp}/{type}.md`, BugAnalyzer → `.devflow/docs/bug-analysis/{branch-slug}/{timestamp}/{focus}.md`, Resolver → `.devflow/docs/reviews/{branch-slug}/{timestamp}/resolution-summary.md` (review mode) / `.devflow/docs/bug-analysis/{branch-slug}/{timestamp}/resolution-summary.md` (bug-analysis mode), Working Memory → `.devflow/memory/WORKING-MEMORY.md` (automatic)

**Incremental Reviews**: `/code-review` writes reports into timestamped subdirectories (`YYYY-MM-DD_HHMM`) and tracks HEAD SHA in `.last-review-head` for incremental diffs. Second review only diffs from last reviewed commit. `/bug-analysis` has an analogous mechanism: it tracks HEAD SHA in `.last-analysis-head` and only analyzes commits since the last analysis run. `/resolve` defaults to the latest timestamped directory in whichever doc path (reviews or bug-analysis) matches the current workflow. `/code-review` auto-discovers git worktrees and processes all reviewable branches in parallel. `/bug-analysis` operates on the current branch only (single-worktree). Multi-cycle convergence detection: loads the prior `resolution-summary.md` as `PRIOR_RESOLUTIONS` so reviewers avoid re-raising resolved false positives; at cycle 3+ the FP ratio is computed and a warning is emitted when it exceeds 70% (suggesting merge or manual inspection). At MAX_REVIEW_CYCLES (10) a warning is emitted but the pipeline continues — convergence info is surfaced in the Synthesizer's Convergence Status section, never blocking.

**Coder Handoff Artifact**: Sequential Coder phases write `.devflow/docs/handoff-{branch_slug}.md` after each phase (branch-scoped to prevent concurrent session clobber). Survives context compaction (unlike PRIOR_PHASE_SUMMARY). Every Coder reads it via HANDOFF_FILE input. Deleted by `/implement` command after pipeline completes.

**Universal Skill Installation**: All skills from all plugins are always installed, regardless of plugin selection. Skills are tiny markdown files installed as `~/.claude/skills/devflow:{name}/` (namespaced to avoid collisions with other plugin ecosystems). Source directories in `shared/skills/` stay unprefixed — the `devflow:` prefix is applied at install-time only. Shadow overrides live at `~/.devflow/skills/{name}/` (unprefixed); when shadowed, the installer copies the user's version to the prefixed install target. Only commands and agents remain plugin-specific.

**Model Strategy**: Explicit model assignments in agent frontmatter override the user's session model. Opus for analysis agents (reviewer, scrutinizer, evaluator, designer, researcher, bug-analyzer), Sonnet for execution agents (coder, simplifier, resolver, skimmer, tester), Haiku for I/O agents (git, synthesizer, validator). Dream uses per-task overrides via `session-start-context`: sonnet for knowledge, opus for decisions/curation (the latter two share one combined opus spawn). Memory is no longer a Dream task — `WORKING-MEMORY.md` is refreshed by the detached `background-memory-update` worker (`claude -p --model haiku`) spawned by `dream-capture`.

## Agent & Command Roster

**Orchestration commands** (spawn agents, never do agent work in main session):
- `/plan` — Skimmer + Explore + Designer + Synthesizer + Plan + Designer → design artifact; consumes decisions via index + on-demand Read via `devflow:apply-decisions`
- `/implement` — Git + Coder + Validator + Simplifier + Scrutinizer + Evaluator + Tester → PR (accepts plan documents, issues, or task descriptions)
- `/code-review` — 8-12 Reviewer agents + Git + Synthesizer; consumes decisions via index + on-demand Read via `devflow:apply-decisions`
- `/resolve` — N Resolver agents + Git; loads compact decisions index (`decisions-index.cjs index`) per worktree and passes it as `DECISIONS_CONTEXT` to each Resolver; Resolvers use `devflow:apply-decisions` to Read full bodies on demand; aggregates cited ADR-NNN/PF-NNN IDs into a `## Decisions Citations` section at the top of `resolution-summary.md`
- `/explore` — Skimmer + Explore + Synthesizer + Knowledge (optional knowledge base creation)
- `/debug` — Agent Teams competing hypotheses
- `/self-review` — Simplifier then Scrutinizer (sequential); consumes decisions via index + on-demand Read via `devflow:apply-decisions`
- `/research` — Researcher agents + Skimmer + Synthesizer + Knowledge; multi-type research with trust-aware synthesis
- `/release` — Git agent + Validator + Synthesizer; adaptive release with learned configuration
- `/bug-analysis` — BugAnalyzer agents + Git + Synthesizer; proactive bug finding with static and semantic analysis, incremental by default
- `/audit-claude` — CLAUDE.md audit (optional plugin)

**Shared agents** (16): git, synthesizer, skimmer, simplifier, coder, reviewer, resolver, evaluator, tester, scrutinizer, validator, designer, knowledge, researcher, bug-analyzer, dream

**Plugin-specific agents** (1): claude-md-auditor

**Agent Teams**: 8 commands use Agent Teams (`/code-review`, `/implement`, `/plan`, `/explore`, `/debug`, `/resolve`, `/research`, `/release`). One-team-per-session constraint — must TeamDelete before creating next team.

## Key Conventions

### Skills

- 3-tier system: Foundation (shared patterns), Specialized (auto-activate), Domain (language/framework)
- Each skill has one non-negotiable **Iron Law** in its `SKILL.md`
- Target: ~120-150 lines per SKILL.md with progressive disclosure to `references/`
- Skills default to read-only (`allowed-tools: Read, Grep, Glob`); exceptions: git/review skills add `Bash`, interactive skills add `AskUserQuestion`, `quality-gates` adds `Write` for state persistence
- All skills live in `shared/skills/` — add to plugin `plugin.json` `skills` array, then `npm run build`

### Agents

- Target: 50-150 lines depending on type (Utility 50-80, Worker 80-120)
- Reference skills via frontmatter, don't duplicate skill content
- Use `tools` frontmatter to platform-restrict agent tool access (prefer over prompt-level prohibitions)
- Define clear input/output contracts and escalation boundaries
- Shared agents live in `shared/agents/` — add to plugin `plugin.json` `agents` array

### Commands

- Commands are orchestration-only — spawn agents, never do agent work in main session
- Create in `plugins/devflow-{plugin}/commands/`
- Register new plugins in `DEVFLOW_PLUGINS` in `src/cli/plugins.ts`

### Commits

Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`

## Critical Rules

### Git Safety
- Run git commands sequentially, never in parallel
- Never force push without explicit user request

### Build System
- `shared/skills/`, `shared/agents/`, and `shared/rules/` are the single source of truth
- Generated copies in `plugins/*/skills/`, `plugins/*/rules/`, and shared agent files are gitignored
- Always run `npm run build` after modifying shared assets
- Plugin manifests (`plugin.json`) declare `skills`, `agents`, and `rules` arrays
- Rules are flat `.md` files (no subdirectory nesting), distributed from `shared/rules/{name}.md` → `plugins/{plugin}/rules/{name}.md`; build fails if a declared rule is missing from `shared/rules/`
- Every `-teams.md` command variant **must** have a matching base `.md` file — the installer iterates base files and looks up teams variants, so orphaned `-teams.md` files are silently skipped

### Token Optimization
- Sub-agents cannot invoke other sub-agents (by design)
- Use parallel execution where possible
- Leverage `.claudeignore` for context reduction

## Reference Documents

For detailed specifications beyond this overview:

- **Skills architecture**: `docs/reference/skills-architecture.md` — tier catalog, templates, creation guide, activation patterns
- **Agent design**: `docs/reference/agent-design.md` — templates, anti-patterns, quality checklist
- **Adding commands**: `docs/reference/adding-commands.md` — command template, plugin registration
- **Release process**: `docs/reference/release-process.md` — CI-driven one-click releases via GitHub Actions `workflow_dispatch`
- **File organization**: `docs/reference/file-organization.md` — source tree, build distribution, install paths, settings
- **Docs framework skill**: `shared/skills/docs-framework/SKILL.md` — documentation naming conventions and templates
