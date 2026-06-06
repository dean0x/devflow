# File Organization

Detailed source tree, plugin structure, build distribution, and installation paths.

## Source Structure

```
devflow/
├── .claude-plugin/                   # Marketplace registry (repo root)
│   └── marketplace.json
├── shared/
│   ├── skills/                       # SINGLE SOURCE OF TRUTH (45 skills)
│   │   ├── git/
│   │   │   ├── SKILL.md
│   │   │   └── references/
│   │   ├── software-design/
│   │   └── ...
│   └── agents/                       # SINGLE SOURCE OF TRUTH (16 shared agents)
│       ├── git.md
│       ├── synthesizer.md
│       ├── coder.md
│       └── ...
├── plugins/                          # Plugin collection (21 plugins)
│   ├── devflow-plan/
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
│   ├── devflow-explore/
│   ├── devflow-research/
│   ├── devflow-release/
│   ├── devflow-self-review/
│   ├── devflow-bug-analysis/
│   ├── devflow-ambient/
│   ├── devflow-core-skills/
│   └── devflow-audit-claude/
├── docs/
│   └── reference/                    # Extracted reference docs
├── scripts/
│   ├── build-plugins.ts
│   ├── build-hud.js                  # Copies dist/hud/ → scripts/hud/
│   ├── hud.sh                        # Thin wrapper: exec node hud/index.js
│   ├── hud/                          # GENERATED — compiled HUD module (gitignored)
│   └── hooks/                        # Dream + ambient + memory hooks
│       ├── dream-capture            # Stop hook: captures turns to queue, writes markers when throttle expires
│       ├── dream-dispatch           # UserPromptSubmit hook: capture-only (appends user turn to queue)
│       ├── dream-recover            # Shared helper: recovers stale .processing markers
│       ├── dream-collect-tasks      # Shared helper: collects pending dream markers
│       ├── dream-evaluate           # SessionEnd hook: orchestrator sourcing eval-* feature modules
│       ├── dream-lock               # Shared helper: mkdir-based locking
│       ├── eval-helpers             # SessionEnd module: shared setup sourced by dream-evaluate
│       ├── eval-decisions           # SessionEnd module: decisions marker (DIALOG_PAIRS)
│       ├── eval-knowledge           # SessionEnd module: knowledge staleness refresh
│       ├── eval-curation            # SessionEnd module: curation marker
│       ├── session-start-memory     # SessionStart hook: injects memory + git state
│       ├── session-start-context    # SessionStart hook: emits DREAM MAINTENANCE directive + decisions TL;DR + learned behaviors
│       ├── pre-compact-memory       # PreCompact hook: saves git state backup
│       ├── preamble                 # UserPromptSubmit hook: ambient keyword + plan auto-detection (zero overhead for normal prompts)
│       ├── get-mtime                # Shared helper: portable mtime (BSD/GNU stat)
│       ├── hook-bootstrap           # Shared helper: sources debug-trace + common setup
│       ├── hook-log-init            # Shared helper: log initialization
│       ├── debug-trace              # Shared helper: debug tracing (sourced via hook-bootstrap)
│       ├── run-hook                 # Shared helper: hook runner with logging
│       ├── log-paths                # Shared helper: per-project log path resolution
│       ├── ensure-devflow-init      # Shared helper: lazy .devflow/ directory creation
│       ├── decisions-usage-scan.cjs # Decisions usage scanning
│       ├── json-helper.cjs          # Node.js jq-equivalent operations
│       ├── json-parse               # Shell wrapper: jq with node fallback
│       └── lib/                     # Node.js helper modules
│           ├── dream-ops.cjs          # Dream marker + queue operations
│           ├── feature-knowledge.cjs  # Feature knowledge base index operations (CRUD, staleness)
│           ├── decisions-index.cjs    # Decisions index builder
│           ├── project-paths.cjs      # Project slug + path resolution
│           ├── safe-path.cjs          # Path safety validation
│           ├── staleness.cjs          # Code reference staleness checker
│           └── transcript-filter.cjs  # Transcript channel extractor
└── src/
    └── cli/
        ├── commands/
        │   ├── init.ts
        │   ├── list.ts
        │   ├── memory.ts
        │   ├── decisions.ts
        │   ├── ambient.ts
        │   ├── flags.ts
        │   ├── rules.ts
        │   ├── skills.ts
        │   ├── context.ts
        │   ├── hud.ts
        │   └── uninstall.ts
        ├── hud/                          # HUD module (TypeScript source)
        │   ├── index.ts                  # Entry point: stdin → gather → render → stdout
        │   ├── types.ts                  # StdinData, HudConfig, ComponentId, etc.
        │   ├── config.ts                 # PRESETS, loadConfig, saveConfig
        │   ├── render.ts                 # Smart multi-line layout assembly
        │   └── components/               # 15 individual component renderers
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
  "skills": ["patterns", "quality-gates"]
}
```

The `skills` and `agents` arrays declare which shared assets this plugin needs. `npm run build` copies them.

## Installation Paths

| Asset | Path | Notes |
|-------|------|-------|
| Commands | `~/.claude/commands/devflow/` | Namespaced |
| Agents | `~/.claude/agents/devflow/` | Namespaced |
| Skills | `~/.claude/skills/devflow:*/` | Namespaced (`devflow:` prefix) |
| Scripts | `~/.devflow/scripts/` | Helper scripts |
| Hooks | `~/.devflow/scripts/hooks/` | Working Memory hooks |
| Settings | `~/.claude/settings.json` | Devflow configuration |

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

- **Shared** (16): `git`, `synthesizer`, `skimmer`, `simplifier`, `coder`, `reviewer`, `resolver`, `evaluator`, `tester`, `scrutinizer`, `validator`, `designer`, `knowledge`, `researcher`, `bug-analyzer`, `dream`
- **Plugin-specific** (1): `claude-md-auditor` — committed directly in its plugin

## Settings Override

`devflow init --override-settings` replaces `~/.claude/settings.json`.

Included settings:
- `statusLine` - Configurable HUD with presets (replaces legacy statusline.sh)
- `hooks` - Dream hooks (UserPromptSubmit, Stop, SessionStart, SessionEnd, PreCompact)
- `env.ENABLE_TOOL_SEARCH` - Deferred MCP tool loading (~85% token savings)
- `env.ENABLE_LSP_TOOL` - Language Server Protocol support
- `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` - Agent Teams for peer-to-peer collaboration
- `extraKnownMarketplaces` - Devflow plugin marketplace (`dean0x/devflow`)
- `permissions.deny` - Security deny list (140 blocked operations) + sensitive file patterns

## Dream Hooks

Three shell-script hooks (`dream-capture`, `dream-dispatch`, `dream-evaluate`) replace the old 8-hook system with a background-maintenance (Dream) architecture. Toggleable via `devflow memory --enable/--disable/--status` or `devflow init --memory/--no-memory`.

| Hook | Event | Purpose |
|------|-------|---------|
| `dream-capture` | Stop | Captures user/assistant turns to `.devflow/memory/.pending-turns.jsonl` queue, writes `.devflow/dream/memory.json` marker when throttle expires (>2min) |
| `dream-dispatch` | UserPromptSubmit | Capture-only: appends the user turn to `.pending-turns.jsonl` (emits no directive) |
| `dream-evaluate` | SessionEnd | Orchestrator sourcing `eval-helpers` + 3 feature modules (`eval-decisions`, `eval-knowledge`, `eval-curation`); writes per-session decisions/knowledge/curation markers |
| `session-start-memory` | SessionStart | Injects previous memory + git state as `additionalContext`. Warns if >1h stale |
| `session-start-context` | SessionStart | Recovers stale `.processing` markers, collects pending markers, emits the DREAM MAINTENANCE directive (throttled to 120s); also injects decisions TL;DR + learned behaviors |
| `pre-compact-memory` | PreCompact | Saves git state + WORKING-MEMORY.md snapshot |
| `preamble` | UserPromptSubmit | Ambient keyword + plan auto-detection (zero overhead for normal prompts) |

**Flow**: User sends prompt → `dream-dispatch` appends the user turn to the queue → session ends → `dream-capture` appends the assistant turn to the queue, writes the memory marker when throttle has expired (>2min) → `dream-evaluate` writes decisions/knowledge/curation markers. On `/clear` or new session → `session-start-memory` injects memory as `additionalContext` with staleness warning if >1h old, and `session-start-context` emits the DREAM MAINTENANCE directive instructing the main model to spawn ONE background Dream agent (`Agent(subagent_type="Dream", run_in_background:true)`) that claims each marker, performs all detection/materialization/curation, then deletes the marker.

`devflow memory --disable` disables Working Memory. Use `devflow memory --clear` to clean up pending queue files across all projects.

Hooks auto-create `.devflow/` on first run — no manual setup needed per project.

## Project Knowledge

Knowledge files in `.devflow/decisions/` capture decisions and pitfalls that agents can't rediscover at runtime:

| File | Format | Source | Purpose |
|------|--------|--------|---------|
| `decisions.md` | ADR-NNN (sequential) | Dream agent via `decisions-append` | Architectural decisions — why choices were made |
| `pitfalls.md` | PF-NNN (sequential) | Dream agent via `decisions-append` | Known gotchas, fragile areas, past bugs |

Each file has a `<!-- TL;DR: ... -->` comment on line 1. SessionStart injects TL;DR headers only (~30-50 tokens). Agents read full files when relevant to their work. Cap: 50 entries per file.

## HUD (Heads-Up Display)

The HUD (`scripts/hud.sh` → `scripts/hud/index.js`) is a configurable TypeScript status line with 15 components and 4 presets:

| Preset | Components | Layout |
|--------|-----------|--------|
| Minimal | directory, git branch, model, context % | Single line |
| Classic | + ahead/behind, diff stats, version badge | Single line |
| Standard (default) | + session duration, usage quota | 2 lines |
| Full | + tool/agent activity, todos, speed, config counts | 3-4 lines |

Configuration: `~/.devflow/hud.json` (preset + component toggles). Manage via `devflow hud --configure`.

Data source: `context_window.current_usage` from Claude Code's JSON stdin. Git data gathered with 1s per-command timeout. Overall 2s timeout with graceful degradation.
