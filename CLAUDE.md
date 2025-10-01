# DevFlow - Agentic Development Toolkit

A comprehensive collection of Claude Code commands and configurations designed to enhance developer workflows when working with AI coding assistants.

## Purpose

DevFlow transforms your coding environment into an intelligence-augmented workspace where AI agents can effectively collaborate with human developers. This toolkit provides:

- **Audit Commands** - Deep analysis of code quality, security, performance, and architecture
- **Session Management** - Status tracking and context preservation across coding sessions
- **Agent Accountability** - Tools to verify AI agent work
- **Development Intelligence** - Smart statusline, dependency analysis, and workflow optimization

## Philosophy

Modern development increasingly involves AI agents that can read, write, and modify code autonomously. However, this power comes with risks:

- **Trust but Verify** - AI agents make mistakes; we need tools to catch them
- **Context Preservation** - Long-term projects need memory across sessions
- **Quality Gates** - Automated checks ensure AI changes meet standards
- **Developer Empowerment** - Tools should enhance human judgment, not replace it

DevFlow bridges the gap between AI capability and development reliability.

## Core Components

### 📊 Slash Commands

**Code Review & Quality:**
- `/pre-commit` - Review uncommitted changes before committing using specialized sub-agents
- `/pre-pr` - Comprehensive branch review for PR readiness assessment
- `/commit` - Intelligent atomic commit creation with safety checks and clean git history

**Session Management:**
- `/catch-up` - Smart summaries for starting new sessions with status validation
- `/note-to-future-self` - Comprehensive session documentation and context preservation
- `/plan-next-steps` - Extract actionable next steps from current discussion

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
- `pre-commit` - Comprehensive pre-commit review orchestrator
- `pre-pr` - Branch review and PR readiness assessment
- `catch-up` - Project status and context restoration with validation
- `commit` - Intelligent commit creation with safety checks

### ⚙️ Configuration
- **Adaptive Statusline** - Shows model, git state, session duration, cost
- **Structured Documentation** - Organized status tracking in `.docs/`

### 📊 Smart Statusline
Intelligent project context display:
- **Real-time Status** - Shows project context, git status, session metrics
- **Cost Tracking** - Displays session cost and duration
- **Git Integration** - Current branch, uncommitted changes indicator
- **Zero Configuration** - Works immediately after installation

## Installation & Setup

### Claude Code Installation

DevFlow is designed specifically for Claude Code with a clean, organized structure:

```
devflow/
├── src/                     # All source files
│   ├── cli/                   # CLI source code
│   │   ├── commands/            # CLI command implementations
│   │   │   └── init.ts            # Init command
│   │   └── cli.ts               # CLI entry point
│   └── claude/                # Claude Code configuration
│       ├── agents/              # AI sub-agents
│       ├── commands/            # Slash command definitions
│       ├── scripts/             # DevFlow scripts
│       │   └── statusline.sh      # Smart statusline script
│       └── settings.json        # Unified Claude Code settings (statusline, model)
├── package.json             # Node.js package configuration
└── tsconfig.json            # TypeScript configuration
```

### Installation
```bash
# Install dependencies and build
npm install
npm run build

# Run the CLI to install DevFlow
node dist/cli.js init

# Or use npx for global installation
npm install -g .
devflow init
```

The `devflow init` command automatically:
- Copies commands from `src/claude/commands/devflow/` to `~/.claude/commands/devflow/`
- Copies agents from `src/claude/agents/devflow/` to `~/.claude/agents/devflow/`
- Copies scripts from `src/claude/scripts/` to `~/.devflow/scripts/`
- Installs unified settings from `src/claude/settings.json` to `~/.claude/settings.json`
- Configures smart statusline
- Optionally creates `.docs/` project structure (use `--skip-docs` to skip)

### 3. Initialize Project Documentation
```bash
# Create documentation structure in your project
mkdir -p .docs/{status/compact,reviews,audits}
```

### 4. First Run
```bash
# Document your current project state
/note-to-future-self

# Run an audit to establish baseline
/audit-architecture
```

## Using Sub-Agents

### Commands vs Sub-Agents
DevFlow provides both **slash commands** and **specialized sub-agents** for flexibility:

**Slash Commands** (`/audit-security`):
- Quick, direct execution
- Immediate results in current context
- Good for spot checks and manual audits

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
1. **Document progress**: `/note-to-future-self` - Capture decisions and state
2. **Review changes**: `/pre-commit` for uncommitted changes, `/pre-pr` for branch review
3. **Commit safely**: Use `/commit` for intelligent, atomic commits with validation

### When Things Go Wrong
1. **Review history**: Check git log and recent commits
2. **Revert changes**: Use git to review and revert if needed
3. **Document lessons**: Update project documentation and constraints

## Environment Integration

**CRITICAL**: This toolkit is designed for live development environments. Every command and setting should be:

1. **Immediately Available** - Copied to global Claude Code configuration
2. **Instantly Testable** - Work on the devflow repo, test in global context
3. **Continuously Improved** - Dogfood your own tools

### Development Loop
```bash
# 1. Modify command or agent in devflow repo
vim devflow/src/claude/commands/pre-commit.md

# 2. Reinstall to global context for testing
node dist/cli.js init

# 3. Test immediately
/pre-commit

# 4. Iterate until satisfied
# 5. Commit to devflow repo using /commit
```

## Command Design Principles

### 1. Brutal Honesty
Commands should expose the truth, not what developers want to hear:
- Security audits find real vulnerabilities
- Performance audits reveal actual bottlenecks
- Architecture audits expose design flaws
- Agent reviews catch AI deception

### 2. Actionable Output
Every audit provides:
- **Specific problems** with file/line references
- **Clear severity** levels (Critical/High/Medium/Low)
- **Concrete fixes** with examples
- **Cost estimates** for remediation

### 3. Context Preservation
Status and review commands create historical records:
- Decisions and rationale
- Problems encountered and solutions
- Evolution of project architecture
- Learning from AI agent interactions

### 4. Fail-Safe Defaults
- Rollback preserves safety branches
- Audits err on the side of flagging issues
- Status tracking captures comprehensive context
- Agent reviews assume skepticism

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
/note-to-future-self
git add .docs/status/
git commit -m "Session status: completed user auth feature"
```

## Extending DevFlow

### Adding New Commands
1. Create command in `devflow/commands/new-command.md`
2. Follow existing patterns for structure and output
3. Copy to `~/.claude/commands/devflow/` for testing
4. Document in this README

### Improving Existing Commands
1. Test changes in your global environment first
2. Ensure backward compatibility
3. Update command documentation
4. Add examples of new functionality

## Contributing

This toolkit grows through usage. As you encounter new AI agent issues, add commands to address them. As you discover better workflow patterns, codify them into the session management tools.

**Remember**: The goal is reliable, high-quality development with AI assistance, not blind trust in AI output.

---

## Quick Reference

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/catch-up` | Review recent work | Starting a session |
| `/note-to-future-self` | Document session | Ending a session |
| `/plan-next-steps` | Extract action items | After planning discussion |
| `/pre-commit` | Review uncommitted changes | Before committing |
| `/commit` | Create atomic commits | When ready to commit |
| `/pre-pr` | Comprehensive branch review | Before creating PR |

## Support

This toolkit is designed to be self-documenting and self-improving. When you encounter issues:

1. Check the command documentation in `src/claude/commands/devflow/`
2. Review sub-agent definitions in `src/claude/agents/devflow/`
3. Review recent status documents in `.docs/status/`
4. Improve the tools based on your experience

The best way to get support is to make the tools better.