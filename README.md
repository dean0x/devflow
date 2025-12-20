# DevFlow - Agentic Development Toolkit

A comprehensive collection of Claude Code commands and configurations designed to enhance developer workflows when working with AI coding assistants.

## Installation

```bash
# Run with npx (recommended - no global install needed)
npx devflow-kit init
```

### Installation Scopes

DevFlow supports two installation scopes:

**User Scope (Default)** - Install for all projects
```bash
npx devflow-kit init --scope user
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

**Dual-Mode Pattern**: The `debug` skill also exists as a slash command (`/debug`) for manual control:
- **Skill mode** (auto): Activates when Claude detects errors or failures
- **Command mode** (manual): Use `/debug` when you want explicit control over the debugging workflow

This gives you the best of both worlds: automatic assistance when needed, manual control when preferred.

### 📊 Slash Commands (User-Invoked)

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/catch-up` | Smart summaries for starting new sessions with status validation | Starting a session |
| `/plan` | Plan release from high-level feature list | Planning a product release with multiple features |
| `/specify` | Specify a feature interactively with technical design | Before implementing a feature |
| `/breakdown` | Quickly break down discussion into actionable tasks | After planning discussion, quick task capture |
| `/coordinate` | Orchestrate parallel feature development with worktrees | Executing a planned release |
| `/swarm` | Execute single task lifecycle (design → implement → review) | Implementing one feature/task |
| `/implement` | Streamlined todo implementation, only stopping for design decisions | After planning, ready to implement todos |
| `/debug` | Systematic debugging workflow with hypothesis testing | When errors occur, tests fail, or investigating issues |
| `/review` | Comprehensive code review using specialized sub-agents | Before committing or creating PR |
| `/commit` | Intelligent atomic commit creation with safety checks | When ready to commit |
| `/pull-request` | Create PR with comprehensive analysis and smart description | After commits, ready to create PR |
| `/resolve-comments` | Systematically address PR review feedback | After PR feedback, need to resolve comments |
| `/release` | Automated release workflow with version management and publishing | Creating a new release |
| `/devlog` | Development log for comprehensive session documentation | Ending a session |

### 🤖 Sub-Agents

**Architecture Note**: Commands run in the main context and can spawn agents. Agents cannot spawn other agents - they do focused work inline.

**Worker Agents** (implementation and specification):

| Sub-Agent | Specialty | Purpose |
|-----------|-----------|---------|
| `Design` | Implementation Planning | Explores codebase inline, creates detailed implementation plan |
| `Specifier` | Feature Specification | Clarifies requirements inline, creates GitHub issue |
| `Coder` | Implementation | Writes code in isolated worktrees, creates PR |

**Review Agents** (specialized code analysis):

| Sub-Agent | Specialty | Purpose |
|-----------|-----------|---------|
| `SecurityReview` | Security Analysis | Expert vulnerability detection and security code review |
| `PerformanceReview` | Performance | Optimization and bottleneck detection |
| `ArchitectureReview` | Architecture | Design pattern analysis and code structure review |
| `TestsReview` | Testing | Test quality, coverage, and effectiveness analysis |
| `ComplexityReview` | Complexity | Code complexity and maintainability assessment |
| `DependenciesReview` | Dependencies | Dependency management and security analysis |
| `DatabaseReview` | Database | Database design and optimization review |
| `DocumentationReview` | Documentation | Docs-code alignment, API accuracy, comment quality |
| `TypescriptReview` | TypeScript | Type safety enforcement and TypeScript code quality |

**Utility Agents** (focused tasks):

| Sub-Agent | Specialty | Purpose |
|-----------|-----------|---------|
| `CatchUp` | Context Restoration | Project status and context restoration with validation |
| `Devlog` | Project State | Analyze project state for status reports |
| `Commit` | Git Operations | Intelligent commit creation with safety checks |
| `GetIssue` | GitHub Issues | Fetch issue details for planning |
| `PullRequest` | PR Creation | Analyze commits/changes and generate PR descriptions |
| `Release` | Release Automation | Project-agnostic release workflow with version management |
| `Debug` | Debugging | Systematic debugging with hypothesis testing |
| `Comment` | PR Comments | Create summary comments for non-diff issues |
| `TechDebt` | Tech Debt | Manage tech debt backlog GitHub issue |

**How Sub-Agents Work:**
- Specialized AI assistants with deep expertise in specific domains
- Separate context windows for focused analysis
- Spawned by orchestration commands (`/plan`, `/swarm`, `/coordinate`, `/review`)
- Restricted tool access appropriate to their domain

**Invoking Sub-Agents:**
```bash
# Explicit invocation
"Use the SecurityReview sub-agent to analyze this authentication code"

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

## Documentation Structure

DevFlow agents automatically create and maintain project documentation in the `.docs/` directory with a consistent, predictable structure.

### Directory Layout

```
.docs/
├── reviews/{branch-slug}/       # Code review reports per branch
│   ├── {type}-report-{timestamp}.md
│   └── review-summary-{timestamp}.md
├── coordinator/                # Release coordination state
│   ├── release-issue.md
│   └── state.json
├── design/                     # Implementation plans (from Design agent)
│   └── {topic-slug}-{timestamp}.md
├── debug/                      # Debug sessions
│   ├── debug-{timestamp}.md
│   └── KNOWLEDGE_BASE.md
├── releases/                   # Release notes
│   └── RELEASE_NOTES_v{version}.md
├── status/                     # Development logs
│   ├── {timestamp}.md
│   ├── compact/{timestamp}.md
│   └── INDEX.md
└── CATCH_UP.md                 # Latest summary
```

### Naming Conventions

**Timestamps**: `YYYY-MM-DD_HHMM` (sortable, chronological)
- Example: `2025-11-14_2030`

**Branch slugs**: Sanitized branch names (slashes replaced with dashes)
- `feature/auth` → `feature-auth`

**Topic slugs**: Lowercase, alphanumeric with dashes
- `"JWT Authentication"` → `jwt-authentication`

### What Gets Created

- **`/catch-up`** → `.docs/CATCH_UP.md` (overwritten each run)
- **`/devlog`** → `.docs/status/{timestamp}.md` + compact version + INDEX
- **`/debug`** → `.docs/debug/debug-{timestamp}.md` + KNOWLEDGE_BASE
- **`/coordinate`** → `.docs/coordinator/state.json` + `release-issue.md`
- **`/swarm`** → `.docs/design/{topic}-{timestamp}.md` (via Design agent)
- **`/review`** → `.docs/reviews/{branch}/` (9 review reports + summary)
- **`/release`** → `.docs/releases/RELEASE_NOTES_v{version}.md`

### Version Control

**Recommended `.gitignore`**:
```gitignore
# Exclude ephemeral catch-up summaries
.docs/CATCH_UP.md

# Optional: Exclude debug sessions (team preference)
.docs/debug/

# Keep everything else for project history
```

The `.docs/` structure provides a searchable history of decisions, designs, and debugging sessions.

## Development Workflow

### Starting a Session
1. `/catch-up` - Review what was done previously
2. Check statusline for current model, git state, duration
3. Review recommended next actions

### During Development
1. **Skills auto-activate** - `research` skill triggers for unfamiliar features, `pattern-check` validates architecture
2. **Plan your work** - `/plan` to triage issues, or `/breakdown` for quick task capture
3. **Implement efficiently** - `/implement` flows through todos automatically
4. **Code with confidence** - Skills catch anti-patterns and violations during implementation
5. `/review` - Review changes before committing
6. `/commit` - Create intelligent atomic commits

### Creating Pull Requests
1. `/review` - Comprehensive branch review
2. `/commit` - Final commits with validation
3. `/pull-request` - Create PR with smart description
4. Wait for review feedback
5. `/resolve-comments` - Address feedback systematically
6. Repeat steps 4-5 until approved

### Ending a Session
1. `/devlog` - Document decisions and state
2. `/review` - Review branch before creating PR
3. `/commit` - Final commits with validation
4. `/pull-request` - Create PR if ready

### Creating a Release
1. `/review` - Comprehensive branch review
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
| `npx devflow-kit init` | Initialize DevFlow for Claude Code | `--scope <user\|local>` - Installation scope (user: user-wide, local: project-only)<br>`--verbose` - Show detailed installation output<br>`--skip-docs` - Skip creating `.docs/` structure |
| `npx devflow-kit uninstall` | Remove DevFlow from Claude Code | `--scope <user\|local>` - Uninstall from specific scope only (default: auto-detect all)<br>`--keep-docs` - Keep `.docs/` directory |

**What `npx devflow-kit init` does:**

**User Scope** (default):
- Installs commands to `~/.claude/commands/devflow/`
- Installs sub-agents to `~/.claude/agents/devflow/`
- Installs skills to `~/.claude/skills/`
- Installs scripts to `~/.devflow/scripts/`
- Updates `~/.claude/settings.json` (statusline and model)
- Creates `.claudeignore` at git repository root
- Creates `.docs/` structure for project documentation

**Local Scope** (`--scope local`):
- Installs commands to `<git-root>/.claude/commands/devflow/`
- Installs sub-agents to `<git-root>/.claude/agents/devflow/`
- Installs skills to `<git-root>/.claude/skills/`
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
echo "Check for exposed API keys in config files" >> ~/.claude/agents/devflow/review-security.md
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
"Add JWT authentication"  # research skill triggers for unfamiliar features
"Fix this error"          # debug skill activates and guides systematic approach

# Manual command invocation for structured workflows
/plan                            # Plan release from feature list
/specify user authentication     # Create detailed feature spec
/coordinate                      # Execute planned release in parallel
/swarm                           # Run design → implement → review cycle
/review                          # Review changes before committing
/commit                          # Create atomic commits
/release                         # Automated release workflow
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
    ├── skills/devflow/     # Skill source (installed flat to ~/.claude/skills/)
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
