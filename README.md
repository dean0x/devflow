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
| `devflow-implement` | `/implement` | Complete task lifecycle (explore → plan → implement → validate) |
| `devflow-review` | `/review` | Comprehensive code review with multiple focus areas |
| `devflow-resolve` | `/resolve` | Process review issues - fix or defer to tech debt |
| `devflow-catch-up` | `/catch-up` | Context restoration from status logs |
| `devflow-devlog` | `/devlog` | Development session logging |
| `devflow-core-skills` | (auto) | Auto-activating quality enforcement skills |

## Commands

### /specify

Guides you through defining a feature with three mandatory gates:

1. **Understanding Gate** - Confirm the feature idea is understood
2. **Scope Gate** - Validate priorities and boundaries
3. **Acceptance Gate** - Confirm success criteria

Creates a GitHub issue with well-defined requirements ready for `/implement`.

### /implement

Executes a single task through the complete development lifecycle:

1. **Exploration** - Understand the codebase and find relevant patterns
2. **Planning** - Design the implementation approach
3. **Implementation** - Write the code on a feature branch
4. **Validation** - Run build, typecheck, lint, and tests
5. **Refinement** - Simplify and review for quality
6. **Alignment Check** - Verify implementation matches the original request

Creates a PR when complete.

### /review

Performs comprehensive code review across multiple focus areas:

- Security vulnerabilities
- Architecture and design patterns
- Performance issues
- Code complexity
- Test coverage and quality
- Database patterns
- Documentation alignment
- Dependency risks
- Regression detection

Provides actionable feedback with severity levels and specific fixes.

### /resolve

Processes issues from `/review`:

- Validates each issue is real (not false positive)
- Assesses risk of fixing (low vs high)
- Fixes low-risk issues immediately
- Defers high-risk issues to tech debt backlog

### /catch-up

Restores context at the start of a session:

- Reads recent status logs
- Summarizes current project state
- Recommends next actions

### /devlog

Documents session state before ending:

- Captures decisions made
- Records problems encountered
- Notes current progress
- Creates searchable history in `.docs/status/`

## Auto-Activating Skills

The `devflow-core-skills` plugin provides quality enforcement skills that activate automatically:

| Skill | Triggers When |
|-------|---------------|
| `commit` | Staging files, creating commits |
| `pull-request` | Creating PRs |
| `test-design` | Writing or modifying tests |
| `code-smell` | Implementing features |
| `input-validation` | Creating API endpoints |
| `typescript` | Working in TypeScript codebases |
| `react` | Working with React components |

## Documentation Structure

DevFlow creates project documentation in `.docs/`:

```
.docs/
├── reviews/{branch}/    # Review reports per branch
├── design/              # Implementation plans
├── status/              # Development logs
│   ├── {timestamp}.md
│   └── INDEX.md
└── CATCH_UP.md          # Latest summary
```

## Workflow

### Starting a Session
```bash
/catch-up    # Review previous state and get recommendations
```

### Implementing a Feature
```bash
/specify     # Define the feature with clarification gates
/implement   # Execute the full lifecycle
```

### Before Creating a PR
```bash
/review      # Comprehensive review across all focus areas
/resolve     # Fix low-risk issues, defer high-risk to backlog
```

### Ending a Session
```bash
/devlog      # Document decisions and state for next session
```

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
| `--override-settings` | Replace existing settings.json |
| `--verbose` | Show detailed output |
| `--skip-docs` | Skip creating .docs/ structure |

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
