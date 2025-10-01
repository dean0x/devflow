# DevFlow - Agentic Development Toolkit

A comprehensive collection of Claude Code commands and configurations designed to enhance developer workflows when working with AI coding assistants.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Build the CLI
npm run build

# 3. Install DevFlow for Claude Code
node dist/cli.js init

# Or install globally
npm install -g .
devflow init
```

## What's Included

### 📊 Slash Commands

**Code Review & Quality:**
- `/pre-commit` - Review uncommitted changes before committing
- `/pre-pr` - Comprehensive branch review for PR readiness
- `/commit` - Intelligent atomic commits with safety checks

**Session Management:**
- `/catch-up` - Smart summaries for starting new sessions
- `/note-to-future-self` - Comprehensive session documentation
- `/plan-next-steps` - Extract actionable next steps from discussion

### 🤖 Sub-Agents

**Audit Specialists:**
- `audit-security` - Security vulnerability detection and analysis
- `audit-performance` - Performance optimization and bottleneck detection
- `audit-architecture` - Software architecture and design pattern analysis
- `audit-tests` - Test quality and coverage analysis
- `audit-dependencies` - Dependency management and security analysis
- `audit-complexity` - Code complexity and maintainability assessment
- `audit-database` - Database design and optimization review

**Workflow Specialists:**
- `catch-up` - Project status and context restoration with validation
- `commit` - Intelligent commit creation with safety checks

### 📊 Smart Statusline
Real-time project context display showing:
- Current model and session duration
- Git branch and uncommitted changes indicator
- Session cost tracking
- Project context

### 🔒 Security & Token Optimization
DevFlow automatically creates a comprehensive `.claudeignore` file to:
- **Protect sensitive files** - Prevents exposure of credentials, keys, and secrets
- **Reduce token usage** - Excludes build artifacts, dependencies, and non-essential files
- **Support all languages** - Covers patterns for Node.js, Python, Ruby, Go, Rust, Java, and more

## CLI Commands

### `devflow init`
Initialize DevFlow for Claude Code. Installs commands, agents, scripts, and settings to your Claude Code configuration. Also creates security and optimization files.

**What it does:**
- Installs commands to `~/.claude/commands/devflow/`
- Installs sub-agents to `~/.claude/agents/devflow/`
- Installs scripts to `~/.devflow/scripts/`
- Installs settings to `~/.claude/settings.json`
- Creates `.claudeignore` at git repository root (if in git repo)
- Creates `.docs/` structure for project documentation

**Options:**
- `--skip-docs` - Skip creating `.docs/` structure

**Example:**
```bash
# Standard installation
devflow init

# Skip project documentation setup
devflow init --skip-docs
```

## Project Structure

```
devflow/
├── src/                     # All source files
│   ├── cli/                   # CLI source code
│   │   ├── commands/            # CLI command implementations
│   │   └── cli.ts               # CLI entry point
│   └── claude/                # Claude Code configuration
│       ├── agents/              # AI sub-agents
│       ├── commands/            # Slash command definitions
│       ├── scripts/             # DevFlow scripts
│       └── settings.json        # Claude Code settings
├── package.json             # Node.js package
└── tsconfig.json            # TypeScript config
```

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch mode for development
npm run dev

# Test CLI locally
node dist/cli.js init
```

## Philosophy

Modern development increasingly involves AI agents that can read, write, and modify code autonomously. DevFlow provides:

- **Trust but Verify** - Tools to catch AI agent mistakes
- **Context Preservation** - Memory across long-term projects
- **Quality Gates** - Automated checks for AI changes
- **Developer Empowerment** - Enhance human judgment, not replace it

## Documentation

See [CLAUDE.md](./CLAUDE.md) for comprehensive documentation including:
- Detailed command descriptions
- Sub-agent system architecture
- Development workflow patterns
- Command design principles

## License

MIT