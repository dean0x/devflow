# File Organization

Detailed source tree, plugin structure, build distribution, and installation paths.

## Source Structure

```
devflow/
├── .claude-plugin/                   # Marketplace registry (repo root)
│   └── marketplace.json
├── shared/
│   ├── skills/                       # SINGLE SOURCE OF TRUTH (31 skills)
│   │   ├── git-workflow/
│   │   │   ├── SKILL.md
│   │   │   └── references/
│   │   ├── core-patterns/
│   │   └── ...
│   └── agents/                       # SINGLE SOURCE OF TRUTH (10 shared agents)
│       ├── git.md
│       ├── synthesizer.md
│       ├── coder.md
│       └── ...
├── plugins/                          # Plugin collection (17 plugins)
│   ├── devflow-specify/
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json
│   │   ├── commands/
│   │   ├── agents/                   # GENERATED shared agents (gitignored)
│   │   ├── skills/                   # GENERATED skills (gitignored)
│   │   └── README.md
│   ├── devflow-implement/
│   ├── devflow-code-review/
│   ├── devflow-resolve/
│   ├── devflow-debug/
│   ├── devflow-self-review/
│   ├── devflow-core-skills/
│   └── devflow-audit-claude/
├── docs/
│   └── reference/                    # Extracted reference docs
├── scripts/
│   ├── build-plugins.ts
│   ├── build-hud.js                  # Copies dist/hud/ → scripts/hud/
│   ├── hud.sh                        # Thin wrapper: exec node hud/index.js
│   ├── hud/                          # GENERATED — compiled HUD module (gitignored)
│   └── hooks/                        # Working Memory + ambient + learning hooks
│       ├── stop-update-memory       # Stop hook: writes WORKING-MEMORY.md
│       ├── session-start-memory     # SessionStart hook: injects memory + git state
│       ├── pre-compact-memory       # PreCompact hook: saves git state backup
│       ├── ambient-prompt           # UserPromptSubmit hook: ambient skill injection
│       ├── stop-update-learning     # Stop hook: triggers background learning
│       ├── background-learning      # Background: pattern detection via Sonnet
│       ├── json-helper.cjs           # Node.js jq-equivalent operations
│       └── json-parse               # Shell wrapper: jq with node fallback
└── src/
    └── cli/
        ├── commands/
        │   ├── init.ts
        │   ├── list.ts
        │   ├── memory.ts
        │   ├── learn.ts
        │   ├── ambient.ts
        │   ├── hud.ts
        │   └── uninstall.ts
        ├── hud/                          # HUD module (TypeScript source)
        │   ├── index.ts                  # Entry point: stdin → gather → render → stdout
        │   ├── types.ts                  # StdinData, HudConfig, ComponentId, etc.
        │   ├── config.ts                 # PRESETS, loadConfig, saveConfig
        │   ├── render.ts                 # Smart multi-line layout assembly
        │   └── components/               # 14 individual component renderers
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
  "version": "1.1.0",
  "agents": ["git", "coder", "synthesizer"],
  "skills": ["implementation-patterns", "self-review"]
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
- **Plugin-specific** (1): `claude-md-auditor` — committed directly in its plugin

## Settings Override

`devflow init --override-settings` replaces `~/.claude/settings.json`.

Included settings:
- `statusLine` - Configurable HUD with presets (replaces legacy statusline.sh)
- `hooks` - Working Memory hooks (Stop, SessionStart, PreCompact) + Learning Stop hook
- `env.ENABLE_TOOL_SEARCH` - Deferred MCP tool loading (~85% token savings)
- `env.ENABLE_LSP_TOOL` - Language Server Protocol support
- `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` - Agent Teams for peer-to-peer collaboration
- `extraKnownMarketplaces` - DevFlow plugin marketplace (`dean0x/devflow`)
- `permissions.deny` - Security deny list (140 blocked operations) + sensitive file patterns

## Working Memory Hooks

Three hooks in `scripts/hooks/` provide automatic session continuity. Toggleable via `devflow memory --enable/--disable/--status` or `devflow init --memory/--no-memory`.

A fourth hook (`stop-update-learning`) provides self-learning. Toggleable via `devflow learn --enable/--disable/--status` or `devflow init --learn/--no-learn`:

| Hook | Event | File | Purpose |
|------|-------|------|---------|
| `stop-update-memory` | Stop | `.memory/WORKING-MEMORY.md` | Throttled (skips if <2min fresh). Slim instruction after first write. |
| `session-start-memory` | SessionStart | reads WORKING-MEMORY.md | Injects previous memory + git state as `additionalContext`. Warns if >1h stale. Injects pre-compact snapshot when compaction occurred mid-session. |
| `pre-compact-memory` | PreCompact | `.memory/backup.json` | Saves git state + WORKING-MEMORY.md snapshot. Bootstraps minimal WORKING-MEMORY.md if none exists. |

**Flow**: Session ends → Stop hook checks throttle (skips if <2min fresh) → spawns background updater → background updater reads session transcript + git state → fresh `claude -p --model haiku` writes WORKING-MEMORY.md. On `/clear` or new session → SessionStart injects memory as `additionalContext` (system context, not user-visible) with staleness warning if >1h old.

Hooks auto-create `.memory/` on first run — no manual setup needed per project.

## Project Knowledge

Knowledge files in `.memory/knowledge/` capture decisions and pitfalls that agents can't rediscover at runtime:

| File | Format | Source | Purpose |
|------|--------|--------|---------|
| `decisions.md` | ADR-NNN (sequential) | `/implement` Phase 11.5 | Architectural decisions — why choices were made |
| `pitfalls.md` | PF-NNN (sequential) | `/code-review`, `/debug`, `/resolve` | Known gotchas, fragile areas, past bugs |

Each file has a `<!-- TL;DR: ... -->` comment on line 1. SessionStart injects TL;DR headers only (~30-50 tokens). Agents read full files when relevant to their work. Cap: 50 entries per file.

## HUD (Heads-Up Display)

The HUD (`scripts/hud.sh` → `scripts/hud/index.js`) is a configurable TypeScript status line with 14 components and 4 presets:

| Preset | Components | Layout |
|--------|-----------|--------|
| Minimal | directory, git branch, model, context % | Single line |
| Classic | + ahead/behind, diff stats, version badge | Single line |
| Standard (default) | + session duration, usage quota | 2 lines |
| Full | + tool/agent activity, todos, speed, config counts | 3-4 lines |

Configuration: `~/.devflow/hud.json` (preset + component toggles). Manage via `devflow hud --configure`.

Data source: `context_window.current_usage` from Claude Code's JSON stdin. Git data gathered with 1s per-command timeout. Overall 2s timeout with graceful degradation.
