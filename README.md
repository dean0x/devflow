# DevFlow - Agentic Development Toolkit

A collection of Claude Code commands designed to enhance developer workflows with structured processes for specification, implementation, and review.

## Installation

### Option 1: Native Plugin (Recommended)

```bash
/plugin install dean0x/devflow
```

Commands are immediately available as `/devflow:command-name` (or just `/command-name` if no conflicts).

### Option 2: CLI Installer

```bash
npx devflow-kit init
```

**Scopes:**
- `--scope user` (default) - Install for all projects (`~/.claude/`)
- `--scope local` - Install for current project only (`.claude/`)

## Commands

| Command | Purpose |
|---------|---------|
| `/specify` | Define a feature through guided clarification before implementation |
| `/implement` | Execute a task through the complete lifecycle (explore → plan → implement → validate) |
| `/review` | Comprehensive code review with multiple focus areas |
| `/resolve` | Process review issues - fix low-risk, defer high-risk to tech debt |
| `/catch-up` | Get oriented at the start of a session |
| `/devlog` | Document session state before ending |

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

## CLI Options

| Command | Options |
|---------|---------|
| `npx devflow-kit init` | `--scope <user\|local>`, `--override-settings`, `--verbose`, `--skip-docs` |
| `npx devflow-kit uninstall` | `--scope <user\|local>`, `--keep-docs` |

### Settings Override

DevFlow includes optimized settings (security deny list, token optimization). Use `--override-settings` to replace existing `settings.json`.

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
