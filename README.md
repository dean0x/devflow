# DevFlow - Agentic Development Toolkit

A comprehensive collection of Claude Code commands and configurations designed to enhance developer workflows when working with AI coding assistants.

## Installation

### Option 1: Native Plugin (Recommended)

Install directly as a Claude Code plugin:

```bash
# From GitHub
/plugin install dean0x/devflow
```

That's it! DevFlow commands are immediately available as `/devflow:command-name` (or just `/command-name` if no conflicts).

### Option 2: CLI Installer

For more control over installation scope:

```bash
# Run with npx (no global install needed)
npx devflow-kit init
```

#### Installation Scopes (CLI only)

**User Scope (Default)** - Install for all projects
```bash
npx devflow-kit init --scope user
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

DevFlow is now installed and ready to use in Claude Code.

## What's Included

### 🎯 Skills (Auto-Activate)

**Skills are model-invoked** - Claude automatically activates them based on context, enforcing quality without manual invocation.

| Skill | Purpose | Auto-Triggers When |
|-------|---------|---------------------|
| `devflow-test-design` | Test quality enforcement (setup complexity, mocking, behavior vs implementation) | Tests are written or modified |
| `devflow-code-smell` | Anti-pattern detection (fake solutions, unlabeled workarounds, magic values) | Features are implemented, code is reviewed |
| `devflow-research` | Pre-implementation planning, documentation study, integration strategy | Unfamiliar features requested, architectural decisions needed |
| `devflow-commit` | Atomic commit patterns, message format, safety scanning | Staging files, creating commits |
| `devflow-pull-request` | PR quality, descriptions, size assessment, breaking change detection | Creating PRs, generating descriptions |
| `devflow-input-validation` | Boundary validation enforcement (parse-don't-validate, SQL injection prevention) | API endpoints created, external data handled |
| `devflow-worktree` | Git worktree management for parallel development | Parallel implementation, isolated working directories needed |

**Iron Laws:**

Every skill has a single, non-negotiable **Iron Law** - a core principle that must never be violated:

| Skill | Iron Law |
|-------|----------|
| `devflow-core-patterns` | NEVER THROW IN BUSINESS LOGIC |
| `devflow-code-smell` | NO FAKE SOLUTIONS |
| `devflow-test-design` | COMPLEX TESTS INDICATE BAD DESIGN |
| `devflow-commit` | ATOMIC COMMITS OR NO COMMITS |
| `devflow-pull-request` | HONEST DESCRIPTIONS OR NO PR |
| `devflow-input-validation` | ALL EXTERNAL DATA IS HOSTILE |
| `devflow-git-safety` | NEVER RUN GIT COMMANDS IN PARALLEL |
| `devflow-github-patterns` | RESPECT RATE LIMITS OR FAIL GRACEFULLY |
| `devflow-security-patterns` | ASSUME ALL INPUT IS MALICIOUS |
| `devflow-typescript` | UNKNOWN OVER ANY |
| `devflow-react` | COMPOSITION OVER PROPS |
| `devflow-self-review` | FIX BEFORE RETURNING |
| `devflow-architecture-patterns` | VIOLATIONS IN YOUR CHANGES ARE BLOCKING |
| `devflow-performance-patterns` | MEASURE BEFORE OPTIMIZING |
| `devflow-complexity-patterns` | COMPLEXITY IS THE ENEMY OF RELIABILITY |
| `devflow-consistency-patterns` | FOLLOW EXISTING PATTERNS |
| `devflow-tests-patterns` | TESTS MUST VALIDATE BEHAVIOR NOT IMPLEMENTATION |
| `devflow-database-patterns` | MIGRATIONS MUST BE REVERSIBLE |
| `devflow-documentation-patterns` | DOCS MUST MATCH CODE |
| `devflow-dependencies-patterns` | NO VULNERABLE DEPENDENCIES IN PRODUCTION |
| `devflow-regression-patterns` | PRESERVE EXISTING FUNCTIONALITY |

Iron Laws are enforced automatically when skills activate.

**How Skills Work:**
- **Proactive enforcement** - Catch issues during implementation, not after
- **No manual invocation** - Model decides when skills are relevant
- **Quality gates** - Block anti-patterns automatically
- **Context-aware** - Activate based on what you're doing

**IMPORTANT**: Skills are **automatically activated** by Claude based on context. They cannot be manually invoked like slash commands.

### Skills Architecture

DevFlow uses a **tiered skills system** where skills serve as shared knowledge libraries that agents can reference:

**Tier 1: Foundation Skills** (shared patterns used by multiple agents)

| Skill | Purpose | Used By |
|-------|---------|---------|
| `devflow-core-patterns` | Result types, DI, immutability, pure functions | Coder, Reviewer |
| `devflow-review-methodology` | 6-step review process, 3-category classification | Reviewer |
| `devflow-self-review` | 9-pillar self-review framework | Scrutinizer |
| `devflow-docs-framework` | .docs/ structure, naming, templates | Devlog, CatchUp |
| `devflow-git-safety` | Git operations, lock handling, commit conventions | Coder, Git |
| `devflow-github-patterns` | GitHub API, rate limiting, PR comments, issues, releases | Git |
| `devflow-implementation-patterns` | CRUD, API, events, config, logging | Coder |
| `devflow-codebase-navigation` | Exploration, pattern discovery, data flow | Coder |

**Pattern Skills** (domain expertise for Reviewer focus areas)

| Skill | Reviewer Focus | Purpose |
|-------|----------------|---------|
| `devflow-security-patterns` | `security` | Injection, auth, crypto vulnerabilities |
| `devflow-architecture-patterns` | `architecture` | SOLID, coupling, layering, modularity |
| `devflow-performance-patterns` | `performance` | Algorithms, N+1, memory, I/O, caching |
| `devflow-complexity-patterns` | `complexity` | Cyclomatic complexity, readability |
| `devflow-consistency-patterns` | `consistency` | Pattern violations, simplification |
| `devflow-tests-patterns` | `tests` | Coverage, quality, brittleness |
| `devflow-database-patterns` | `database` | Schema, queries, migrations |
| `devflow-documentation-patterns` | `documentation` | Docs quality, alignment |
| `devflow-dependencies-patterns` | `dependencies` | CVEs, versions, licenses |
| `devflow-regression-patterns` | `regression` | Lost functionality, broken behavior |

**Tier 2: Specialized Skills** (user-facing, auto-activate based on context)

| Skill | Purpose | Auto-Triggers When |
|-------|---------|---------------------|
| `devflow-test-design` | Test quality enforcement | Tests written or modified |
| `devflow-code-smell` | Anti-pattern detection | Features implemented |
| `devflow-research` | Pre-implementation planning | Unfamiliar features requested |
| `devflow-commit` | Atomic commit patterns | Staging files, creating commits |
| `devflow-pull-request` | PR quality & descriptions | Creating PRs |
| `devflow-input-validation` | Boundary validation | API endpoints created |
| `devflow-worktree` | Git worktree management | Parallel implementation |

**Tier 3: Domain-Specific Skills** (language and framework patterns)

| Skill | Purpose | Used When |
|-------|---------|-----------|
| `devflow-typescript` | Type safety, generics, utility types, idioms | TypeScript codebases |
| `devflow-react` | Components, hooks, state, performance | React codebases |

**How Agents Use Skills:**

The unified `Reviewer` agent loads ALL pattern skills and applies the relevant one based on the focus area specified in its invocation prompt:
```yaml
---
name: Reviewer
description: Universal code review agent with parameterized focus
model: inherit
skills: devflow-review-methodology, devflow-security-patterns, devflow-architecture-patterns, ...
---
```

The `Scrutinizer` agent runs self-review in a fresh context after Coder completes:
```yaml
---
name: Scrutinizer
description: Self-review agent that evaluates and fixes P0/P1 issues
skills: devflow-self-review, devflow-core-patterns
---
```

### 📊 Slash Commands (User-Invoked)

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/catch-up` | Smart summaries for starting new sessions with status validation | Starting a session |
| `/specify` | Specify a feature with 3 clarification gates (understanding → scope → acceptance) | Before implementing a feature |
| `/implement` | Execute single task lifecycle (explore → plan → implement → review) | Implementing one feature/task |
| `/review` | Comprehensive code review using specialized sub-agents | Before committing or creating PR |
| `/devlog` | Development log for comprehensive session documentation | Ending a session |

### 🤖 Agents

**Architecture**: Commands run in the main context and spawn multiple agents in parallel for optimal results. Orchestration happens at command level.

**Native Agents** (built-in Claude Code agents, spawned by commands):

| Agent | Specialty | Usage |
|-------|-----------|-------|
| `Explore` | Codebase Exploration | 3-4 spawned in parallel per task for patterns, integration, edge cases |
| `Plan` | Implementation Planning | 1-3 spawned in parallel per task for architecture, testing, parallelization |
| `Coder` | Implementation | 1-N spawned per task (parallel when work is parallelizable) |

**Review Agent** (unified, parameterized):

| Agent | Purpose | Focus Areas |
|-------|---------|-------------|
| `Reviewer` | Universal code review with parameterized focus | security, architecture, performance, complexity, consistency, regression, tests, dependencies, documentation, typescript, database |

The Reviewer agent is spawned multiple times in parallel, each with a different focus area specified in the prompt. This replaces the previous 11 individual review agents while maintaining the same specialized analysis.

**GitHub Operations Agent** (unified, parameterized):

| Agent | Purpose | Operations |
|-------|---------|------------|
| `Git` | All git/GitHub operations | `fetch-issue`, `comment-pr`, `manage-debt`, `create-release` |

The Git agent handles all GitHub API interactions including fetching issues, creating PR comments, managing tech debt backlog, and creating releases.

**Utility Agents** (focused tasks):

| Agent | Specialty | Purpose |
|-------|-----------|---------|
| `Skimmer` | Codebase Orientation | Fast codebase overview using `skim` for 60-90% token reduction |
| `CatchUp` | Context Restoration | Project status and context restoration with validation |
| `Devlog` | Project State | Analyze project state for status reports |
| `Synthesizer` | Output Synthesis | Combine outputs from parallel agents (modes: exploration, planning, review) |
| `Simplifier` | Code Refinement | Post-implementation code clarity and consistency improvements |
| `Scrutinizer` | Self-Review | Final quality gate using 9-pillar framework, fixes P0/P1 issues |

**How Commands Orchestrate Agents:**
- `/specify` → Skimmer + 4 Explore + Synthesizer + 3 Plan + Synthesizer → GitHub issue
- `/implement` → Git (fetch-issue) + Skimmer + 4 Explore + Synthesizer + 3 Plan + Synthesizer + 1-N Coder + Simplifier + Scrutinizer → PR
- `/review` → 7-11 Reviewer agents (parallel, different focus areas) + Git (comment-pr) + Git (manage-debt) + Synthesizer

**Skimmer Integration:**

Skimmer runs as the first exploration phase in both `/specify` and `/implement`, using the `skim` tool to:
- Extract codebase structure with 60-90% token reduction
- Identify relevant files and functions for the task
- Provide oriented context to downstream Explore agents

Requires `skim` tool: `npm install -g rskim` or `cargo install rskim`

**Invoking Sub-Agents:**
```bash
# Explicit invocation with focus
"Use the Reviewer agent with security focus to analyze this authentication code"

# Automatic delegation (Claude Code decides which sub-agent to use)
"Review this code for security issues"
```

### 📊 Smart Statusline

Real-time project context display showing:
- Current directory and model name
- Git branch with uncommitted changes indicator (`*`)
- **Context usage percentage** with color coding:
  - 🟢 Green: < 50% context used
  - 🟡 Yellow: 50-80% context used
  - 🔴 Red: > 80% context used
- Zero configuration - works immediately after installation

### 🔒 Security & Token Optimization

**Permission Deny List** (with `--managed-settings`):

DevFlow includes a comprehensive security deny list that blocks dangerous operations:

| Category | Examples |
|----------|----------|
| System destruction | `rm -rf /`, `dd`, `mkfs`, `shred` |
| Code execution | `curl \| bash`, `eval`, `exec` |
| Privilege escalation | `sudo`, `su`, `doas`, `pkexec` |
| Permission changes | `chmod 777`, `chown root` |
| System control | `kill -9`, `reboot`, `shutdown` |
| Data exfiltration | `netcat`, `socat`, `telnet`, `sftp` |
| Sensitive file reads | `.env`, SSH keys, AWS credentials |
| Package globals | `npm -g`, `pip --system`, `apt install` |
| Resource abuse | Fork bombs, crypto miners |

Included automatically in DevFlow's settings.json template.

**.claudeignore** (automatic):

DevFlow also creates a comprehensive `.claudeignore` file at your git repository root to:

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
├── design/                     # Implementation plans (from Design agent)
│   └── {topic-slug}-{timestamp}.md
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
- **`/implement`** → `.docs/design/{topic}-{timestamp}.md` (via Design agent)
- **`/review`** → `.docs/reviews/{branch}/` (7-11 focus area reports + summary)

### Version Control

**Recommended `.gitignore`**:
```gitignore
# Exclude ephemeral catch-up summaries
.docs/CATCH_UP.md

# Keep everything else for project history
```

The `.docs/` structure provides a searchable history of decisions, designs, and review sessions.

## Development Workflow

### Starting a Session
1. `/catch-up` - Review what was done previously
2. Check statusline for current model, git state, duration
3. Review recommended next actions

### During Development
1. **Skills auto-activate** - `devflow-research` triggers for unfamiliar features, foundation skills validate patterns
2. **Specify features** - `/specify` for detailed specs with clarification gates
3. **Execute tasks** - `/implement` for full lifecycle (explore → plan → implement → review)
4. **Code with confidence** - Skills catch anti-patterns and violations during implementation
5. `/review` - Review changes before committing
6. **Commit changes** - `devflow-commit` skill enforces atomic commits and message format

### Creating Pull Requests
1. `/review` - Comprehensive branch review
2. **Commit changes** - `devflow-commit` skill enforces quality
3. **Create PR** - `devflow-pull-request` skill ensures comprehensive descriptions
4. Wait for review feedback
5. Address PR comments directly
6. Repeat steps 4-5 until approved

### Ending a Session
1. `/devlog` - Document decisions and state
2. `/review` - Review branch before creating PR
3. **Commit changes** - `devflow-commit` skill enforces quality
4. **Create PR** - `devflow-pull-request` skill ensures comprehensive descriptions

### When Things Go Wrong
1. **Investigate systematically** - Follow root cause analysis approach
2. Check git log and recent commits
3. Revert changes using git
4. Document lessons learned

## CLI Commands

| Command | Purpose | Options |
|---------|---------|---------|
| `npx devflow-kit init` | Initialize DevFlow for Claude Code | `--scope <user\|local>` - Installation scope<br>`--override-settings` - Override existing settings.json<br>`--verbose` - Show detailed installation output<br>`--skip-docs` - Skip creating `.docs/` structure |
| `npx devflow-kit uninstall` | Remove DevFlow from Claude Code | `--scope <user\|local>` - Uninstall from specific scope only<br>`--keep-docs` - Keep `.docs/` directory |

### Settings Override

If you have an existing `settings.json`, use `--override-settings` to replace it:

```bash
devflow init --override-settings
```

DevFlow settings include:
- Security deny list (126 blocked operations)
- `ENABLE_TOOL_SEARCH` for deferred MCP tool loading (~85% token savings)
- Smart statusline with context percentage

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
# Extend pattern skills for project-specific checks
echo "Check for exposed API keys in config files" >> ~/.claude/skills/devflow-security-patterns/SKILL.md
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
"Fix this error"          # systematic debugging approach guides investigation

# Manual command invocation for structured workflows
/specify user authentication     # Create detailed feature spec
/implement                       # Run explore → plan → implement → review cycle
/review                          # Review changes before committing
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
devflow/
├── agents/                # Sub-agent definitions (.md)
├── commands/              # Slash command definitions (.md)
├── skills/                # Skill definitions (installed flat to ~/.claude/skills/)
├── scripts/               # statusline.sh
├── src/
│   ├── cli/               # CLI source code (TypeScript)
│   │   ├── commands/      # init.ts, uninstall.ts
│   │   └── cli.ts         # CLI entry point
│   ├── claude/            # CLAUDE.md template
│   └── templates/         # settings.json template
├── CLAUDE.md              # Developer guide
└── README.md              # User documentation
```

## Support

- Check installed command documentation
- Review `.docs/status/` for recent sessions
- Skills auto-activate for systematic troubleshooting
- Report issues at https://github.com/dean0x/devflow/issues

## License

MIT
