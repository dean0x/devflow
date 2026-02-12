# DevFlow Development Guide

Instructions for developers and AI agents working on DevFlow. For user docs, see README.md.

## Purpose

DevFlow enhances Claude Code with intelligent development workflows. Modifications must:
- Maintain brutal honesty in review outputs (no sycophancy)
- Preserve context across sessions
- Enhance developer empowerment without replacing judgment
- Ensure all commands are self-documenting

## Architecture Overview

Plugin marketplace with 10 self-contained plugins, each following the Claude plugins format (`.claude-plugin/plugin.json`, `commands/`, `agents/`, `skills/`).

| Plugin | Purpose | Agent Teams |
|--------|---------|-------------|
| `devflow-specify` | Feature specification workflow | Yes |
| `devflow-implement` | Complete task implementation lifecycle | Yes |
| `devflow-review` | Comprehensive code review | Yes |
| `devflow-resolve` | Review issue resolution | Yes |
| `devflow-debug` | Competing hypothesis debugging | Yes |
| `devflow-self-review` | Self-review (Simplifier + Scrutinizer) | No |
| `devflow-catch-up` | Context restoration | No |
| `devflow-devlog` | Session logging | No |
| `devflow-core-skills` | Auto-activating quality enforcement | No |
| `devflow-audit-claude` | Audit CLAUDE.md files (optional) | No |

**Build-time asset distribution**: Skills and agents are stored once in `shared/skills/` and `shared/agents/`, then copied to each plugin at build time based on `plugin.json` manifests. This eliminates duplication in git.

**Working Memory**: Three shell-script hooks (`scripts/hooks/`) provide automatic session continuity. Stop hook → Claude writes `.docs/WORKING-MEMORY.md` (throttled: skips if updated <2min ago, uses slim instruction after first write). SessionStart hook → injects previous memory + git state as `additionalContext` on `/clear`, startup, or compact (warns if >1h stale). PreCompact hook → saves git state backup + bootstraps minimal WORKING-MEMORY.md if none exists. Zero-ceremony context preservation.

## Project Structure

```
devflow/
├── shared/skills/          # 28 skills (single source of truth)
├── shared/agents/          # 10 shared agents (single source of truth)
├── plugins/devflow-*/      # 10 self-contained plugins
├── docs/reference/         # Detailed reference documentation
├── scripts/                # Helper scripts (statusline, docs-helpers)
│   └── hooks/              # Working Memory hooks (stop, session-start, pre-compact)
├── src/cli/                # TypeScript CLI (init, list, uninstall)
└── .claude-plugin/         # Marketplace registry
```

**Install paths**: Commands → `~/.claude/commands/devflow/`, Agents → `~/.claude/agents/devflow/`, Skills → `~/.claude/skills/` (flat), Scripts → `~/.devflow/scripts/`

## Development Loop

```bash
# 1. Edit source files
vim plugins/devflow-review/commands/review.md  # Commands/agents in plugins
vim shared/skills/security-patterns/SKILL.md   # Skills in shared/

# 2. Build (compiles CLI + distributes skills/agents to plugins)
npm run build

# 3. Reinstall to global context
node dist/cli.js init                       # All plugins
node dist/cli.js init --plugin=review       # Single plugin

# 4. Test immediately
/review
```

**Build commands**: `npm run build` (full), `npm run build:cli` (TypeScript only), `npm run build:plugins` (skill/agent distribution only)

## Documentation Artifacts

All generated docs live under `.docs/` in the project root:

```
.docs/
├── reviews/{branch-slug}/    # Review reports per branch
├── design/                   # Implementation plans
├── status/                   # Development logs + INDEX.md
├── CATCH_UP.md               # Latest summary (overwritten)
├── WORKING-MEMORY.md         # Auto-maintained by Stop hook (overwritten each response)
└── working-memory-backup.json # Pre-compact git state snapshot
```

**Naming conventions**: Timestamps as `YYYY-MM-DD_HHMM`, branch slugs replace `/` with `-`, topic slugs are lowercase-dashes. Use `.devflow/scripts/docs-helpers.sh` for consistent naming.

**Persisting agents**: CatchUp → `.docs/CATCH_UP.md`, Devlog → `.docs/status/`, Reviewer → `.docs/reviews/`, Synthesizer → `.docs/reviews/` (review mode), Working Memory → `.docs/WORKING-MEMORY.md` (automatic)

## Agent & Command Roster

**Orchestration commands** (spawn agents, never do agent work in main session):
- `/specify` — Skimmer + Explore + Synthesizer + Plan + Synthesizer → GitHub issue
- `/implement` — Git + Skimmer + Explore + Synthesizer + Plan + Synthesizer + Coder + Simplifier + Scrutinizer + Shepherd → PR
- `/review` — 7-11 Reviewer agents + Git + Synthesizer
- `/resolve` — N Resolver agents + Git
- `/debug` — Agent Teams competing hypotheses
- `/self-review` — Simplifier then Scrutinizer (sequential)
- `/devlog`, `/catch-up` — Single-agent utilities
- `/audit-claude` — CLAUDE.md audit (optional plugin)

**Shared agents** (10): git, synthesizer, skimmer, simplifier, coder, reviewer, resolver, shepherd, scrutinizer, validator

**Plugin-specific agents** (3): devlog, catch-up, claude-md-auditor

**Agent Teams**: 5 commands use Agent Teams (`/review`, `/implement`, `/debug`, `/specify`, `/resolve`). One-team-per-session constraint — must TeamDelete before creating next team.

## Key Conventions

### Skills

- 3-tier system: Foundation (shared patterns), Specialized (auto-activate), Domain (language/framework)
- Each skill has one non-negotiable **Iron Law** in its `SKILL.md`
- Target: ~120-150 lines per SKILL.md with progressive disclosure to `references/`
- Skills are read-only (`allowed-tools: Read, Grep, Glob`)
- All skills live in `shared/skills/` — add to plugin `plugin.json` `skills` array, then `npm run build`

### Agents

- Target: 50-150 lines depending on type (Utility 50-80, Worker 80-120)
- Reference skills via frontmatter, don't duplicate skill content
- Define clear input/output contracts and escalation boundaries
- Shared agents live in `shared/agents/` — add to plugin `plugin.json` `agents` array

### Commands

- Commands are orchestration-only — spawn agents, never do agent work in main session
- Create in `plugins/devflow-{plugin}/commands/`
- Register new plugins in `DEVFLOW_PLUGINS` in `src/cli/commands/init.ts`

### Commits

Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`

## Critical Rules

### Git Safety
- Always use `rm -f .git/index.lock &&` before git operations
- Run git commands sequentially, never in parallel
- Never force push without explicit user request

### Build System
- `shared/skills/` and `shared/agents/` are the single source of truth
- Generated copies in `plugins/*/skills/` and shared agent files are gitignored
- Always run `npm run build` after modifying shared assets
- Plugin manifests (`plugin.json`) declare `skills` and `agents` arrays

### Token Optimization
- Sub-agents cannot invoke other sub-agents (by design)
- Use parallel execution where possible
- Leverage `.claudeignore` for context reduction

## Reference Documents

For detailed specifications beyond this overview:

- **Skills architecture**: `docs/reference/skills-architecture.md` — tier catalog, templates, creation guide, activation patterns
- **Agent design**: `docs/reference/agent-design.md` — templates, anti-patterns, quality checklist
- **Adding commands**: `docs/reference/adding-commands.md` — command template, plugin registration
- **Release process**: `docs/reference/release-process.md` — full runbook with checklists
- **File organization**: `docs/reference/file-organization.md` — source tree, build distribution, install paths, settings
- **Docs framework skill**: `shared/skills/docs-framework/SKILL.md` — documentation naming conventions and templates
