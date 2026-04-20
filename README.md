# Devflow

[![npm version](https://img.shields.io/npm/v/devflow-kit)](https://www.npmjs.com/package/devflow-kit)
[![CI](https://github.com/dean0x/devflow/actions/workflows/ci.yml/badge.svg)](https://github.com/dean0x/devflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/node-18%2B-brightgreen.svg)](https://nodejs.org/)
[![Website](https://img.shields.io/badge/Website-dean0x.github.io%2Fx%2Fdevflow-blue)](https://dean0x.github.io/x/devflow/)

<p align="center">
  <img src=".github/assets/devflow-init.gif" alt="Devflow init demo" width="720" />
</p>

## The problem with AI-assisted development

Claude Code is powerful. But every session starts from scratch. Context evaporates between conversations. Code reviews are single-pass and shallow. Quality depends entirely on what you remember to ask for.

Devflow fixes this. Install once, forget about it. Your code gets better automatically.

It watches every prompt, classifies intent, and orchestrates the right workflow — plan, implement, review, debug — loading the relevant skills. Simple questions get zero overhead. Complex tasks get an advanced TDD and EDD harness with quality gates at every step.

## See it work

```
you: add rate limiting to the /api/upload endpoint

Devflow: IMPLEMENT/ORCHESTRATED
         → Created branch feat/42-rate-limit-upload
         → Exploring codebase... Planning... Coding...
         → Validator: build ✓ typecheck ✓ lint ✓ tests ✓
         → Simplifier: cleaned up 3 files
         → Scrutinizer: 9-pillar quality check passed
         → Evaluator: implementation matches request ✓
         → Tester: 5/5 QA scenarios passed ✓
```

```
/code-review     → 18 reviewers examine your changes in parallel
/resolve         → all issues validated and fixed automatically
```

## What you get

**Ambient intelligence.** Devflow classifies every prompt into three tiers — QUICK (zero overhead), GUIDED (skill loading + main session), ORCHESTRATED (full agent pipelines). You never invoke it manually. Init and forget.

**Memory that persists.** Session context survives restarts, `/clear`, and context compaction. Your AI picks up exactly where it left off. Architectural decisions and known pitfalls accumulate in `.memory/knowledge/` and inform every future session. No manual bookkeeping.

**It learns how you work.** A self-learning mechanism detects 4 observation types across sessions — workflow patterns, procedural knowledge, architectural decisions, and recurring pitfalls. Workflow and procedural observations create reusable slash commands and skills automatically. Decisions and pitfalls are written directly to `.memory/knowledge/decisions.md` and `.memory/knowledge/pitfalls.md` — informing every future review and implementation session.

**18 parallel code reviewers.** Security, architecture, performance, complexity, consistency, regression, testing, and more. Each produces findings with severity, confidence scoring, and concrete fixes. Conditional reviewers activate when relevant (TypeScript for `.ts` files, database for schema changes). Every finding gets validated and resolved automatically.

**41 skills grounded in expert material.** Every skill is backed by peer-reviewed papers, canonical books, and industry standards — security (OWASP, Shostack), architecture (Parnas, Evans, Fowler), performance (Brendan Gregg), testing (Beck, Meszaros), design (Wlaschin, Hickey). 200+ sources total.

**Skill shadowing.** Override any built-in skill with your own version. Drop a file into `~/.devflow/skills/{name}/` and the installer uses yours instead of the default — same activation, your rules.

**Full lifecycle.** `/plan` takes a feature idea through codebase exploration, gap analysis, design review, and outputs a plan document ready for `/implement`. `/implement` accepts that plan document (or an issue or task description directly) and drives it through coding, validation, and refinement to a PR. `/debug` investigates bugs with competing hypotheses in parallel. `/self-review` runs Simplifier + Scrutinizer quality passes.

**Everything is composable.** 17 plugins (8 core + 9 language/ecosystem). Install only what you need. Six commands cover the entire development lifecycle.

**HUD.** A persistent status line updates on every prompt — project, branch, diff stats, context usage, model, session duration, cost with weekly/monthly totals, quota reset timers, and configuration counts at a glance.

```
~/devflow · main · +2 -1 · v2.0.0+3
▓▓▓▓▓▓▓▓ 100% · 5h ↻2h15m ████░░░░ 45% · 7d ↻3d12h ████████ 70%
Opus 4.6 (1M) · 3 MCPs 2 rules · ⏱ 15m · $1.42 · $18.50/wk · $62.30/mo
```

**Security.** Deny lists block dangerous tool patterns out of the box — configurable during init.

## Quick Start

```bash
npx devflow-kit init
```

That's it. The interactive wizard handles plugin selection, feature configuration, and security settings. Ambient mode, working memory, and self-learning are on by default.

## Commands

| Command | What it does |
|---------|-------------|
| `/plan` | Full design pipeline: explore → gap analysis → design → PR-ready plan document |
| `/implement` | Execute plan: accepts plan documents from `/plan`, issues, or task descriptions → PR |
| `/code-review` | Multi-perspective parallel code review |
| `/resolve` | Validate and fix all review issues |
| `/debug` | Competing hypothesis investigation |
| `/self-review` | Simplifier + Scrutinizer quality pass |

See [docs/commands.md](docs/commands.md) for detailed usage.

## Language Support

Optional plugins add language-specific patterns for TypeScript, React, Go, Python, Java, Rust, accessibility, and UI design.

```bash
npx devflow-kit init --plugin=typescript,react
```

## How it works

Devflow is a plugin system for Claude Code. Each plugin installs commands, agents, and skills into your Claude Code environment. Skills are tiny markdown files that activate automatically based on context. Agents are specialized workers (reviewer, coder, resolver, etc.) with explicit model assignments — Opus for analysis, Sonnet for execution, Haiku for I/O. Commands orchestrate agent pipelines.

For deep dives: [Working Memory](docs/working-memory.md) | [Self-Learning](docs/self-learning.md) | [CLI Reference](docs/cli-reference.md) | [Commands](docs/commands.md)

## CLI Reference

```bash
npx devflow-kit init                    # Install (interactive wizard)
npx devflow-kit init --plugin=implement # Install specific plugin
npx devflow-kit list                    # List available plugins
npx devflow-kit ambient --enable        # Toggle ambient mode
npx devflow-kit learn --enable          # Toggle self-learning (4-type extraction: workflow, procedural, decision, pitfall)
npx devflow-kit uninstall               # Remove Devflow
```

See [docs/cli-reference.md](docs/cli-reference.md) for all options.

## Part of the AI Development Stack

| Tool | Role | What It Does |
|------|------|-------------|
| **[Skim](https://github.com/dean0x/skim)** | Context Optimization | Code-aware AST parsing, command rewriting, output compression |
| **Devflow** | Quality Orchestration | Parallel reviewers, working memory, self-learning, composable plugins |
| **[Backbeat](https://github.com/dean0x/backbeat)** | Agent Orchestration | Karpathy optimization loops, multi-agent pipelines, DAG dependencies |

## Building from Source

```bash
git clone https://github.com/dean0x/devflow.git
cd devflow && npm install && npm run build
node dist/cli.js init
```

## Requirements

- [Claude Code](https://claude.ai/download) (latest)
- Node.js 18+

## License

MIT
