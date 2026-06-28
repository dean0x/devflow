# Devflow Development Guide

Instructions for developers and AI agents working on Devflow. For user docs, see README.md.

## Purpose

Devflow enhances Claude Code with intelligent development workflows. Modifications must:
- Maintain brutal honesty in review outputs (no sycophancy)
- Preserve context across sessions
- Enhance developer empowerment without replacing judgment
- Ensure all commands are self-documenting

## Architecture Overview

Plugin marketplace with 22 plugins (12 core + 9 optional language/ecosystem + 1 optional workflow), each following the Claude plugins format (`.claude-plugin/plugin.json`, `commands/`, `agents/`, `skills/`).

| Plugin | Purpose |
|--------|---------|
| `devflow-implement` | Complete task implementation lifecycle |
| `devflow-plan` | Unified design planning with gap analysis |
| `devflow-code-review` | Comprehensive code review |
| `devflow-resolve` | Review issue resolution |
| `devflow-debug` | Competing hypothesis debugging |
| `devflow-explore` | Codebase exploration with knowledge base creation |
| `devflow-research` | Multi-type research with trust-aware synthesis |
| `devflow-release` | Adaptive project release with learned configuration |
| `devflow-self-review` | Self-review (Simplifier + Scrutinizer) |
| `devflow-bug-analysis` | Proactive bug finding with static and semantic analysis |
| `devflow-ambient` | Ambient mode — plan auto-detection |
| `devflow-core-skills` | Auto-activating quality enforcement |
| `devflow-audit-claude` | Audit CLAUDE.md files (optional) |
| `devflow-dynamic` | Dynamic workflow recipes — dependency-aware tickets→plan→build delivery pipeline (optional) |
| `devflow-typescript` | TypeScript language patterns (optional) |
| `devflow-react` | React framework patterns (optional) |
| `devflow-accessibility` | Web accessibility patterns (optional) |
| `devflow-ui-design` | UI design patterns (optional) |
| `devflow-go` | Go language patterns (optional) |
| `devflow-python` | Python language patterns (optional) |
| `devflow-java` | Java language patterns (optional) |
| `devflow-rust` | Rust language patterns (optional) |

**Build-time asset distribution**: Skills and agents are stored once in `shared/skills/` and `shared/agents/`, then copied to each plugin at build time based on `plugin.json` manifests. This eliminates duplication in git.

**LLM-vs-plumbing principle**: The LLM does all detection, semantic matching, materialization, and curation. Deterministic code is plumbing only: hooks, locks, throttles, file I/O, id-keyed JSONL records, `assign-anchor`/`retire-anchor` ledger numbering, `render-decisions` rendering, and `merge-observation` writes. No detection or judgment logic lives in shell or TypeScript.

**Working Memory**: Three shell-script hooks (`scripts/hooks/`) replace the old 8-hook system with a background-maintenance (Dream) architecture. Toggleable via `devflow memory --enable/--disable/--status` or `devflow init --memory/--no-memory`. Feature state is stored in `.devflow/dream/config.json` (config-only; dream config is the sole source of truth per ADR-001). `dream-capture` (Stop hook) — captures user/assistant turns to `.devflow/memory/.pending-turns.jsonl` queue; after the 120s throttle (keyed by `.working-memory-last-trigger` mtime), spawns `background-memory-update` as a detached `nohup` worker (`claude -p --model haiku`); touches `.working-memory-last-trigger` BEFORE spawning to prevent double-spawn; uses mkdir-based locking for queue overflow truncation across concurrent sessions. `background-memory-update` (Stop-hook worker, not a hook itself) — drains `.pending-turns.jsonl`, calls `claude -p` (prompt on stdin, never argv), rewrites `WORKING-MEMORY.md` with `<!-- memory-head: <sha> branch: <name> -->` on line 1, touches `.last-refresh-ok` on success; holds a 300s-stale worker lock; user-only queue truncated without LLM run. `dream-dispatch` (UserPromptSubmit hook) — **capture-only**: appends the user turn to `.pending-turns.jsonl`; it does NOT emit any directive. `dream-evaluate` (SessionEnd hook) — orchestrator that sources `eval-helpers` + 2 feature modules (`eval-decisions`, `eval-curation`) after shared setup; each module uses `${VAR:?}` fail-fast guards and `_MODULENAME_` variable prefixes for namespace isolation; evaluates whether to write decisions or curation dream markers; writes per-session marker files using atomic temp+mv; uses mkdir-based locking (`dream-lock`) to serialize operations across concurrent sessions. Always-on SessionStart hook (`session-start-context`) — recovers stale `.processing` markers (via `dream-recover` → `dream_recover_stale`), collects pending markers (via `dream-collect-tasks`), and emits a **DREAM MAINTENANCE** directive instructing the main model to spawn background `Dream` agents; directive emission is throttled to 120s. `dream-collect-tasks` unconditionally deletes orphaned `learning.*`, `memory.*`, AND `knowledge.*` markers (all three pipelines removed from Dream subagent). The Dream agent processes decisions and curation only — memory and knowledge are NOT Dream tasks. SessionStart hook (`session-start-memory`) → injects previous memory with git-reconciled header (3-state: A in-sync / B drifted / C refresh-failing) + optional pre-compact snapshot as `additionalContext`; stamp `<!-- memory-head: <sha> branch: <name> -->` on line 1 drives drift detection; no raw-turns dump. PreCompact hook → saves git state + WORKING-MEMORY.md snapshot. Memory sections: `## Now`, `## Progress`, `## Decisions`, `## Context`, `## Session Log`. The background-memory-update worker uses rename-to-claim for queue consumption (atomically renames `.pending-turns.jsonl` → `.pending-turns.processing`). Disabling memory writes `memory: false` to dream config — hooks remain registered (shared across features). `removeMemoryHooks` (used by `devflow init --no-memory`) also removes pre-dream legacy hooks. Use `devflow memory --clear` to clean up pending queue files across projects. Zero-ceremony context preservation.

**Ambient Mode**: Single-component system for zero-overhead session enhancement. UserPromptSubmit hook (`preamble`) uses two coexisting detection paths, both controlled by the same single toggle (`devflow ambient --enable/--disable/--status` or `devflow init`). **First-word keyword detection** — when a prompt's first word (case-insensitive) is one of `implement`, `explore`, `research`, `debug`, or `plan`, followed by at least one additional word, the hook outputs a directive instructing the model to briefly announce the workflow then invoke the matching `devflow:<keyword>` skill via the Skill tool. **3-marker plan detection** — when a prompt contains `## Goal`, `## Steps`, and `## Files` markers (and the keyword path did not fire), it outputs a directive to invoke `devflow:implement`. Zero overhead for normal prompts — hook outputs nothing. Any legacy `commands.md` rule left by prior installs is auto-removed on every `devflow ambient --enable/--disable` or `devflow init`.

**Decisions pipeline** (`eval-decisions` SessionEnd module → `decisions.{session_id}.json` marker → Dream agent): The `eval-decisions` module runs every session, extracts DIALOG_PAIRS from the transcript, and writes a decisions marker. At SessionStart the Dream agent claims the marker, detects **decision** and **pitfall** observation types via LLM analysis of the dialog pairs, and materializes entries via `assign-anchor` (internally self-locks `.decisions.lock`; assigns the next ADR-NNN/PF-NNN anchor number into `decisions-ledger.jsonl`, then deterministically renders `decisions.md`/`pitfalls.md` from the ledger — active entries only). Removal is recoverable via `retire-anchor` (flips `decisions_status`, never deletes). Raw observations accumulate in the gitignored `.devflow/decisions/decisions-log.jsonl` (rotated to `decisions-log.archive.jsonl` by `rotate-observations`). No deterministic thresholds or confidence formulas — the LLM determines whether an observation warrants a new entry or should be merged with an existing one. Global config: `~/.devflow/decisions.json`. Project config: `.devflow/decisions/decisions.json`. Runtime sentinel: `.devflow/decisions/.disabled` — the decisions sections in `session-start-context` skip if present; `devflow decisions --enable` removes it, `devflow decisions --disable` creates it. Toggleable via `devflow decisions --enable/--disable/--status` or `devflow init --decisions/--no-decisions`. Management subcommands: `devflow decisions list`, `devflow decisions --configure`, `devflow decisions --clear/--reset`.

Debug logs stored at `~/.devflow/logs/{project-slug}/`.

**Debug Tracing**: Single global toggle covering all hooks. Enabled via `devflow debug --enable/--disable/--status` CLI or by setting `DEVFLOW_HOOK_DEBUG=1` in `~/.claude/settings.json` env block (survives reinstalls). All hooks share the `scripts/hooks/debug-trace` helper script (sourced via `hook-bootstrap`) so tracing behavior is consistent and updated in one place. Two-phase logging: pre-CWD traces go to global `~/.devflow/logs/.hook-debug.log`; post-CWD traces go to per-project `~/.devflow/logs/{project-slug}/.hook-debug.log`. A 5MB size guard prevents unbounded growth. applies ADR-007

**Claude Code Flags**: Typed registry (`src/cli/utils/flags.ts`) for managing Claude Code feature flags (env vars and top-level settings). Pure functions `applyFlags`/`stripFlags`/`getDefaultFlags` follow the `applyViewMode`/`stripViewMode` pattern. Flags (18 total): default ON — `tui`, `tool-search`, `lsp`, `prompt-caching-1h`, `show-turn-duration`, `clear-context-on-plan`; default OFF — `brief`, `thinking-summaries`, `subprocess-env-scrub`, `disable-nonessential-traffic`, `forked-subagents`, `disable-adaptive-thinking`, `always-thinking`, `disable-git-instructions`, `disable-compact`, `disable-1m-context`, `disable-autoupdater`, `agent-teams`. Manageable via `devflow flags --enable/--disable/--status/--list`. Stored in manifest `features.flags: string[]`. View mode (`default`/`verbose`/`focus`) stored in manifest `features.viewMode?: string` and applied to `settings.json` as the `viewMode` key; `applyViewMode`/`stripViewMode` utilities colocated in `flags.ts`.

**Feature Knowledge Bases**: Per-feature `.devflow/features/` directory containing KNOWLEDGE.md files that capture area-specific patterns, conventions, architecture, and gotchas. Uses a **write-through** model: load = direct file-I/O reading `.devflow/features/index.md` (regenerable cache) with frontmatter-glob fallback over `features/*/KNOWLEDGE.md` (source of truth) + verify-against-code on read; save = in-command write-through via a simplified Knowledge agent that writes `KNOWLEDGE.md` + the `index.md` line directly (no `.create-result.json`, no external scripts, no lock). Freshness = write-through + verify-on-read (NO git-staleness, NO SessionEnd eval, NO Dream task). `index.md` line format: `- **{slug}** — {areas} — {Use-when description}`; frontmatter is authoritative if the line is lost. MDS module: `shared/knowledge/` contains `_knowledge.mds` (defines/exports `knowledge_load` and `knowledge_writeback` partials) + 9 host `.mds` sources compiled to plugin commands at build time by `scripts/build-knowledge.ts` (`npm run build:knowledge`). `knowledge_load` is used up-front by: implement, plan, resolve, code-review, self-review, research, bug-analysis. `knowledge_writeback` is used at workflow end by: implement, resolve, self-review, explore, debug. explore/debug do NOT load up-front (intentional asymmetry). Config gate: single `knowledge: true|false` in dream config (default true) — gates write-back only; load is ungated. CLI: `devflow knowledge list` (read index.md / frontmatter glob), `devflow knowledge --enable/--disable/--status` (flip config). Note: `/debug` keeps FEATURE_KNOWLEDGE orchestrator-local (investigation workers examine code without pre-loaded context). Toggleable via `devflow knowledge --enable/--disable/--status` or `devflow init --knowledge/--no-knowledge`.

**Rules**: Ultra-concise, always-on engineering principle files (~10-15 lines each) installed to `~/.claude/rules/devflow/` as flat `.md` files. Claude Code loads them automatically on every prompt — no hooks required — filling the guidance gap for quick edits that don't trigger a full skill pipeline. Rules flow through the same four-stage pipeline as skills: authored in `shared/rules/`, distributed to `plugins/*/rules/` at build time, installed (or shadowed) at runtime, and activated automatically. Unlike skills (which install universally from all plugins), rules are **plugin-scoped**: only rules belonging to selected plugins are installed. This keeps core rules (`security`, `engineering`, `quality`, `reliability` from `devflow-core-skills`) always present, and language/ecosystem rules (`typescript`, `react`, `go`, etc.) present only when the user has that plugin installed. Shadow overrides: `~/.devflow/rules/{name}.md` overrides the Devflow source. Toggleable via `devflow rules --enable/--disable/--status/--list` or `devflow init --rules/--no-rules`. Stored in manifest `features.rules: boolean` (self-heals to `true` on old manifests). Currently 12 rules: 4 core + 8 language/UI. `paths: []` YAML frontmatter must remain — it signals Claude Code to apply the rule globally.

**One background pipeline** (toggleable):
- `devflow decisions --enable/--disable` — Decisions pipeline (decision + pitfall detection, materialized by Dream agent from DIALOG_PAIRS)

Knowledge write-back is in-command (not a background pipeline): gated by `devflow knowledge --enable/--disable` (flips `knowledge` in dream config); Knowledge agent writes directly at workflow end.

**Two-Mode Init**: `devflow init` offers Recommended (sensible defaults, quick setup) or Advanced (full interactive flow) after plugin selection. `--recommended` / `--advanced` CLI flags for non-interactive use. Recommended applies: ambient ON, memory ON, decisions ON, rules ON, HUD ON, default-ON flags, .claudeignore ON, auto-install safe-delete if trash CLI detected, user-mode security deny list, viewMode preserved from existing settings.json. Advanced path adds a view mode selector (default/verbose/focus) after Claude Code flags. Use `--decisions/--no-decisions` to toggle the decisions agent independently. Use `--rules/--no-rules` to toggle rules independently.

**Migrations**: Run-once migrations execute automatically on `devflow init`, tracked at `~/.devflow/migrations.json` (scope-independent; single file regardless of user-scope vs local-scope installs). Registry: append an entry to `MIGRATIONS` in `src/cli/utils/migrations.ts`. Scopes: `global` (runs once per machine, no project context) vs `per-project` (sweeps all discovered Claude-enabled projects in parallel). Failures are non-fatal — migrations retry on next init. Currently registered per-project migrations include `purge-legacy-knowledge-v2` (removes 4 hardcoded pre-v2 ADR/PF IDs and orphan `PROJECT-PATTERNS.md`), `purge-legacy-knowledge-v3` (v3: sweeps all remaining pre-v2 seeded entries using the `- **Source**: self-learning:` format discriminator — any ADR/PF section lacking this marker is removed; entries the user edited to include the marker survive), `purge-orphaned-sidecar-judgment-state` (per-project; removes orphaned `.learning-manifest.json`, `.decisions-manifest.json`, `.decisions-notifications.json` — judgment-state files written by the now-removed deterministic render/reconcile layer), `purge-learning-pipeline-v1` (per-project; removes `.devflow/learning/` directory, learning dream markers, `learning` key from dream/sidecar config, `.claude/commands/self-learning/`, and auto-generated skills), `purge-stale-memory-markers-v1` (per-project; removes stale `dream/memory.*` markers left by the old Dream-subagent memory pipeline now that `background-memory-update` handles memory refresh — ENOENT-idempotent, rethrows non-ENOENT errors), `purge-dead-working-memory-sentinel-v1` (per-project; removes the stale `.devflow/memory/.working-memory-disabled` sentinel now that the memory gate is config-only per ADR-001 — ENOENT-tolerant, rethrows non-ENOENT errors). Global migrations: `purge-learning-global-v1` removes `~/.devflow/learning.json`; `purge-orphaned-dream-commit-hook-v1` removes the orphaned `~/.devflow/scripts/hooks/dream-commit` (the `dream-commit` helper was deleted when `.devflow/` became gitignored-by-default per ADR-021, but the installer copies `scripts/` additively — `copyDirectory` never deletes — so the stale file would otherwise linger; ENOENT-idempotent); `purge-knowledge-hooks-global-v1` removes the orphaned `~/.devflow/scripts/hooks/eval-knowledge` and `~/.devflow/scripts/hooks/lib/feature-knowledge.cjs` (deleted from source in Phase 2 of the write-through migration; installer copies additively so they linger; ENOENT-idempotent). Per-project: `purge-feature-knowledge-pipeline-v1` removes `.devflow/dream/knowledge.*` markers, `.devflow/features/.knowledge.lock/` (recursive), `.devflow/features/.knowledge-last-refresh`, `.devflow/features/.knowledge-refresh.lock`, `.devflow/features/.disabled`; renames `.devflow/features/index.json` → `index.json.deprecated` (if present; never recreated — write-through creates `index.md` lazily). Does NOT touch the `knowledge` key in dream config (write-back gate stays). Existing KNOWLEDGE.md files remain loadable via frontmatter-glob fallback. **D37 edge case**: a project cloned *after* migrations have run won't be swept (the marker is global, not per-project). Recovery: `rm ~/.devflow/migrations.json` forces a re-sweep on next `devflow init`.

## Project Structure

```
devflow/
├── shared/skills/          # 43 skills (single source of truth)
├── shared/agents/          # 16 shared agents (single source of truth)
├── shared/rules/           # 12 rules (single source of truth; flat .md files)
├── shared/recipes/         # MDS recipe sources (single source of truth, compiled to plugins/devflow-dynamic/commands/ at build)
├── plugins/devflow-*/      # 22 plugins (12 core + 9 optional language/ecosystem + 1 optional workflow)
├── docs/reference/         # Detailed reference documentation
├── scripts/                # Helper scripts (statusline, docs-helpers)
│   └── hooks/              # Dream + ambient + memory hooks (dream-capture, dream-dispatch [capture-only], background-memory-update [Stop-hook worker], dream-recover, dream-collect-tasks, dream-evaluate, dream-lock, session-start-memory, session-start-context, pre-compact-memory, preamble, get-mtime, hook-bootstrap, hook-log-init, eval-helpers, eval-decisions, eval-curation)
├── src/cli/                # TypeScript CLI (init, list, uninstall, ambient, decisions, flags, knowledge, rules, debug)
├── .claude-plugin/         # Marketplace registry
├── .devflow/               # All per-project runtime data — gitignored wholesale by default (ensure-devflow-init adds .devflow/ to the root .gitignore; sharing is opt-in)
│   ├── docs/               # Project docs (reviews, design)
│   ├── memory/             # Working memory files
│   ├── dream/              # Dream marker files
│   ├── decisions/          # Decisions agent observations and ADR/PF files
│   └── features/           # Per-feature knowledge bases (gitignored by default; opt-in to share)
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

**Build commands**: `npm run build` (full), `npm run build:cli` (TypeScript only), `npm run build:plugins` (skill/agent distribution only), `npm run build:recipes` (MDS recipe compilation only), `npm run build:knowledge` (MDS knowledge command compilation only)

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
├── tickets/{slug}/                    # Ticket sets from /dynamic-tickets
│   └── {YYYY-MM-DD_HHMM}/            # Timestamped ticket directory
│       ├── {ticket-slug}.md           # Individual ticket files
│       └── tracking-issue.md          # Tracking issue body (GitHub sync)
├── waves/{slug}/                      # Wave run reports from /dynamic-wave
│   └── {YYYY-MM-DD_HHMM}/            # Timestamped wave directory
│       └── wave-report.md             # Wave run summary and status
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
│   ├── .pending-turns.jsonl          # Queue of captured user/assistant turns (JSONL, ephemeral)
│   ├── .pending-turns.processing     # Atomic handoff during background processing (transient, D56c)
│   ├── .working-memory-last-trigger  # Mtime = last worker spawn time (120s throttle key, transient)
│   ├── .last-refresh-ok              # Mtime = last successful WORKING-MEMORY.md write (transient)
│   └── .working-memory.lock/         # Worker lock dir — 300s stale-break (transient, never tracked)
├── dream/                        # Dream state: config.json (feature toggles), per-session markers (decisions.{session}.json, curation.{session}.json), .processor-spawned-at (120s spawn throttle), .curation-last (7-day curation throttle)
├── decisions/
│   ├── decisions-ledger.jsonl    # Anchored ledger (gitignored by default) — render source of truth; one row per ADR/PF incl. retired
│   ├── decisions-log.jsonl       # Raw decision/pitfall observations (JSONL, gitignored)
│   ├── decisions-log.archive.jsonl # Archived observing rows >30d, moved by rotate-observations (gitignored)
│   ├── decisions.json            # Project-level decisions agent config (max runs, throttle, model, debug)
│   ├── .decisions-runs-today     # Daily run counter for decisions agent (date + count)
│   ├── .decisions.lock           # Lock directory for assign-anchor/retire-anchor writers (transient)
│   ├── .decisions-usage.json     # Citation counts written by decisions-usage-scan.cjs Stop hook
│   ├── decisions.md              # Architectural decisions (ADR-NNN) — rendered from decisions-ledger.jsonl (active only) by Dream agent via assign-anchor + render-decisions
│   ├── pitfalls.md               # Known pitfalls (PF-NNN, area-specific gotchas) — rendered from decisions-ledger.jsonl (active only) by Dream agent via assign-anchor + render-decisions
│   └── .disabled                 # Runtime sentinel — decisions sections in session-start-context skip if present
└── features/                     # Per-feature knowledge bases (gitignored by default; opt-in to share)
    ├── {slug}/KNOWLEDGE.md
    └── index.md                  # Regenerable cache (line format: `- **{slug}** — {areas} — {Use-when}`); frontmatter is authoritative if absent

~/.devflow/logs/{project-slug}/
├── .dream-capture.log                 # dream-capture (Stop hook) log
└── .background-memory-update.log      # background-memory-update worker log
```

**Naming conventions**: Timestamps as `YYYY-MM-DD_HHMM`, branch slugs replace `/` with `-`, topic slugs are lowercase-dashes.

**Persisting agents**: Reviewer → `.devflow/docs/reviews/{branch-slug}/{timestamp}/{focus}.md`, Synthesizer → `.devflow/docs/reviews/{branch-slug}/{timestamp}/review-summary.md` (review mode) / `.devflow/docs/research/{topic-slug}/{timestamp}/research-summary.md` (research mode) / `.devflow/docs/bug-analysis/{branch-slug}/{timestamp}/bug-analysis-summary.md` (bug-analysis mode), Researcher → `.devflow/docs/research/{topic-slug}/{timestamp}/{type}.md`, BugAnalyzer → `.devflow/docs/bug-analysis/{branch-slug}/{timestamp}/{focus}.md`, Resolver → `.devflow/docs/reviews/{branch-slug}/{timestamp}/resolution-summary.md` (review mode) / `.devflow/docs/bug-analysis/{branch-slug}/{timestamp}/resolution-summary.md` (bug-analysis mode), Working Memory → `.devflow/memory/WORKING-MEMORY.md` (automatic)

**Incremental Reviews**: `/code-review` writes reports into timestamped subdirectories (`YYYY-MM-DD_HHMM`) and tracks HEAD SHA in `.last-review-head` for incremental diffs. Second review only diffs from last reviewed commit. `/bug-analysis` has an analogous mechanism: it tracks HEAD SHA in `.last-analysis-head` and only analyzes commits since the last analysis run. `/resolve` defaults to the latest timestamped directory in whichever doc path (reviews or bug-analysis) matches the current workflow. `/code-review` auto-discovers git worktrees and processes all reviewable branches in parallel. `/bug-analysis` operates on the current branch only (single-worktree). Multi-cycle convergence detection: loads the prior `resolution-summary.md` as `PRIOR_RESOLUTIONS` so reviewers avoid re-raising resolved false positives; at cycle 3+ the FP ratio is computed and a warning is emitted when it exceeds 70% (suggesting merge or manual inspection). At MAX_REVIEW_CYCLES (10) a warning is emitted but the pipeline continues — convergence info is surfaced in the Synthesizer's Convergence Status section, never blocking.

**Coder Handoff Artifact**: Sequential Coder phases write `.devflow/docs/handoff-{branch_slug}.md` after each phase (branch-scoped to prevent concurrent session clobber). Survives context compaction (unlike PRIOR_PHASE_SUMMARY). Every Coder reads it via HANDOFF_FILE input. Deleted by `/implement` command after pipeline completes.

**Universal Skill Installation**: All skills from all plugins are always installed, regardless of plugin selection. Skills are tiny markdown files installed as `~/.claude/skills/devflow:{name}/` (namespaced to avoid collisions with other plugin ecosystems). Source directories in `shared/skills/` stay unprefixed — the `devflow:` prefix is applied at install-time only. Shadow overrides live at `~/.devflow/skills/{name}/` (unprefixed); when shadowed, the installer copies the user's version to the prefixed install target. Only commands and agents remain plugin-specific.

**Model Strategy**: Explicit model assignments in agent frontmatter override the user's session model. Opus for analysis agents (reviewer, scrutinizer, evaluator, designer, researcher, bug-analyzer), Sonnet for execution agents (coder, simplifier, resolver, skimmer, tester, knowledge), Haiku for I/O agents (git, synthesizer, validator). Dream uses per-task overrides via `session-start-context`: opus for decisions/curation (share one combined opus spawn). Memory is not a Dream task — `WORKING-MEMORY.md` is refreshed by the detached `background-memory-update` worker (`claude -p --model haiku`) spawned by `dream-capture`. Knowledge is not a Dream task — the Knowledge agent (sonnet) is spawned in-command by `knowledge_writeback()` at workflow end.

## Agent & Command Roster

**Orchestration commands** (spawn agents, never do agent work in main session):
- `/plan` — Skimmer + Explore + Designer + Synthesizer + Plan + Designer → design artifact; consumes decisions via index + on-demand Read via `devflow:apply-decisions`
- `/implement` — Git + Coder + Validator + Simplifier + Scrutinizer + Evaluator + Tester → PR (accepts plan documents, issues, or task descriptions)
- `/code-review` — 8-12 Reviewer agents + Git + Synthesizer; consumes decisions via index + on-demand Read via `devflow:apply-decisions`
- `/resolve` — N Resolver agents + Git; loads compact decisions index (`decisions-index.cjs index`) per worktree and passes it as `DECISIONS_CONTEXT` to each Resolver; Resolvers use `devflow:apply-decisions` to Read full bodies on demand; aggregates cited ADR-NNN/PF-NNN IDs into a `## Decisions Citations` section at the top of `resolution-summary.md`
- `/explore` — Skimmer + Explore + Synthesizer + Knowledge (optional knowledge base creation)
- `/debug` — competing hypotheses debugging
- `/self-review` — Simplifier then Scrutinizer (sequential); consumes decisions via index + on-demand Read via `devflow:apply-decisions`
- `/research` — Researcher agents + Skimmer + Synthesizer + Knowledge; multi-type research with trust-aware synthesis
- `/release` — Git agent + Validator + Synthesizer; adaptive release with learned configuration
- `/bug-analysis` — BugAnalyzer agents + Git + Synthesizer; proactive bug finding with static and semantic analysis, incremental by default
- `/audit-claude` — CLAUDE.md audit (optional plugin)

**Shared agents** (16): git, synthesizer, skimmer, simplifier, coder, reviewer, resolver, evaluator, tester, scrutinizer, validator, designer, knowledge, researcher, bug-analyzer, dream

**Plugin-specific agents** (1): claude-md-auditor

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
