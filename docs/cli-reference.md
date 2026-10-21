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
| `--curation` / `--no-curation` | Enable/disable curation (default: on); with curation off, init installs the curation-off prompts and not `devflow:apply-decisions` |
| `--knowledge` / `--no-knowledge` | Enable/disable feature knowledge (default: on) |
| `--rules` / `--no-rules` | Enable/disable rules (default: on) |
| `--hud` / `--no-hud` | Enable/disable HUD status line (default: on) |
| `--proxy` / `--no-proxy` | Enable/disable external model routing — GPT models via OpenAI/Codex subscription (default: off; Advanced-only, requires Codex auth) |
| `--behavior` / `--no-behavior` | Enable/disable the opt-in behavior rule — agents reply in ASD-STE100 Simplified Technical English (default: off; asked in the Advanced wizard only; a re-init keeps the recorded value) |
| `--compliance <list>` / `--no-compliance` | Enable compliance with comma-separated framework IDs (e.g., `gdpr,hipaa`) / disable preserving frameworks (default: off; bypasses the wizard entirely when passed) |
| `--tracker <id>` | The machine's default issue tracker provider: `github`, `jira`, or `linear` (default: `github`); a repository's `.devflow/project.json` can select its own. Suppresses the tracker wizard question on both init paths. There is no `--no-tracker` — `--tracker github` is the default |
| `--gate-level <full\|standard\|lean>` | The machine's default gate level: `full`, `standard`, or `lean` (default: `standard`); a personal `gateLevel` in `.devflow/config.json` still wins in its repository. Suppresses the gate level wizard question on both init paths. An invalid value, or no value, exits 1 before anything is written and the error names the valid levels; it cannot be combined with `--hud-only` |
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

### Your Explore agent stays yours

devflow ships an `Explore` agent that replaces Claude Code's built-in Explore in every session, plan mode included. Claude Code matches agents by exact name, so a lowercase `explore` is a different agent. If an agent file under your agents directory already defines `Explore`, `init` skips devflow's copy and warns. `uninstall` removes devflow's copy, and the built-in applies again.

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
| `devflow-self-review` | Core | Polish + Harden |
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

## Curation

```bash
npx devflow-kit curation --enable         # Enable curation (decision + pitfall detection; installs the curation-on prompts and the apply-decisions skill)
npx devflow-kit curation --disable        # Disable curation (drains the curation queue and the pending rows in the backups; installs the curation-off prompts and removes the skill)
npx devflow-kit curation --status         # Show status and entry counts
npx devflow-kit curation --list           # List entries, inactive entries with their notes, and observations
npx devflow-kit curation --show <id>      # Print one entry (ADR-NNN or PF-NNN) or observation as JSON
npx devflow-kit curation --restore <id>   # Make an inactive entry active again
npx devflow-kit curation --configure      # Interactive config (model, debug, scope)
npx devflow-kit curation --clear          # Drop the observations no entry uses; drain the queue
npx devflow-kit curation --reset          # Remove all curation state files
```

Devflow 3.8 renamed this command from `devflow learning`, and renamed the init flags `--learning` and `--no-learning` to `--curation` and `--no-curation`. The old names are not aliases. They fail with the unknown command or option error and exit 1. The data folder is now `.devflow/curation/`, and the tuning file is `curation.json`. The first `devflow init` or Claude Code session in a project moves the old `.devflow/learning/` folder. See the 3.8.0 upgrade notes in the changelog.

`curation --status` counts the active entries by type, the inactive ones by status, the active entries still in the v1 format and the observations, and warns when it skipped malformed lines. When a move left a backup folder, it prints one `Backup: <path>: N pending rows in the backup` line for each folder. Delete a backup only when its line shows 0 pending rows. A backup made on re-upgrade can hold the only copy of entries that 3.7 wrote. Check them before you delete it. `--status`, `--list` and `--show` write nothing. `--restore` brings back an entry that was retired, superseded, encoded or deprecated, and maintenance reviews it again. `--clear` keeps every observation an entry uses and drops the rest, then drains the curation queue; when the ledger has a malformed line it writes nothing, leaves the queue in place and exits 1. When git tracks any entry under `.devflow/learning/`, `.devflow/curation/` or a backup folder, or does not answer, the drain deletes no queue file and prints the notice that is described below. `--reset` removes `.devflow/curation/`; when there is none it prints `No curation data to reset.`, creates nothing and exits 0. `--restore`, `--clear` and `--reset` wait at most 5 seconds for the curation lock, and when it stays busy they change nothing and exit 1.

A project that still has the old `.devflow/learning/` folder is not read by `--status`, `--list` and `--show`. They print `Curation: run devflow init, or open Claude Code in this project after it`, or `Curation: move refused, see the hook log` when the move was refused or failed. The hook log names the cause.

The move skips a project, and changes nothing in it, when git tracks any entry under `.devflow/learning/`, `.devflow/curation/` or a backup folder (`.devflow/learning.backup-*`), or tracks an entry named `.devflow` itself. It also skips a project when a `.git` entry stands and git does not answer. In both cases devflow prints one fixed notice that holds nothing from the repository. When git tracks files, the notice says to run `git ls-files .devflow`, and then `git rm --cached <file>` for the files that git lists. Run these commands in the checkout that holds the folders. When git does not answer, the notice says that the move runs again at the next session start or the next init, and that you should check that git runs in the project if the notice stays. The HUD prints one short line for a skip. `devflow init` with curation off prints the notice once: when its `Ledger move skipped for <root>` line holds the notice, the drain of the queue adds only `The curation queue was not drained.` `--status`, `--list` and `--show` print the whole notice. They print it also when `.devflow/curation/` exists, and then they read that folder as usual: `--status` prints the notice before the counts, `--list` prints it before the listing, and `--show` prints it on stderr.

`--restore`, `--clear`, `--reset` and `--configure` (project scope) move the folder first. If another run holds the move lock, they print `Another run is moving this project's curation data.`, change nothing and exit 1. If a Curate run holds the queue claim, which holds the move for up to 15 minutes, they print `A Curate run holds this project's curation queue, and the move waits for it.`, change nothing and exit 1. If the move is refused or fails, they print the reason, change nothing and exit 1. If the move is skipped, they print `Ledger move skipped for <root>` and the notice, change nothing and exit 1. They also refuse, with a line that tells them to run `devflow init` first, when the installed scripts come from another version than the CLI.

`--enable` and `--disable` write the machine switch under both manifest keys, `features.curation` and `features.learning`, so a 3.7 install reads the same value. They try the move of the current project once and wait for no lock. If the move is skipped, they print the notice as a warning, and the exit code does not change. Under version skew they write both keys and move nothing. Only `--disable` drains the queue. The drain deletes the queue files of the current project in each ledger folder that exists and in the backups. When git tracks any entry under `.devflow/learning/`, `.devflow/curation/` or a backup folder, or does not answer, the drain deletes no queue file. It prints the notice once, and the switch stays recorded.

## Feature Knowledge

```bash
npx devflow-kit knowledge list              # List knowledge bases
npx devflow-kit knowledge --enable          # Enable feature knowledge
npx devflow-kit knowledge --disable         # Disable feature knowledge
npx devflow-kit knowledge --status          # Show current status
```

`memory --status`, `curation --status` and `knowledge --status` report the machine-wide switch. A repository can only narrow it: when the switch is on but the current directory's repository turns the feature off — under `features` in the committed `.devflow/project.json`, or in your personal `.devflow/config.json` — the output adds `Effective here: disabled (<file>)`, naming that file. When nothing narrows it, the line is absent and the output is unchanged. `knowledge --status` also prints `Effective here: disabled (<file> is unreadable)` when a repository file exists but is not a JSON object: commands then switch knowledge write-back off, while memory and curation capture carry on as the machine switch says. `--enable` turns a feature on in every project, and says so, but a repository can still opt out this way.

When the current checkout's `.devflow/config.json` is tracked by git, `memory`, `curation`, `knowledge`, `tracker --status` and `gates --status` also warn that devflow ignores it — the file holds personal settings, and a committed copy would let a branch set them for whoever checks it out — and say how to fix it: untrack the tracked entry with `git rm --cached`, then check or delete the file, because untracking leaves the committed bytes on disk as your personal file. The warning never prints the entry names.

## Behavior

The behavior rule is opt-in and off by default. It asks agents to write replies in ASD-STE100 Simplified Technical English: short sentences, one idea each, common words, active voice, simple tenses. Code, commands and quoted text keep their own form.

```bash
npx devflow-kit behavior --enable           # Turn it on (installs the rule)
npx devflow-kit behavior --disable          # Turn it off (removes the rule)
npx devflow-kit behavior --status           # Show whether it is on and whether the file is installed
```

The rule is feature-owned (not plugin-scoped), like the compliance rule, and installs only while rules are enabled (`devflow rules --enable`). `--enable` and `--disable` write the machine switch `features.behavior` and update the installed file at once. `devflow init --behavior` / `--no-behavior` set the same switch: a plain re-init keeps it and `--reset` returns it to off. A shadow at `~/.devflow/rules/behavior.md` replaces the shipped text.

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

**The review lens is per repository.** `/code-review` and `/plan` run the compliance review from the local settings line's `COMPLIANCE` field: this machine's frameworks plus the ids in the repository's `.devflow/project.json` `compliance` list — `generic` controls only when either declares compliance with no ids, and no lens at all when neither declares it. The reviewing agent loads `references/{id}.md` for those ids and no others, so a repository declaring `hipaa` gets a HIPAA review on a machine with compliance off, and that machine's rule is never installed or changed by it. When the lens is on, `/implement`, `/resolve`, `/debug` and `/dynamic-build` add one line to each Code agent's prompt that tells it to load the compliance skill and those references, and `/code-review` and `/plan` add one to the compliance-focus spawn. With the lens off no prompt carries anything about compliance.

**Evidence policy.** Enabled compliance — at any framework count, zero included — makes `required` the floor of the evidence policy on this machine: a repository with no committed evidence setting (`evidence` in `.devflow/project.json`) resolves `required`, and a committed `standard` is raised to it. A repository is held to the same floor when its `.devflow/project.json` — on the default branch, its tracking branch or the working tree, never HEAD alone — carries a `compliance` key, whatever its value. `--status` also shows the policy resolved for the current directory's repository, as `Evidence policy: <required|standard> (source: <file|worktree|default|invalid|error>)` plus any warnings (`remote-unavailable`, `invalid-file`, `raised-by-compliance`, `pr-changes-policy`). When the repository declares `compliance`, `--status` adds, under `Frameworks:`, the lines the review lens is folded from: `Repository: <ids> (.devflow/project.json)` for this checkout's file (`Repository: generic controls only (.devflow/project.json is unreadable)` when it cannot be read), `Default branch: <ids> (its .devflow/project.json)` for the default branch's copy as your clone's tracking branch holds it — each only when that copy declares `compliance` — and `Effective here: <ids> (this machine + the default branch + this checkout)` — the union the review actually loads. An empty or malformed list reads `generic controls only`. While a retired `.devflow/policy.json` is in the working tree it adds a `Migration:` hint: the file is never read, and where `project.json` has no `evidence` its presence alone holds the repository at `required` (`invalid-file`), so the hint prints the `project.json` line for each value — `{"version":1,"evidence":"standard"}` or `{"version":1,"evidence":"required"}` — and says to keep `policy.json` until every teammate runs devflow 3.0 or later. `--enable` and `--set` print the keys to add to `.devflow/project.json` on the default branch — `{"version":1,"evidence":"required","compliance":[…]}` with this machine's frameworks — merged into the file when the repository already has one, never replacing it, so the policy applies to everyone working in the repository. The CLI never writes that file: the team owns it.

## Issue Tracker

Select which issue tracker devflow's traceability speaks to. `github` is the default and needs no configuration.

```bash
npx devflow-kit tracker --status            # Show the provider, this repo's effective one and conventions; re-arms inference
npx devflow-kit tracker --set jira          # Set the machine's default provider
npx devflow-kit tracker --set github        # Back to the default (there is no --no-tracker)
npx devflow-kit tracker --servers atlassian,linear  # Tracker servers the Git and Tracker agents may call
npx devflow-kit tracker --servers default           # Back to the default list
npx devflow-kit tracker                     # No flag: print usage and the valid provider IDs
```

Valid provider IDs: `github`, `jira`, `linear`. The ID is matched **exactly** — `JIRA`, `jira ` and `jira-cloud` are rejected with an error rather than repaired, so a typo never silently selects a tracker you did not name. `--status` wins over `--set` and `--servers`; `--set` and `--servers` may be combined.

The machine default is stored in `~/.devflow/manifest.json` under `features.tracker.provider`. A malformed value in that file is self-healed to `github` silently on read.

**A repository can select its own tracker** in its committed `.devflow/project.json` — `{"tracker":{"provider":"jira","site":"https://acme.atlassian.net","key":"ACME"}}` — and devflow follows it there automatically, on every teammate's machine. The provider resolves in this order: the repository's `project.json`, then the machine default, then `github`. Your personal `.devflow/config.json` `tracker` key can only narrow that, to `github` or to the same provider; one that names a different provider makes the Git agent report `TRACEABILITY: DEGRADED (tracker configuration mismatch (repository override))` and make no tracker call; correct or drop that key to fix it. A `config.json` that git tracks is ignored, override included. The Git agent learns all of this from the one local settings line (`resolve-settings.cjs`), never by reading the files itself.

**Every install carries every provider.** All 47 generated reference files are installed under the `devflow:git` skill — every provider's mechanics, the tracker contract `references/tracker/_contract.md`, the tool-call contract `references/tracker/_mcp.md` and the PR-host mechanics — plus the Tracker agent. `devflow tracker --set <id>` therefore installs nothing: it writes the manifest, re-arms the attempt counters and writes the `~/.devflow/.tracker.enabled` sentinel (the provider's name; removed for `github`), in that order.

`devflow tracker --status` prints the machine provider; an `Effective:` line when the current directory's repository selects one — `Effective:   jira (project)`; whether the effective provider's conventions file has been learned, and its path — `none` on GitHub, which learns no conventions; and a `Mechanics:` line — `installed (N file(s))`, `MISSING — run devflow init`, or `unreadable (<errno>)`. The three are different facts with different remedies: nothing installed is fixed by an install, a permissions problem is not.

**Tracker servers.** The Git and Tracker agents hold a tool allowlist, and the installer appends one `mcp__<name>` entry per tracker server to their installed `tools:` line. The default list is `atlassian`, `jira`, `claude_ai_Atlassian`, `linear`, `claude_ai_Linear` (a claude.ai connector is `claude_ai_<Name>`); `github` is left out. `--servers` stores the list in `features.tracker.servers` and re-stamps the installed agents at once; `default` removes the key. Names match `^[A-Za-z0-9_-]{1,64}$`, may not contain `__`, and are capped at 32. A server under a name not on the list is unreachable and reports `TRACEABILITY: DEGRADED (no tracker tool for {capability})`. `--status` prints a `Servers:` line, and `devflow init --reset` returns the list to the default.

### When the wizard asks

`devflow init` asks for a provider only when the question can be answered interactively:

| Invocation | Asks? |
|---|---|
| `--advanced`, or a re-init with no mode flag (TTY) | Yes |
| Interactive run where you chose Recommended at the Setup-mode prompt | Yes |
| Interactive run where you chose Advanced at the Setup-mode prompt | Yes |
| `--recommended` flag | No — applies the seeded value silently |
| Non-TTY / piped | No |
| Any run passing `--tracker <id>` | No — the flag is honoured on both paths |

`--reset` collapses the provider back to `github`.

### Learned conventions

When a session's provider — the repository's, else the machine's, as your personal `config.json` narrows it — is not `github`, a background agent runs once at a session start and writes `~/.devflow/tracker/{provider}.md` — the project key, issue types, required fields, workflow transitions, assignee policy and reference rendering it could establish, with a `# UNRESOLVED:` line for anything it could not. It is written **once or not at all**, mode `0600`, and it is never overwritten: to re-learn, delete it. Each provider has its own file, learned from the **first repository that uses that provider**; a second Jira repository with a different project key reads the first one's file, and the key and site in its own `project.json` take precedence over it.

The conventions files are **per-developer, not team-shared.** They live in your home directory, not the repository, so every teammate gets their own — and they are treated as **your content** on `devflow uninstall`: an artifacts-only sweep keeps them. If a file's frontmatter `provider:` does not name its own provider, devflow reports `TRACEABILITY: DEGRADED (tracker configuration mismatch (conventions file))` and makes no tracker call, rather than acting on stale conventions.

Upgrading moves an existing `~/.devflow/tracker.md` to `~/.devflow/tracker/{provider}.md`, by the provider its frontmatter names, once; a file whose frontmatter names no provider stays where it is, with a warning. Existing `tracker.md.{previous}.bak` files are left alone as your content.

### The inference attempt cap

Background inference is capped at **5** attempts per provider, counted in `~/.devflow/.tracker.{provider}.attempts`, so a permanently unreachable tracker cannot respawn a background agent at every session start forever — and one broken provider cannot use up another's attempts. Every `devflow init` run and `devflow tracker --set` and `--status` reset every provider's counter and give inference another five tries:

| Command | Re-arms? |
|---|---|
| `devflow init` (any run, any path) | Yes |
| `devflow tracker --set <id>` | Yes |
| `devflow tracker --status` | Yes — asking why nothing is being learned is what hands back another five tries |
| `devflow tracker --servers <names>` | No |

Deleting a `~/.devflow/.tracker.{provider}.attempts` file by hand has the same effect for that provider.

### Known Unknowns — Linear

Two facts behind Linear traceability are **inherited rather than measured**, and devflow states them instead of presenting a guess as a measurement.

- **The comment-body cap is borrowed.** Devflow truncates a Linear comment at 32,767 characters — the cap it uses for Jira. Linear publishes no cap that devflow has measured. Borrowed too generously, a long post is rejected at the tracker and degrades with a reason; borrowed too strictly, a body that would have fit is truncated with a pointer to the local artifact. Either way nothing is lost silently.
- **A duplicate back-link is possible.** On a stock Linear workspace devflow cannot ask the tracker which account it is, so it cannot tell its own comments from anyone else's — the lowest rung of its dedup ladder, rank 4. It therefore **posts with a warning** rather than staying silent: every run emits `TRACEABILITY: DEGRADED (dedup unavailable — duplicate possible)`, and each comment carries a first-line marker plus the devflow project URL so a later run can recognise it. A missing release back-link is worse than a second one you were told about.

Both are tracked in [issue #343](https://github.com/dean0x/devflow/issues/343), which names the two files the borrowed values live in so a measurement lands in one change.

## Gate Level

The gate level is one of three words that say how much checking a command applies. Every command reads it from the one local settings line, as `GATE_LEVEL=<full|standard|lean>`, never from a file.

| Level | Meaning |
|---|---|
| `full` | The most checking. Any value that is not one of the three levels also reads as `full`. |
| `standard` | The default when no level is set. |
| `lean` | The least checking. |

**What reads it.** `/code-review` picks its focuses by level. `full` runs every focus. `standard` drops TypeScript, and drops Dependencies on a code diff that changes no dependency manifest (a lockfile alone does not count). `lean` runs Security, Testing and Reliability on a code diff, plus Compliance on its own trigger. A docs-only, tests-only or lockfile-only diff runs a smaller set of its own, and Security runs at every level. `/plan` runs its full shape at `full`. At `standard` and `lean` it runs one Explore round, two gap-analysis agents (security on its own), one Plan agent and the design review, with no Synthesize step. Security, the design review and Gates 0, 1 and 2 run at every level, and the Compliance agent runs on its own trigger. `/implement` runs the lint pack at `lean`: its Phase 6 Validate runs the project's `lint-pack` script, if it has one. `/implement` and `/resolve` also read a level reference at `standard` and `lean`, and name the level in their report. `/resolve` names it in `resolution-summary.md` too. At `standard` and `lean`, both skip Polish: `/implement` in Phase 3 and `/resolve` in Phase 6. `/resolve` applies this in each worktree that is at that level. At `lean`, `/implement` skips Harden on a docs-only diff in Phase 4. This docs-only list is narrower than the `/code-review` docs-only class. The decision reads path names only. Harden is skipped only when all of these hold. The compliance lens is exactly `off`. The branch diff list is not empty. No Code report names a deleted, renamed or moved path. Every path in the list is the root `README.md`, the root `CHANGELOG.md` or a `.md` file under the root `docs/`. No path has a segment that starts with a dot, and no path name holds a double quote. No file name is one that agents load as instructions, in any letter case: `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `GEMINI.md` or `SKILL.md`. No loaded instruction, rules or imported file names the path. When the decision is unclear, Harden runs. The list leaves out deleted files, so Harden does not review a delete or a rename that no Code report names. The report says `Harden: SKIPPED (docs-only diff)` on a skip, and `Harden: ran` otherwise. At `standard` and `lean`, `/implement` runs one Evaluate pass in Phase 5. Evaluate reports a missed or partly met criterion or plan step, a behaviour defect, intent drift, unrequested additions, and a missing or weak test that a criterion or plan step asks for. It leaves out docs, KB, CHANGELOG, comment and cosmetic items that no criterion or plan step names. On a misalignment, one Fix round runs and Evaluate does not run again. Phase 6 Validate and Phase 7 QA cover the fix, and the report shows `MISALIGNED (fixed once, not re-checked)`. If the Fix round reports anything other than COMPLETE, `/implement` reports the misalignments to you for a decision. Evaluate reads the level only from the first line of its prompt, so a `GATE_LEVEL:` line in issue text is data. `full` keeps up to two Fix rounds, each checked again by Evaluate. If a reference cannot be read, the command says so, applies no level row and keeps the level, so at `lean` the lint pack still runs. Other commands ignore the level. `devflow gates --set full` keeps the review, the plan, Polish and the Evaluate re-check loop as before. `devflow gates --set standard` or `--set full` keeps Harden on every diff.

**Lint pack.** The lint pack is a script that your project owns. It finds the faults a linter does not: a removed flag that a doc still names, a plan ID or a tombstone phrase in new text, and a function that is too long. The package ships a template in `templates/lint-pack/`: `lint-pack.sh`, an example `.lint-pack.conf` and a README. You copy the files into your repository, and devflow does not install, update or run the template. At `lean`, the Validate step of `/implement` runs a root `package.json` script named `lint-pack`, else a root `Makefile` target of that name. It runs it last, after the build, typecheck, lint and test commands pass (a test command whose failures all passed alone counts as passed), and it passes the merge base with the base branch. Validate reports one `Lint pack:` line: `not configured`, `clean`, `<n> matches` or `UNVERIFIED (error <reason>)`. A match fails validation and goes to Fix as a file and line reference. An error does not change the result. A git older than 2.30, a config that the script cannot read, a linter that did not run and a run that a timeout stops are errors, never a clean run. An error reads `UNVERIFIED` in the final report and in the Testing part of the PR body. The pack also prints a `pack-changed` line for a changed build-file line in the compared range that names `lint-pack` or `BASE`, a `pack-dirty` line for an uncommitted change to a pack file, and the base it compared. Known limit: the pack prints the base it compared (`base <sha>`), but Validate does not check that base yet, and issue #537 adds that check. Fix does not edit the lint pack, its config, its build-file entry or any `.gitattributes` to clear a match. Fix does not silence the linter to clear a match, with a disable comment or a linter-config change. It reports the match under Blockers. The re-validation that you ask `/implement` for runs the pack. The re-validation after QA fixes, `/resolve`, `/self-review`, `/release` and `/dynamic-build` do not run it. When the settings line is not accepted, the level reads `full` and the pack does not run. A level reference that `/implement` cannot read does not stop the pack. To clear a match that you judge false, add an allow glob to `.lint-pack.conf` or a disable comment, commit it, and ask `/implement` to re-validate. The template README describes the steps.

```bash
npx devflow-kit gates --status      # The level in effect here, which layer decided it, and the machine default
npx devflow-kit gates --set lean    # Set the machine default: full, standard or lean
npx devflow-kit init --gate-level lean  # Set it during init, with no prompt
npx devflow-kit gates               # No flag: print usage and the valid levels
```

**Precedence.** The level in effect comes from the first of these that holds a value:

1. A top-level `gateLevel` key in your personal `.devflow/config.json`.
2. The machine default, `features.gateLevel` in `~/.devflow/manifest.json`.
3. `standard`.

**Raise or lower.** The memory, curation and knowledge switches are narrow-only: a repository file can turn them off but never on. The gate level is not a switch. Your personal `gateLevel` may raise the level above the machine default as well as lower it. The committed `.devflow/project.json` has no `gateLevel`: a key of that name there is ignored, and there is no team floor, so a repository that declares compliance can still run a lower personal level.

**Set it at init.** `devflow init` asks for the machine default, so you meet the choice during setup. The prompt lists `full`, `standard` and `lean` with a one-line effect each. On a first install it starts on `standard`. On a re-init it shows the current value and starts on it, so Enter keeps it. If the stored value is malformed or `null`, the prompt starts on `full`, the level that every reader gives it, and accepting it writes `full` in its place. The machine level that applies does not change. It runs under the same gate as the tracker question:

| Invocation | Asks? |
|---|---|
| `--advanced`, or a re-init with no mode flag (TTY) | Yes |
| Interactive run where you chose Recommended at the Setup-mode prompt | Yes |
| Interactive run where you chose Advanced at the Setup-mode prompt | Yes |
| `--recommended` flag | No — keeps the stored value, or records none on a first install |
| Non-TTY / piped | No — same |
| Any run passing `--gate-level <full\|standard\|lean>` | No — the flag sets the level on every path |

Init writes the same field as `gates --set`, `features.gateLevel`, and the summary at the end of init shows the level that is now set. When the run changes the machine level that applies, the summary adds the level that applied before, as in `Gate level: lean (was standard)`. It adds no note when init keeps the level, writes a malformed value back as it was, or cannot read the old level. If init cannot save the manifest, the summary warns that the gate level did not change. A malformed stored value shows as `invalid (manifest.json; reads as full)`, as in `devflow gates`. The Recommended settings note, which init prints before the install, has a `Gate level:` row. Init never writes the personal key in `config.json`, so a personal level still wins in its repository. `--gate-level` is matched exactly, like `--set`: `Lean` or an empty value exits 1 before init writes anything, and the error names the valid levels. `--gate-level` with no value also exits 1, with an `argument missing` error that names the levels, and writes nothing.

**A manifest that devflow rejects or cannot read.** A manifest is rejected when it is valid JSON with a `features` object that devflow rejects: a required field is missing or mistyped, or the file starts with a byte-order mark. If a rejected manifest holds a gate level, a promptless init (`--recommended`, or a run with no TTY) and `--hud-only` keep that value as it is stored, a malformed value or `null` included. The summary then warns that init kept the level while it replaced the manifest. When the prompt runs, your answer is the level. The prompt starts on the stored level and says where it comes from, and accepting a malformed or `null` value writes `full`, as for any manifest. A level that you set with `--gate-level` or at the prompt is a choice, even when it equals the stored one, so the warning does not print. A manifest is unreadable to init when init can find no level to keep in it. It is corrupt or not JSON, it is not a JSON object with a `features` object, it is not a regular file, it stores a level that nests too deep to write back as JSON, or it is over 1 MiB and also one that devflow rejects. Init cannot know the level in it. The prompt shows `Current setting: unknown` and starts on `standard`. A promptless run writes no level, and the summary warns that the stored level could not be read, that `standard` (the machine default) applies, and that `devflow gates --set <level>` sets it again. `devflow init --reset` removes the stored level in both cases. Over a rejected manifest, `--reset` still names the level it removed: a manifest that stored `full` gives `Gate level: standard (default) (was full)` and no kept-level warning. Over an unreadable manifest, the summary has no level to name and no warning.

**Who writes what.** `gates --set` writes the machine default and nothing else: it changes only `features.gateLevel` and `updatedAt` in the manifest, never `project.json` or `config.json`, and it installs nothing and re-arms nothing. A repeat prints `Gate level: <level> (unchanged)` and writes nothing. No command writes the personal key. Set it by hand in the repository's `.devflow/config.json`, which is personal, so keep it out of git:

```json
{"gateLevel":"lean"}
```

The machine default sits in `~/.devflow/manifest.json` as `features.gateLevel`; `gates --set` and `init` write it, and a hand edit has the same effect:

```json
{"features":{"gateLevel":"lean"}}
```

The level is matched **exactly**. `--set` rejects `Lean`, `lean ` with a trailing space and an empty value with exit 1, and names the valid levels. A bare `--set` also exits 1, with Commander's `argument missing` error for `--set <full|standard|lean>`, which names the levels too. It exits 1, with nothing written, when there is no manifest (run `devflow init`), when the manifest is corrupt (a message names the path and says nothing changed) and when the directory cannot be written.

**Invalid values.** A `gateLevel` that is not exactly `full`, `standard` or `lean` is malformed, and this includes `Lean`, a trailing space, an empty string, `null`, a number and a duplicated key. A malformed level reads as `full` and is never repaired:

- A malformed personal value does not fall through to the machine default. Only the level becomes `full`; every other setting reads as if the key were absent.
- A malformed machine value reads as `full` and stays in the manifest as written. Unrelated commands keep it, and so does a promptless init. An init prompt that you accept writes `full` in its place.
- A personal `config.json` or a `project.json` that cannot be read, or a git check that fails, fails the whole settings line closed, and the level is `full`.
- A corrupt manifest and one over 1 MiB read as no machine default, so the level is `standard`. A manifest that is valid JSON with a `features` object but lacks a field devflow requires keeps its stored level.

**A tracked `config.json`.** A `config.json` that git tracks is ignored as if it were absent, so its `gateLevel` does not apply, and `gates --status` warns with the fix (see the memory, curation and knowledge section above).

**`--status`.** It resolves the settings once, writes nothing, and exits 0. Beside a valid `--set` it still only shows the status. Beside an invalid `--set` it prints the error and exits 1, as `tracker` and `compliance` do:

```text
Effective: lean (personal)
Machine:   full
```

The output is titled `Gate Level Status`. The `Effective:` line is the level in effect and the layer that decided it (`default`, `machine` or `personal`). `, invalid` follows the layer when it holds a malformed value, and the warning names `config.json` and says that `full` is in effect; the bad value is never printed. A fail-closed result prints `Effective: full (fail-closed: <reason>)`, or `reason unknown`, with no layer. The `Machine:` line is the machine default: a level, `none` when the manifest records no level or cannot be read, or `invalid (manifest.json; reads as full)`. If the settings resolver cannot load, the first line reads `Effective: level unknown`.

`--status` words its manifest warning one way for a manifest that devflow rejects and another way for one that `devflow gates` cannot read. If the manifest is valid JSON with a `features` object that devflow rejects, the warning says that `devflow init` will replace the file and keep a gate level stored in it, unless you choose another level or use `--reset`. If `devflow gates` cannot read the manifest (it is corrupt, has no `features` object, or is over 1 MiB), the warning says that `devflow init` will replace the file, and that init keeps a gate level stored in it only if init can read the file. If init reports that it could not read the level, set it again with `devflow gates --set <level>`. The two readers differ for a valid manifest over 1 MiB: `devflow gates` cannot read it, and init can read it and keeps its level. What init does in each case is in "Set it at init" above. `devflow init --hud-only` follows the same rules: it keeps the level it can read, and otherwise records no level, warns, and leaves the level to `devflow gates --set <level>`. A plain `devflow init` over a manifest that devflow reads keeps the level.

**Reset, update and uninstall.** `devflow init --reset` removes the machine default, so the level reads `standard` again unless a personal level is set; a personal key in `config.json` survives the reset. An interactive `--reset` asks again, starting on `standard`, and `--reset --gate-level <full|standard|lean>` sets the new level after the reset. A `devflow init --recommended`, a non-interactive `devflow init`, `devflow init --hud-only` and every command that writes the manifest keep the stored value as it is. A manifest that cannot be read holds no value that devflow can keep (see "Set it at init"). An interactive re-init keeps a valid level when you accept the prompt as shown. Over a malformed or `null` value, accepting the prompt writes `full`. A full `devflow uninstall` removes the manifest, and the machine default with it; `devflow uninstall --plugin` keeps it. Your personal key lives in the repository's `.devflow/config.json`, which uninstall removes only if you accept the offer to remove that repository's `.devflow/`.

**After an update, run `devflow init`.** The settings line gained the `GATE_LEVEL` field, and the installed command prompts must carry the matching pattern. `devflow init --hud-only` and a plugin-only update refresh the resolver script but not those prompts, so until a full `devflow init` every installed command that reads the settings line falls back to its fail-closed value. `devflow init --hud-only` prints one line when the installed prompts come from a different devflow version than the running CLI.

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

The HUD also shows your OpenAI Codex usage limits (the weekly window, plus the 5-hour window when your plan has one) next to the Claude quota. It reads them from Codex's own session logs under `~/.codex/sessions`, makes no network call, and shows nothing when you do not use Codex.

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

All 32 flags by kind and devflow default:

| Flag ID | Kind | Target | Devflow Default |
|---------|------|--------|-----------------|
| `tui` | boolean | setting `tui` | `true` (fullscreen) |
| `tool-search` | boolean | env `ENABLE_TOOL_SEARCH` | `true` |
| `lsp` | boolean | env `ENABLE_LSP_TOOL` | `true` |
| `prompt-caching-1h` | boolean | env `ENABLE_PROMPT_CACHING_1H` | `true` |
| `subagent-cache-5m` | boolean | setting `subagentPromptCacheTtl` | `true`⁵ |
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

⁵ `subagent-cache-5m` writes `"5m"`, so subagents write 5-minute prompt-cache entries while the main session keeps the 1-hour TTL of `prompt-caching-1h`. Disabling or uninstalling deletes the key only when it holds `"5m"`. When the key already holds another value (say `"1h"`), `devflow init` and the flags TUI record the flag off and keep your value; `init --reset` writes `"5m"`.

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

**Code runs as three agents.** `code` (the `implement` and `issue-fix` modes), `fix` (repairs after a failed validation, alignment, QA or CI check) and `refactor` (mechanical edits) are separate entries in the list and the TUI. Each ships on Sonnet at high effort. An override set on `code` does not reach `fix` or `refactor`; set each one you want to change.

**Old slugs.** `--set <old slug>` still works after an agent rename. It prints an info line (`Agent '<old slug>' has been renamed to '<new slug>' — using canonical name.`), writes the new slug and leaves no old key in `~/.devflow/agent-models.json`. An old key that is already in that file is mapped to its new slug when the file is read. If the old key and the new key both exist, the new key wins. The CHANGELOG lists each old slug and its new slug.

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
