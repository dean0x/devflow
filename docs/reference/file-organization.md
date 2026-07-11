# File Organization

Detailed source tree, plugin structure, build distribution, and installation paths.

## Source Structure

```
devflow/
├── .claude-plugin/                   # Marketplace registry (repo root)
│   └── marketplace.json
├── shared/
│   ├── skills/                       # SINGLE SOURCE OF TRUTH (40 skills)
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
├── plugins/                          # Plugin collection (22 plugins)
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
│   └── hooks/                        # Capture + memory + dream + ambient hooks
│       ├── capture-prompt           # UserPromptSubmit hook: appends user turn to memory + dream queues (independently gated)
│       ├── capture-turn             # Stop hook: appends assistant turn to memory + dream queues; never spawns
│       ├── capture-question         # PostToolUse hook (matcher: AskUserQuestion): appends answered questions to both queues
│       ├── queue-append             # Shared helper: queue_append_row / queue_append_both / queue_read_gates
│       ├── memory-worker            # Stop hook (registered after capture-turn): 120s throttle, spawns background-memory-update
│       ├── background-memory-update # Detached claude -p haiku worker: rewrites WORKING-MEMORY.md (spawned by memory-worker)
│       ├── dream-lock               # Shared helper: mkdir-based locking
│       ├── session-start-memory     # SessionStart hook: injects memory + git state; recovers orphaned .pending-turns.processing itself
│       ├── session-start-context    # SessionStart hook: injects decisions TL;DR + the Dream agent spawn directive when the queue is pending
│       ├── session-start-orchestrator # SessionStart hook (ambient, presence-gated): injects orchestrator charter (git repos only)
│       ├── pre-compact-memory       # PreCompact hook: saves git state backup
│       ├── preamble                 # UserPromptSubmit hook (ambient, presence-gated): plan-handoff fast-path + slash skip + orchestrator reminder (git repos only)
│       ├── git-marker               # Sourced helper: df_has_git_marker — bounded upward walk to detect git repos (no subprocess)
│       ├── get-mtime                # Shared helper: portable mtime (BSD/GNU stat)
│       ├── hook-bootstrap           # Shared helper: sources debug-trace + common setup
│       ├── hook-log-init            # Shared helper: log initialization
│       ├── debug-trace              # Shared helper: debug tracing (sourced via hook-bootstrap)
│       ├── run-hook                 # Shared helper: hook runner with logging; exits 0 when the named script is absent
│       ├── log-paths                # Shared helper: per-project log path resolution
│       ├── ensure-devflow-init      # Shared helper: lazy .devflow/ directory creation
│       ├── decisions-usage-scan.cjs # Decisions usage scanning
│       ├── json-helper.cjs          # Node.js jq-equivalent operations
│       ├── json-parse               # Shell wrapper: jq with node fallback
│       ├── assets/                  # Static prose assets shipped with hooks
│       │   └── orchestrator-charter.md  # Static charter asset: injected by session-start-orchestrator
│       └── lib/                     # Node.js helper modules
│           ├── project-paths.cjs      # Project slug + path resolution
│           └── safe-path.cjs          # Path safety validation
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

- **Shared** (16): `git`, `synthesizer`, `skimmer`, `simplifier`, `coder`, `reviewer`, `triager`, `evaluator`, `tester`, `scrutinizer`, `validator`, `designer`, `knowledge`, `researcher`, `bug-analyzer`, `dream`
- **Plugin-specific** (1): `claude-md-auditor` — committed directly in its plugin

## Settings Override

`devflow init --override-settings` replaces `~/.claude/settings.json`.

Included settings:
- `statusLine` - Configurable HUD with presets (replaces legacy statusline.sh)
- `hooks` - Capture + Dream hooks (UserPromptSubmit, PostToolUse, Stop, SessionStart, PreCompact)
- `env.ENABLE_TOOL_SEARCH` - Deferred MCP tool loading (~85% token savings)
- `env.ENABLE_LSP_TOOL` - Language Server Protocol support
- `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` - Agent Teams (not in settings template by default; enabled on demand via the optional `agent-teams` Claude Code flag — `devflow flags --enable agent-teams`)
- `extraKnownMarketplaces` - Devflow plugin marketplace (`dean0x/devflow`)
- `permissions.deny` - Security deny list (140 blocked operations) + sensitive file patterns

## Capture + Dream Hooks

A capture/spawn split across always-on shell-script hooks. Queue-append (`capture-prompt`/`capture-turn`/`capture-question`) is unconditional; each queue write is independently gated per-feature by dream config. Memory refresh is toggleable via `devflow memory --enable/--disable/--status` or `devflow init --memory/--no-memory`; decisions detection/curation via `devflow decisions --enable/--disable/--status` or `devflow init --decisions/--no-decisions`.

| Hook / Worker | Event | Purpose |
|---------------|-------|---------|
| `capture-prompt` | UserPromptSubmit | Appends the user turn to `.devflow/memory/.pending-turns.jsonl` and `.devflow/dream/.pending-turns.jsonl` (each gated independently); emits no directive |
| `capture-turn` | Stop | Appends the assistant turn to both queues; runs the decisions usage scanner; never spawns anything |
| `capture-question` | PostToolUse (matcher: `AskUserQuestion`) | Appends each answered question as a `{role:"qa"}` row to both queues |
| `memory-worker` | Stop (registered after `capture-turn` — append-before-spawn ordering) | After the 120s throttle (keyed by `.working-memory-last-trigger` mtime), spawns `background-memory-update` as a detached `nohup` worker (`claude -p --model haiku`) |
| `background-memory-update` | Detached worker (spawned by `memory-worker`) | Drains `.pending-turns.jsonl` → calls `claude -p --model haiku` (prompt on stdin) → rewrites `WORKING-MEMORY.md` with `<!-- memory-head: <sha> branch: <name> -->` on line 1. On success: removes `.processing`, touches `.last-refresh-ok`. On failure: leaves `.processing` for crash recovery at next SessionStart. |
| `session-start-memory` | SessionStart | Reads the already-fresh `WORKING-MEMORY.md` and injects it as `additionalContext` with a git-reconciled 3-state header (A in-sync / B drifted / C refresh-failing banner); also recovers an orphaned `.pending-turns.processing` itself (self-contained cold path) |
| `session-start-context` | SessionStart | Injects the decisions TL;DR and, when the dream queue is non-empty (or a crashed run left a stale `.processing` batch), a `--- DREAM MAINTENANCE ---` directive instructing the main model to **silently** spawn the background Dream agent with the resolved model (project → global `decisions.json` → `opus` default) |
| `pre-compact-memory` | PreCompact | Saves git state + WORKING-MEMORY.md snapshot |
| `session-start-orchestrator` | SessionStart (ambient, presence-gated) | Injects the orchestrator charter as `additionalContext`; silent outside git repos |
| `preamble` | UserPromptSubmit (ambient, presence-gated) | Plan-handoff fast-path (`Implement the following plan:` → `devflow:implement`), slash skip, and orchestrator reminder; silent outside git repos |

**Flow**: User sends prompt → `capture-prompt` appends the user turn to both queues → session ends → `capture-turn` appends the assistant turn to both queues, then `memory-worker` spawns `background-memory-update` (if the 120s throttle has expired) which rewrites `WORKING-MEMORY.md` directly via `claude -p`. On `/clear` or new session → `session-start-memory` injects the already-written `WORKING-MEMORY.md` as `additionalContext` (3-state git-reconciled header); `session-start-context` injects the decisions TL;DR and, when the dream queue has pending turns, the Dream maintenance directive — the main model silently spawns the Dream agent in the background, which claims the queue atomically, performs decision/pitfall detection and curation directly against the data files, deletes the claimed batch as its final act, and reports a 1–3 line summary.

`devflow memory --disable` disables Working Memory (hooks stay registered; queue writes for memory are skipped). Use `devflow memory --clear` to clean up pending memory queue files across all projects, or `devflow decisions --clear`/`--reset` for the dream queue and decisions state.

Hooks auto-create `.devflow/` on first run — no manual setup needed per project.

## Project Knowledge

Knowledge files in `.devflow/decisions/` capture decisions and pitfalls that agents can't rediscover at runtime:

| File | Format | Source | Purpose |
|------|--------|--------|---------|
| `decisions.md` | ADR-NNN (sequential) | Dream agent via `assign-anchor` (renders via `render-decisions.cjs`) | Architectural decisions — why choices were made |
| `pitfalls.md` | PF-NNN (sequential) | Dream agent via `assign-anchor` (renders via `render-decisions.cjs`) | Known gotchas, fragile areas, past bugs |
| `index.md` | Compact ADR/PF index | Rendered by `render-decisions.cjs` from `decisions-ledger.jsonl` alongside `decisions.md`/`pitfalls.md` | Compact write-time index consumed by workflow commands via plain Read |

`decisions.md` and `pitfalls.md` each have a `<!-- TL;DR: ... -->` comment on line 1; SessionStart injects these TL;DR headers only (~30-50 tokens). Agents read full files when relevant to their work. Cap: 50 entries per file. `index.md` has no TL;DR line and is not injected at SessionStart — it is the write-time artifact consumed via plain Read by workflow commands at invocation time (applies ADR-007).

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
