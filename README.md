# DevFlow - Agentic Development Toolkit

A comprehensive collection of Claude Code commands and configurations designed to enhance developer workflows when working with AI coding assistants.

## Installation

```bash
# Run with npx (recommended - no global install needed)
npx devflow-kit init
```

That's it! DevFlow is now installed and ready to use in Claude Code.

## What's Included

### 📊 Slash Commands

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/catch-up` | Smart summaries for starting new sessions with status validation | Starting a session |
| `/research [topic]` | Comprehensive pre-implementation research and planning | Before implementing features |
| `/devlog` | Development log for comprehensive session documentation | Ending a session |
| `/plan-next-steps` | Extract actionable next steps from current discussion | After planning discussion |
| `/debug [issue]` | Systematic debugging with issue-specific investigation | When troubleshooting |
| `/pre-commit` | Review uncommitted changes using specialized sub-agents | Before committing |
| `/commit` | Intelligent atomic commit creation with safety checks | When ready to commit |
| `/pre-pr` | Comprehensive branch review for PR readiness | Before creating PR |
| `/release` | Automated release workflow with version management and publishing | Creating a new release |

### 🤖 Sub-Agents

| Sub-Agent | Specialty | Purpose |
|-----------|-----------|---------|
| `audit-security` | Security Analysis | Expert vulnerability detection and security code review |
| `audit-performance` | Performance | Optimization and bottleneck detection |
| `audit-architecture` | Architecture | Design pattern analysis and code structure review |
| `audit-tests` | Testing | Test quality, coverage, and effectiveness analysis (surgical execution) |
| `audit-complexity` | Complexity | Code complexity and maintainability assessment |
| `audit-dependencies` | Dependencies | Dependency management and security analysis |
| `audit-database` | Database | Database design and optimization review |
| `audit-documentation` | Documentation | Docs-code alignment, API accuracy, comment quality |
| `catch-up` | Context Restoration | Project status and context restoration with validation |
| `commit` | Git Operations | Intelligent commit creation with safety checks |
| `research` | Implementation Planning | Pre-implementation research, approach analysis, and planning |
| `release` | Release Automation | Project-agnostic release workflow with version management |

**How Sub-Agents Work:**
- Specialized AI assistants with deep expertise in specific domains
- Separate context windows for focused analysis
- Can be invoked explicitly or automatically by orchestrator commands
- Restricted tool access appropriate to their domain

**Invoking Sub-Agents:**
```bash
# Explicit invocation
"Use the audit-security sub-agent to analyze this authentication code"

# Automatic delegation (Claude Code decides which sub-agent to use)
"Review this code for security issues"
```

### 📊 Smart Statusline

Real-time project context display showing:
- Current model and session duration
- Git branch and uncommitted changes indicator
- Session cost tracking
- Project context
- Zero configuration - works immediately after installation

### 🔒 Security & Token Optimization

DevFlow automatically creates a comprehensive `.claudeignore` file at your git repository root to:

**Protect Sensitive Data:**
- Environment files (`.env`, `.env.*`, `.envrc`)
- Credentials & keys (`*.key`, `*.pem`, SSH keys)
- Cloud configs (`.aws/`, `.gcp/`, `.azure/`)
- Package tokens (`.npmrc`, `.pypirc`)
- Database files (`*.sql`, `*.db`)

**Optimize Token Usage:**
- Dependencies (`node_modules/`, `vendor/`, `venv/`)
- Build artifacts (`dist/`, `build/`, `.next/`)
- IDE files (`.vscode/`, `.idea/`)
- Lock files (`package-lock.json`, `yarn.lock`)
- Media and binaries

Covers patterns for all major languages and operating systems.

## Development Workflow

### Starting a Session
1. `/catch-up` - Review what was done previously
2. Check statusline for current model, git state, duration
3. Review recommended next actions

### During Development
1. `/research [topic]` - Research implementation approaches before coding
2. `/pre-commit` - Review changes before committing
3. `/commit` - Create intelligent atomic commits
4. Invoke audit sub-agents as needed

### Ending a Session
1. `/devlog` - Document decisions and state
2. `/pre-pr` - Review branch before creating PR
3. `/commit` - Final commits with validation

### Creating a Release
1. `/pre-pr` - Comprehensive branch review
2. `/release` - Automated release workflow
   - Detects project type (Node.js, Rust, Python, Go, etc.)
   - Analyzes commits and suggests version bump
   - Generates changelog from git history
   - Builds and tests before publishing
   - Creates git tags and platform releases
3. Verify package in registry

### When Things Go Wrong
1. Check git log and recent commits
2. `/debug [issue description]` - Structured debugging
3. Revert changes using git
4. Document lessons learned

## CLI Commands

| Command | Purpose | Options |
|---------|---------|---------|
| `devflow init` | Initialize DevFlow for Claude Code | `--skip-docs` - Skip creating `.docs/` structure |
| `devflow uninstall` | Remove DevFlow from Claude Code | `--keep-docs` - Keep `.docs/` directory |

**What `devflow init` does:**
- Installs commands to `~/.claude/commands/devflow/`
- Installs sub-agents to `~/.claude/agents/devflow/`
- Installs scripts to `~/.devflow/scripts/`
- Updates `~/.claude/settings.json` (statusline and model)
- Creates `.claudeignore` at git repository root
- Creates `.docs/` structure for project documentation

**First Run:**
```bash
devflow init
/devlog      # Document your current project state
/catch-up    # Get oriented with the project
```

## Advanced Usage

### Custom Audit Rules
```bash
# Extend sub-agents for project-specific patterns
echo "Check for exposed API keys in config files" >> ~/.claude/agents/devflow/audit-security.md
```

### Team Usage
```bash
# Share session documentation with team
/devlog
git add .docs/status/
git commit -m "Session status: completed user auth feature"
```

### Integration Examples
```bash
/research "add JWT authentication"  # Research before implementing
/pre-commit    # Review uncommitted changes
/commit        # Create atomic commits
/pre-pr        # Branch review before PR
/release       # Automated release workflow
/debug "TypeError in auth module"  # Debug specific issue
```

## Philosophy

Modern development increasingly involves AI agents that can read, write, and modify code autonomously. DevFlow provides:

- **Trust but Verify** - Tools to catch AI agent mistakes
- **Context Preservation** - Memory across long-term projects
- **Quality Gates** - Automated checks for AI changes
- **Developer Empowerment** - Enhance human judgment, not replace it

## Building from Source

```bash
# Clone and build
git clone https://github.com/dean0x/devflow.git
cd devflow
npm install
npm run build

# Test locally
node dist/cli.js init

# Watch mode for development
npm run dev
```

**Project Structure:**
```
src/
├── cli/                   # CLI source code (TypeScript)
│   ├── commands/           # init.ts, uninstall.ts
│   └── cli.ts             # CLI entry point
└── claude/                # Claude Code configuration
    ├── agents/devflow/     # Sub-agent definitions (.md)
    ├── commands/devflow/   # Slash command definitions (.md)
    ├── scripts/            # statusline.sh
    └── settings.json       # Claude Code settings
```

## Support

- Check installed command documentation
- Review `.docs/status/` for recent sessions
- Use `/debug [issue]` for systematic troubleshooting
- Report issues at https://github.com/dean0x/devflow/issues

## License

MIT
