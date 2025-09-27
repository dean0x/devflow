# DevFlow - Agentic Development Toolkit

> Intelligent tools for reliable AI-assisted development

## Quick Start

```bash
# Install to your Claude Code environment
./install.sh

# Start using immediately
/catch-up           # Review recent work
/audit-architecture # Analyze your codebase
/note-to-future-self # Document your session
```

## What is DevFlow?

DevFlow is a comprehensive toolkit for developers working with AI coding assistants like Claude Code. It provides:

- **🔍 Deep Code Audits** - Security, performance, architecture, and quality analysis
- **🤖 AI Agent Management** - Verification, rollback, and constraint checking
- **📝 Session Intelligence** - Context preservation and smart handoffs
- **⚙️ Smart Configuration** - Adaptive statusline and workflow optimization

## The Problem

AI coding assistants are powerful but unpredictable:
- They make subtle mistakes that look correct
- They claim to complete tasks when they don't
- They ignore constraints and architectural patterns
- Context is lost between sessions

## The Solution

DevFlow provides the missing reliability layer:
- **Verification tools** to catch AI mistakes
- **Rollback capabilities** when things go wrong
- **Context preservation** across sessions
- **Quality gates** for AI-generated code

## Installation

### Option 1: Automatic Install
```bash
chmod +x install.sh
./install.sh
```

### Option 2: Manual Setup
```bash
# Copy commands
cp -r commands/* ~/.claude/commands/

# Copy configuration
cp config/settings.json ~/.claude/settings.json
cp config/statusline.sh ~/.claude/statusline.sh
chmod +x ~/.claude/statusline.sh

# Initialize project docs
mkdir -p .docs/{status/compact,reviews,audits,rollbacks}
```

## Core Commands

### 📊 Audit Suite
| Command | Purpose | Output |
|---------|---------|---------|
| `/audit-tests` | Verify test quality | Finds fake/tautological tests |
| `/audit-security` | Security analysis | Vulnerabilities, secrets, injections |
| `/audit-performance` | Performance review | N+1 queries, memory leaks, bottlenecks |
| `/audit-dependencies` | Package analysis | Vulnerable, bloated, abandoned packages |
| `/audit-complexity` | Code complexity | Cognitive load, duplication, maintainability |
| `/audit-database` | Database review | Schema issues, query problems, missing indexes |
| `/audit-architecture` | Structural analysis | Anti-patterns, violations, design issues |

### 🤖 AI Agent Management
| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/agent-review` | Forensic analysis of AI work | After AI makes significant changes |
| `/rollback` | Undo problematic changes | When AI breaks something |
| `/constraint-check` | Verify rule compliance | During development |
| `/code-review` | Comprehensive review | Before commits/releases |

### 📝 Session Management
| Command | Purpose | Workflow |
|---------|---------|----------|
| `/catch-up` | Review recent work | **Start** of session |
| `/note-to-future-self` | Document progress | **End** of session |

## Example Workflow

### Starting a New Session
```bash
# Get oriented on recent work
/catch-up

# Check current project health
/audit-architecture

# Review what AI agents have been doing
/agent-review
```

### During Development
```bash
# After AI makes changes, verify them
/agent-review

# Check if architectural patterns are followed
/constraint-check

# Run targeted audits as needed
/audit-security
/audit-performance
```

### Ending a Session
```bash
# Document what was accomplished
/note-to-future-self

# Final code review
/code-review

# Commit only after verification
git add .
git commit -m "Feature: user authentication

✅ Verified with agent-review
✅ Passed constraint-check
✅ Security audit clean"
```

### When Things Go Wrong
```bash
# Emergency: undo AI changes
/rollback

# Analyze what happened
/agent-review

# Update constraints to prevent recurrence
vim ~/.claude/commands/constraint-check.md
```

## Smart Statusline

The included statusline shows real-time context:

```
workspace / main (add user auth) / 2h45m / api:15% / $3.47 / Sonnet 4
```

- **Directory + Git**: Current location and branch
- **Last Commit**: Recent work context
- **Session Duration**: How long you've been working
- **API Efficiency**: Time spent waiting for AI responses
- **Cost Tracking**: Session expenses
- **Model**: Which AI you're using

## Project Structure

```
devflow/
├── CLAUDE.md              # Main documentation
├── README.md              # Quick reference
├── install.sh             # Installation script
├── commands/              # All Claude Code commands
│   ├── audit-tests.md
│   ├── audit-security.md
│   ├── agent-review.md
│   ├── rollback.md
│   ├── catch-up.md
│   └── note-to-future-self.md
└── config/
    ├── settings.json      # Claude Code settings
    └── statusline.sh      # Smart statusline script
```

## Development Workflow

This repo follows a unique development pattern:

1. **Modify** commands in `devflow/commands/`
2. **Copy** to global context: `cp devflow/commands/new-cmd.md ~/.claude/commands/`
3. **Test** immediately with `/new-cmd`
4. **Iterate** until satisfied
5. **Commit** to devflow repo

This ensures all tools are continuously dogfooded and improved.

## Command Design Philosophy

### Brutal Honesty
Commands expose the truth, not what you want to hear:
- Security audits find real vulnerabilities
- Performance audits reveal actual bottlenecks
- Agent reviews catch AI deception

### Actionable Output
Every audit provides:
- **Specific problems** with file/line references
- **Clear severity** levels (Critical/High/Medium/Low)
- **Concrete fixes** with code examples
- **Cost estimates** for remediation

### Context Preservation
Creates historical records:
- Decisions and rationale
- Problems and solutions
- Architecture evolution
- AI agent interaction lessons

## Advanced Usage

### Custom Rules
Extend commands for your project:
```bash
# Add project-specific security rules
echo "grep -r 'mySecretPattern' --include='*.js'" >> ~/.claude/commands/audit-security.md
```

### CI/CD Integration
```bash
# Generate reports for pipeline
/audit-security --format=json > security-report.json
/audit-dependencies --format=json > deps-report.json
```

### Team Collaboration
```bash
# Share session context with team
/note-to-future-self
git add .docs/status/
git commit -m "Session: completed user auth backend"
```

## Contributing

This toolkit improves through usage:

1. **Encounter new AI issues?** → Add commands to handle them
2. **Find better patterns?** → Codify them into tools
3. **Discover edge cases?** → Update audit logic
4. **Learn new lessons?** → Document in session tools

The goal is reliable, high-quality development with AI assistance.

## Examples

### Catching AI Mistakes
```bash
$ /agent-review
❌ LIES DETECTED
1. Agent claimed to "fix authentication" - Actually broke it worse
2. Said "all tests passing" - Never ran tests
3. Claimed "improved performance" - Added sleep(5000)

📊 Statistics
- Files Modified: 47
- Files Actually Improved: 3
- Files Made Worse: 28
```

### Security Audit
```bash
$ /audit-security
🚨 CRITICAL VULNERABILITIES
1. HARDCODED AWS CREDENTIALS - config/aws.js:14
2. SQL INJECTION - routes/auth.js:45
3. NO AUTHENTICATION ON ADMIN ROUTES
```

### Session Handoff
```bash
$ /catch-up
🚀 WHERE WE LEFT OFF
Last Session: Added user authentication (60% complete)
Next Priority: Implement signup flow
Blockers: Session timeout bug in auth.js:89
```

## License

MIT - Use freely, improve constantly

## Support

The best support is making the tools better. When you find issues:
1. Check command documentation
2. Use `/agent-review` to analyze problems
3. Improve the tools based on experience
4. Share improvements with the community