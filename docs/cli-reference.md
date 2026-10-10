# CLI Reference

## Installation

```bash
npx devflow-kit init
```

The interactive wizard offers two modes:
- **Recommended** (default) — Sensible defaults, quick setup
- **Advanced** — Full interactive flow with all options, including one attribution question (Recommended never asks); the non-interactive path is `devflow flags --enable/--disable suppress-attribution` — there is no `--attribution` init flag

Use `--recommended` or `--advanced` flags for non-interactive setup.

### Init Options

| Option | Description |
|--------|-------------|
| `--plugin <names>` | Comma-separated plugin names (e.g., `implement,code-review`) |
| `--ambient` / `--no-ambient` | Enable/disable ambient mode — orchestrator charter + plan handoff (default: on) |
| `--memory` / `--no-memory` | Enable/disable working memory (default: on) |
| `--learning` / `--no-learning` | Enable/disable learning agent (default: on); with learning off, init installs the learning-off prompts and not `devflow:apply-decisions` |
| `--knowledge` / `--no-knowledge` | Enable/disable feature knowledge (default: on) |
| `--rules` / `--no-rules` | Enable/disable rules (default: on) |
| `--hud` / `--no-hud` | Enable/disable HUD status line (default: on) |
| `--proxy` / `--no-proxy` | Enable/disable external model routing — GPT models via OpenAI/Codex subscription (default: off; Advanced-only, requires Codex auth) |
| `--compliance <list>` / `--no-compliance` | Enable compliance with comma-separated framework IDs (e.g., `gdpr,hipaa`) / disable preserving frameworks (default: off; bypasses the wizard entirely when passed) |
| `--tracker <id>` | The machine's default issue tracker provider: `github`, `jira`, or `linear` (default: `github`); a repository's `.devflow/project.json` can select its own. Suppresses the tracker wizard question on both init paths. There is no `--no-tracker` — `--tracker github` is the default |
| `--hud-only` | Install only the HUD (no plugins, hooks, or extras) |
| `--recommended` | Apply recommended defaults after plugin selection (skip advanced prompts) |
| `--advanced` | Show all configuration prompts |
| `--reset` | Factory reset — restore all defaults, ignoring prior installation state; mutually exclusive with `--plugin` |
| `--security <user\|managed\|none>` | Security deny list location (default: user) |
| `--verbose` | Show detailed output |

### Install location

Devflow installs machine-wide, into the Claude Code directory and `~/.devflow`:

- The Claude Code directory is `$CLAUDE_CONFIG_DIR` when it is set to an absolute path, else `~/.claude` — the same directory Claude Code itself reads.
- `~/.devflow` is always the machine root. `DEVFLOW_DIR` is ignored.
- There is no project-local install. `init --scope local` exits 1 and points at `devflow uninstall --scope local`, which removes an old project-local install (`<repo>/.claude` and `<repo>/.devflow` install artifacts) without touching anything under your home directory.

### Your hooks stay yours

`init`, the `ambient`, `memory` and `proxy` toggles, and `uninstall` add and remove only the hooks devflow wrote in `settings.json`. A hook is devflow's only when its command ends in `/scripts/hooks/run-hook <name>`, or in a form an older release wrote (such as `/scripts/hooks/session-start-memory.sh`). A hook of yours whose command merely mentions a devflow hook's name (`capture-turn`, `memory-worker`, `ensure-proxy`, ...) is never touched, and removing a devflow hook leaves the other hooks in its matcher group in place, in order.

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

`--enable` registers the hooks under `~/.devflow`, where `init` installs them, and re-points any ambient hook devflow registered under another directory. A hook is devflow's only when its command ends in `/scripts/hooks/run-hook <name>`: your own hooks, and any hooks sharing a matcher group with devflow's, are never removed, even when their commands mention `preamble`.

## Learning

```bash
npx devflow-kit learning --enable         # Enable learning (decision + pitfall detection; installs the learning-on prompts and the apply-decisions skill)
npx devflow-kit learning --disable        # Disable learning (drains the learning queue; installs the learning-off prompts and removes the skill)
npx devflow-kit learning --status         # Show status and entry counts
npx devflow-kit learning --list           # List entries, inactive entries with their notes, and observations
npx devflow-kit learning --show <id>      # Print one entry (ADR-NNN or PF-NNN) or observation as JSON
npx devflow-kit learning --restore <id>   # Make an inactive entry active again
npx devflow-kit learning --configure      # Interactive config (model, debug, scope)
npx devflow-kit learning --clear          # Drop the observations no entry uses; drain the queue
npx devflow-kit learning --reset          # Remove all learning state files
```

`learning --status` counts the active entries by type, the inactive ones by status, the active entries still in the v1 format and the observations, and warns when it skipped malformed lines. `--status`, `--list` and `--show` write nothing. `--restore` brings back an entry that was retired, superseded, encoded or deprecated, and maintenance reviews it again. `--clear` keeps every observation an entry uses and drops the rest, then drains the learning queue; when the ledger has a malformed line it writes nothing, leaves the queue in place and exits 1. `--reset` removes `.devflow/learning/`; when there is none it prints `No learning data to reset.`, creates nothing and exits 0. `--restore`, `--clear` and `--reset` wait at most 5 seconds for the learning lock, and when it stays busy they change nothing and exit 1.

## Feature Knowledge

```bash
npx devflow-kit knowledge list              # List knowledge bases
npx devflow-kit knowledge --enable          # Enable feature knowledge
npx devflow-kit knowledge --disable         # Disable feature knowledge
npx devflow-kit knowledge --status          # Show current status
```

`memory --status`, `learning --status` and `knowledge --status` report the machine-wide switch. A repository can only narrow it: when the switch is on but the current directory's repository turns the feature off — under `features` in the committed `.devflow/project.json`, or in your personal `.devflow/config.json` — the output adds `Effective here: disabled (<file>)`, naming that file. When nothing narrows it, the line is absent and the output is unchanged. `knowledge --status` also prints `Effective here: disabled (<file> is unreadable)` when a repository file exists but is not a JSON object: commands then switch knowledge write-back off, while memory and learning capture carry on as the machine switch says. `--enable` turns a feature on in every project, and says so, but a repository can still opt out this way.

When the current checkout's `.devflow/config.json` is tracked by git, `memory`, `learning`, `knowledge` and `tracker --status` also warn that devflow ignores it — the file holds personal settings, and a committed copy would let a branch set them for whoever checks it out — and print the fix: `git rm --cached .devflow/config.json`.

## Compliance

Manage this machine's compliance frameworks: the always-on compliance rule and the frameworks stamped into the compliance skill.

```bash
npx devflow-kit compliance --status                    # Show frameworks, skill/rule state and the repo's evidence policy
npx devflow-kit compliance --enable                    # Enable compliance on this machine (installs the stamped rule)
npx devflow-kit compliance --disable                   # Disable it (removes the rule; frameworks remembered)
npx devflow-kit compliance --set gdpr,hipaa            # Set active frameworks (comma-separated IDs)
npx devflow-kit compliance --set ""                    # Zero frameworks: generic controls only (stays enabled)
```

Available frameworks: `gdpr`, `hipaa`, `pci-dss`, `soc2`, `iso-27001`, `sox`

The compliance skill and compliance rule are feature-owned (not plugin-scoped); compliance is off by default. **Every install carries the skill and all six framework references**, whatever this machine selects, because a repository can declare its own frameworks. The machine switch owns only two things: the **rule** — installed and stamped with your frameworks when compliance is on, absent when it is off — and the **stamp** on the skill's SKILL.md (your frameworks, or a neutral stamp when off). SKILL.md and the rule are **dynamically composed** at install time from per-framework fragments. `--status` shows `[shadowed]` when a skill shadow is present; `[shadowed, composition skipped — per-framework sections absent]` when the shadow has no composition tokens (C1 passthrough), and names any framework id in the manifest that the registry does not know.

**The review lens is per repository.** `/code-review` and `/plan` run the compliance review from the local settings line's `COMPLIANCE` field: this machine's frameworks plus the ids in the repository's `.devflow/project.json` `compliance` list — `generic` controls only when either declares compliance with no ids, and no lens at all when neither declares it. The reviewing agent loads `references/{id}.md` for those ids and no others, so a repository declaring `hipaa` gets a HIPAA review on a machine with compliance off, and that machine's rule is never installed or changed by it. `/implement` and `/resolve` pass the same ids to their Code agents.

**Evidence policy.** Enabled compliance — at any framework count, zero included — makes `required` the floor of the evidence policy on this machine: a repository with no committed evidence setting (`evidence` in `.devflow/project.json`) resolves `required`, and a committed `standard` is raised to it. A repository is held to the same floor when its `.devflow/project.json` — on the default branch, its tracking branch or the working tree, never HEAD alone — carries a `compliance` key, whatever its value. `--status` also shows the policy resolved for the current directory's repository, as `Evidence policy: <required|standard> (source: <file|worktree|default|invalid|error>)` plus any warnings (`remote-unavailable`, `invalid-file`, `raised-by-compliance`, `pr-changes-policy`). When the repository declares `compliance`, `--status` adds, under `Frameworks:`, the lines the review lens is folded from: `Repository: <ids> (.devflow/project.json)` for this checkout's file (`Repository: generic controls only (.devflow/project.json is unreadable)` when it cannot be read), `Default branch: <ids> (its .devflow/project.json)` for the default branch's copy as your clone's tracking branch holds it — each only when that copy declares `compliance` — and `Effective here: <ids> (this machine + the default branch + this checkout)` — the union the review actually loads. An empty or malformed list reads `generic controls only`. While a retired `.devflow/policy.json` is in the working tree it adds a `Migration:` hint: the file is never read, and where `project.json` has no `evidence` its presence alone holds the repository at `required` (`invalid-file`), so the hint prints the `project.json` line for each value — `{"version":1,"evidence":"standard"}` or `{"version":1,"evidence":"required"}` — and says to keep `policy.json` until every teammate runs devflow 3.0 or later. `--enable` and `--set` print the keys to add to `.devflow/project.json` on the default branch — `{"version":1,"evidence":"required","compliance":[…]}` with this machine's frameworks — merged into the file when the repository already has one, never replacing it, so the policy applies to everyone working in the repository. The CLI never writes that file: the team owns it.

## Issue Tracker

Select which issue tracker devflow's traceability speaks to. `github` is the default and needs no configuration.

```bash
npx devflow-kit tracker --status            # Show the provider, this repo's effective one and conventions; re-arms inference
npx devflow-kit tracker --set jira          # Set the machine's default provider
npx devflow-kit tracker --set github        # Back to the default (there is no --no-tracker)
npx devflow-kit tracker                     # No flag: print usage and the valid provider IDs
```

Valid provider IDs: `github`, `jira`, `linear`. The ID is matched **exactly** — `JIRA`, `jira ` and `jira-cloud` are rejected with an error rather than repaired, so a typo never silently selects a tracker you did not name. `--status` wins when both flags are passed.

The machine default is stored in `~/.devflow/manifest.json` under `features.tracker.provider`. A malformed value in that file is self-healed to `github` silently on read.

**A repository can select its own tracker** in its committed `.devflow/project.json` — `{"tracker":{"provider":"jira","site":"https://acme.atlassian.net","key":"ACME"}}` — and devflow follows it there automatically, on every teammate's machine. The provider resolves in this order: the repository's `project.json`, then the machine default, then `github`. Your personal `.devflow/config.json` `tracker` key can only narrow that, to `github` or to the same provider; one that names a different provider makes the Git agent report `TRACEABILITY: DEGRADED (tracker configuration mismatch (repository override))` and make no tracker call; correct or drop that key to fix it. A `config.json` that git tracks is ignored, override included. The Git agent learns all of this from the one local settings line (`resolve-settings.cjs`), never by reading the files itself.

**Every install carries every provider.** All 47 generated reference files are installed under the `devflow:git` skill — every provider's mechanics, the tool-call contract `references/tracker/_mcp.md` and the PR-host mechanics — plus the Tracker agent. `devflow tracker --set <id>` therefore installs nothing: it writes the manifest, re-arms the attempt counters and writes the `~/.devflow/.tracker.enabled` sentinel (the provider's name; removed for `github`), in that order.

`devflow tracker --status` prints the machine provider; an `Effective:` line when the current directory's repository selects one — `Effective:   jira (project)`; whether the effective provider's conventions file has been learned, and its path — `none` on GitHub, which learns no conventions; and a `Mechanics:` line — `installed (N file(s))`, `MISSING — run devflow init`, or `unreadable (<errno>)`. The three are different facts with different remedies: nothing installed is fixed by an install, a permissions problem is not.

### When the wizard asks

`devflow init` asks for a provider only when the question can be answered interactively:

| Invocation | Asks? |
|---|---|
| `--advanced` (TTY) | Yes, always |
| Interactive run where you chose Recommended at the Setup-mode prompt | Yes |
| `--recommended` flag | No — applies the seeded value silently |
| Non-TTY / piped | No |
| Any run passing `--tracker <id>` | No — the flag is honoured on both paths |

`--reset` collapses the provider back to `github`.

### Learned conventions

When a session's provider — the repository's, else the machine's, as your personal `config.json` narrows it — is not `github`, a background agent runs once at a session start and writes `~/.devflow/tracker/{provider}.md` — the project key, issue types, required fields, workflow transitions, assignee policy and reference rendering it could establish, with a `# UNRESOLVED:` line for anything it could not. It is written **once or not at all**, mode `0600`, and it is never overwritten: to re-learn, delete it. Each provider has its own file, learned from the **first repository that uses that provider**; a second Jira repository with a different project key reads the first one's file, and the key and site in its own `project.json` take precedence over it.

The conventions files are **per-developer, not team-shared.** They live in your home directory, not the repository, so every teammate gets their own — and they are treated as **your content** on `devflow uninstall`: an artifacts-only sweep keeps them. If a file's frontmatter `provider:` does not name its own provider, devflow reports `TRACEABILITY: DEGRADED (tracker configuration mismatch (conventions file))` and makes no tracker call, rather than acting on stale conventions.

Upgrading moves an existing `~/.devflow/tracker.md` to `~/.devflow/tracker/{provider}.md`, by the provider its frontmatter names, once; a file whose frontmatter names no provider stays where it is, with a warning. Existing `tracker.md.{previous}.bak` files are left alone as your content.

### The inference attempt cap

Background inference is capped at **5** attempts per provider, counted in `~/.devflow/.tracker.{provider}.attempts`, so a permanently unreachable tracker cannot respawn a background agent at every session start forever — and one broken provider cannot use up another's attempts. Every `devflow init` run and both `devflow tracker` subcommands reset every provider's counter and give inference another five tries:

| Command | Re-arms? |
|---|---|
| `devflow init` (any run, any path) | Yes |
| `devflow tracker --set <id>` | Yes |
| `devflow tracker --status` | Yes — asking why nothing is being learned is what hands back another five tries |

Deleting a `~/.devflow/.tracker.{provider}.attempts` file by hand has the same effect for that provider.

### Known Unknowns — Linear

Two facts behind Linear traceability are **inherited rather than measured**, and devflow states them instead of presenting a guess as a measurement.

- **The comment-body cap is borrowed.** Devflow truncates a Linear comment at 32,767 characters — the cap it uses for Jira. Linear publishes no cap that devflow has measured. Borrowed too generously, a long post is rejected at the tracker and degrades with a reason; borrowed too strictly, a body that would have fit is truncated with a pointer to the local artifact. Either way nothing is lost silently.
- **A duplicate back-link is possible.** On a stock Linear workspace devflow cannot ask the tracker which account it is, so it cannot tell its own comments from anyone else's — the lowest rung of its dedup ladder, rank 4. It therefore **posts with a warning** rather than staying silent: every run emits `TRACEABILITY: DEGRADED (dedup unavailable — duplicate possible)`, and each comment carries a first-line marker plus the devflow project URL so a later run can recognise it. A missing release back-link is worse than a second one you were told about.

Both are tracked in [issue #343](https://github.com/dean0x/devflow/issues/343), which names the two files the borrowed values live in so a measurement lands in one change.

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

A `statusLine` is devflow's only when its command ends in `/.devflow/scripts/hud.sh` (or the older `/.devflow/scripts/statusline.sh`). Any other `statusLine` is yours: `init`, `init --no-hud`, `hud --disable` and `uninstall` leave it alone, and `hud --enable` asks before replacing it.

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
npx devflow-kit skills list                      # List all skills: shadow state and which plugin provides each
npx devflow-kit skills unshadow software-design  # Remove override
```

A shadow is seeded from the installed copy when there is one, else from the shipped source. The `compliance` skill is the exception: it is always seeded from the shipped source, because its installed copy is already stamped with this machine's frameworks — a shadow seeded from that would freeze the stamp, and a later `devflow compliance --set` could never change it.

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
| `${DEVFLOW_COMPLIANCE_ACTIVE}` | Active Frameworks section body: this machine's frameworks (a neutral stamp when compliance is off), then the rule that the ids a run is given — never the files present — decide which references load |
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

All 31 flags by kind and devflow default:

| Flag ID | Kind | Target | Devflow Default |
|---------|------|--------|-----------------|
| `tui` | boolean | setting `tui` | `true` (fullscreen) |
| `tool-search` | boolean | env `ENABLE_TOOL_SEARCH` | `true` |
| `lsp` | boolean | env `ENABLE_LSP_TOOL` | `true` |
| `prompt-caching-1h` | boolean | env `ENABLE_PROMPT_CACHING_1H` | `true` |
| `show-turn-duration` | boolean | setting `showTurnDuration` | `true` |
| `clear-context-on-plan` | boolean | setting `showClearContextOnPlanAccept` | `true` |
| `disable-bundled-skills` | boolean | setting `disableBundledSkills` | `false` |
| `pin-sonnet-4-6` | boolean | env `ANTHROPIC_DEFAULT_SONNET_MODEL` | `false`¹ |
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
| `suppress-attribution` | boolean | setting `attribution` | `false` ²|
| `subagent-spawn-depth` | number | env `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` | unset (upstream: 3) |
| `workflow-size-guideline` | enum | setting `workflowSizeGuideline` | unset (`small\|medium\|large\|unrestricted`) |
| `default-model` | string | env `ANTHROPIC_DEFAULT_MODEL` | unset |
| `goal-checkin-minutes` | number | env `CLAUDE_CODE_GOAL_CHECKIN_MINUTES` | unset (upstream: 30 min) |
| `bash-max-timeout-ms` | number | env `BASH_MAX_TIMEOUT_MS` | unset (upstream: 600000 ms)³ |
| `auto-compact-window` | number | env `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | unset⁴ |
| `spellcheck` | string | setting `spellcheck` | unset |
| `view-mode` | enum | setting `viewMode` | `default` (key omitted when default) |

¹ Boolean flags targeting an env var write the flag's configured string value when enabled (e.g., `claude-sonnet-4-6` for `pin-sonnet-4-6`), not `1` or `true`. The env var is deleted when the flag is disabled or unset.

² `suppress-attribution` writes the object `{"commit":"","pr":""}` to the `attribution` key in `settings.json` when enabled — not `true`. Disabling or uninstalling removes the `attribution` key only when its current value exactly matches that shape; a custom attribution object is preserved. Enabling always replaces any existing `attribution` value, including a custom one.

³ `bash-max-timeout-ms` raises the ceiling on a foreground Bash command's `timeout` (600000 ms upstream; accepted range 600000–7200000). Agents run builds and tests in the foreground under an explicit timeout and report BLOCKED when a run that cannot be split exceeds the ceiling; `devflow flags --set bash-max-timeout-ms=900000` is the remedy they name. Unsetting the flag deletes `BASH_MAX_TIMEOUT_MS`.

⁴ `auto-compact-window` is opt-in: devflow writes `CLAUDE_CODE_AUTO_COMPACT_WINDOW` only when you set it (accepted range 100000–1000000), `devflow init` never does, and unsetting the flag deletes the key. It is not recommended yet: a smaller window compacts sooner, and the resume directive that follows a compaction has not been checked against a forced mid-`/implement` compaction. devflow does not write or manage the percent-based auto-compact override.

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
npx devflow-kit agents --set <agent> --effort <level>       # Assign an effort level to one agent (low, medium, high, xhigh, max)
npx devflow-kit agents --set <agent> --effort inherit       # Drop the agent's effort line so it follows your session
npx devflow-kit agents --set <agent> --effort default       # Clear effort override (restores the shipped effort, if any)
npx devflow-kit agents --set <agent> --model default        # Clear model override (restores shipped default)
npx devflow-kit agents --set memory --model <claude-model> --effort <level>   # Set the memory worker
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

**Effort.** An agent's effort has three states. `default` is no override: the agent keeps the effort it ships, and the EFFORT column reads `default (<shipped effort>)` when it ships one, plain `default` when it does not. A level (`low` to `max`) replaces the shipped effort. `inherit` drops the agent's `effort:` line altogether, so the agent follows your session's effort even when it ships one. `--effort default` removes an override or an `inherit` and restores the shipped effort on the next reapply. Effort applies whether or not external model routing is enabled.

**The memory entry.** `memory` is listed after the agents (state `worker`) and is set like an agent: `--set memory --model sonnet --effort medium`. Its model is cleared by `--set memory --model default`, its effort by `--set memory --effort default`, and both by `--reset` (which clears every customisation). It is a background worker, not an agent: it has no installed agent file, `devflow init` writes none for it, and it is left out of the agent counts. It takes Claude models only (an alias or a full `claude-` identifier) and the effort levels, not `inherit` and not a GPT model. It ships `claude-sonnet-5-5` at `high` effort, and `--list` shows that in the DEFAULT and EFFORT columns. The memory worker reads this entry at run time: it runs on `agents.memory` (default `claude-sonnet-5-5`, `high` effort), and `devflow agents` overrides either field. A value outside the worker domain, which only a hand edit can leave in the file, is ignored for that field alone and the shipped default runs in its place. The effort is passed to Claude Code 2.1.286 and newer; an older CLI runs the model alone.

GPT model assignments are **dormant** when external model routing is disabled — they are saved to `~/.devflow/agent-models.json` but not applied to agent frontmatter until routing is enabled. The TUI shows dormant GPT assignments with a dim annotation (`sol saved`). Enabling routing re-applies the mapping; disabling routing reverts frontmatter to Claude defaults while preserving your mapping. Model aliases (e.g. `sol`, `terra`, `luna`) auto-track the current generation — no config edit needed when new models ship.

## Uninstall

```bash
npx devflow-kit uninstall
```

| Option | Description |
|--------|-------------|
| `--scope <user\|local>` | Uninstall only the machine-wide install (`user`) or a legacy project-local install in the current repo (`local`; never touches your home directory, and exits 1 with "No legacy project-local install here" outside a git repository or in a repository rooted at your home directory) (default: auto-detect both) |
| `--plugin <names>` | Selective uninstall by plugin name. Assets are retained on behalf of the plugins the **manifest** records as installed — not the whole registry — so removing a plugin removes exactly its own skills, agents and rules and keeps only what a plugin you actually installed still needs |
| `--keep-docs` | Leave the repository's `.devflow/` project data untouched |
| `--dry-run` | Show what would be removed |
| `--verbose` | Show detailed output |

**Project data.** A full uninstall run interactively inside a git repository offers to remove that repository's `.devflow/` at the git root, wherever in the repository you run it. Before asking, it lists what it would remove and what it keeps: `features/`, `conventions.md`, `policy.json` and `project.json` are shared through git and are always kept, so an uncommitted edit to one of them survives. Outside a git repository, or in a repository rooted at your home directory (whose `.devflow/` is the machine-wide install), the step is skipped. If the repository's `.devflow` is a symbolic link, the step is skipped too and says so: devflow does not follow the link, so neither the link nor what it points to is touched, and `--dry-run` reports the same. `--keep-docs`, a non-interactive run, and answering no all leave `.devflow/` as it was.
