# DevFlow: The Most Advanced Agentic Development Toolkit for Production-Grade Code

[![npm version](https://img.shields.io/npm/v/devflow-kit)](https://www.npmjs.com/package/devflow-kit)
[![CI](https://github.com/dean0x/devflow/actions/workflows/ci.yml/badge.svg)](https://github.com/dean0x/devflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/node-18%2B-brightgreen.svg)](https://nodejs.org/)
[![Website](https://img.shields.io/badge/Website-dean0x.github.io%2Fx%2Fdevflow-blue)](https://dean0x.github.io/x/devflow/)

**The most advanced toolkit for generating production-grade code with Claude Code. 18 parallel code reviewers. Working memory that never forgets. Self-learning that gets smarter every session.**

<p align="center">
  <img src=".github/assets/devflow-init.gif" alt="DevFlow init demo" width="720" />
</p>

## Why DevFlow

Claude Code is powerful. DevFlow makes it extraordinary.

**18 parallel code reviewers.** Not a linter. Not a single-pass review. DevFlow deploys up to 18 specialized reviewers simultaneously: security, architecture, performance, complexity, consistency, regression, tests, plus conditional reviewers for TypeScript, React, accessibility, Go, Python, Java, Rust, database, dependencies, and documentation. Each reviewer has domain-specific expertise. Findings include confidence scores, and false positives are tracked and penalized.

**Working memory that never forgets.** Three shell hooks preserve session context across restarts, `/clear`, and context compaction. Zero ceremony. Your AI remembers what it was doing, what decisions were made, and what files were modified. Every session picks up exactly where the last one left off.

**Long-term project knowledge.** Architectural decisions (ADRs) and known pitfalls persist across sessions in `.memory/knowledge/`. Reviewers automatically check if changes reintroduce known pitfalls or violate prior architectural decisions.

**Self-learning workflows.** DevFlow watches how you work and auto-creates slash commands and skills from repeated patterns. It literally gets smarter the more you use it, detecting workflow patterns across sessions and generating reusable artifacts.

39 quality skills. 10 shared agents. Full lifecycle from specification to PR. One `npx devflow-kit init`.

## Features

- **18 parallel code reviewers** with security, architecture, performance, complexity, consistency, regression, tests, plus conditional language and framework reviewers
- **Working memory** that survives restarts, `/clear`, and context compaction. Zero ceremony.
- **Self-learning** that detects repeated workflows and auto-creates slash commands and skills
- **Long-term project knowledge** with architectural decisions and known pitfalls that persist and inform reviews
- **Full-lifecycle implementation** from spec to explore to plan to code to validate to refine in one command
- **Parallel debugging** with competing hypotheses investigated simultaneously
- **39 quality skills** with 9 auto-activating core, 8 language/ecosystem, plus specialized review and orchestration skills
- **Ambient mode** that classifies intent and loads proportional skill sets automatically
- **Model strategy** with explicit model assignments — Opus for analysis agents (reviewer, scrutinizer, shepherd), Sonnet for execution agents (coder, resolver, simplifier), Haiku for I/O agents (git, synthesizer, validator)
- **Fully composable plugin system** where every feature is a plugin. Install only what you need. No bloat, no take-it-or-leave-it bundles.

## Quick Start

```bash
npx devflow-kit init
```

Then in Claude Code:

```
/code-review
```

## Commands

| Plugin | Command | Description |
|--------|---------|-------------|
| `devflow-specify` | `/specify` | Interactive feature specification with clarification gates |
| `devflow-implement` | `/implement` | Complete task lifecycle — explore, plan, code, validate, refine |
| `devflow-code-review` | `/code-review` | Multi-perspective code review with severity classification |
| `devflow-resolve` | `/resolve` | Process review issues — fix or defer to tech debt |
| `devflow-debug` | `/debug` | Parallel hypothesis debugging |
| `devflow-self-review` | `/self-review` | Self-review workflow (Simplifier + Scrutinizer) |
| `devflow-ambient` | (hook) | Ambient mode — intent classification with agent orchestration |
| `devflow-core-skills` | (auto) | Auto-activating quality enforcement skills |

## Command Details

### /specify

Guides you through defining a feature with three mandatory gates:

1. **Understanding Gate** - Confirm the feature idea is understood
2. **Scope Gate** - Validate priorities and boundaries
3. **Acceptance Gate** - Confirm success criteria

Creates a GitHub issue with well-defined requirements ready for `/implement`.

### /implement

Executes a single task through the complete development lifecycle:

1. **Exploration** — analyze codebase for relevant patterns and dependencies
2. **Planning** — design the implementation approach
3. **Implementation** — write code on a feature branch
4. **Validation** — run build, typecheck, lint, and tests
5. **Refinement** — simplify and review for quality
6. **Alignment Check** — verify implementation matches the original request

Creates a PR when complete.

### /code-review

Multi-perspective code review with specialized reviewers:

- **Core**: Security, Architecture, Performance, Quality
- **Conditional** (activated when relevant): TypeScript, React, Accessibility, Go, Python, Java, Rust, Database, Dependencies, Documentation
- Findings classified as must-fix, should-fix, or nit with severity and confidence levels

Provides actionable feedback with specific file locations and suggested fixes.

### /debug

Investigates bugs using competing hypotheses:

1. **Hypothesis Generation** — identify 3-5 plausible explanations
2. **Parallel Investigation** — each hypothesis investigated independently
3. **Evidence Evaluation** — hypotheses ranked by supporting evidence
4. **Root Cause** — the best-supported explanation with fix recommendation

Produces a root cause analysis report with confidence level.

### /resolve

Processes issues from `/code-review`:

- Validates each issue is real (not false positive)
- Standard fixes applied directly, careful fixes (public API, shared state) get test-first treatment
- Only defers to tech debt when complete architectural overhaul is needed

## Auto-Activating Skills

The `devflow-core-skills` plugin provides quality enforcement skills that activate automatically:

| Skill | Triggers When |
|-------|---------------|
| `software-design` | Implementing business logic, error handling |
| `docs-framework` | Creating documentation artifacts in .docs/ |
| `git` | Git operations, commits, PRs, GitHub API |
| `test-driven-development` | Implementing new features (RED-GREEN-REFACTOR) |
| `testing` | Writing or modifying tests |
| `boundary-validation` | Creating API endpoints |
| `search-first` | Adding utilities, helpers, or infrastructure code |

## Language & Ecosystem Plugins

Optional plugins for language-specific patterns. Install only what you need:

| Plugin | Skill | Triggers When |
|--------|-------|---------------|
| `devflow-typescript` | `typescript` | Working in TypeScript codebases |
| `devflow-react` | `react` | Working with React components |
| `devflow-accessibility` | `accessibility` | Creating UI components, forms |
| `devflow-frontend-design` | `ui-design` | Working with CSS, styling |
| `devflow-go` | `go` | Working in Go codebases |
| `devflow-python` | `python` | Working in Python codebases |
| `devflow-java` | `java` | Working in Java codebases |
| `devflow-rust` | `rust` | Working in Rust codebases |

```bash
# Install specific language plugins
npx devflow-kit init --plugin=typescript,react
npx devflow-kit init --plugin=go
```

## Requirements

- [Claude Code](https://claude.ai/download) (latest)
- Node.js 18+

## Installation

### Install All Plugins

```bash
npx devflow-kit init
```

The interactive wizard walks through plugin selection, feature configuration (ambient mode, working memory, HUD, safe-delete), and security settings. In user scope, it discovers all projects Claude has worked on and batch-installs `.claudeignore` across them.

### Install Specific Plugins

```bash
# List available plugins
npx devflow-kit list

# Install specific plugin(s)
npx devflow-kit init --plugin=implement
npx devflow-kit init --plugin=implement,code-review
```

### Scopes

- `--scope user` (default) - Install for all projects (`~/.claude/`)
- `--scope local` - Install for current project only (`.claude/`)

## Working Memory

DevFlow automatically preserves session context across restarts, `/clear`, and context compaction — zero ceremony required.

Three shell hooks run behind the scenes:

| Hook | When | What |
|------|------|------|
| **Stop** | After each response | Updates `.memory/WORKING-MEMORY.md` with current focus, decisions, and progress. Throttled — skips if updated <2 min ago. |
| **SessionStart** | On startup, `/clear`, resume, compaction | Injects previous working memory + fresh git state as system context. Warns if memory is >1h stale. |
| **PreCompact** | Before context compaction | Backs up git state to JSON. Bootstraps a minimal working memory from git if none exists yet. |

Working memory is **per-project** — scoped to each repo's `.memory/` directory. Multiple sessions across different repos don't interfere.

## Self-Learning

DevFlow detects repeated workflows and procedural knowledge across your sessions and automatically creates slash commands and skills.

A background agent runs on session end, batching every 3 sessions (5 at 15+ observations) to analyze transcripts for patterns. When a pattern is observed enough times (3 observations with 24h+ temporal spread for both types), it creates an artifact:

- **Workflow patterns** become slash commands at `.claude/commands/self-learning/`
- **Procedural patterns** become skills at `.claude/skills/{slug}/`

| Command | Description |
|---------|-------------|
| `devflow learn --enable` | Register the learning SessionEnd hook |
| `devflow learn --disable` | Remove the learning hook |
| `devflow learn --status` | Show learning status and observation counts |
| `devflow learn --list` | Show all observations sorted by confidence |
| `devflow learn --configure` | Interactive configuration (model, throttle, daily cap, debug) |
| `devflow learn --clear` | Reset all observations |
| `devflow learn --purge` | Remove invalid/corrupted entries from learning log |

Observations accumulate in `.memory/learning-log.jsonl` with confidence scores and temporal decay. You can edit or delete any generated artifacts — they are never overwritten.

## Documentation Structure

DevFlow creates project documentation in `.docs/` and working memory in `.memory/`:

```
.docs/
├── reviews/{branch}/         # Review reports per branch
└── design/                   # Implementation plans

.memory/
├── WORKING-MEMORY.md         # Auto-maintained by Stop hook
├── backup.json               # Pre-compact git state snapshot
├── learning-log.jsonl        # Learning observations (JSONL)
├── learning.json             # Project-level learning config
├── .learning-runs-today      # Daily run counter
├── .learning-session-count   # Session IDs pending batch (one per line)
├── .learning-batch-ids       # Session IDs for current batch run
├── .learning-notified-at     # New artifact notification marker
└── knowledge/
    ├── decisions.md           # Architectural decisions (ADR-NNN, append-only)
    └── pitfalls.md            # Known pitfalls (area-specific gotchas)

~/.devflow/logs/{project-slug}/
├── .learning-update.log      # Background learning agent log
└── .working-memory-update.log # Background memory updater log
```

## Workflow Examples

### Implementing a Feature
```bash
/specify     # Define the feature with clarification gates
/implement   # Execute the full lifecycle
```

### Debugging an Issue
```bash
/debug "login fails after session timeout"
/debug #42   # Investigate from GitHub issue
```

### Before Creating a PR
```bash
/code-review      # Multi-perspective code review
/resolve     # Fix low-risk issues, defer high-risk to backlog
```

### Session Continuity

Session context is saved and restored automatically via Working Memory hooks — no manual steps needed.

## CLI Reference

| Command | Description |
|---------|-------------|
| `npx devflow-kit init` | Install all plugins |
| `npx devflow-kit init --plugin=<names>` | Install specific plugin(s) |
| `npx devflow-kit list` | List available plugins |
| `npx devflow-kit ambient --enable` | Enable always-on ambient mode |
| `npx devflow-kit ambient --disable` | Disable ambient mode |
| `npx devflow-kit learn --enable` | Enable self-learning |
| `npx devflow-kit learn --disable` | Disable self-learning |
| `npx devflow-kit uninstall` | Remove DevFlow |

### Init Options

| Option | Description |
|--------|-------------|
| `--plugin <names>` | Comma-separated plugin names (e.g., `implement,code-review`) |
| `--scope <user\|local>` | Installation scope (default: user) |
| `--teams` / `--no-teams` | Enable/disable Agent Teams (experimental, default: off) |
| `--ambient` / `--no-ambient` | Enable/disable ambient mode (default: on) |
| `--memory` / `--no-memory` | Enable/disable working memory (default: on) |
| `--learn` / `--no-learn` | Enable/disable self-learning (default: on) |
| `--hud` / `--no-hud` | Enable/disable HUD status line (default: on) |
| `--hud-only` | Install only the HUD (no plugins, hooks, or extras) |
| `--verbose` | Show detailed output |

### HUD Options

| Command | Description |
|---------|-------------|
| `npx devflow-kit hud --status` | Show current HUD config |
| `npx devflow-kit hud --enable` | Enable HUD |
| `npx devflow-kit hud --disable` | Disable HUD (version notifications still appear) |
| `npx devflow-kit hud --detail` | Show tool/agent descriptions |
| `npx devflow-kit hud --no-detail` | Hide tool/agent descriptions |

### Skill Shadowing

Override any DevFlow skill with your own version. Shadowed skills survive `devflow init` — your version is copied to the install target on each init instead of DevFlow's.

```bash
# Create a personal override (copies current version as reference)
npx devflow-kit skills shadow software-design

# Edit your override
vim ~/.devflow/skills/software-design/SKILL.md

# List all overrides
npx devflow-kit skills list-shadowed

# Remove override (next init restores DevFlow's version)
npx devflow-kit skills unshadow software-design
```

### Uninstall Options

| Option | Description |
|--------|-------------|
| `--scope <user\|local>` | Uninstall scope (default: user) |
| `--plugin <names>` | Comma-separated plugin names to uninstall selectively |
| `--keep-docs` | Preserve .docs/ directory |
| `--dry-run` | Show what would be removed without deleting anything |
| `--verbose` | Show detailed uninstall output |

## Part of the AI Development Stack

| Tool | Role | What It Does |
|------|------|-------------|
| **[Skim](https://github.com/dean0x/skim)** | Context Optimization | Code-aware AST parsing across 12 languages, command rewriting, test/build/git output compression |
| **DevFlow** | Quality Orchestration | 18 parallel reviewers, working memory, self-learning, composable plugin system |
| **[Backbeat](https://github.com/dean0x/backbeat)** | Agent Orchestration | Orchestration at scale. Karpathy optimization loops, multi-agent pipelines, DAG dependencies, autoscaling |

Skim optimizes what your AI sees. DevFlow enforces how it works. Backbeat scales everything across agents. No other stack covers all three.

## Building from Source

```bash
git clone https://github.com/dean0x/devflow.git
cd devflow
npm install
npm run build
node dist/cli.js init
```

## License

MIT
