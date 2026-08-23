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

**A staffed agent roster.** 16 specialized agents with explicit model assignments — Opus for analysis, Sonnet for execution, Haiku for I/O. Reassign any agent's model with `devflow agents`, including GPT models through external model routing (`devflow proxy`).

**Up to 20 parallel Review agents.** Security, architecture, performance, complexity, consistency, regression, testing, and more. Each produces findings with severity, confidence scoring, and concrete fixes. Conditional Review agents activate when relevant (TypeScript for `.ts` files, database for schema changes, compliance when regulated surface detected in the diff). Every finding gets validated and resolved automatically.

**Memory that persists.** Session context survives restarts, `/clear`, and context compaction. Your agent picks up exactly where it left off.

**Self learning.** A background agent detects architectural decisions and known pitfalls from your session dialogs and writes them to `.devflow/learning/decisions.md` and `.devflow/learning/pitfalls.md` — informing every future review and implementation session without any manual bookkeeping.

**Feature knowledge bases.** Curated `KNOWLEDGE.md` files per feature area — patterns, conventions, and gotchas — git-tracked and shared with your team. Planning, implementation, and review workflows load them automatically and refresh them after changes.

**Always-on rules.** 13 ultra-condensed engineering principles (~10 lines each) load on every prompt — security, quality, and language-specific guidance (TypeScript, React, Go, Python, Java, Rust), plus a compliance rule when compliance is enabled. Rules install from your selected plugins only, so a Go project won't get React rules. Override any rule via `~/.devflow/rules/{name}.md` or `devflow rules shadow <name>`.

**41 skills** (40 universal + 1 feature-owned compliance skill, installed when compliance is enabled). Most are grounded in expert material — backed by peer-reviewed papers, canonical books, and industry standards: security (OWASP, Shostack), architecture (Parnas, Evans, Fowler), performance (Brendan Gregg), testing (Beck, Meszaros), design (Wlaschin, Hickey), compliance (GDPR, HIPAA, PCI DSS, SOC 2, ISO 27001, SOX, NIST SSDF, OWASP ASVS), 200+ sources total.

**Skill shadowing.** Override any built-in skill with your own version. Drop a file into `~/.devflow/skills/{name}/` and the installer uses yours instead of the default — same activation, your rules.

**Compliance built in.** Six regulatory frameworks — GDPR, HIPAA, PCI DSS, SOC 2, ISO 27001, SOX — composed into a review skill and an always-on rule for exactly the frameworks you select. Compliance reviews activate automatically when a diff touches regulated surface. `devflow compliance --enable`.

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
                         each ticket adversarially reviewed · tracking issue opened

you: /dynamic-plan (wave 1)

  Plan ×4                every wave-1 ticket plan-challenged in parallel: acceptance criteria + test plans
  Preference profile     known decisions auto-resolved from ~/.devflow/preference-profile.md
  Decision gate          DECISIONS-NEEDED.md — 2 calls only you can make

you: (answer 2 decisions, walk away) /dynamic-build (wave 1)

  Wave 1                 4 tickets   implement → review → verify, dependency-ordered
  Git                    wave report posted to the tracking issue

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

Everything Devflow generates lives under `.devflow/` — working memory, decisions and pitfalls, feature knowledge bases, and transient locks. That directory is **gitignored wholesale by default**, so this per-developer runtime state stays on your machine and never lands in a commit. Devflow adds the `.devflow/` line to your project's root `.gitignore` automatically on first use.

Sharing is opt-in. To share **everything** with your team, remove the `.devflow/` line from `.gitignore`. To share only curated knowledge (and keep memory, queues, and locks local), replace the `.devflow/` line with a pattern that ignores everything except the files you want tracked:

```gitignore
# Ignore all Devflow runtime data…
.devflow/**
# …except the team knowledge you want to share
!.devflow/learning/
!.devflow/learning/decisions.md
!.devflow/learning/pitfalls.md
!.devflow/features/
!.devflow/features/index.md
!.devflow/features/*/
!.devflow/features/*/KNOWLEDGE.md
```

(The directory re-includes — `!.devflow/learning/` — are required: git won't descend into an excluded directory to reach a re-included file.)

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

**PR-comment publication** for `/code-review` and `/resolve` is visibility-gated (counts-only stub on public repos by default) and every posted body is secret-scrubbed before it leaves your machine. Configure via `reviewPublication` in `.devflow/config.json` — details in [docs/commands.md](https://github.com/dean0x/devflow/blob/main/docs/commands.md).

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
npx devflow-kit compliance --enable     # Enable compliance reviews (pick frameworks)
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
| **[Backbeat](https://github.com/dean0x/backbeat)** | Agent Orchestration | Karpathy optimization loops, multi-agent pipelines, DAG dependencies |

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
