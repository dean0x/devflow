# File Organization

Detailed source tree, plugin structure, build distribution, and installation paths.

## Source Structure

```
devflow/
├── .claude-plugin/                   # Marketplace registry (repo root)
│   └── marketplace.json
├── shared/
│   ├── skills/                       # SINGLE SOURCE OF TRUTH (28 skills)
│   │   ├── commit/
│   │   │   ├── SKILL.md
│   │   │   └── references/
│   │   ├── core-patterns/
│   │   └── ...
│   └── agents/                       # SINGLE SOURCE OF TRUTH (10 shared agents)
│       ├── git.md
│       ├── synthesizer.md
│       ├── coder.md
│       └── ...
├── plugins/                          # Plugin collection (10 plugins)
│   ├── devflow-specify/
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json
│   │   ├── commands/
│   │   ├── agents/                   # GENERATED shared agents (gitignored)
│   │   ├── skills/                   # GENERATED skills (gitignored)
│   │   └── README.md
│   ├── devflow-implement/
│   ├── devflow-review/
│   ├── devflow-resolve/
│   ├── devflow-debug/
│   ├── devflow-self-review/
│   ├── devflow-catch-up/
│   ├── devflow-devlog/
│   ├── devflow-core-skills/
│   └── devflow-audit-claude/
├── docs/
│   └── reference/                    # Extracted reference docs
├── scripts/
│   ├── build-plugins.ts
│   ├── statusline.sh
│   └── hooks/                        # Working Memory hooks
│       ├── stop-update-memory.sh     # Stop hook: writes WORKING-MEMORY.md
│       ├── session-start-memory.sh   # SessionStart hook: injects memory + git state
│       └── pre-compact-memory.sh     # PreCompact hook: saves git state backup
└── src/
    └── cli/
        ├── commands/
        │   ├── init.ts
        │   ├── list.ts
        │   └── uninstall.ts
        └── cli.ts
```

## Plugin Structure

Each plugin follows the official Claude plugins format:

```
devflow-{name}/
├── .claude-plugin/
│   └── plugin.json           # Manifest (includes skills + agents arrays)
├── commands/                 # Slash commands
├── agents/                   # GENERATED shared agents + committed plugin-specific agents
├── skills/                   # GENERATED - copied from shared/skills/ at build time
└── README.md
```

**Plugin manifest example** (`plugin.json`):
```json
{
  "name": "devflow-implement",
  "description": "Complete task implementation workflow",
  "version": "0.9.0",
  "agents": ["git", "coder", "synthesizer"],
  "skills": ["codebase-navigation", "implementation-patterns", "self-review"]
}
```

The `skills` and `agents` arrays declare which shared assets this plugin needs. `npm run build` copies them.

## Installation Paths

| Asset | Path | Notes |
|-------|------|-------|
| Commands | `~/.claude/commands/devflow/` | Namespaced |
| Agents | `~/.claude/agents/devflow/` | Namespaced |
| Skills | `~/.claude/skills/` | Flat (auto-discovery) |
| Scripts | `~/.devflow/scripts/` | Helper scripts |
| Hooks | `~/.devflow/scripts/hooks/` | Working Memory hooks |
| Settings | `~/.claude/settings.json` | DevFlow configuration |

## Build-Time Asset Distribution

Skills and agents are **not duplicated** in git. Instead:

1. **Single source of truth**: `shared/skills/` and `shared/agents/`
2. **Manifest declares needs**: Each plugin's `plugin.json` has `skills` and `agents` arrays
3. **Build copies assets**: `npm run build:plugins` copies to each plugin
4. **Git ignores generated**: `plugins/*/skills/` and shared agents are in `.gitignore`
5. **npm includes generated**: `npm pack` includes built assets for distribution

### Adding a Skill to a Plugin

1. Ensure skill exists in `shared/skills/{skill-name}/`
2. Add skill name to plugin's `plugin.json` skills array
3. Run `npm run build`
4. Verify with `ls plugins/devflow-{plugin}/skills/`

### Adding an Agent to a Plugin

1. Ensure agent exists in `shared/agents/{agent-name}.md`
2. Add agent name to plugin's `plugin.json` agents array
3. Run `npm run build`
4. Verify with `ls plugins/devflow-{plugin}/agents/`

### Shared vs Plugin-Specific Agents

- **Shared** (10): `git`, `synthesizer`, `skimmer`, `simplifier`, `coder`, `reviewer`, `resolver`, `shepherd`, `scrutinizer`, `validator`
- **Plugin-specific** (3): `devlog`, `catch-up`, `claude-md-auditor` — committed directly in their plugins

## Settings Override

`devflow init --override-settings` replaces `~/.claude/settings.json`.

Included settings:
- `statusLine` - Smart statusline with context percentage
- `hooks` - Working Memory hooks (Stop, SessionStart, PreCompact)
- `env.ENABLE_TOOL_SEARCH` - Deferred MCP tool loading (~85% token savings)
- `env.ENABLE_LSP_TOOL` - Language Server Protocol support
- `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` - Agent Teams for peer-to-peer collaboration
- `extraKnownMarketplaces` - DevFlow plugin marketplace (`dean0x/devflow`)
- `permissions.deny` - Security deny list (126 blocked operations) + sensitive file patterns

## Working Memory Hooks

Three hooks in `scripts/hooks/` provide automatic session continuity:

| Hook | Event | File | Purpose |
|------|-------|------|---------|
| `stop-update-memory.sh` | Stop | `.docs/WORKING-MEMORY.md` | Throttled (skips if <2min fresh). Slim instruction after first write. |
| `session-start-memory.sh` | SessionStart | reads WORKING-MEMORY.md | Injects previous memory + git state as `additionalContext`. Warns if >1h stale. |
| `pre-compact-memory.sh` | PreCompact | `.docs/working-memory-backup.json` | Saves git state snapshot. Bootstraps minimal WORKING-MEMORY.md if none exists. |

**Flow**: Claude responds → Stop hook checks mtime (skips if <2min fresh) → blocks with instruction → Claude writes WORKING-MEMORY.md silently → `stop_hook_active=true` → allows stop. On `/clear` or new session → SessionStart injects memory as `additionalContext` (system context, not user-visible) with staleness warning if >1h old.

All hooks are no-ops in projects without `.docs/` (non-DevFlow projects).

## Statusline Script

The statusline (`scripts/statusline.sh`) displays:
- Directory name and model
- Git branch with dirty indicator (`*`)
- Context usage percentage (green <50%, yellow 50-80%, red >80%)

Data source: `context_window.current_usage` from Claude Code's JSON stdin.
