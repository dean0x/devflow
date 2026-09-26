# Devflow

[![npm version](https://img.shields.io/npm/v/devflow-kit)](https://www.npmjs.com/package/devflow-kit)
[![CI](https://github.com/dean0x/devflow/actions/workflows/ci.yml/badge.svg)](https://github.com/dean0x/devflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/dean0x/devflow/blob/main/LICENSE)
[![Node.js 22+](https://img.shields.io/badge/node-22%2B-brightgreen.svg)](https://nodejs.org/)
[![Website](https://img.shields.io/badge/Website-dean0x.github.io%2Fx%2Fdevflow-blue)](https://dean0x.github.io/x/devflow/)

**A meta-harness for Claude Code.** Claude Code gives you one brilliant engineer. Devflow installs the engineering organization around it: an orchestrator that delegates, a roster of specialized agents, a review culture, institutional memory, and a delivery pipeline. Built for developers turning agentic development into a team that ships.

## The problem with AI-assisted development

Claude Code is powerful. But a single agent is not a team. Every session starts from scratch, context evaporates between conversations, reviews are single-pass and shallow, and quality depends on what you remember to ask for. What's missing is exactly what makes an engineering team ship: memory, standards, review culture, and a delivery process.

Devflow fixes this. Install once, forget about it.

## See it work

One feature, four commands, bird's-eye view — each command is an agent pipeline, not a prompt:

```text
you: /plan add rate limiting to the /api/upload endpoint

  Skim · Explore         orient in the codebase — relevant modules, existing middleware patterns
  Design                 gap analysis: completeness, security, performance
  Plan · Synthesize      PR-ready plan document → .devflow/docs/design/
  Git                    traceable issue #42 opened

you: /implement (hand it the plan)

  Git                    branch feat/42-rate-limit-upload
  Code                   implements the plan — your learned decisions, pitfalls, and feature knowledge preloaded
  Validate               build ✓ typecheck ✓ lint ✓ tests ✓
  Simplify · Scrutinize  cleanup pass, then 9-pillar quality gate
  Evaluate               implementation matches the original request ✓
  Test                   5/5 QA scenarios pass → PR opened

you: /code-review

  Review ×12             security, architecture, performance, complexity, … (up to 20, in parallel)
  Synthesize             18 findings ranked by severity + confidence → review-summary.md

you: /resolve

  Triage                 every finding validated against a blast-radius matrix — 11 fix-now, 3 by design, 4 false positives
  Code ×11               each real issue fixed
  Validate · Git         verification gate ✓ → pushed to the PR
```

This is the **orchestrated flow** — you stay in the loop between every step. With ambient mode on you don't even need the commands: describe the task and the orchestrator routes it through the same pipelines.

## What you get

**Ambient orchestration.** Your main session becomes the tech lead: a charter injected at session start turns it into a pure orchestrator that delegates work to specialized agents and keeps only judgment mainline. Plan-mode handoffs auto-run `/implement`. Init and forget.

**A staffed agent roster.** 17 specialized agents with explicit model assignments — Opus for analysis, Sonnet for execution, Haiku for I/O. Reassign any agent's model with `devflow agents`, including GPT models through external model routing (`devflow proxy`).

**Up to 20 parallel Review agents.** Security, architecture, performance, complexity, consistency, regression, testing, and more. Each produces findings with severity, confidence scoring, and concrete fixes. Conditional Review agents activate when relevant (TypeScript for `.ts` files, database for schema changes, compliance when regulated surface detected in the diff). Every finding gets validated and resolved automatically.

**Memory that persists.** Session context survives restarts, `/clear`, and context compaction. Your agent picks up exactly where it left off.

**Self learning.** A background agent detects architectural decisions and known pitfalls from your session dialogs and writes them to `.devflow/learning/decisions.md` and `.devflow/learning/pitfalls.md` — informing every future review and implementation session without any manual bookkeeping.

**Feature knowledge bases.** Curated `KNOWLEDGE.md` files per feature area — patterns, conventions, and gotchas — git-tracked and shared with your team. Planning, implementation, and review workflows load them automatically and refresh them after changes.

**Always-on rules.** 13 ultra-condensed engineering principles (~10 lines each) load on every prompt — security, quality, and language-specific guidance (TypeScript, React, Go, Python, Java, Rust), plus a compliance rule when compliance is enabled. Rules install from your selected plugins only, so a Go project won't get React rules. Override any rule via `~/.devflow/rules/{name}.md` or `devflow rules shadow <name>`.

**41 skills** (40 plugin-owned + 1 feature-owned compliance skill, installed when compliance is enabled). Skills install for the plugins you selected plus whatever those plugins declare they use, so the default plugin set installs 32 of the 40 and a Go project never gets the React skill. Most are grounded in expert material — backed by peer-reviewed papers, canonical books, and industry standards: security (OWASP, Shostack), architecture (Parnas, Evans, Fowler), performance (Brendan Gregg), testing (Beck, Meszaros), design (Wlaschin, Hickey), compliance (GDPR, HIPAA, PCI DSS, SOC 2, ISO 27001, SOX, NIST SSDF, OWASP ASVS), 200+ sources total.

**Skill shadowing.** Override any built-in skill with your own version. Drop a file into `~/.devflow/skills/{name}/` and the installer uses yours instead of the default — same activation, your rules. A shadow for a skill outside your plugin selection stays where it is: not installed, never deleted, and live again the moment you select that plugin.

**Compliance built in.** Six regulatory frameworks — GDPR, HIPAA, PCI DSS, SOC 2, ISO 27001, SOX — composed into a review skill and an always-on rule for exactly the frameworks you select. Compliance reviews activate automatically when a diff touches regulated surface. `devflow compliance --enable`. Enabling it also makes `required` the floor of your team's [evidence policy](#evidence-policy) on your machine: tracker-linked PRs, checked test plans, traced releases and a non-author approval before a PR reads merge-ready.

**Your issue tracker, not just GitHub.** Pick the tracker your team actually uses — GitHub, Jira, or Linear — at `devflow init`, with `devflow init --tracker <id>`, or later with `devflow tracker --set <id>`. Only the tracker you picked is installed: GitHub gets 24 generated reference files and nothing else, Jira and Linear get 36 — the tool-call contract among them — plus the background agent that reads it. Nine of those files are the PR-host mechanics every install carries, because pull requests stay on GitHub whatever your tracker. On a non-GitHub tracker that agent learns your conventions once (project key, issue types, required fields, workflow transitions, how a reference renders) and writes them to `~/.devflow/tracker.md`, so traceability speaks your tracker's vocabulary instead of assuming `#123`. That file is yours: hand-editable, kept across an uninstall, and refused rather than silently trusted if it no longer matches your selected provider. **GitHub is the default** and needs no configuration: no background agent and no `tracker.md`.

**Full lifecycle.** Beyond the core flow: `/explore` maps a codebase into knowledge bases, `/research` runs multi-type research with trust-aware synthesis, `/debug` investigates with competing hypotheses in parallel, `/bug-analysis` hunts bugs before review, `/self-review` runs Simplify + Scrutinize quality passes, and `/release` ships with learned configuration.

**Everything is composable.** 21 plugins (12 core + 9 optional). Install only what you need.

**HUD.** A persistent status line updates on every prompt — project, branch, diff stats, context usage, model, cost with weekly/monthly totals, quota reset timers, and configuration counts at a glance.

```
~/devflow · main · +2 -1 · v2.0.0+3
Context ████░░░░ 42% · 5h ████░░░░ 45% (2h 15m) · 7d ████████ 70% (3d 12h)
Opus 4.6 (1M) · 3 MCPs 2 rules · $1.42 · $18.50/wk · $62.30/mo
```

**Security.** Deny lists block dangerous tool patterns out of the box — configurable during init and toggleable any time with `devflow security` (`--enable`/`--disable`/`--status`).

## Graph workflows

Prompt engineering became context engineering; the current frontier is **graph engineering** — designing agentic work as an explicit graph of nodes, dependencies, and gates rather than one long conversation. Devflow ships it as ready-made recipes.

When to use which: the orchestrated flow is for a **feature**; graph workflows are for a **system**. Start from a spec, break it into a dependency graph of tickets, then deliver it wave by wave — plan a wave, build a wave, repeat until the spec is shipped:

```text
you: /dynamic-tickets specs/billing-v2.md

  Ticket factory         spec → 14 dependency-graphed tickets across 4 waves
                         each ticket adversarially reviewed
  Git                    tracking issue + one issue per ticket filed (required evidence policy)

you: /dynamic-plan (wave 1)

  Plan ×4                every wave-1 ticket plan-challenged in parallel: acceptance criteria + test plans
  Preference profile     known decisions auto-resolved from ~/.devflow/preference-profile.md
  Decision gate          DECISIONS-NEEDED.md — 2 calls only you can make

you: (answer 2 decisions, walk away) /dynamic-build (wave 1)

  Wave 1                 4 tickets   implement → review → verify, dependency-ordered
  Git                    wave report posted to the tracking issue
  Git · Test             wave PR opened once you say so · its test-plan evidence refreshed

you: /dynamic-plan (wave 2) → /dynamic-build (wave 2) → …

  — four waves later: 14/14 tickets landed, spec shipped —
```

Graph runs trade tokens for autonomy: you make your calls at each wave's decision gate, then the wave builds — a single build run can go 20+ hours unattended. In practice you'll live in the orchestrated flow day to day and reach for graph workflows when you're delivering a whole system. Both share the same agents, quality gates, memory, and learned decisions.

## Quick Start

```bash
npx devflow-kit init
```

That's it. The interactive wizard offers Recommended defaults or an Advanced flow — plugin selection, feature configuration, compliance frameworks, and security settings. Ambient mode, working memory, and learning are on by default. Non-interactive: `npx devflow-kit init --recommended`.

## Privacy & Sharing

Everything Devflow generates lives under `.devflow/` — working memory, decisions and pitfalls, feature knowledge bases, naming conventions, docs and transient locks. On first use Devflow appends one block to your project's root `.gitignore`. It keeps per-developer runtime state on your machine and shares three things through git: the feature knowledge bases, the learned naming conventions and the team's [evidence policy](#evidence-policy):

```gitignore
# Devflow runtime data — local by default (memory, learning, docs, locks).
# Shared via git: feature knowledge bases under .devflow/features/ (index.md and
# every {slug}/KNOWLEDGE.md), .devflow/conventions.md (naming authority) and
# .devflow/policy.json (evidence policy). To stop sharing the first two, re-add
# `.devflow/features/` or `.devflow/conventions.md` to your own .gitignore.
.devflow/*
!.devflow/features/
.devflow/features/*
!.devflow/features/index.md
!.devflow/features/*/
.devflow/features/*/*
!.devflow/features/*/KNOWLEDGE.md
!.devflow/conventions.md
!.devflow/policy.json
.claudeignore
```

The paired lines — `!.devflow/features/` then `.devflow/features/*` — are required: git never descends into an excluded directory to reach a re-included file. The final `.claudeignore` line is left out when your `.gitignore` already has its own `.claudeignore` or `!.claudeignore` entry.

To keep the knowledge bases or conventions local, add `.devflow/features/` or `.devflow/conventions.md` to your own `.gitignore`. A `/.devflow/` line of your own opts the whole project out: Devflow then leaves your `.gitignore` alone.

## Commands

| Command | What it does |
|---------|-------------|
| `/explore` | Codebase exploration with optional knowledge base creation |
| `/research` | Multi-type research with trust-aware synthesis |
| `/plan` | Full design pipeline: explore → gap analysis → design → PR-ready plan document |
| `/implement` | Execute plan: accepts plan documents from `/plan`, issues, or task descriptions → PR |
| `/self-review` | Simplify + Scrutinize quality pass |
| `/code-review` | Multi-perspective parallel code review |
| `/resolve` | Validate and fix all review issues |
| `/debug` | Competing hypothesis investigation |
| `/bug-analysis` | Proactive bug finding with static and semantic analysis |
| `/release` | Adaptive release with learned configuration |
| `/dynamic-tickets` | Graph workflows: spec or initiative → dependency-graphed, wave-structured ticket slate |
| `/dynamic-plan` | Graph workflows: parallel plan-challenge, acceptance criteria, decision gate |
| `/dynamic-build` | Graph workflows: dependency-aware engine — build, review, verify wave by wave |
| `/dynamic-profile` | Distill session transcripts into a decision-preference profile |

See [docs/commands.md](https://github.com/dean0x/devflow/blob/main/docs/commands.md) for detailed usage.

**PR-comment publication** for `/code-review` and `/resolve` is visibility-gated (counts-only stub on public repos by default) and every posted body is secret-scrubbed before it leaves your machine. Configure via `reviewPublication` (`auto`, `full` or `off`) in `.devflow/config.json`. Under a `required` evidence policy, `off` still posts the counts-only stub, so a record reaches the PR. The [test-plan evidence](#test-plan-evidence) comment is a stub unless `reviewPublication` is `full` — details in [docs/commands.md](https://github.com/dean0x/devflow/blob/main/docs/commands.md).

## Evidence policy

How much evidence a change must carry is a team decision, so it lives in a file the team commits: `.devflow/policy.json`, read from the repository's default branch.

```json
{"version":1,"evidencePolicy":"required"}
```

The file holds exactly two keys: `version`, always `1`, and `evidencePolicy`, either `required` or `standard`. Anything else — another key, a duplicate key, a byte-order mark, more than 4 KiB — makes the file invalid, and an invalid file resolves to `required`.

| | `standard` | `required` |
|---|---|---|
| Tracker issue | optional — `/plan` offers to create one | mandatory — `/plan` creates or enriches one; `/implement` without one records a self-attested exception or stops |
| Test plan | written and shown on the PR when there is one; a missing plan is only reported | mandatory — `/implement` without one records a self-attested exception or stops, and a wave PR with a merged ticket lacking one is blocked |
| Naming conventions | not learned, not applied | learned once into `.devflow/conventions.md`, then applied to branch names and PR titles |
| External review threads | left alone | `/resolve` replies to them and resolves the ones it verifiably fixed |
| Merge readiness | not checked by `/resolve` | `/resolve` checks it, and READY needs a trusted non-author approval |
| Releases | no trace gate (`--dry-run` still shows the trace) | `/release` maps every commit since the last release to its issue; untraced commits are attested or the release halts; shipped issues are back-linked and added to the release marker |
| `reviewPublication: off` | no PR comment | the counts-only stub still posts |
| `/dynamic-tickets` | files no issues | files the tracking issue and one issue per ticket |

**Defaults.** With no committed file the policy is `standard`, unless compliance is enabled on the machine running devflow — at any framework count — which makes it `required` there.

**The stricter value wins.** The default branch's copy is the authority, so a feature branch that commits a weaker policy is still judged by the default branch's; the difference shows as a `pr-changes-policy` warning. Local sources can raise the policy but never lower it: enabled compliance raises a committed `standard` to `required` on that machine. Every failure — git not answering, an invalid file, a resolver that cannot run — resolves to `required`. Offline, devflow reads the local copies instead and flags the result `remote-unavailable`.

**Commit it yourself.** The CLI never writes `policy.json`. `devflow compliance --enable` and `--set` print the file for you to commit, and `devflow compliance --status` shows the policy resolved for the current repository and where it came from. The `.gitignore` block above keeps the file shareable. Guard it like any other policy file, for example with a CODEOWNERS entry:

```text
/.devflow/policy.json @your-org/maintainers
```

## Test-plan evidence

A PR carries a test plan: one TP line per acceptance criterion, in one fixed shape.

```text
- [ ] TP-1 (AC-1) rejects an upload over the size limit — method:ci [files: src/upload/**]
```

`method` is how the line is verified: `ci` (the CI suite covers it), `local` (a command whose exit code the Test agent reads) or `manual` (agent-driven steps, observed). `files:` lists the globs the line covers, so a later change elsewhere does not make it stale. A scenario is plain words — no `#`, `@`, `/`, `<`, `>`, brackets or backticks — because it lands in the PR body, where a closing keyword or a mention would act.

`/plan` writes the lines, and `/implement` checks them before any code is written. The PR body carries them as a test-plan block between `<!-- devflow:test-plan -->` markers. The Test agent records a claim per line — `PASS`, `FAIL` or `SKIP` at a commit — and the evidence scripts, never a prompt, turn each claim into one of six states:

| State | Meaning |
|---|---|
| `VERIFIED-CI` | a `ci` pass backed by passing CI runs at the verifying commit |
| `ATTESTED-LOCAL` | a `local` pass with exit code 0, a `manual` pass, or a `ci` pass at a commit that has no CI runs |
| `UNVERIFIED` | no usable claim: none, a skip, a commit outside the PR, or a line whose text changed |
| `STALE` | claimed at an older commit, and the change since may touch the line's files |
| `FAILED` | a fail, a non-zero exit code, or a failing CI run |
| `INDETERMINATE` | something the verdict needs could not be resolved, such as a CI run still in progress or expired |

Only the first two count as verified, and the block ticks exactly those lines. `update-pr-evidence` re-derives every state at the PR's head, updates the block — reduced to one counts line when the lines would push the body past its size limit — and posts an append-only evidence comment keyed to that head. `/implement`, `/resolve` and the wave PR of `/dynamic-build` all refresh it.

The evidence comment is a counts-only **STUB** unless `reviewPublication` is `full`. **FULL** adds the scenario table, with links to the CI runs, and the reasons for any self-attested exception, and falls back to the STUB above 55,000 characters. `off` posts no evidence comment, except under a `required` policy, where it becomes the STUB. A self-attested exception — no tracker issue, or no test plan — is recorded in the PR body under `## Evidence Exceptions`, with who attested it and when.

## Language Support

Optional plugins add language-specific patterns for TypeScript, React, Go, Python, Java, Rust, accessibility, and UI design.

```bash
npx devflow-kit init --plugin=typescript,react
```

## How it works

Devflow is the meta-harness layer: Claude Code harnesses the model; Devflow harnesses Claude Code. Concretely, it's a registry-driven plugin system — each plugin installs commands, agents, and skills into your Claude Code environment. Skills are tiny markdown files that activate automatically based on context. Agents are specialized workers (review, triage, code, etc.) with explicit model assignments — Opus for analysis, Sonnet for execution, Haiku for I/O. Commands orchestrate agent pipelines.

For deep dives: [Working Memory](https://github.com/dean0x/devflow/blob/main/docs/working-memory.md) | [CLI Reference](https://github.com/dean0x/devflow/blob/main/docs/cli-reference.md) | [Commands](https://github.com/dean0x/devflow/blob/main/docs/commands.md)

## CLI Reference

```bash
npx devflow-kit init                    # Install (interactive wizard)
npx devflow-kit init --plugin=implement # Install specific plugin
npx devflow-kit ambient --enable        # Toggle ambient mode (orchestrator)
npx devflow-kit learning --enable       # Toggle decision/pitfall tracking
npx devflow-kit compliance --enable     # Enable compliance (pick frameworks); prints the policy.json to commit
npx devflow-kit compliance --status     # Show compliance state and this repo's evidence policy
npx devflow-kit tracker --set jira       # Pick the issue tracker (github | jira | linear)
npx devflow-kit tracker --status         # Show provider, learned conventions, installed mechanics
npx devflow-kit rules --status          # Show installed rules
npx devflow-kit security --status       # Show / manage the security deny list
npx devflow-kit safe-delete --enable    # Install rm -> trash safe-delete
npx devflow-kit proxy --enable          # Enable external model routing (GPT via Codex)
npx devflow-kit proxy --disable         # Disable and revert agents to Claude defaults
npx devflow-kit agents                  # Configure per-agent model assignments (TUI)
npx devflow-kit agents --list           # List agents with current model assignments
npx devflow-kit uninstall               # Remove Devflow
```

See [docs/cli-reference.md](https://github.com/dean0x/devflow/blob/main/docs/cli-reference.md) for all options.

## Part of the AI Development Stack

| Tool | Role | What It Does |
|------|------|-------------|
| **[Skim](https://github.com/dean0x/skim)** | Context Optimization | Code-aware AST parsing, command rewriting, output compression |
| **Devflow** | Meta-Harness | Orchestrated + graph workflows, parallel review, memory, self-learning |
| **[MDS](https://github.com/dean0x/mdscript)** | Prompt Engineering | Composable template language for prompts — variables, loops, conditionals, imports, compiled to clean Markdown |

## Building from Source

```bash
git clone https://github.com/dean0x/devflow.git
cd devflow && npm install && npm run build
node dist/cli.js init
```

## Requirements

- [Claude Code](https://claude.ai/download) (latest)
- Node.js 22+

## License

MIT
