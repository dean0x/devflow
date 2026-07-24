# CLI Reference

## Installation

```bash
npx devflow-kit init
```

The interactive wizard offers two modes:
- **Recommended** (default) — Sensible defaults, quick setup
- **Advanced** — Full interactive flow with all options

Use `--recommended` or `--advanced` flags for non-interactive setup.

### Init Options

| Option | Description |
|--------|-------------|
| `--plugin <names>` | Comma-separated plugin names (e.g., `implement,code-review`) |
| `--scope <user\|local>` | Installation scope (default: user) |
| `--ambient` / `--no-ambient` | Enable/disable ambient mode — orchestrator charter + plan handoff (default: on) |
| `--memory` / `--no-memory` | Enable/disable working memory (default: on) |
| `--learning` / `--no-learning` | Enable/disable learning agent (default: on) |
| `--knowledge` / `--no-knowledge` | Enable/disable feature knowledge (default: on) |
| `--rules` / `--no-rules` | Enable/disable rules (default: on) |
| `--hud` / `--no-hud` | Enable/disable HUD status line (default: on) |
| `--proxy` / `--no-proxy` | Enable/disable external model routing — GPT models via OpenAI/Codex subscription (default: off; Advanced-only, requires Codex auth) |
| `--hud-only` | Install only the HUD (no plugins, hooks, or extras) |
| `--recommended` | Apply recommended defaults after plugin selection (skip advanced prompts) |
| `--advanced` | Show all configuration prompts |
| `--reset` | Factory reset — restore all defaults, ignoring prior installation state; mutually exclusive with `--plugin` |
| `--security <user\|managed\|none>` | Security deny list location (default: user) |
| `--verbose` | Show detailed output |

### Scopes

- `--scope user` (default) — Install for all projects (`~/.claude/`)
- `--scope local` — Install for current project only (`.claude/`)

## Plugin Management

```bash
npx devflow-kit init --plugin=implement       # Install specific plugin
npx devflow-kit init --plugin=implement,code-review  # Install multiple
```

### Available Plugins

| Plugin | Type | Description |
|--------|------|-------------|
| `devflow-plan` | Core | Unified design planning with gap analysis |
| `devflow-implement` | Core | Complete task implementation lifecycle |
| `devflow-code-review` | Core | Comprehensive code review |
| `devflow-resolve` | Core | Review issue resolution |
| `devflow-debug` | Core | Competing hypothesis debugging |
| `devflow-explore` | Core | Codebase exploration with knowledge base creation |
| `devflow-research` | Core | Multi-type research with trust-aware synthesis |
| `devflow-release` | Core | Adaptive release with learned configuration |
| `devflow-self-review` | Core | Simplifier + Scrutinizer |
| `devflow-bug-analysis` | Core | Proactive bug finding with static and semantic analysis |
| `devflow-ambient` | Core | Ambient mode (orchestrator charter + plan handoff) |
| `devflow-core-skills` | Core | Auto-activating quality skills |
| `devflow-audit-claude` | Optional | CLAUDE.md file audit |
| `devflow-typescript` | Language | TypeScript patterns |
| `devflow-react` | Language | React patterns |
| `devflow-accessibility` | Language | Web accessibility patterns |
| `devflow-ui-design` | Language | UI design patterns |
| `devflow-go` | Language | Go patterns |
| `devflow-python` | Language | Python patterns |
| `devflow-java` | Language | Java patterns |
| `devflow-rust` | Language | Rust patterns |

## Ambient Mode

```bash
npx devflow-kit ambient --enable     # Enable ambient mode (orchestrator charter + plan handoff)
npx devflow-kit ambient --disable    # Disable ambient mode
npx devflow-kit ambient --status     # Show current status (partial state detected and reported)
```

## Learning

```bash
npx devflow-kit learning --enable     # Enable learning (decision + pitfall detection)
npx devflow-kit learning --disable    # Disable learning (drains the learning queue)
npx devflow-kit learning --status     # Show status and entry counts
npx devflow-kit learning --list       # List all decisions and pitfalls
npx devflow-kit learning --configure  # Interactive config (model, debug, scope)
npx devflow-kit learning --clear      # Reset all observations
npx devflow-kit learning --reset      # Remove all learning state files
```

## Feature Knowledge

```bash
npx devflow-kit knowledge list              # List knowledge bases
npx devflow-kit knowledge --enable          # Enable feature knowledge
npx devflow-kit knowledge --disable         # Disable feature knowledge
npx devflow-kit knowledge --status          # Show current status
```

## Rules

```bash
npx devflow-kit rules --enable       # Install rules from manifest plugins
npx devflow-kit rules --disable      # Remove all installed rules
npx devflow-kit rules --status       # Show installed rules with source plugin
npx devflow-kit rules --list         # Show all available rules with install status and shadow state
npx devflow-kit rules list           # List all rules with install status and shadow state
```

## HUD (Status Line)

```bash
npx devflow-kit hud --status         # Show current HUD config
npx devflow-kit hud --enable         # Enable HUD
npx devflow-kit hud --disable        # Disable HUD
npx devflow-kit hud --detail         # Show tool/agent descriptions
npx devflow-kit hud --no-detail      # Hide tool/agent descriptions
```

## Security (Deny List)

```bash
npx devflow-kit security --status            # Show deny list state + entry counts + location
npx devflow-kit security --enable            # Install deny list (user settings, default)
npx devflow-kit security --enable --managed  # Install into system managed settings
npx devflow-kit security --disable           # Remove the deny list from all locations
```

## Safe-Delete

```bash
npx devflow-kit safe-delete --status   # Show install state (installed/outdated/absent/unknown)
npx devflow-kit safe-delete --enable   # Install the rm -> trash shell function
npx devflow-kit safe-delete --disable  # Remove the safe-delete shell function
```

## Skill Shadowing

Override any Devflow skill with your own version. Shadowed skills survive `devflow init` — your version is installed instead of Devflow's.

```bash
npx devflow-kit skills shadow software-design    # Create override (copies current as reference)
vim ~/.devflow/skills/software-design/SKILL.md   # Edit your override
npx devflow-kit skills list                      # List all skills with shadow state
npx devflow-kit skills unshadow software-design  # Remove override
```

## Rule Shadowing

Override any Devflow rule with your own version. Shadowed rules survive `devflow init` — your version is installed instead of Devflow's.

```bash
npx devflow-kit rules shadow security            # Create rule override (seeds from installed or source)
vim ~/.devflow/rules/security.md                 # Edit your override
npx devflow-kit rules list                       # List all rules with install status and shadow state
npx devflow-kit rules unshadow security          # Remove override
```

## Feature Flags

```bash
npx devflow-kit flags --list           # List all flags with current state
npx devflow-kit flags --enable <flag>  # Enable a flag
npx devflow-kit flags --disable <flag> # Disable a flag
npx devflow-kit flags --status         # Show enabled flags
```

Notable flags (default OFF):

| Flag | Default | Description |
|------|---------|-------------|
| `agent-teams` | OFF | Enables Claude Code's experimental Agent Teams via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`. Enable with `devflow flags --enable agent-teams`. |

## External Model Routing (Devflow Proxy)

Route Devflow agents through GPT models via your OpenAI/Codex subscription. When enabled, a local Devflow proxy relay intercepts agent requests and forwards them to the configured model.

**Requirements:** Codex auth at `~/.codex/auth.json`; the Devflow proxy relay package installed; an active OpenAI/Codex subscription. Configure through the Advanced init wizard or the CLI below.

```bash
npx devflow-kit proxy --enable   # Enable external model routing (runs preflight checks)
npx devflow-kit proxy --disable  # Disable and revert agents to Claude defaults
npx devflow-kit proxy --status   # Show routing status, port, and active relay PID
npx devflow-kit proxy --port <n> # Set the relay port (default: 4141)
```

| Option | Description |
|--------|-------------|
| `--enable` | Enable routing — runs preflight, writes `~/.devflow/proxy.json` and `~/.devflow/proxy-routing.json`, injects `ANTHROPIC_BASE_URL` into `settings.json`, applies saved agent model mapping |
| `--disable` | Disable routing — reverts agent frontmatter to Claude defaults, removes env override; mapping is preserved for re-enable |
| `--status` | Show enabled/disabled, port, relay PID (if running), and relay binary path |
| `--port <n>` | Override the relay port (default 4141); takes effect on next enable |

Takes effect in new Claude Code sessions after `--enable`. The relay auto-starts on `SessionStart` and `UserPromptSubmit` via the `ensure-proxy` hook. Routing state is stored in `~/.devflow/proxy.json`; per-agent model mapping in `~/.devflow/agent-models.json`.

## Per-Agent Model Configuration (devflow agents)

Configure which AI model each Devflow agent uses. Changes persist across reinstalls — Devflow reapplies your mapping after every `devflow init`.

```bash
npx devflow-kit agents                                      # Open interactive TUI (requires TTY)
npx devflow-kit agents --list                               # List all agents with current model assignment
npx devflow-kit agents --set <agent> --model <model>        # Assign a model to one agent
npx devflow-kit agents --set <agent> --effort <level>       # Assign an effort level to one agent
npx devflow-kit agents --set <agent> --model default        # Clear model override (restores shipped default)
npx devflow-kit agents --reset                              # Clear all agent customisations (prompts for confirmation)
npx devflow-kit agents --reset --yes                        # Skip confirmation prompt
```

**TUI keybindings:**

| Key | Action |
|-----|--------|
| `↑` / `↓` or `k` / `j` | Navigate agents |
| `Tab` | Switch between model and effort fields |
| `←` / `→` or `Space` | Cycle active field (model or effort) |
| `d` | Reset active field to default |
| `Enter` | Confirm and save all changes |
| `Escape` / `q` | Quit without saving |

GPT model assignments are **dormant** when external model routing is disabled — they are saved to `~/.devflow/agent-models.json` but not applied to agent frontmatter until routing is enabled. The TUI shows dormant GPT assignments with a dim annotation (`gpt-5.5 saved`). Enabling routing re-applies the mapping; disabling routing reverts frontmatter to Claude defaults while preserving your mapping.

## Uninstall

```bash
npx devflow-kit uninstall
```

| Option | Description |
|--------|-------------|
| `--scope <user\|local>` | Uninstall scope (default: auto-detect all installed scopes) |
| `--plugin <names>` | Selective uninstall by plugin name |
| `--keep-docs` | Preserve `.devflow/docs/` directory |
| `--dry-run` | Show what would be removed |
| `--verbose` | Show detailed output |
