# File Organization

Detailed source tree, plugin structure, build distribution, and installation paths.

## Source Structure

```
devflow/
├── src/
│   ├── cli.ts                        # CLI entry point
│   ├── cli/                          # CLI command modules
│   │   ├── commands/                 # init.ts, init-seed.ts, memory.ts, learning.ts, ambient.ts,
│   │   │                             #   flags.ts, rules.ts, skills.ts, context.ts, hud.ts,
│   │   │                             #   uninstall.ts, safe-delete.ts, security.ts, debug.ts,
│   │   │                             #   capture.ts, legacy-hooks.ts, compliance.ts, proxy.ts,
│   │   │                             #   agents.ts, knowledge/
│   │   └── utils/                    # (empty — utilities moved to src/core/)
│   ├── core/                         # Shared logic (single source of truth for registry + utilities)
│   │   ├── plugins.ts                # DEVFLOW_PLUGINS registry — 21 plugin entries
│   │   ├── paths.ts                  # getPackageRoot + asset path helpers
│   │   ├── assets.ts                 # skillsDir, agentsDir, rulesDir, commandsDir, scriptsDir
│   │   ├── flags.ts                  # Claude Code flag registry (28 flags)
│   │   ├── fs-atomic.ts              # Atomic write helper (D34)
│   │   ├── manifest.ts               # Manifest read/write
│   │   ├── migrations.ts             # Run-once migration registry (2.x entries only; first: canonicalise-agent-keys-v1)
│   │   ├── git.ts                    # getGitRoot
│   │   ├── project-paths.ts          # Per-project .devflow/ path construction
│   │   └── ...                       # feature-config.ts, learning-tuning-config.ts, …
│   ├── hud/                          # HUD module (TypeScript source)
│   │   ├── index.ts                  # Entry point: stdin → gather → render → stdout
│   │   ├── render.ts                 # Smart multi-line layout assembly
│   │   ├── config.ts                 # PRESETS, loadConfig, saveConfig
│   │   └── components/               # 15 individual component renderers
│   ├── targets/claude-code/          # Claude Code install target
│   │   ├── installer.ts              # installViaFileCopy, composeScripts
│   │   ├── claude-paths.ts           # getInstallationPaths
│   │   ├── hooks.ts                  # Hook registration helpers
│   │   ├── post-install.ts           # Post-install setup
│   │   ├── legacy.ts                 # Legacy hook cleanup
│   │   └── templates/                # Settings and config templates
│   └── assets/                       # SINGLE SOURCE OF TRUTH for all installable assets
│       ├── skills/                   # 41 skills
│       │   ├── git/
│       │   │   ├── SKILL.md
│       │   │   └── references/
│       │   ├── software-design/
│       │   └── ...
│       ├── agents/                   # 16 agents
│       │   ├── git.md
│       │   ├── synthesize.md
│       │   ├── code.md
│       │   └── ...
│       ├── rules/                    # 13 rules (flat .md files)
│       │   ├── engineering.md
│       │   ├── security.md
│       │   └── ...
│       ├── commands/                 # Command sources
│       │   ├── *.mds                 # 13 MDS host files (compiled to dist/commands/ by build:mds)
│       │   ├── *.md                  # 1 static command file
│       │   └── _partials/            # 11 MDS partial files (no output-dir:, never compiled directly)
│       └── scripts/hooks/            # Capture + memory + learning + ambient hooks
│           ├── capture-prompt        # UserPromptSubmit hook: appends user turn to memory + learning queues (independently gated)
│           ├── capture-turn          # Stop hook: appends assistant turn to memory + learning queues; never spawns
│           ├── capture-question      # PostToolUse hook (matcher: AskUserQuestion): appends answered questions to both queues
│           ├── queue-append          # Shared helper: queue_append_row / queue_append_both / queue_read_gates
│           ├── memory-worker         # Stop hook (registered after capture-turn): 120s throttle, spawns background-memory-update
│           ├── background-memory-update # Detached claude -p sonnet 4.6 worker: rewrites WORKING-MEMORY.md (spawned by memory-worker)
│           ├── learning-lock         # Shared helper: mkdir-based locking
│           ├── session-start-memory  # SessionStart hook: injects memory + git state; recovers orphaned .pending-turns.processing itself
│           ├── session-start-context # SessionStart hook: injects decisions TL;DR + the Learning agent spawn directive when the queue is pending
│           ├── session-start-orchestrator # SessionStart hook (ambient, presence-gated): injects orchestrator charter (git repos only)
│           ├── pre-compact-memory    # PreCompact hook: saves git state backup
│           ├── preamble              # UserPromptSubmit hook (ambient, presence-gated): plan-handoff fast-path + slash skip + orchestrator reminder (git repos only)
│           ├── git-marker            # Sourced helper: df_has_git_marker — bounded upward walk to detect git repos (no subprocess)
│           ├── get-mtime             # Shared helper: portable mtime (BSD/GNU stat)
│           ├── hook-bootstrap        # Shared helper: sources debug-trace + common setup
│           ├── hook-log-init         # Shared helper: log initialization
│           ├── debug-trace           # Shared helper: debug tracing (sourced via hook-bootstrap)
│           ├── run-hook              # Shared helper: hook runner with logging; exits 0 when the named script is absent
│           ├── log-paths             # Shared helper: per-project log path resolution
│           ├── ensure-devflow-init   # Shared helper: lazy .devflow/ directory creation
│           ├── decisions-usage-scan.cjs # Decisions usage scanning
│           ├── json-helper.cjs       # Node.js jq-equivalent operations
│           ├── json-parse            # Shell wrapper: jq with node fallback
│           ├── assets/               # Static prose assets shipped with hooks
│           │   └── orchestrator-charter.md  # Static charter asset: injected by session-start-orchestrator
│           └── lib/                  # Node.js helper modules
│               ├── project-paths.cjs   # Project slug + path resolution
│               └── safe-path.cjs       # Path safety validation
├── scripts/                          # Dev tooling
│   ├── build-mds.ts                  # MDS compiler: src/assets/commands/*.mds → dist/commands/*.md
│   └── bump-version.ts               # Version bump script
├── docs/
│   └── reference/                    # Extracted reference docs
```

## Plugin Registry

Plugins are entries in `DEVFLOW_PLUGINS` in `src/core/plugins.ts` — no per-plugin directory structure required. Each entry declares:

```typescript
{
  name: 'devflow-implement',
  description: 'Complete task implementation workflow - accepts plan documents, issues, or task descriptions',
  commands: ['/implement'],
  agents: ['git', 'code', 'simplify', 'scrutinize', 'evaluate', 'test', 'validate', 'knowledge'],
  skills: ['patterns', 'qa', 'quality-gates', 'worktree-support', 'feature-knowledge', 'apply-feature-knowledge'],
  rules: [],
}
```

The `commands` array lists slash-command names (e.g., `'/implement'`). The installer maps each command name to a compiled `.md` file in `dist/commands/` and copies it to `~/.claude/commands/devflow/`. Skills, agents, and rules are copied directly from `src/assets/` — no build step required for them.

## Installation Paths

| Asset | Path | Notes |
|-------|------|-------|
| Commands | `~/.claude/commands/devflow/` | Namespaced; installed from `dist/commands/*.md` |
| Agents | `~/.claude/agents/devflow/` | Namespaced; installed from `src/assets/agents/` |
| Skills | `~/.claude/skills/devflow:*/` | Namespaced (`devflow:` prefix); installed from `src/assets/skills/` |
| Rules | `~/.claude/rules/devflow/` | Flat `.md`; installed from `src/assets/rules/` (plugin-scoped) |
| Scripts | `~/.devflow/scripts/` | Helper scripts |
| Hooks | `~/.devflow/scripts/hooks/` | Installed from `src/assets/scripts/hooks/`; Working Memory hooks |
| Settings | `~/.claude/settings.json` | Devflow configuration |

## Asset Distribution

Assets live once in `src/assets/` and install directly to the user's `~/.claude/` — no duplication in the repo. The only intermediate build step is compiling `.mds` command sources to `dist/commands/`.

| Asset type | Source | Install path | Build step |
|------------|--------|--------------|-----------|
| Skills | `src/assets/skills/{name}/` | `~/.claude/skills/devflow:{name}/` | None — edit → init |
| Agents | `src/assets/agents/{name}.md` | `~/.claude/agents/devflow/{name}.md` | None — edit → init |
| Rules | `src/assets/rules/{name}.md` | `~/.claude/rules/devflow/{name}.md` | None — edit → init |
| Commands | `dist/commands/{name}.md` | `~/.claude/commands/devflow/{name}.md` | `npm run build:mds` |
| Scripts | `src/assets/scripts/hooks/` | `~/.devflow/scripts/hooks/` | None — edit → init |

### Packaging

`npm pack` ships `dist/` (compiled JS + commands) and `src/assets/` (skills, agents, rules, scripts). No `plugins/` or `shared/` directories are included.

### Adding a Skill to a Plugin

1. Ensure skill exists in `src/assets/skills/{skill-name}/`
2. Add skill name to the plugin entry's `skills` array in DEVFLOW_PLUGINS (`src/core/plugins.ts`)
3. Run `node dist/cli.js init` to install

### Adding an Agent to a Plugin

1. Ensure agent exists in `src/assets/agents/{agent-name}.md`
2. Add agent name to the plugin entry's `agents` array in DEVFLOW_PLUGINS
3. Run `node dist/cli.js init` to install

### Agents

All 16 agents (`git`, `synthesize`, `skim`, `simplify`, `code`, `review`, `triage`, `evaluate`, `test`, `scrutinize`, `validate`, `design`, `knowledge`, `research`, `diagnose`, `learning`) are shared — committed directly in `src/assets/agents/`.

## Settings Override

`devflow init --override-settings` replaces `~/.claude/settings.json`.

Included settings:
- `statusLine` - Configurable HUD with presets (replaces legacy statusline.sh)
- `hooks` - Capture + Learning hooks (UserPromptSubmit, PostToolUse, Stop, SessionStart, PreCompact)
- `env.ENABLE_TOOL_SEARCH` - Deferred MCP tool loading (~85% token savings)
- `env.ENABLE_LSP_TOOL` - Language Server Protocol support
- `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` - Agent Teams (not in settings template by default; enabled on demand via the optional `agent-teams` Claude Code flag — `devflow flags --enable agent-teams`)
- `permissions.deny` - Security deny list (140 blocked operations) + sensitive file patterns

## Capture + Learning Hooks

A capture/spawn split across always-on shell-script hooks. Queue-append (`capture-prompt`/`capture-turn`/`capture-question`) is unconditional; each queue write is independently gated per-feature by feature config. Memory refresh is toggleable via `devflow memory --enable/--disable/--status` or `devflow init --memory/--no-memory`; learning detection/curation via `devflow learning --enable/--disable/--status` or `devflow init --learning/--no-learning`.

| Hook / Worker | Event | Purpose |
|---------------|-------|---------|
| `capture-prompt` | UserPromptSubmit | Appends the user turn to `.devflow/memory/.pending-turns.jsonl` and `.devflow/learning/.pending-turns.jsonl` (each gated independently); emits no directive |
| `capture-turn` | Stop | Appends the assistant turn to both queues; runs the decisions usage scanner; never spawns anything |
| `capture-question` | PostToolUse (matcher: `AskUserQuestion`) | Appends each answered question as a `{role:"qa"}` row to both queues |
| `memory-worker` | Stop (registered after `capture-turn` — append-before-spawn ordering) | After the 120s throttle (keyed by `.working-memory-last-trigger` mtime), spawns `background-memory-update` as a detached `nohup` worker (`claude -p --model claude-sonnet-4-6`) |
| `background-memory-update` | Detached worker (spawned by `memory-worker`) | Drains `.pending-turns.jsonl` → calls `claude -p --model claude-sonnet-4-6` (prompt on stdin) → rewrites `WORKING-MEMORY.md` with `<!-- memory-head: <sha> branch: <name> -->` on line 1. On success: removes `.processing`, touches `.last-refresh-ok`. On failure: leaves `.processing` for crash recovery at next SessionStart. |
| `session-start-memory` | SessionStart | Reads the already-fresh `WORKING-MEMORY.md` and injects it as `additionalContext` with a git-reconciled 3-state header (A in-sync / B drifted / C refresh-failing banner); also recovers an orphaned `.pending-turns.processing` itself (self-contained cold path) |
| `session-start-context` | SessionStart | Injects the decisions TL;DR and, when the learning queue is non-empty (or a crashed run left a stale `.processing` batch), a `--- LEARNING MAINTENANCE ---` directive instructing the main model to **silently** spawn the background Learning agent with the resolved model (project `.devflow/learning/learning.json` → global `~/.devflow/learning.json` → `opus` default) |
| `pre-compact-memory` | PreCompact | Saves git state + WORKING-MEMORY.md snapshot |
| `session-start-orchestrator` | SessionStart (ambient, presence-gated) | Injects the orchestrator charter as `additionalContext`; silent outside git repos |
| `preamble` | UserPromptSubmit (ambient, presence-gated) | Plan-handoff fast-path (`Implement the following plan:` → `devflow:implement`), slash skip, and orchestrator reminder; silent outside git repos |

**Flow**: User sends prompt → `capture-prompt` appends the user turn to both queues → session ends → `capture-turn` appends the assistant turn to both queues, then `memory-worker` spawns `background-memory-update` (if the 120s throttle has expired) which rewrites `WORKING-MEMORY.md` directly via `claude -p`. On `/clear` or new session → `session-start-memory` injects the already-written `WORKING-MEMORY.md` as `additionalContext` (3-state git-reconciled header); `session-start-context` injects the decisions TL;DR and, when the learning queue has pending turns, the Learning maintenance directive — the main model silently spawns the Learning agent in the background, which claims the queue atomically, performs decision/pitfall detection and curation directly against the data files, deletes the claimed batch as its final act, and reports a 1–3 line summary.

`devflow memory --disable` disables Working Memory (hooks stay registered; queue writes for memory are skipped). Use `devflow memory --clear` to clean up pending memory queue files across all projects, or `devflow learning --clear`/`--reset` for the learning queue and learning state.

Hooks auto-create `.devflow/` on first run — no manual setup needed per project.

## Project Knowledge

Knowledge files in `.devflow/learning/` capture decisions and pitfalls that agents can't rediscover at runtime:

| File | Format | Source | Purpose |
|------|--------|--------|---------|
| `decisions.md` | ADR-NNN (sequential) | Learning agent via `assign-anchor` (renders via `render-decisions.cjs`) | Architectural decisions — why choices were made |
| `pitfalls.md` | PF-NNN (sequential) | Learning agent via `assign-anchor` (renders via `render-decisions.cjs`) | Known gotchas, fragile areas, past bugs |
| `index.md` | Compact ADR/PF index | Rendered by `render-decisions.cjs` from `decisions-ledger.jsonl` alongside `decisions.md`/`pitfalls.md` | Compact write-time index consumed by workflow commands via plain Read |

`decisions.md` and `pitfalls.md` each have a `<!-- TL;DR: ... -->` comment on line 1; SessionStart injects these TL;DR headers only (~30-50 tokens). Agents read full files when relevant to their work. Cap: 50 entries per file. `index.md` has no TL;DR line and is not injected at SessionStart — it is the write-time artifact consumed via plain Read by workflow commands at invocation time (applies ADR-007).

## HUD (Heads-Up Display)

The HUD (`dist/hud/index.js`) is a configurable TypeScript status line. The fixed component list is defined in `HUD_COMPONENTS` in `src/hud/config.ts` and includes: directory, git branch, git ahead/behind, diff stats, release info, worktree count, model, context usage, version badge, session cost, usage quota, todo progress, config counts, and learning counts.

Configuration: `~/.devflow/hud.json` (`{ enabled, detail }`). Manage via `devflow hud --status | --enable | --disable | --detail | --no-detail`.

Data source: `context_window.current_usage` from Claude Code's JSON stdin. Git data gathered with 1s per-command timeout. Overall 2s timeout with graceful degradation.

## Namespace Ownership and Orphan Sweep

### Devflow-Owned Namespaces

Devflow claims four namespaces inside `~/.claude/`:

| Namespace | Path | Content |
|-----------|------|---------|
| Commands | `~/.claude/commands/devflow/` | One `.md` file per command (e.g., `implement.md`) |
| Agents | `~/.claude/agents/devflow/` | One `.md` file per agent (e.g., `code.md`) |
| Rules | `~/.claude/rules/devflow/` | One `.md` file per rule (e.g., `security.md`) |
| Skills | `~/.claude/skills/devflow:*/` | One directory per skill (e.g., `devflow:software-design/`) |

These four namespaces hold the installed asset files. `devflow init` also writes `~/.claude/settings.json` (hook registrations, flags — including the `view-mode` enum flag) and `~/.devflow/` state files (manifest, migrations tracking, proxy config). The `devflow:` prefix on skills prevents collisions with other tool ecosystems.

### Orphan Sweep (install and selective uninstall)

An orphan is an installed asset whose name is no longer in the plugin registry — typically a retired or renamed agent/command/skill. Without active cleanup, orphans accumulate on disk indefinitely.

**Mechanism** (`src/core/orphan-sweep.ts: sweepOrphanedAssets`):

1. Read the directory listing for the target namespace.
2. Apply a name extractor (strips `.md` for agents/commands; strips `devflow:` prefix for skills).
3. Delete every entry whose extracted name is **not** in the `knownNames` set.
4. Return a `SweepResult` with counts and per-item errors — failures are non-fatal (avoids PF-009).

**When it runs** (`src/targets/claude-code/installer.ts: installViaFileCopy` and `src/cli/commands/uninstall.ts: sweepDevflowNamespaces`):

- **On every install** (`devflow init`): `installViaFileCopy` runs three sweeps — skills are swept before the skill-copy phase; commands and agents are swept after their respective copy phases. Either way, retired assets are removed on every `devflow init`, including partial installs.
- **On full uninstall** (`devflow uninstall`): `removeAllDevFlow` calls `sweepDevflowNamespaces` after removing its registry-and-legacy-list entries so that any orphaned `devflow:*` skill directories that left the registry are also cleaned up.
- **On selective uninstall** (`devflow uninstall --plugin <name>`): `sweepDevflowNamespaces` runs after per-plugin file removal. `knownNames` spans ALL plugins (not just the ones being uninstalled), so assets belonging to non-selected plugins are never swept.

The skills sweep matches entries starting with `devflow:` against `getAllSkillNames()` — non-Devflow skill directories are untouched.

### Full Uninstall (`devflow uninstall`)

`removeAllDevFlow` removes the entire owned namespace directories and the scripts directory:

```
rm -rf ~/.claude/commands/devflow/
rm -rf ~/.claude/agents/devflow/
rm -rf ~/.claude/rules/devflow/
rm -rf ~/.devflow/scripts/
```

Skills are removed individually rather than by namespace directory, because `~/.claude/skills/` is shared with other tools. Two separate passes run to avoid deleting foreign dirs (avoids PF-012):
- **Prefixed** (`devflow:name`): removed for every skill in the live registry ∪ `LEGACY_SKILL_NAMES`.
- **Bare** (unprefixed): removed only for entries in the frozen `LEGACY_SKILL_NAMES` list. A bare dir whose name matches a current registry skill is by construction foreign to Devflow (the `devflow:` namespace shipped in commit dcecda3, 2026-03-30) and must not be deleted.

### Selective Uninstall (`devflow uninstall --plugin <name>`)

1. Compute assets to remove via `computeAssetsToRemove` — skills and agents shared by remaining plugins are retained.
2. Remove individual files for each asset (agents, commands, skills, rules) belonging to the selected plugins.
3. Run `sweepDevflowNamespaces` for a registry-diff sweep across all three namespaces — catches any orphaned files whose names left the registry regardless of this uninstall run.

### Install Artifacts Removed on Uninstall

`removeDevFlowInstallArtifacts` removes Devflow-generated files from `~/.devflow/` on every uninstall path (decline, cancel, non-interactive, and `--keep-docs`). These are machine-generated and safe to delete — they are re-created on the next `devflow init`.

| Artifact | Path | Notes |
|----------|------|-------|
| Manifest | `~/.devflow/manifest.json` | Plugin/feature state |
| Migrations | `~/.devflow/migrations.json` | Run-once migration state |
| Agent overrides | `~/.devflow/agent-models.json` | Stale keys re-apply to renamed agents on reinstall |
| Logs | `~/.devflow/logs/` | Per-project hook logs + `proxy.log` |
| Costs | `~/.devflow/costs/` | Session cost history |
| Cache | `~/.devflow/cache/` | Model-discovery and HUD component caches |
| Proxy state | `~/.devflow/proxy.json`, `proxy-routing.json`, `proxy.pid`, `.proxy-spawn.lock/` | Relay runtime state |

User-authored files (`~/.devflow/skills/`, `~/.devflow/rules/`, `preference-profile.md`, `learning.json`, `hud.json`) are **never** removed by `removeDevFlowInstallArtifacts` — only by a confirmed full `~/.devflow/` wipe in an interactive session.
