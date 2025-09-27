# DevFlow - Agentic Development Toolkit

A comprehensive collection of Claude Code commands and configurations designed to enhance developer workflows when working with AI coding assistants.

## Purpose

DevFlow transforms your coding environment into an intelligence-augmented workspace where AI agents can effectively collaborate with human developers. This toolkit provides:

- **Audit Commands** - Deep analysis of code quality, security, performance, and architecture
- **Session Management** - Status tracking and context preservation across coding sessions
- **Agent Accountability** - Tools to verify AI agent work and rollback problematic changes
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
Comprehensive code analysis commands:
- `/audit-tests` - Verify test quality and catch fake/tautological tests
- `/audit-security` - Scan for vulnerabilities, secrets, and security issues
- `/audit-performance` - Find N+1 queries, memory leaks, and bottlenecks
- `/audit-dependencies` - Analyze package health, vulnerabilities, and bloat
- `/audit-complexity` - Measure cognitive load and code maintainability
- `/audit-database` - Review schemas, queries, and database design
- `/audit-architecture` - Detect anti-patterns and structural issues

### 🤖 Agent Management
Tools for working safely with AI agents:
- `/agent-review` - Forensic analysis of what agents actually did vs claimed
- `/rollback` - Surgical rollback of AI changes when things go wrong
- `/constraint-check` - Verify agents follow your rules and patterns
- `/code-review` - Comprehensive review of recent changes

### 📝 Session Intelligence
Context preservation and handoff tools:
- `/note-to-future-self` - Comprehensive session documentation
- `/catch-up` - Smart summaries for starting new sessions
- **Smart Statusline** - Real-time project context display

### ⚙️ Configuration
- **Adaptive Statusline** - Shows model, git state, session duration, cost
- **Structured Documentation** - Organized status tracking in `.docs/`

## Installation & Setup

### 1. Copy Commands to Global Context
```bash
# Copy all commands to your global Claude Code commands directory
cp -r commands/* ~/.claude/commands/

# Copy settings
cp settings.json ~/.claude/settings.json

# Copy statusline script
cp statusline.sh ~/.claude/statusline.sh
chmod +x ~/.claude/statusline.sh
```

### 2. Initialize Project Documentation
```bash
# Create documentation structure in your project
mkdir -p .docs/{status/compact,reviews,audits,rollbacks}
```

### 3. First Run
```bash
# Document your current project state
/note-to-future-self

# Run an audit to establish baseline
/audit-architecture
```

## Development Workflow

### Starting a Session
1. **Get oriented**: `/catch-up` - Review what was done previously
2. **Check status**: Use statusline to see current model, git state, duration
3. **Plan work**: Review recommended next actions from catch-up summary

### During Development
1. **Verify AI work**: Use `/agent-review` after significant AI changes
2. **Check constraints**: Run `/constraint-check` to ensure patterns are followed
3. **Monitor quality**: Run relevant audit commands as you work

### Ending a Session
1. **Document progress**: `/note-to-future-self` - Capture decisions and state
2. **Review changes**: `/code-review` for final quality check
3. **Commit safely**: Only after verification and documentation

### When Things Go Wrong
1. **Emergency rollback**: `/rollback` to undo problematic AI changes
2. **Analyze failure**: `/agent-review` to understand what went wrong
3. **Document lessons**: Update constraints and patterns

## Environment Integration

**CRITICAL**: This toolkit is designed for live development environments. Every command and setting should be:

1. **Immediately Available** - Copied to global Claude Code configuration
2. **Instantly Testable** - Work on the devflow repo, test in global context
3. **Continuously Improved** - Dogfood your own tools

### Development Loop
```bash
# 1. Modify command in devflow repo
vim devflow/commands/audit-tests.md

# 2. Copy to global context for testing
cp devflow/commands/audit-tests.md ~/.claude/commands/

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
| `/agent-review` | Verify AI work | After AI makes changes |
| `/rollback` | Undo AI changes | When AI breaks things |
| `/constraint-check` | Verify compliance | During development |
| `/code-review` | Comprehensive review | Before releasing |

## Support

This toolkit is designed to be self-documenting and self-improving. When you encounter issues:

1. Check the command documentation
2. Review recent status documents
3. Use `/agent-review` to understand what happened
4. Improve the tools based on your experience

The best way to get support is to make the tools better.