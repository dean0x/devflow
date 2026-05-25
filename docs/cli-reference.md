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
| `--teams` / `--no-teams` | Enable/disable Agent Teams (default: off) |
| `--ambient` / `--no-ambient` | Enable/disable ambient mode (default: on) |
| `--memory` / `--no-memory` | Enable/disable working memory (default: on) |
| `--learn` / `--no-learn` | Enable/disable self-learning (default: on) |
| `--decisions` / `--no-decisions` | Enable/disable decisions agent (default: on) |
| `--knowledge` / `--no-knowledge` | Enable/disable feature knowledge (default: on) |
| `--rules` / `--no-rules` | Enable/disable rules (default: on) |
| `--hud` / `--no-hud` | Enable/disable HUD status line (default: on) |
| `--hud-only` | Install only the HUD (no plugins, hooks, or extras) |
| `--verbose` | Show detailed output |

### Scopes

- `--scope user` (default) — Install for all projects (`~/.claude/`)
- `--scope local` — Install for current project only (`.claude/`)

## Plugin Management

```bash
npx devflow-kit list                          # List available plugins
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
| `devflow-ambient` | Core | Ambient mode (plan auto-detection and command awareness) |
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
npx devflow-kit ambient --enable     # Enable always-on ambient mode
npx devflow-kit ambient --disable    # Disable ambient mode
npx devflow-kit ambient --status     # Show current status
```

## Self-Learning

```bash
npx devflow-kit learn --enable       # Register the learning hook
npx devflow-kit learn --disable      # Remove the learning hook
npx devflow-kit learn --status       # Show status and observation counts
npx devflow-kit learn --list         # Show all observations by confidence
npx devflow-kit learn --configure    # Interactive config (model, throttle, caps)
npx devflow-kit learn --clear        # Reset all observations
npx devflow-kit learn --purge        # Remove invalid/corrupted entries
```

## Decisions

```bash
npx devflow-kit decisions --enable     # Register the decisions hook
npx devflow-kit decisions --disable    # Remove the decisions hook
npx devflow-kit decisions --status     # Show status and entry counts
npx devflow-kit decisions list         # List all decisions and pitfalls
npx devflow-kit decisions --configure  # Interactive config (model, throttle)
npx devflow-kit decisions --review     # Review observations or capacity
npx devflow-kit decisions --purge      # Remove invalid entries
npx devflow-kit decisions --clear      # Reset all observations
npx devflow-kit decisions --reset      # Remove all artifacts + log
```

## Feature Knowledge

```bash
npx devflow-kit knowledge list              # List knowledge bases with staleness
npx devflow-kit knowledge create <slug>     # Create a new knowledge base
npx devflow-kit knowledge check             # Check all for staleness
npx devflow-kit knowledge refresh [slug]    # Refresh stale knowledge base(s)
npx devflow-kit knowledge remove <slug>     # Remove a knowledge base
npx devflow-kit knowledge --enable          # Enable feature knowledge
npx devflow-kit knowledge --disable         # Disable feature knowledge
npx devflow-kit knowledge --status          # Show current status
```

## Rules

```bash
npx devflow-kit rules --enable       # Install rules from manifest plugins
npx devflow-kit rules --disable      # Remove all installed rules
npx devflow-kit rules --status       # Show installed rules with source plugin
npx devflow-kit rules --list         # Show all available rules with install status
```

## HUD (Status Line)

```bash
npx devflow-kit hud --status         # Show current HUD config
npx devflow-kit hud --enable         # Enable HUD
npx devflow-kit hud --disable        # Disable HUD
npx devflow-kit hud --detail         # Show tool/agent descriptions
npx devflow-kit hud --no-detail      # Hide tool/agent descriptions
```

## Skill Shadowing

Override any Devflow skill with your own version. Shadowed skills survive `devflow init` — your version is installed instead of Devflow's.

```bash
npx devflow-kit skills shadow software-design    # Create override (copies current as reference)
vim ~/.devflow/skills/software-design/SKILL.md   # Edit your override
npx devflow-kit skills list-shadowed             # List all overrides
npx devflow-kit skills unshadow software-design  # Remove override
```

## Feature Flags

```bash
npx devflow-kit flags --list           # List all flags with current state
npx devflow-kit flags --enable <flag>  # Enable a flag
npx devflow-kit flags --disable <flag> # Disable a flag
npx devflow-kit flags --status         # Show enabled flags
```

## Uninstall

```bash
npx devflow-kit uninstall
```

| Option | Description |
|--------|-------------|
| `--scope <user\|local>` | Uninstall scope (default: user) |
| `--plugin <names>` | Selective uninstall by plugin name |
| `--keep-docs` | Preserve `.devflow/docs/` directory |
| `--dry-run` | Show what would be removed |
| `--verbose` | Show detailed output |
