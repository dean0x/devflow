# DevFlow Development Guide

Instructions for developers and AI agents working on DevFlow. For user docs, see README.md.

## Purpose

DevFlow enhances Claude Code with intelligent development workflows. Modifications must:
- Maintain brutal honesty in review outputs (no sycophancy)
- Preserve context across sessions
- Enhance developer empowerment without replacing judgment
- Ensure all commands are self-documenting

## Architecture Overview

Plugin marketplace with 17 plugins (8 core + 9 optional language/ecosystem), each following the Claude plugins format (`.claude-plugin/plugin.json`, `commands/`, `agents/`, `skills/`).

| Plugin | Purpose | Teams Variant |
|--------|---------|---------------|
| `devflow-specify` | Feature specification workflow | Optional |
| `devflow-implement` | Complete task implementation lifecycle | Optional |
| `devflow-code-review` | Comprehensive code review | Optional |
| `devflow-resolve` | Review issue resolution | Optional |
| `devflow-debug` | Competing hypothesis debugging | Optional |
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

**Working Memory**: Three shell-script hooks (`scripts/hooks/`) provide automatic session continuity. Toggleable via `devflow memory --enable/--disable/--status` or `devflow init --memory/--no-memory`. Stop hook → reads last turn from session transcript (`~/.claude/projects/{encoded-cwd}/{session_id}.jsonl`), spawns background `claude -p --model haiku` to update `.memory/WORKING-MEMORY.md` with structured sections (`## Now`, `## Progress`, `## Decisions`, `## Modified Files`, `## Context`, `## Session Log`; throttled: skips if triggered <2min ago; concurrent sessions serialize via mkdir-based lock). SessionStart hook → injects previous memory + git state as `additionalContext` on `/clear`, startup, or compact (warns if >1h stale; injects pre-compact memory snapshot when compaction happened mid-session). PreCompact hook → saves git state + WORKING-MEMORY.md snapshot + bootstraps minimal WORKING-MEMORY.md if none exists. Zero-ceremony context preservation.

**Self-Learning**: A SessionEnd hook (`session-end-learning`) accumulates session IDs and triggers a background `claude -p --model sonnet` every 3 sessions (5 at 15+ observations) to detect repeated workflows and procedural knowledge from batch transcripts. Observations accumulate in `.memory/learning-log.jsonl` with confidence scores, temporal decay, and daily run caps. When confidence thresholds are met (3 observations with 24h+ temporal spread for both workflow and procedural types), artifacts are auto-created as slash commands (`.claude/commands/self-learning/`) or skills (`.claude/skills/{slug}/`). Loaded artifacts are reinforced locally (no LLM) on each session end. Toggleable via `devflow learn --enable/--disable/--status` or `devflow init --learn/--no-learn`. Configurable model/throttle/caps/debug via `devflow learn --configure`. Debug logs stored at `~/.devflow/logs/{project-slug}/`. Use `devflow learn --purge` to remove invalid observations.

**Claude Code Flags**: Typed registry (`src/cli/utils/flags.ts`) for managing Claude Code feature flags (env vars and top-level settings). Pure functions `applyFlags`/`stripFlags`/`getDefaultFlags` follow the `applyTeamsConfig`/`stripTeamsConfig` pattern. Initial flags: `tool-search`, `lsp`, `clear-context-on-plan` (default ON), `brief`, `disable-1m-context` (default OFF). Manageable via `devflow flags --enable/--disable/--status/--list`. Stored in manifest `features.flags: string[]`.

**Two-Mode Init**: `devflow init` offers Recommended (sensible defaults, quick setup) or Advanced (full interactive flow) after plugin selection. `--recommended` / `--advanced` CLI flags for non-interactive use. Recommended applies: ambient ON, memory ON, learn ON, HUD ON, teams OFF, default-ON flags, .claudeignore ON, auto-install safe-delete if trash CLI detected, user-mode security deny list.

## Project Structure

```
devflow/
├── shared/skills/          # 38 skills (single source of truth)
├── shared/agents/          # 11 shared agents (single source of truth)
├── plugins/devflow-*/      # 17 plugins (8 core + 9 optional language/ecosystem)
├── docs/reference/         # Detailed reference documentation
├── scripts/                # Helper scripts (statusline, docs-helpers)
│   └── hooks/              # Working Memory + ambient + learning hooks (stop, session-start, pre-compact, ambient-prompt, session-end-learning, stop-update-learning [deprecated], background-learning)
├── src/cli/                # TypeScript CLI (init, list, uninstall, ambient, learn, flags)
├── .claude-plugin/         # Marketplace registry
├── .docs/                  # Project docs (reviews, design) — per-project
└── .memory/                # Working memory files — per-project
```

**Install paths**: Commands → `~/.claude/commands/devflow/`, Agents → `~/.claude/agents/devflow/`, Skills → `~/.claude/skills/devflow:*/` (namespaced), Scripts → `~/.devflow/scripts/`

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
└── design/                            # Implementation plans
```

Working memory files live in a dedicated `.memory/` directory:

```
.memory/
├── WORKING-MEMORY.md         # Auto-maintained by Stop hook (overwritten each session)
├── backup.json               # Pre-compact git state snapshot
├── learning-log.jsonl        # Learning observations (JSONL, one entry per line)
├── learning.json             # Project-level learning config (max runs, throttle, model, debug)
├── .learning-runs-today      # Daily run counter (date + count)
├── .learning-session-count   # Session IDs pending batch (one per line)
├── .learning-batch-ids       # Session IDs for current batch run
├── .learning-notified-at     # New artifact notification marker (epoch timestamp)
└── knowledge/
    ├── decisions.md           # Architectural decisions (ADR-NNN, append-only)
    └── pitfalls.md            # Known pitfalls (PF-NNN, area-specific gotchas)

~/.devflow/logs/{project-slug}/
├── .learning-update.log      # Background learning agent log
└── .working-memory-update.log # Background memory updater log
```

**Naming conventions**: Timestamps as `YYYY-MM-DD_HHMM`, branch slugs replace `/` with `-`, topic slugs are lowercase-dashes.

**Persisting agents**: Reviewer → `.docs/reviews/{branch-slug}/{timestamp}/{focus}.md`, Synthesizer → `.docs/reviews/{branch-slug}/{timestamp}/review-summary.md` (review mode), Resolver → `.docs/reviews/{branch-slug}/{timestamp}/resolution-summary.md`, Working Memory → `.memory/WORKING-MEMORY.md` (automatic)

**Incremental Reviews**: `/code-review` writes reports into timestamped subdirectories (`YYYY-MM-DD_HHMM`) and tracks HEAD SHA in `.last-review-head` for incremental diffs. Second review only diffs from last reviewed commit. `/resolve` defaults to latest timestamped directory. Both commands auto-discover git worktrees and process all reviewable branches in parallel.

**Coder Handoff Artifact**: Sequential Coder phases write `.docs/handoff.md` after each phase. Survives context compaction (unlike PRIOR_PHASE_SUMMARY). Every Coder reads it on startup. Deleted by implementation-orchestration after pipeline completes.

**Universal Skill Installation**: All skills from all plugins are always installed, regardless of plugin selection. Skills are tiny markdown files installed as `~/.claude/skills/devflow:{name}/` (namespaced to avoid collisions with other plugin ecosystems). Source directories in `shared/skills/` stay unprefixed — the `devflow:` prefix is applied at install-time only. Shadow overrides live at `~/.devflow/skills/{name}/` (unprefixed); when shadowed, the installer copies the user's version to the prefixed install target. Only commands and agents remain plugin-specific.

**Model Strategy**: Explicit model assignments in agent frontmatter override the user's session model. Opus for analysis agents (reviewer, scrutinizer, evaluator), Sonnet for execution agents (coder, simplifier, resolver, skimmer, tester), Haiku for I/O agents (git, synthesizer, validator).

## Agent & Command Roster

**Orchestration commands** (spawn agents, never do agent work in main session):
- `/specify` — Skimmer + Explore + Synthesizer + Plan + Synthesizer → GitHub issue
- `/implement` — Git + Skimmer + Explore + Synthesizer + Plan + Synthesizer + Coder + Simplifier + Scrutinizer + Evaluator + Tester → PR
- `/code-review` — 7-11 Reviewer agents + Git + Synthesizer
- `/resolve` — N Resolver agents + Git
- `/debug` — Agent Teams competing hypotheses
- `/self-review` — Simplifier then Scrutinizer (sequential)
- `/audit-claude` — CLAUDE.md audit (optional plugin)

**Shared agents** (11): git, synthesizer, skimmer, simplifier, coder, reviewer, resolver, evaluator, tester, scrutinizer, validator

**Plugin-specific agents** (1): claude-md-auditor

**Ambient orchestration skills** (6): implementation-orchestration, debug-orchestration, plan-orchestration, review-orchestration, resolve-orchestration, pipeline-orchestration. These enable the same agent pipelines as slash commands but triggered via ambient intent classification.

**Agent Teams**: 5 commands use Agent Teams (`/code-review`, `/implement`, `/debug`, `/specify`, `/resolve`). One-team-per-session constraint — must TeamDelete before creating next team.

## Key Conventions

### Skills

- 3-tier system: Foundation (shared patterns), Specialized (auto-activate), Domain (language/framework)
- Each skill has one non-negotiable **Iron Law** in its `SKILL.md`
- Target: ~120-150 lines per SKILL.md with progressive disclosure to `references/`
- Skills default to read-only (`allowed-tools: Read, Grep, Glob`); exceptions: git/review skills add `Bash`, interactive skills add `AskUserQuestion`, `knowledge-persistence`/`self-review` add `Write` for state persistence, and `ambient-router` omits `allowed-tools` entirely (unrestricted, as the main-session orchestrator)
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
- `shared/skills/` and `shared/agents/` are the single source of truth
- Generated copies in `plugins/*/skills/` and shared agent files are gitignored
- Always run `npm run build` after modifying shared assets
- Plugin manifests (`plugin.json`) declare `skills` and `agents` arrays
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
