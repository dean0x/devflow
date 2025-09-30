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

### 📊 Audit Suite
Comprehensive code analysis available as both commands and specialized sub-agents:

**Commands** (Slash Commands):
- `/audit-tests` - Verify test quality and catch fake/tautological tests
- `/audit-security` - Scan for vulnerabilities, secrets, and security issues
- `/audit-performance` - Find N+1 queries, memory leaks, and bottlenecks
- `/audit-dependencies` - Analyze package health, vulnerabilities, and bloat
- `/audit-complexity` - Measure cognitive load and code maintainability
- `/audit-database` - Review schemas, queries, and database design
- `/audit-architecture` - Detect anti-patterns and structural issues

**Sub-Agents** (Specialized AI Assistants):
- `audit-security` - Expert security vulnerability detection specialist
- `audit-performance` - Performance optimization and bottleneck specialist
- `audit-architecture` - Software architecture and design pattern specialist
- `audit-database` - Database design and optimization specialist
- `audit-dependencies` - Dependency management and security specialist
- `audit-complexity` - Code complexity and maintainability specialist
- `audit-tests` - Test quality and coverage analysis specialist
- `forensic-analysis` - AI agent accountability and forensic analysis specialist

### 🤖 Agent Management
Tools for working safely with AI agents:
- `/forensic-analysis` - Forensic analysis of what agents actually did vs claimed
- `/constraint-check` - Verify agents follow your rules and patterns
- `/review-commit` - Review uncommitted changes before committing
- `/review-branch` - Comprehensive branch review for PR readiness

### 📝 Session Intelligence
Context preservation and handoff tools:
- `/note-to-future-self` - Comprehensive session documentation
- `/catch-up` - Smart summaries for starting new sessions
- **Smart Statusline** - Real-time project context display

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
│   ├── agents/                # AI sub-agents
│   ├── commands/              # Slash command definitions
│   ├── scripts/               # DevFlow scripts
│   │   └── statusline.sh        # Smart statusline script
│   └── settings.json          # Unified Claude Code settings (statusline, model)
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
- Copies commands from `src/commands/` to `~/.claude/commands/`
- Copies agents from `src/agents/` to `~/.claude/agents/`
- Copies scripts from `src/scripts/` to `~/.devflow/scripts/`
- Installs unified settings from `src/settings.json` to `~/.claude/settings.json`
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
Sub-agents are configured in `.claude/agents/` and included in your project setup. Each sub-agent has:
- Specialized expertise and system prompts
- Restricted tool access appropriate to their domain
- Focused analysis capabilities

## Development Workflow

### Starting a Session
1. **Get oriented**: `/catch-up` - Review what was done previously
2. **Check status**: Use statusline to see current model, git state, duration
3. **Plan work**: Review recommended next actions from catch-up summary

### During Development
1. **Verify AI work**: Use `/forensic-analysis` or `forensic-analysis` sub-agent after significant AI changes
2. **Check constraints**: Run `/constraint-check` to ensure patterns are followed
3. **Monitor quality**: Run relevant audit commands or invoke specialized sub-agents

### Ending a Session
1. **Document progress**: `/note-to-future-self` - Capture decisions and state
2. **Review changes**: `/review-commit` for pre-commit checks, `/review-branch` for comprehensive PR review
3. **Commit safely**: Only after verification and documentation

### When Things Go Wrong
1. **Analyze failure**: `/forensic-analysis` to understand what went wrong
2. **Review changes**: Use git to review and revert if needed
3. **Document lessons**: Update constraints and patterns

## Environment Integration

**CRITICAL**: This toolkit is designed for live development environments. Every command and setting should be:

1. **Immediately Available** - Copied to global Claude Code configuration
2. **Instantly Testable** - Work on the devflow repo, test in global context
3. **Continuously Improved** - Dogfood your own tools

### Development Loop
```bash
# 1. Modify command in devflow repo
vim devflow/src/commands/audit-tests.md

# 2. Reinstall to global context for testing
node dist/cli.js init

# 3. Test immediately
/audit-tests

# 4. Iterate until satisfied
# 5. Commit to devflow repo
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
Extend audit commands for project-specific patterns:
```bash
# Add custom security rules
echo "grep -r 'process.env.SECRET' --include='*.js'" >> ~/.claude/commands/audit-security.md
```

### Integration with CI/CD
```bash
# Run critical audits in pipeline
/audit-security --format=json > security-report.json
/audit-dependencies --format=json > deps-report.json
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
3. Copy to `~/.claude/commands/` for testing
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
| `/audit-*` | Code quality analysis | Before major commits |
| `/forensic-analysis` | Verify AI work | After AI makes changes |
| `/constraint-check` | Verify compliance | During development |
| `/review-commit` | Pre-commit review | Before committing |
| `/review-branch` | Comprehensive PR review | Before releasing |

## Support

This toolkit is designed to be self-documenting and self-improving. When you encounter issues:

1. Check the command documentation
2. Review recent status documents
3. Use `/forensic-analysis` to understand what happened
4. Improve the tools based on your experience

The best way to get support is to make the tools better.