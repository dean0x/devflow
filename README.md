# DevFlow Kit - Agentic Development Toolkit

A comprehensive collection of Claude Code commands and configurations designed to enhance developer workflows when working with AI coding assistants.

## Installation

```bash
# Install globally from npm
npm install -g devflow-kit

# Initialize DevFlow in Claude Code
devflow init
```

## What's Included

### 📊 Slash Commands

**Code Review & Quality:**
- `/pre-commit` - Review uncommitted changes before committing using specialized sub-agents
- `/pre-pr` - Comprehensive branch review for PR readiness assessment
- `/commit` - Intelligent atomic commit creation with safety checks and clean git history

**Session Management:**
- `/catch-up` - Smart summaries for starting new sessions with status validation
- `/devlog` - Development log for comprehensive session documentation
- `/plan-next-steps` - Extract actionable next steps from current discussion

**Development Tools:**
- `/debug [issue]` - Systematic debugging with issue-specific investigation (accepts issue description as argument)

### 🤖 Sub-Agents

**Audit Specialists:**
- `audit-security` - Expert security vulnerability detection and analysis
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
- Zero configuration - works immediately after installation

### 🔒 Security & Token Optimization

DevFlow automatically creates a comprehensive `.claudeignore` file to protect your codebase:

**Security Protection:**
- **Environment files** - `.env`, `.env.*`, `.envrc`
- **Credentials & Keys** - `*.key`, `*.pem`, `id_rsa`, SSH keys
- **Cloud configs** - `.aws/`, `.gcp/`, `.azure/` credentials
- **Package configs** - `.npmrc`, `.pypirc` with tokens
- **Database files** - `*.sql`, `*.db` with potential data

**Token Optimization:**
- **Dependencies** - `node_modules/`, `vendor/`, `venv/` (saves thousands of tokens)
- **Build artifacts** - `dist/`, `build/`, `.next/` output
- **IDE files** - `.vscode/`, `.idea/` settings
- **Lock files** - `package-lock.json`, `yarn.lock` (rarely needed for context)
- **Large files** - Media, archives, binaries

The `.claudeignore` is created at your git repository root and covers patterns for all major languages and operating systems.

## Using Sub-Agents

### Commands vs Sub-Agents
DevFlow provides both **slash commands** and **specialized sub-agents** for flexibility:

**Slash Commands** (`/pre-commit`, `/catch-up`):
- Quick, direct execution
- Immediate results in current context
- Good for workflow orchestration and session management

**Sub-Agents** (`audit-security`):
- Specialized AI assistants with deep expertise
- Separate context windows for focused analysis
- Ideal for complex, multi-step investigations
- Can be invoked automatically by orchestrator commands

### Invoking Sub-Agents
```bash
# Explicit invocation
"Use the audit-security sub-agent to analyze this authentication code"

# Automatic delegation
"Review this code for security issues" # May automatically use audit-security sub-agent

# Multiple sub-agents
"Analyze this database code" # May invoke both audit-database and audit-performance
```

### Sub-Agent Configuration
Sub-agents are configured in `.claude/agents/devflow/` and included in your project setup. Each sub-agent has:
- Specialized expertise and system prompts
- Restricted tool access appropriate to their domain
- Focused analysis capabilities

## Development Workflow

### Starting a Session
1. **Get oriented**: `/catch-up` - Review what was done previously
2. **Check status**: Use statusline to see current model, git state, duration
3. **Plan work**: Review recommended next actions from catch-up summary

### During Development
1. **Review changes**: Use `/pre-commit` for quick review before committing
2. **Create commits**: Use `/commit` for intelligent atomic commits with safety checks
3. **Monitor quality**: Invoke specialized audit sub-agents as needed

### Ending a Session
1. **Document progress**: `/devlog` - Capture decisions and state
2. **Review changes**: `/pre-commit` for uncommitted changes, `/pre-pr` for branch review
3. **Commit safely**: Use `/commit` for intelligent, atomic commits with validation

### When Things Go Wrong
1. **Review history**: Check git log and recent commits
2. **Debug systematically**: Use `/debug [issue description]` for structured debugging
3. **Revert changes**: Use git to review and revert if needed
4. **Document lessons**: Update project documentation and constraints

## CLI Commands

### `devflow init`
Initialize DevFlow for Claude Code. Installs commands, agents, scripts, and settings to your Claude Code configuration.

**What it does:**
- Installs commands to `~/.claude/commands/devflow/`
- Installs sub-agents to `~/.claude/agents/devflow/`
- Installs scripts to `~/.devflow/scripts/`
- Installs settings to `~/.claude/settings.json`
- Creates `.claudeignore` at git repository root (if in git repo)
- Creates `.docs/` structure for project documentation
- Configures smart statusline

**Options:**
- `--skip-docs` - Skip creating `.docs/` structure

**Example:**
```bash
# Standard installation
devflow init

# Skip project documentation setup
devflow init --skip-docs
```

### `devflow uninstall`
Remove DevFlow from Claude Code.

**What it does:**
- Removes commands from `~/.claude/commands/devflow/`
- Removes sub-agents from `~/.claude/agents/devflow/`
- Removes scripts from `~/.devflow/scripts/`
- Optionally preserves `.docs/` directory

**Options:**
- `--keep-docs` - Keep .docs/ directory and documentation

**Example:**
```bash
# Standard uninstall
devflow uninstall

# Keep documentation
devflow uninstall --keep-docs
```

## Advanced Usage

### Custom Audit Rules
Extend audit sub-agents for project-specific patterns:
```bash
# Add custom security rules to sub-agent
echo "Additional pattern: check for exposed API keys in config files" >> ~/.claude/agents/devflow/audit-security.md
```

### Integration with Workflow
```bash
# Pre-commit review
/pre-commit

# Intelligent commits
/commit

# Branch review before PR
/pre-pr
```

### Team Usage
```bash
# Share status with team
/devlog
git add .docs/status/
git commit -m "Session status: completed user auth feature"
```

### First Run
After installation, start with:
```bash
# Document your current project state
/devlog

# Get oriented with the project
/catch-up
```

## Quick Reference

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/catch-up` | Review recent work | Starting a session |
| `/devlog` | Document session | Ending a session |
| `/plan-next-steps` | Extract action items | After planning discussion |
| `/debug [issue]` | Debug specific issues | When troubleshooting |
| `/pre-commit` | Review uncommitted changes | Before committing |
| `/commit` | Create atomic commits | When ready to commit |
| `/pre-pr` | Comprehensive branch review | Before creating PR |

## Philosophy

Modern development increasingly involves AI agents that can read, write, and modify code autonomously. DevFlow provides:

- **Trust but Verify** - Tools to catch AI agent mistakes
- **Context Preservation** - Memory across long-term projects
- **Quality Gates** - Automated checks for AI changes
- **Developer Empowerment** - Enhance human judgment, not replace it

## Building from Source

If you want to contribute or modify DevFlow:

```bash
# Clone the repository
git clone https://github.com/dean0x/devflow.git
cd devflow

# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch mode for development
npm run dev

# Test CLI locally
node dist/cli.js init
```

### Project Structure

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

## Support

This toolkit is designed to be self-documenting and self-improving. When you encounter issues:

1. Check the command documentation in the installed commands
2. Review recent status documents in `.docs/status/`
3. Use `/debug [issue]` for systematic troubleshooting
4. Report issues at https://github.com/dean0x/devflow/issues

## License

MIT