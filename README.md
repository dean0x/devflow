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

Devflow fixes this. Install once, forget about it.

## See it work

```
you: add rate limiting to the /api/upload endpoint
     (or use /devflow:implement for the full agent pipeline)

         → Created branch feat/42-rate-limit-upload
         → Exploring codebase... Planning... Coding...
         → Validator: build ✓ typecheck ✓ lint ✓ tests ✓
         → Simplifier: cleaned up 3 files
         → Scrutinizer: 9-pillar quality check passed
         → Evaluator: implementation matches request ✓
         → Tester: 5/5 QA scenarios passed ✓
```

```
/devflow:code-review     → up to 20 reviewers examine your changes in parallel
/devflow:resolve         → all issues validated and fixed automatically
/devflow:bug-analysis    → proactive bug finding before review
```

## What you get

**Ambient intelligence.** A charter injected at session start turns the main session into a pure orchestrator. Normal prompts get a 2-line delegation reminder; plan-mode handoffs auto-run `devflow:implement`; slash commands pass through unchanged. Init and forget.

**Memory that persists.** Session context survives restarts, `/clear`, and context compaction. Your agent picks up exactly where it left off.


**Self learning.** A background agent detects architectural decisions and known pitfalls from your session dialogs and writes them to `.devflow/learning/decisions.md` and `.devflow/learning/pitfalls.md` — informing every future review and implementation session without any manual bookkeeping.

**Skill shadowing.** Override any built-in skill with your own version. Drop a file into `~/.devflow/skills/{name}/` and the installer uses yours instead of the default — same activation, your rules.

**Always-on rules.** 13 ultra-condensed engineering principles (~10 lines each) load on every prompt — security, quality, and language-specific guidance (TypeScript, React, Go, Python, Java, Rust), plus a global compliance rule when the devflow-compliance plugin is installed. Rules install from your selected plugins only, so a Go project won't get React rules. Override any rule via `~/.devflow/rules/{name}.md` or `devflow rules shadow <name>`.

**Full lifecycle.** `/devflow:plan` takes a feature idea through codebase exploration, gap analysis, design review, and outputs a plan document ready for `/devflow:implement`. `/devflow:implement` accepts that plan document (or an issue or task description directly) and drives it through coding, validation, and refinement to a PR. `/devflow:debug` investigates bugs with competing hypotheses in parallel. `/devflow:self-review` runs Simplifier + Scrutinizer quality passes.

**Everything is composable.** 23 plugins (12 core + 10 language/ecosystem + 1 optional workflow recipes). Install only what you need.

**HUD.** A persistent status line updates on every prompt — project, branch, diff stats, context usage, model, cost with weekly/monthly totals, quota reset timers, and configuration counts at a glance.

```
~/devflow · main · +2 -1 · v2.0.0+3
Context ████░░░░ 42% · 5h ████░░░░ 45% (2h 15m) · 7d ████████ 70% (3d 12h)
Opus 4.6 (1M) · 3 MCPs 2 rules · $1.42 · $18.50/wk · $62.30/mo
```

**Up to 20 parallel code reviewers.** Security, architecture, performance, complexity, consistency, regression, testing, and more. Each produces findings with severity, confidence scoring, and concrete fixes. Conditional reviewers activate when relevant (TypeScript for `.ts` files, database for schema changes, compliance when the devflow-compliance plugin is installed). Every finding gets validated and resolved automatically.

**41 skills.** Most are grounded in expert material — backed by peer-reviewed papers, canonical books, and industry standards: security (OWASP, Shostack), architecture (Parnas, Evans, Fowler), performance (Brendan Gregg), testing (Beck, Meszaros), design (Wlaschin, Hickey), compliance (GDPR, HIPAA, PCI DSS, SOC 2, ISO 27001, SOX, NIST SSDF, OWASP ASVS), 200+ sources total.

**Security.** Deny lists block dangerous tool patterns out of the box — configurable during init and toggleable any time with `devflow security` (`--enable`/`--disable`/`--status`).

## Quick Start

```bash
npx devflow-kit init
```

That's it. The interactive wizard handles plugin selection, feature configuration, and security settings. Ambient mode, working memory, and learning are on by default.

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
| `/self-review` | Simplifier + Scrutinizer quality pass |
| `/code-review` | Multi-perspective parallel code review |
| `/resolve` | Validate and fix all review issues |
| `/debug` | Competing hypothesis investigation |
| `/bug-analysis` | Proactive bug finding with static and semantic analysis |
| `/release` | Adaptive release with learned configuration |

See [docs/commands.md](docs/commands.md) for detailed usage.

## Language Support

Optional plugins add language-specific patterns for TypeScript, React, Go, Python, Java, Rust, accessibility, and UI design.

```bash
npx devflow-kit init --plugin=typescript,react
```

## How it works

Devflow is a plugin system for Claude Code. Each plugin installs commands, agents, and skills into your Claude Code environment. Skills are tiny markdown files that activate automatically based on context. Agents are specialized workers (reviewer, triager, coder, etc.) with explicit model assignments — Opus for analysis, Sonnet for execution, Haiku for I/O. Commands orchestrate agent pipelines.

For deep dives: [Working Memory](docs/working-memory.md) | [CLI Reference](docs/cli-reference.md) | [Commands](docs/commands.md)

## CLI Reference

```bash
npx devflow-kit init                    # Install (interactive wizard)
npx devflow-kit init --plugin=implement # Install specific plugin
npx devflow-kit ambient --enable        # Toggle ambient mode (orchestrator)
npx devflow-kit learning --enable       # Toggle decision/pitfall tracking
npx devflow-kit rules --status          # Show installed rules
npx devflow-kit security --status       # Show / manage the security deny list
npx devflow-kit safe-delete --enable    # Install rm -> trash safe-delete
npx devflow-kit proxy --enable          # Enable external model routing (GPT via Codex)
npx devflow-kit proxy --disable         # Disable and revert agents to Claude defaults
npx devflow-kit agents                  # Configure per-agent model assignments (TUI)
npx devflow-kit agents --list           # List agents with current model assignments
npx devflow-kit uninstall               # Remove Devflow
```

See [docs/cli-reference.md](docs/cli-reference.md) for all options.

## Part of the AI Development Stack

| Tool | Role | What It Does |
|------|------|-------------|
| **[Skim](https://github.com/dean0x/skim)** | Context Optimization | Code-aware AST parsing, command rewriting, output compression |
| **Devflow** | Quality Orchestration | Parallel reviewers, working memory, learning, composable plugins |
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
