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

### 📊 Audit Commands
Deep analysis of code quality, security, performance, and architecture:
- `/audit-security` - Security vulnerabilities and secrets scanning
- `/audit-performance` - N+1 queries, memory leaks, bottlenecks
- `/audit-architecture` - Anti-patterns and structural issues
- `/audit-tests` - Test quality and fake test detection
- `/audit-dependencies` - Package health and vulnerabilities
- `/audit-complexity` - Code maintainability metrics
- `/audit-database` - Database design and optimization

### 🤖 Agent Management
Tools for working safely with AI agents:
- `/forensic-analysis` - Verify what AI agents actually did vs claimed
- `/constraint-check` - Verify agents follow your rules and patterns
- `/review-commit` - Review uncommitted changes before committing
- `/review-branch` - Comprehensive branch review for PR readiness

### 📝 Session Intelligence
Context preservation and handoff tools:
- `/note-to-future-self` - Comprehensive session documentation
- `/catch-up` - Smart summaries for starting new sessions
- `/plan-next-steps` - Extract actionable next steps

### 📊 Smart Statusline
Real-time project context display showing:
- Current model and session duration
- Git branch and uncommitted changes indicator
- Session cost tracking
- Project context

## CLI Commands

### `devflow init`
Initialize DevFlow for Claude Code. Copies commands, agents, scripts, and settings to your Claude Code configuration.

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
│   ├── agents/                # AI sub-agents
│   ├── commands/              # Slash command definitions
│   ├── scripts/               # DevFlow scripts
│   └── settings.json          # Claude Code settings
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