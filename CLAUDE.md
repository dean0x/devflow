# Devflow Development Guide

Instructions for developers and AI agents working on Devflow. For user docs, see README.md.

## Purpose

Devflow enhances Claude Code with intelligent development workflows. Modifications must:
- Maintain brutal honesty in review outputs (no sycophancy)
- Preserve context across sessions
- Enhance developer empowerment without replacing judgment
- Ensure all commands are self-documenting

## Architecture Overview

Plugin marketplace with 20 plugins (11 core + 9 optional language/ecosystem), each following the Claude plugins format (`.claude-plugin/plugin.json`, `commands/`, `agents/`, `skills/`).

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
| `devflow-ambient` | Ambient mode — three-tier intent classification (QUICK/GUIDED/ORCHESTRATED) | No |
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

**Working Memory**: Four shell-script hooks (`scripts/hooks/`) provide automatic session continuity. Toggleable via `devflow memory --enable/--disable/--status` or `devflow init --memory/--no-memory`. UserPromptSubmit (`prompt-capture-memory`) captures user prompt to `.memory/.pending-turns.jsonl` queue. Stop hook captures `response_text` (on `end_turn` only) to same queue, then spawns throttled background `claude -p --model haiku` updater (skips if triggered <2min ago; concurrent sessions serialize via mkdir-based lock). Background updater uses `mv`-based atomic handoff to process all pending turns in batch (capped at 10 most recent), with crash recovery via `.pending-turns.processing` file. Updates `.memory/WORKING-MEMORY.md` with structured sections (`## Now`, `## Progress`, `## Decisions`, `## Modified Files`, `## Context`, `## Session Log`). SessionStart hook → injects previous memory + git state as `additionalContext` on `/clear`, startup, or compact (warns if >1h stale; injects pre-compact memory snapshot when compaction happened mid-session). PreCompact hook → saves git state + WORKING-MEMORY.md snapshot + bootstraps minimal WORKING-MEMORY.md if none exists. Disabling memory removes all four hooks. Use `devflow memory --clear` to clean up pending queue files across projects. Zero-ceremony context preservation.

**Ambient Mode**: Three-layer architecture for always-on intent classification. SessionStart hook (`session-start-classification`) reads lean classification rules (`~/.claude/skills/devflow:router/classification-rules.md`, ~30 lines) and injects as `additionalContext` — once per session, deterministic, zero model overhead. UserPromptSubmit hook (`preamble`) injects a one-sentence prompt per message triggering classification + conditional router loading via Skill tool. Router SKILL.md is a pure dispatcher loaded on-demand only for GUIDED/ORCHESTRATED depth — maps intent + depth to a guided skill (short, focused, loads companion skills) or an orch skill (full agent pipeline, loads companion skills before first phase). Toggleable via `devflow ambient --enable/--disable/--status` or `devflow init`.

**Self-Learning**: Two independent agents detect patterns from session transcripts. Transcript content is split into two channels by `scripts/hooks/lib/transcript-filter.cjs`: `USER_SIGNALS` (plain user messages) and `DIALOG_PAIRS` (prior-assistant + user turns).

**Learning agent** (`session-end-learning` hook → `devflow learn --run-background`): Detects **workflow** and **procedural** observation types from `USER_SIGNALS`. Accumulates session IDs (batch_size=3 by default, 5 at 15+ observations) and triggers a background `claude -p --model sonnet` with `--output-format text`. Detection uses per-type linguistic markers and quality gates stored in each observation as `quality_ok`. Per-type thresholds govern promotion (workflow: 3 required; procedural: 4 required), each with independent temporal spread requirements. Observations accumulate in `.memory/learning-log.jsonl` (workflow/procedural only); lifecycle is `observing → ready → created → deprecated`. When thresholds are met, `json-helper.cjs render-ready` renders deterministically to slash commands (`.claude/commands/self-learning/`) and skills (`.claude/skills/{slug}/`). A session-start feedback reconciler (`json-helper.cjs reconcile-manifest`) checks the manifest at `.memory/.learning-manifest.json` (workflow/procedural artifacts) against the filesystem to detect deletions (applies 0.3× confidence penalty) and edits (ignored per D13). The reconciler also **self-heals** from render-ready crash-window states: when a decisions file contains an ADR/PF anchor that is absent from the manifest *and* the section carries the `- **Source**: self-learning:` marker, the heal scans the log for `status: 'ready'` observations matching by normalized pattern (exactly one match = upgrade to `status: 'created'` and reconstruct manifest entry; zero or multiple matches = silently skipped). The marker check excludes pre-v2 seeded entries from the heal path so they cannot be falsely paired with a current ready obs. Loaded artifacts are reinforced locally (no LLM) on each session end. Single toggle mechanism: hook presence in `settings.json` IS the enabled state — no `enabled` field in `learning.json`. Toggleable via `devflow learn --enable/--disable/--status` or `devflow init --learn/--no-learn`. Configurable model/throttle/caps/debug via `devflow learn --configure`. Use `devflow learn --reset` to remove all artifacts + log + transient state. Use `devflow learn --purge` to remove invalid observations. Use `devflow learn --review` to inspect observations needing attention (workflow/procedural flagged entries only — capacity review is in `devflow decisions --review`).

**Decisions agent** (`session-end-decisions` hook → `devflow decisions --run-background`): Detects **decision** and **pitfall** observation types from `DIALOG_PAIRS`. Runs every session (batch_size=1 — no accumulation). Uses `--output-format json --json-schema` for structured Claude output; the TypeScript CLI (`decisions-agent.ts`) parses the structured JSON envelope and serializes multi-field observations into semicolon-delimited `details` strings (D10). Decision/pitfall promotion threshold is 1 (lower than learning agent — each dialog pair is already pre-filtered for signal). Decision/pitfall observations promote to `ready` on first creation when `quality_ok=true` (confidence=0.95 ≥ promote threshold=0.65, spread=0 — immediate). Observations accumulate in `.memory/decisions-log.jsonl`; renders to decisions.md ADR entries and pitfalls.md PF entries via `json-helper.cjs render-ready`. Manifest tracked at `.memory/.decisions-manifest.json`. No artifact reinforcement (decisions don't decay). Global config: `~/.devflow/decisions.json`. Project config: `.memory/decisions.json`. Toggleable via `devflow decisions --enable/--disable/--status` or `devflow init --decisions/--no-decisions`. Management subcommands: `devflow decisions list`, `devflow decisions --configure`, `devflow decisions --purge/--review/--clear/--reset/--dismiss-capacity`. `devflow decisions --review` offers two modes: **observations** (stale/missing/capacity-flagged entries) and **capacity** (deprecate least-used decisions/pitfalls entries by cites count, with 7-day protection window).

Debug logs stored at `~/.devflow/logs/{project-slug}/`.

**Claude Code Flags**: Typed registry (`src/cli/utils/flags.ts`) for managing Claude Code feature flags (env vars and top-level settings). Pure functions `applyFlags`/`stripFlags`/`getDefaultFlags` follow the `applyTeamsConfig`/`stripTeamsConfig` pattern. Flags (14 total): default ON — `tui`, `tool-search`, `lsp`, `prompt-caching-1h`, `show-turn-duration`, `clear-context-on-plan`; default OFF — `brief`, `thinking-summaries`, `subprocess-env-scrub`, `disable-nonessential-traffic`, `forked-subagents`, `disable-compact`, `disable-1m-context`, `disable-autoupdater`. Manageable via `devflow flags --enable/--disable/--status/--list`. Stored in manifest `features.flags: string[]`.

**Feature Knowledge Bases**: Per-feature `.features/` directory containing KNOWLEDGE.md files that capture area-specific patterns, conventions, architecture, and gotchas. Knowledge bases are created as side-effects of implementation (implement:orch Phase 8), loaded automatically across all workflows via `FEATURE_KNOWLEDGE` variable (companion to `DECISIONS_CONTEXT`), and use staleness detection via git log against `referencedFiles`. Index at `.features/index.json` (object keyed by slug). Managed via `devflow knowledge list|create|check|refresh|remove`. Knowledge agent (sonnet) structures exploration outputs into KNOWLEDGE.md. `apply-feature-knowledge` skill provides consumption algorithm for agents. `.features/.knowledge.lock` is gitignored (transient lock directory for concurrent index writes, added automatically by `devflow init`). `devflow knowledge list` — List all feature knowledge bases with staleness status. `devflow knowledge create <slug>` — Create a new knowledge base via claude -p exploration. `devflow knowledge check` — Check all knowledge bases for staleness. `devflow knowledge refresh [slug]` — Refresh stale knowledge base(s). `devflow knowledge remove <slug>` — Remove a knowledge base and its index entry. Note: debug:orch keeps FEATURE_KNOWLEDGE orchestrator-local (investigation workers examine code without pre-loaded context). Toggleable via `devflow knowledge --enable/--disable/--status` or `devflow init --knowledge/--no-knowledge`. SessionEnd hook auto-refreshes stale knowledge bases (throttled to once per 2 hours, max 3 per run). `.features/.disabled` sentinel gates Phase 8 generation and refresh hook.

**Rules**: Ultra-concise, always-on engineering principle files (~10-15 lines each) installed to `~/.claude/rules/devflow/` as flat `.md` files. Claude Code loads them automatically on every prompt — no hooks required — filling the guidance gap for quick edits that don't trigger a full skill pipeline. Rules flow through the same four-stage pipeline as skills: authored in `shared/rules/`, distributed to `plugins/*/rules/` at build time, installed (or shadowed) at runtime, and activated automatically. Unlike skills (which install universally from all plugins), rules are **plugin-scoped**: only rules belonging to selected plugins are installed. This keeps core rules (`security`, `engineering`, `quality`, `reliability` from `devflow-core-skills`) always present, and language/ecosystem rules (`typescript`, `react`, `go`, etc.) present only when the user has that plugin installed. Shadow overrides: `~/.devflow/rules/{name}.md` overrides the Devflow source. Toggleable via `devflow rules --enable/--disable/--status/--list` or `devflow init --rules/--no-rules`. Stored in manifest `features.rules: boolean` (self-heals to `true` on old manifests). Currently 12 rules: 4 core + 8 language/UI. `paths: []` YAML frontmatter must remain — it signals Claude Code to apply the rule globally.

**Three independent self-learning systems** (all toggleable separately):
- `devflow learn --enable/--disable` — Learning agent (workflow + procedural detection from USER_SIGNALS)
- `devflow decisions --enable/--disable` — Decisions agent (decision + pitfall detection from DIALOG_PAIRS)
- `devflow knowledge --enable/--disable` — Feature knowledge bases (codebase area exploration)

**Two-Mode Init**: `devflow init` offers Recommended (sensible defaults, quick setup) or Advanced (full interactive flow) after plugin selection. `--recommended` / `--advanced` CLI flags for non-interactive use. Recommended applies: ambient ON, memory ON, learn ON, decisions ON, rules ON, HUD ON, teams OFF, default-ON flags, .claudeignore ON, auto-install safe-delete if trash CLI detected, user-mode security deny list. Use `--decisions/--no-decisions` to toggle the decisions agent independently. Use `--rules/--no-rules` to toggle rules independently.

**Migrations**: Run-once migrations execute automatically on `devflow init`, tracked at `~/.devflow/migrations.json` (scope-independent; single file regardless of user-scope vs local-scope installs). Registry: append an entry to `MIGRATIONS` in `src/cli/utils/migrations.ts`. Scopes: `global` (runs once per machine, no project context) vs `per-project` (sweeps all discovered Claude-enabled projects in parallel). Failures are non-fatal — migrations retry on next init. Currently registered per-project migrations include `purge-legacy-knowledge-v2` (removes 4 hardcoded pre-v2 ADR/PF IDs and orphan `PROJECT-PATTERNS.md`) and `purge-legacy-knowledge-v3` (v3: sweeps all remaining pre-v2 seeded entries using the `- **Source**: self-learning:` format discriminator — any ADR/PF section lacking this marker is removed; entries the user edited to include the marker survive). **D37 edge case**: a project cloned *after* migrations have run won't be swept (the marker is global, not per-project). Recovery: `rm ~/.devflow/migrations.json` forces a re-sweep on next `devflow init`.

## Project Structure

```
devflow/
├── shared/skills/          # 58 skills (single source of truth)
├── shared/agents/          # 14 shared agents (single source of truth)
├── shared/rules/           # 12 rules (single source of truth; flat .md files)
├── plugins/devflow-*/      # 20 plugins (11 core + 9 optional language/ecosystem)
├── docs/reference/         # Detailed reference documentation
├── scripts/                # Helper scripts (statusline, docs-helpers)
│   └── hooks/              # Working Memory + ambient + learning hooks (prompt-capture-memory, stop-update-memory, background-memory-update, session-start-memory, session-start-classification, pre-compact-memory, preamble, session-end-learning, session-end-decisions, get-mtime, session-end-knowledge-refresh, background-knowledge-refresh)
├── src/cli/                # TypeScript CLI (init, list, uninstall, ambient, learn, decisions, flags, knowledge, rules)
├── .claude-plugin/         # Marketplace registry
├── .docs/                  # Project docs (reviews, design) — per-project
├── .features/              # Per-feature knowledge bases (committed to git)
├── .release/               # Release configuration (lazy-init)
│   ├── RELEASE-FLOW.md     # Learned release process config
│   ├── .gitignore          # Excludes .progress.json, .lock/
│   └── .progress.json      # Mid-release checkpoint (transient)
└── .memory/                # Working memory files — per-project
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

All generated docs live under `.docs/` in the project root:

```
.docs/
├── reviews/{branch-slug}/              # Review reports per branch
│   ├── .last-review-head              # HEAD SHA for incremental reviews
│   └── {timestamp}/                   # Timestamped review directory
│       ├── {focus}.md                 # Reviewer reports (security.md, etc.)
│       ├── review-summary.md          # Synthesizer output
│       └── resolution-summary.md      # Written by /resolve
├── design/                            # Design artifacts from /plan
└── research/{topic-slug}/             # Research artifacts per topic
    └── {YYYY-MM-DD_HHMM}/            # Timestamped research directory
        ├── {type}.md                  # Researcher outputs (codebase.md, external.md, etc.)
        └── research-summary.md        # Synthesizer output
```

Working memory files live in a dedicated `.memory/` directory:

```
.memory/
├── WORKING-MEMORY.md         # Auto-maintained by background updater (queue-based, updated in batch)
├── backup.json               # Pre-compact git state snapshot
├── learning-log.jsonl        # Learning observations (workflow/procedural only, JSONL, one entry per line)
├── learning.json             # Project-level learning agent config (max runs, throttle, model, debug — no enabled field)
├── decisions-log.jsonl       # Decision/pitfall observations (JSONL, one entry per line)
├── decisions.json            # Project-level decisions agent config (max runs, throttle, model, debug)
├── .learning-runs-today      # Daily run counter (date + count)
├── .learning-session-count   # Session IDs pending batch (one per line)
├── .learning-batch-ids       # Session IDs for current batch run
├── .learning-notified-at     # New artifact notification marker (epoch timestamp)
├── .learning-manifest.json   # Rendered artifact manifest (workflow/procedural artifacts) — reconciled at session-start
├── .decisions-manifest.json  # Rendered decisions artifact manifest — reconciled at session-start
├── .decisions-notifications.json # Decisions capacity notifications
├── .decisions-runs-today     # Daily run counter for decisions agent (date + count)
├── .decisions-batch-ids      # Session IDs for current decisions batch run
├── .decisions.lock           # Lock directory for decisions background agent (transient)
├── .pending-turns.jsonl      # Queue of captured user/assistant turns (JSONL, ephemeral)
├── .pending-turns.processing  # Atomic handoff during background processing (transient)
└── decisions/
    ├── decisions.md           # Architectural decisions (ADR-NNN, append-only) — written by decisions agent via render-ready
    └── pitfalls.md            # Known pitfalls (PF-NNN, area-specific gotchas) — written by decisions agent via render-ready

~/.devflow/logs/{project-slug}/
├── .learning-update.log      # Background learning agent log
├── .decisions-update.log     # Background decisions agent log
└── .working-memory-update.log # Background memory updater log
```

**Naming conventions**: Timestamps as `YYYY-MM-DD_HHMM`, branch slugs replace `/` with `-`, topic slugs are lowercase-dashes.

**Persisting agents**: Reviewer → `.docs/reviews/{branch-slug}/{timestamp}/{focus}.md`, Synthesizer → `.docs/reviews/{branch-slug}/{timestamp}/review-summary.md` (review mode) / `.docs/research/{topic-slug}/{timestamp}/research-summary.md` (research mode), Researcher → `.docs/research/{topic-slug}/{timestamp}/{type}.md`, Resolver → `.docs/reviews/{branch-slug}/{timestamp}/resolution-summary.md`, Working Memory → `.memory/WORKING-MEMORY.md` (automatic)

**Incremental Reviews**: `/code-review` writes reports into timestamped subdirectories (`YYYY-MM-DD_HHMM`) and tracks HEAD SHA in `.last-review-head` for incremental diffs. Second review only diffs from last reviewed commit. `/resolve` defaults to latest timestamped directory. Both commands auto-discover git worktrees and process all reviewable branches in parallel.

**Coder Handoff Artifact**: Sequential Coder phases write `.docs/handoff-{branch_slug}.md` after each phase (branch-scoped to prevent concurrent session clobber). Survives context compaction (unlike PRIOR_PHASE_SUMMARY). Every Coder reads it via HANDOFF_FILE input. Deleted by implement:orch orchestration skill after pipeline completes.

**Universal Skill Installation**: All skills from all plugins are always installed, regardless of plugin selection. Skills are tiny markdown files installed as `~/.claude/skills/devflow:{name}/` (namespaced to avoid collisions with other plugin ecosystems). Source directories in `shared/skills/` stay unprefixed — the `devflow:` prefix is applied at install-time only. Shadow overrides live at `~/.devflow/skills/{name}/` (unprefixed); when shadowed, the installer copies the user's version to the prefixed install target. Only commands and agents remain plugin-specific.

**Model Strategy**: Explicit model assignments in agent frontmatter override the user's session model. Opus for analysis agents (reviewer, scrutinizer, evaluator, designer, researcher), Sonnet for execution agents (coder, simplifier, resolver, skimmer, tester), Haiku for I/O agents (git, synthesizer, validator).

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
- `/audit-claude` — CLAUDE.md audit (optional plugin)

**Shared agents** (14): git, synthesizer, skimmer, simplifier, coder, reviewer, resolver, evaluator, tester, scrutinizer, validator, designer, knowledge, researcher

**Plugin-specific agents** (1): claude-md-auditor

**Workflow skills** (16): 9 orch skills (implement:orch, explore:orch, debug:orch, plan:orch, review:orch, resolve:orch, pipeline:orch, research:orch, release:orch) + 7 guided skills (implement:guided, debug:guided, explore:guided, plan:guided, review:guided, research:guided, release:guided). Router dispatches by intent + depth to either a guided or orch skill.

**Agent Teams**: 8 commands use Agent Teams (`/code-review`, `/implement`, `/plan`, `/explore`, `/debug`, `/resolve`, `/research`, `/release`). One-team-per-session constraint — must TeamDelete before creating next team.

## Key Conventions

### Skills

- 3-tier system: Foundation (shared patterns), Specialized (auto-activate), Domain (language/framework)
- Each skill has one non-negotiable **Iron Law** in its `SKILL.md`
- Target: ~120-150 lines per SKILL.md with progressive disclosure to `references/`
- Skills default to read-only (`allowed-tools: Read, Grep, Glob`); exceptions: git/review skills add `Bash`, interactive skills add `AskUserQuestion`, `quality-gates` adds `Write` for state persistence, and `router` omits `allowed-tools` entirely (unrestricted, as the main-session orchestrator)
- All skills live in `shared/skills/` — add to plugin `plugin.json` `skills` array, then `npm run build`
- Orchestration skills (`*:orch`) follow the Phase Protocol (defined in `router/SKILL.md`) — each phase needs `**Produces:**`/`**Requires:**` annotations and a `## Phase Completion Checklist`

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
