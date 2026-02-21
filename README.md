# DevFlow - Agentic Development Toolkit

A collection of Claude Code plugins designed to enhance developer workflows with structured processes for specification, implementation, and review.

## Installation

### Option 1: Install All Plugins

```bash
npx devflow-kit init
```

### Option 2: Install Specific Plugins

```bash
# List available plugins
npx devflow-kit list

# Install specific plugin(s)
npx devflow-kit init --plugin=implement
npx devflow-kit init --plugin=implement,review
```

### Option 3: Native Plugin (When Available)

```bash
/plugin install dean0x/devflow-implement
/plugin install dean0x/devflow-review
```

### Scopes

- `--scope user` (default) - Install for all projects (`~/.claude/`)
- `--scope local` - Install for current project only (`.claude/`)

## Plugins

| Plugin | Command | Description |
|--------|---------|-------------|
| `devflow-specify` | `/specify` | Interactive feature specification with clarification gates |
| `devflow-implement` | `/implement` | Complete task lifecycle with team-based exploration and planning |
| `devflow-review` | `/review` | Adversarial code review with team debate and consensus |
| `devflow-resolve` | `/resolve` | Process review issues - fix or defer to tech debt |
| `devflow-debug` | `/debug` | Competing hypothesis debugging with agent teams |
| `devflow-self-review` | `/self-review` | Self-review workflow (Simplifier + Scrutinizer) |
| `devflow-core-skills` | (auto) | Auto-activating quality enforcement skills |

## Commands

The descriptions below reflect the **teams variant** behavior (Agent Teams with peer debate). The **no-teams variant** achieves the same outcomes using parallel subagents without debate rounds.

### /specify

Guides you through defining a feature with three mandatory gates:

1. **Understanding Gate** - Confirm the feature idea is understood
2. **Scope Gate** - Validate priorities and boundaries
3. **Acceptance Gate** - Confirm success criteria

Creates a GitHub issue with well-defined requirements ready for `/implement`.

### /implement

Executes a single task through the complete development lifecycle:

1. **Exploration** - Agent team explores codebase with debate on findings
2. **Planning** - Agent team designs approach with adversarial challenge
3. **Implementation** - Write the code on a feature branch
4. **Validation** - Run build, typecheck, lint, and tests
5. **Refinement** - Simplify and review for quality
6. **Alignment Check** - Shepherd↔Coder direct dialogue validates alignment

Creates a PR when complete.

### /review

Performs adversarial code review where reviewers debate findings:

- Security, Architecture, Performance, and Quality perspectives
- Conditional: TypeScript, React, Accessibility, Database, Dependencies, Documentation
- Reviewers challenge each other's findings with evidence
- Findings classified by consensus: HIGH / MEDIUM / LOW confidence

Provides actionable feedback with severity levels, confidence, and specific fixes.

### /debug

Investigates bugs using competing hypotheses with an agent team:

1. **Hypothesis Generation** - Identify 3-5 plausible explanations
2. **Parallel Investigation** - Each agent investigates one hypothesis
3. **Adversarial Debate** - Agents try to disprove each other's theories
4. **Convergence** - Root cause is the hypothesis that survives scrutiny

Produces a root cause analysis report with confidence level.

### /resolve

Processes issues from `/review`:

- Validates each issue is real (not false positive)
- Assesses risk of fixing (low vs high)
- Fixes low-risk issues immediately
- Defers high-risk issues to tech debt backlog

## Auto-Activating Skills

The `devflow-core-skills` plugin provides quality enforcement skills that activate automatically:

| Skill | Triggers When |
|-------|---------------|
| `core-patterns` | Implementing business logic, error handling |
| `git-workflow` | Staging files, creating commits, PRs |
| `test-patterns` | Writing or modifying tests |
| `input-validation` | Creating API endpoints |
| `typescript` | Working in TypeScript codebases |
| `react` | Working with React components |
| `accessibility` | Creating UI components, forms, interactive elements |
| `frontend-design` | Working with CSS, styling, visual design |

## Working Memory

DevFlow automatically preserves session context across restarts, `/clear`, and context compaction — zero ceremony required.

Three shell hooks run behind the scenes:

| Hook | When | What |
|------|------|------|
| **Stop** | After each response | Updates `.docs/WORKING-MEMORY.md` with current focus, decisions, and progress. Throttled — skips if updated <2 min ago. |
| **SessionStart** | On startup, `/clear`, resume, compaction | Injects previous working memory + fresh git state as system context. Warns if memory is >1h stale. |
| **PreCompact** | Before context compaction | Backs up git state to JSON. Bootstraps a minimal working memory from git if none exists yet. |

Working memory is **per-project** — scoped to each repo's `.docs/` directory. Multiple sessions across different repos don't interfere.

## Documentation Structure

DevFlow creates project documentation in `.docs/`:

```
.docs/
├── reviews/{branch}/         # Review reports per branch
├── design/                   # Implementation plans
├── WORKING-MEMORY.md         # Auto-maintained by Stop hook
└── working-memory-backup.json # Pre-compact git state snapshot
```

## Workflow

### Starting a Session

Session context is restored automatically via Working Memory hooks — no manual steps needed.

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
/review      # Adversarial review with team debate
/resolve     # Fix low-risk issues, defer high-risk to backlog
```

### Ending a Session

Working memory is saved automatically — no manual steps needed.

## CLI Reference

| Command | Description |
|---------|-------------|
| `npx devflow-kit init` | Install all plugins |
| `npx devflow-kit init --plugin=<names>` | Install specific plugin(s) |
| `npx devflow-kit list` | List available plugins |
| `npx devflow-kit uninstall` | Remove DevFlow |

### Init Options

| Option | Description |
|--------|-------------|
| `--plugin <names>` | Comma-separated plugin names (e.g., `implement,review`) |
| `--scope <user\|local>` | Installation scope (default: user) |
| `--teams` / `--no-teams` | Select command variant: `--teams` uses Agent Teams with peer debate; `--no-teams` uses parallel subagents (default: prompt at install) |
| `--verbose` | Show detailed output |

### Uninstall Options

| Option | Description |
|--------|-------------|
| `--scope <user\|local>` | Uninstall scope (default: user) |
| `--keep-docs` | Preserve .docs/ directory |

## Building from Source

```bash
git clone https://github.com/dean0x/devflow.git
cd devflow
npm install
npm run build
node dist/cli.js init
```

## Support

Report issues at https://github.com/dean0x/devflow/issues

## License

MIT
