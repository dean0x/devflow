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
| `--compliance <list>` / `--no-compliance` | Enable compliance with comma-separated framework IDs (e.g., `gdpr,hipaa`) / disable preserving frameworks (default: off; bypasses the wizard entirely when passed) |
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
| `devflow-self-review` | Core | Simplify + Scrutinize |
| `devflow-bug-analysis` | Core | Proactive bug finding with static and semantic analysis |
| `devflow-ambient` | Core | Ambient mode (orchestrator charter + plan handoff) |
| `devflow-core-skills` | Core | Auto-activating quality skills |
| `devflow-typescript` | Language | TypeScript patterns |
| `devflow-react` | Language | React patterns |
| `devflow-accessibility` | Language | Web accessibility patterns |
| `devflow-ui-design` | Language | UI design patterns |
| `devflow-go` | Language | Go patterns |
| `devflow-python` | Language | Python patterns |
| `devflow-java` | Language | Java patterns |
| `devflow-rust` | Language | Rust patterns |
| `devflow-dynamic` | Optional | Dynamic workflow recipes — dependency-aware tickets→plan→build delivery pipeline |

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

## Compliance

Manage regulatory compliance framework reference files installed in the compliance skill.

```bash
npx devflow-kit compliance --status                    # Show installed frameworks and skill state
npx devflow-kit compliance --enable                    # Enable compliance feature (install skill + rule)
npx devflow-kit compliance --disable                   # Disable compliance feature
npx devflow-kit compliance --set gdpr,hipaa            # Set active frameworks (comma-separated IDs)
npx devflow-kit compliance --set ""                    # Clear all active frameworks
```

Available frameworks: `gdpr`, `hipaa`, `pci-dss`, `soc2`, `iso-27001`, `sox`

The compliance skill and compliance rule are feature-owned (not plugin-scoped); installed when compliance is enabled (`devflow compliance --enable` or `devflow init --compliance <list>`); opt-in, off by default. Active frameworks are determined by which `references/{id}.md` files are present in the installed skill directory. SKILL.md and the rule are **dynamically composed** at install time from per-framework fragments — only the selected frameworks appear in the installed artifacts. `--status` shows `[shadowed]` when a skill shadow is present; `[shadowed, composition skipped — per-framework sections absent]` when the shadow has no composition tokens (C1 passthrough).

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

The `compliance` skill and rule are dynamically composed at install time from per-framework fragment files. The skill template uses five tokens:

| Token | Resolved to |
|-------|------------|
| `${DEVFLOW_COMPLIANCE_SCOPE}` | Framework clause (`under GDPR, SOC 2`, or `under active compliance frameworks` at zero) appended to the opening body sentence |
| `${DEVFLOW_COMPLIANCE_ACTIVE}` | Active Frameworks section body listing the selected frameworks |
| `${DEVFLOW_COMPLIANCE_MAPPING}` | Full Framework Mapping table (header + one row per selected framework) |
| `${DEVFLOW_COMPLIANCE_CHECKLIST}` | Per-framework checklist items appended to the Checklist section |
| `${DEVFLOW_COMPLIANCE_REFERENCES}` | Per-framework `references/{id}.md` rows in the Extended References table |

The rule template uses one token: `${DEVFLOW_COMPLIANCE_RULE_BULLETS}` (per-framework `Apply ...` bullets). The active-framework clause `${DEVFLOW_COMPLIANCE_FRAMEWORKS}` is a separate placeholder handled by `stampComplianceRule`.

If you shadow `compliance`, the shadow's own tokens are replaced at install time; removing the placeholders makes `devflow compliance --set` a no-op for those lines (you own them entirely). Similarly, shadowing the compliance skill without the `${DEVFLOW_COMPLIANCE_...}` tokens bypasses per-framework composition — `devflow compliance --status` will show `[shadowed, composition skipped]`.

**Caveat**: a rule shadow seeded by copying the *installed* rule (rather than the source template) carries the already-composed content (tokens already replaced). Composition still runs against it — blank-line hygiene fires — but `--set` has no effect on the framework bullets or labels because those tokens are no longer present in the shadow.

## Feature Flags

```bash
npx devflow-kit flags                    # Interactive TUI (TTY only); non-TTY prints status table + exits 1
npx devflow-kit flags --status           # Show current flag states (non-destructive)
npx devflow-kit flags --list             # List all flags with kind, target, and default
npx devflow-kit flags --enable <ids>     # Enable boolean flag(s), comma-separated
npx devflow-kit flags --disable <ids>    # Disable boolean flag(s), comma-separated
npx devflow-kit flags --set <id=value>   # Set a flag value (repeatable); use 'unset' as value to clear
npx devflow-kit flags --unset <ids>      # Reset flag(s) to neutral, comma-separated
```

`--enable` and `--disable` accept boolean flags only. Non-boolean flags (enum, number, string) use `--set id=value`. Passing a non-boolean id to `--enable`/`--disable` prints an error and redirects to `--set`.

All 29 flags by kind and devflow default:

| Flag ID | Kind | Target | Devflow Default |
|---------|------|--------|-----------------|
| `tui` | boolean | setting `tui` | `true` (fullscreen) |
| `tool-search` | boolean | env `ENABLE_TOOL_SEARCH` | `true` |
| `lsp` | boolean | env `ENABLE_LSP_TOOL` | `true` |
| `prompt-caching-1h` | boolean | env `ENABLE_PROMPT_CACHING_1H` | `true` |
| `show-turn-duration` | boolean | setting `showTurnDuration` | `true` |
| `clear-context-on-plan` | boolean | setting `showClearContextOnPlanAccept` | `true` |
| `disable-bundled-skills` | boolean | setting `disableBundledSkills` | `true` |
| `pin-sonnet-4-6` | boolean | env `ANTHROPIC_DEFAULT_SONNET_MODEL` | `true`¹ |
| `max-concurrent-subagents` | number | env `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` | `40` (upstream: 20) |
| `brief` | boolean | env `CLAUDE_CODE_BRIEF` | `false` |
| `thinking-summaries` | boolean | setting `showThinkingSummaries` | `false` |
| `subprocess-env-scrub` | boolean | env `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` | `false` |
| `disable-nonessential-traffic` | boolean | env `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `false` |
| `forked-subagents` | boolean | env `CLAUDE_CODE_FORK_SUBAGENT` | `false` |
| `disable-adaptive-thinking` | boolean | env `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` | `false` |
| `always-thinking` | boolean | setting `alwaysThinkingEnabled` | `false` |
| `disable-git-instructions` | boolean | env `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS` | `false` |
| `disable-compact` | boolean | env `DISABLE_COMPACT` | `false` |
| `disable-1m-context` | boolean | env `CLAUDE_CODE_DISABLE_1M_CONTEXT` | `false` |
| `disable-autoupdater` | boolean | env `DISABLE_AUTOUPDATER` | `false` |
| `agent-teams` | boolean | env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | `false` |
| `enable-todo-tools` | boolean | env `CLAUDE_CODE_ENABLE_TODO_TOOLS` | `false` |
| `suppress-attribution` | boolean | setting `attribution` | `false` |
| `subagent-spawn-depth` | number | env `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` | unset (upstream: 3) |
| `workflow-size-guideline` | enum | setting `workflowSizeGuideline` | unset (`small\|medium\|large\|unrestricted`) |
| `default-model` | string | env `ANTHROPIC_DEFAULT_MODEL` | unset |
| `goal-checkin-minutes` | number | env `CLAUDE_CODE_GOAL_CHECKIN_MINUTES` | unset (upstream: 30 min) |
| `spellcheck` | string | setting `spellcheck` | unset |
| `view-mode` | enum | setting `viewMode` | `default` (key omitted when default) |

¹ Boolean flags targeting an env var write the flag's configured string value when enabled (e.g., `claude-sonnet-4-6` for `pin-sonnet-4-6`), not `1` or `true`. The env var is deleted when the flag is disabled or unset.

## External Model Routing (Devflow Proxy)

Route Devflow agents through GPT models via your OpenAI/Codex subscription. When enabled, a local Devflow proxy relay intercepts agent requests and forwards them to the configured model.

**Requirements:** Codex auth at `~/.codex/auth.json`; the Devflow proxy relay package installed; an active OpenAI/Codex subscription. Configure through the Advanced init wizard or the CLI below.

```bash
npx devflow-kit proxy --enable   # Enable external model routing (runs preflight checks)
npx devflow-kit proxy --disable  # Disable and revert agents to Claude defaults
npx devflow-kit proxy --status   # Show routing status, port, and active relay PID
npx devflow-kit proxy --enable --port <n>  # Enable on a specific port (default: 4141)
```

| Option | Description |
|--------|-------------|
| `--enable` | Enable routing — runs preflight, writes `~/.devflow/proxy.json` and `~/.devflow/proxy-routing.json`, starts and verifies the relay, injects `ANTHROPIC_BASE_URL` and `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT` into `settings.json`, applies saved agent model mapping |
| `--disable` | Disable routing — reverts agent frontmatter to Claude defaults, removes env override; mapping is preserved for re-enable; the relay process is left running for live sessions (a manual `kill <pid>` hint is shown) |
| `--status` | Show feature state (enabled/disabled, port), relay process and PID, `ANTHROPIC_BASE_URL` and `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT` env state, Codex auth content (not just existence), external-mapped agent count, cached model registry, and proxy log path |
| `--port <n>` | Override the relay port (default 4141); takes effect on next enable |

Takes effect in new Claude Code sessions after `--enable`. The relay auto-starts on `SessionStart` via the `ensure-proxy` hook; `UserPromptSubmit` exits immediately with no action (SessionStart handles all relay-start and warning logic). Routing state is stored in `~/.devflow/proxy.json`; per-agent model mapping in `~/.devflow/agent-models.json`.

## Per-Agent Model Configuration (devflow agents)

Configure which AI model each Devflow agent uses. Changes persist across reinstalls — Devflow reapplies your mapping after every `devflow init`.

```bash
npx devflow-kit agents                                      # Open interactive TUI (requires TTY)
npx devflow-kit agents --list                               # List all agents with current model assignment
npx devflow-kit agents --set <agent> --model <model>        # Assign a model to one agent (alias e.g. sol, terra, luna)
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
| `←` / `→` or `Space` | Cycle value of active field (← backward, →/Space forward) |
| `d` | Reset active field to default |
| `Enter` | Confirm and save all changes |
| `Escape` / `q` | Quit without saving |

GPT model assignments are **dormant** when external model routing is disabled — they are saved to `~/.devflow/agent-models.json` but not applied to agent frontmatter until routing is enabled. The TUI shows dormant GPT assignments with a dim annotation (`sol saved`). Enabling routing re-applies the mapping; disabling routing reverts frontmatter to Claude defaults while preserving your mapping. Model aliases (e.g. `sol`, `terra`, `luna`) auto-track the current generation — no config edit needed when new models ship.

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
