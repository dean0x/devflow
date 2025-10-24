# DevFlow - Agentic Development Toolkit

A comprehensive collection of Claude Code commands and configurations designed to enhance developer workflows when working with AI coding assistants.

## Installation

```bash
# Run with npx (recommended - no global install needed)
npx devflow-kit init
```

### Installation Scopes

DevFlow supports two installation scopes:

**Global Scope (Default)** - Install for all projects
```bash
npx devflow-kit init --scope global
# Or interactively: npx devflow-kit init (prompts for scope)
```
- Installs to `~/.claude/` and `~/.devflow/`
- Available across all projects
- Recommended for personal use

**Local Scope** - Install for current project only
```bash
npx devflow-kit init --scope local
```
- Installs to `<git-root>/.claude/` and `<git-root>/.devflow/`
- Only available in the current project
- Recommended for team projects where DevFlow should be project-specific
- Requires a git repository (run `git init` first)
- Add `.claude/` and `.devflow/` to `.gitignore` (done automatically)

That's it! DevFlow is now installed and ready to use in Claude Code.

## What's Included

### 🎯 Skills (Auto-Activate)

**Skills are model-invoked** - Claude automatically activates them based on context, enforcing quality without manual invocation.

| Skill | Purpose | Auto-Triggers When |
|-------|---------|---------------------|
| `pattern-check` | Architectural pattern validation (Result types, DI, immutability) | Code changes are made, new functions added |
| `test-design` | Test quality enforcement (setup complexity, mocking, behavior vs implementation) | Tests are written or modified |
| `code-smell` | Anti-pattern detection (fake solutions, unlabeled workarounds, magic values) | Features are implemented, code is reviewed |
| `research` | Pre-implementation planning, documentation study, integration strategy | Unfamiliar features requested, architectural decisions needed |
| `debug` | Systematic debugging with hypothesis testing and root cause analysis | Errors occur, tests fail, performance issues detected |
| `input-validation` | Boundary validation enforcement (parse-don't-validate, SQL injection prevention) | API endpoints created, external data handled |
| `error-handling` | Result type consistency and exception boundary enforcement | Error handling code written, functions that can fail |

**How Skills Work:**
- **Proactive enforcement** - Catch issues during implementation, not after
- **No manual invocation** - Model decides when skills are relevant
- **Quality gates** - Block anti-patterns automatically
- **Context-aware** - Activate based on what you're doing

**IMPORTANT**: Skills are **automatically activated** by Claude based on context. They cannot be manually invoked like slash commands.

**Dual-Mode Pattern**: The `research` and `debug` skills also exist as slash commands (`/research`, `/debug`) for manual control:
- **Skill mode** (auto): Activates when Claude detects unfamiliar features or errors
- **Command mode** (manual): Use `/research` or `/debug` when you want explicit control over the workflow

This gives you the best of both worlds: automatic assistance when needed, manual control when preferred.

### 📊 Slash Commands (User-Invoked)

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/catch-up` | Smart summaries for starting new sessions with status validation | Starting a session |
| `/devlog` | Development log for comprehensive session documentation | Ending a session |
| `/plan-next-steps` | Extract actionable next steps from current discussion | After planning discussion |
| `/implement` | Smart interactive implementation orchestrator with todo triage | After planning, ready to implement todos |
| `/debug` | Systematic debugging workflow with hypothesis testing | When errors occur, tests fail, or investigating issues |
| `/research` | Pre-implementation research and approach analysis | Before implementing unfamiliar features or integrations |
| `/code-review` | Comprehensive code review using specialized sub-agents | Before committing or creating PR |
| `/commit` | Intelligent atomic commit creation with safety checks | When ready to commit |
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
1. **Skills auto-activate** - `research` skill triggers for unfamiliar features, `pattern-check` validates architecture
2. **Code with confidence** - Skills catch anti-patterns and violations during implementation
3. `/code-review` - Review changes before committing
4. `/commit` - Create intelligent atomic commits

### Ending a Session
1. `/devlog` - Document decisions and state
2. `/code-review` - Review branch before creating PR
3. `/commit` - Final commits with validation

### Creating a Release
1. `/code-review` - Comprehensive branch review
2. `/release` - Automated release workflow
   - Detects project type (Node.js, Rust, Python, Go, etc.)
   - Analyzes commits and suggests version bump
   - Generates changelog from git history
   - Builds and tests before publishing
   - Creates git tags and platform releases
3. Verify package in registry

### When Things Go Wrong
1. **Skills auto-activate** - `debug` skill triggers on errors/failures with systematic approach
2. Check git log and recent commits
3. Revert changes using git
4. Document lessons learned in `.docs/debug/`

## CLI Commands

| Command | Purpose | Options |
|---------|---------|---------|
| `devflow init` | Initialize DevFlow for Claude Code | `--scope <global\|local>` - Installation scope (global: user-wide, local: project-only)<br>`--skip-docs` - Skip creating `.docs/` structure<br>`--force` - Override existing files<br>`-y, --yes` - Auto-approve prompts |
| `devflow uninstall` | Remove DevFlow from Claude Code | `--keep-docs` - Keep `.docs/` directory |

**What `devflow init` does:**

**Global Scope** (default):
- Installs commands to `~/.claude/commands/devflow/`
- Installs sub-agents to `~/.claude/agents/devflow/`
- Installs skills to `~/.claude/skills/devflow/`
- Installs scripts to `~/.devflow/scripts/`
- Updates `~/.claude/settings.json` (statusline and model)
- Creates `.claudeignore` at git repository root
- Creates `.docs/` structure for project documentation

**Local Scope** (`--scope local`):
- Installs commands to `<git-root>/.claude/commands/devflow/`
- Installs sub-agents to `<git-root>/.claude/agents/devflow/`
- Installs skills to `<git-root>/.claude/skills/devflow/`
- Installs scripts to `<git-root>/.devflow/scripts/`
- Creates `<git-root>/.claude/settings.json` (statusline and model)
- Creates `.claudeignore` at git repository root
- Creates `.docs/` structure for project documentation
- Adds `.claude/` and `.devflow/` to `.gitignore`

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
# Skills auto-activate during development
"Add JWT authentication"  # research skill triggers automatically
"Fix this error"          # debug skill activates and guides systematic approach

# Manual command invocation
/code-review   # Review changes (uncommitted or full branch)
/commit        # Create atomic commits
/release       # Automated release workflow
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
    ├── skills/devflow/     # Auto-activate skill definitions (.md)
    ├── scripts/            # statusline.sh
    └── settings.json       # Claude Code settings
```

## Support

- Check installed command documentation
- Review `.docs/status/` for recent sessions
- Skills auto-activate for systematic troubleshooting
- Report issues at https://github.com/dean0x/devflow/issues

## License

MIT
