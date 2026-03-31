# DevFlow

[![npm version](https://img.shields.io/npm/v/devflow-kit)](https://www.npmjs.com/package/devflow-kit)
[![CI](https://github.com/dean0x/devflow/actions/workflows/ci.yml/badge.svg)](https://github.com/dean0x/devflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/node-18%2B-brightgreen.svg)](https://nodejs.org/)
[![Website](https://img.shields.io/badge/Website-dean0x.github.io%2Fx%2Fdevflow-blue)](https://dean0x.github.io/x/devflow/)

<p align="center">
  <img src=".github/assets/devflow-init.gif" alt="DevFlow init demo" width="720" />
</p>

## The problem with AI-assisted development

Claude Code is powerful. But every session starts from scratch. Context evaporates between conversations. Code reviews are single-pass and shallow. Quality depends entirely on what you remember to ask for.

DevFlow fixes this. Install it once. Forget about it. Your code gets better automatically.

**18 parallel code reviewers** investigate your changes from every angle — security, architecture, performance, complexity, consistency, regression, testing — each with domain-specific expertise and confidence scoring. Not a linter. Not a single-pass review.

**Working memory that never forgets.** Session context survives restarts, `/clear`, and context compaction. Your AI picks up exactly where it left off — zero ceremony.

**It learns how you work.** Repeated workflows and procedural patterns are detected across sessions and turned into reusable slash commands and skills automatically.

## See it work

You're on `main`. You type a task description. DevFlow detects you're on a protected branch, auto-creates a feature branch following your repo's naming conventions, and starts implementing — exploration, planning, coding, validation, refinement, all orchestrated through specialized agents.

```
you: add rate limiting to the /api/upload endpoint

DevFlow: Ambient: IMPLEMENT/ORCHESTRATED
         → Created branch feat/42-rate-limit-upload
         → Exploring codebase... Planning... Coding...
         → Validator: build ✓ typecheck ✓ lint ✓ tests ✓
         → Simplifier: cleaned up 3 files
         → Scrutinizer: 9-pillar quality check passed
         → Shepherd: implementation matches request ✓
```

When you're ready for review:

```
/code-review     → 18 reviewers examine your changes in parallel
/resolve         → all issues validated and fixed automatically
```

## What you get

**Code review that actually works.** Up to 18 specialized reviewers run in parallel — security, architecture, performance, complexity, and more. Each produces findings with severity, confidence, and concrete fixes. Conditional reviewers activate when relevant (TypeScript for `.ts` files, database for schema changes). Every finding gets a category: must-fix, should-fix, or informational.

**Memory that persists.** Three hooks run behind the scenes — on stop, on start, before compaction. Architectural decisions and known pitfalls accumulate in `.memory/knowledge/` and inform every future session. No manual bookkeeping.

**Full lifecycle in one command.** `/implement` takes a task from exploration through planning, coding, validation, and refinement to a PR. `/specify` defines features with clarification gates. `/debug` investigates bugs with competing hypotheses in parallel.

**Ambient intelligence.** DevFlow classifies every prompt and loads proportional skill sets automatically. Simple questions get zero overhead. Complex tasks get full agent orchestration. You never invoke it — it just works.

## Quick Start

```bash
npx devflow-kit init
```

That's it. The interactive wizard handles plugin selection, feature configuration, and security settings. Ambient mode, working memory, and self-learning are on by default.

## Commands

| Command | What it does |
|---------|-------------|
| `/specify` | Define a feature with clarification gates → GitHub issue |
| `/implement` | Full lifecycle: explore → plan → code → validate → refine → PR |
| `/code-review` | Multi-perspective parallel code review |
| `/resolve` | Validate and fix all review issues |
| `/debug` | Competing hypothesis investigation |
| `/self-review` | Simplifier + Scrutinizer quality pass |

See [docs/commands.md](docs/commands.md) for detailed usage.

## Language Support

Optional plugins add language-specific patterns for TypeScript, React, Go, Python, Java, Rust, accessibility, and frontend design.

```bash
npx devflow-kit init --plugin=typescript,react
```

## CLI Reference

```bash
npx devflow-kit init                    # Install (interactive wizard)
npx devflow-kit init --plugin=implement # Install specific plugin
npx devflow-kit list                    # List available plugins
npx devflow-kit ambient --enable        # Toggle ambient mode
npx devflow-kit learn --enable          # Toggle self-learning
npx devflow-kit uninstall               # Remove DevFlow
```

See [docs/cli-reference.md](docs/cli-reference.md) for all options.

## How it works

DevFlow is a plugin system for Claude Code. Each plugin installs commands, agents, and skills into your Claude Code environment. Skills are tiny markdown files that activate automatically based on context. Agents are specialized workers (reviewer, coder, resolver, etc.) with explicit model assignments — Opus for analysis, Sonnet for execution, Haiku for I/O. Commands orchestrate agent pipelines.

For deep dives: [Working Memory](docs/working-memory.md) | [Self-Learning](docs/self-learning.md) | [CLI Reference](docs/cli-reference.md) | [Commands](docs/commands.md)

## Part of the AI Development Stack

| Tool | Role | What It Does |
|------|------|-------------|
| **[Skim](https://github.com/dean0x/skim)** | Context Optimization | Code-aware AST parsing, command rewriting, output compression |
| **DevFlow** | Quality Orchestration | Parallel reviewers, working memory, self-learning, composable plugins |
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
