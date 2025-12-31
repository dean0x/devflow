# DevFlow Development Guide

This document contains instructions for developers and AI agents working on the DevFlow codebase. For user documentation, see README.md.

## Purpose for AI Agents

When working on DevFlow code, understand that this toolkit is designed to enhance Claude Code with intelligent development workflows. Your modifications should:

- Maintain brutal honesty in review outputs
- Preserve context across sessions
- Enhance developer empowerment without replacing judgment
- Ensure all commands are self-documenting

## Architecture Overview

DevFlow consists of four main components:

1. **CLI Tool** (`src/cli/`) - TypeScript-based installer and manager
2. **Claude Code Commands** (`commands/`) - Markdown-based slash commands (user-invoked)
3. **Skills** (`skills/`) - Auto-activate quality enforcement (model-invoked)
4. **Sub-Agents** (`agents/`) - Specialized AI assistants for focused tasks

## Documentation Framework

All sub-agents that persist artifacts MUST follow this standardized framework for consistency and predictability.

### Directory Structure

All generated documentation lives under `.docs/` in the project root:

```
.docs/
├── reviews/{branch-slug}/              # Code review reports per branch
│   ├── {type}-report-{timestamp}.md
│   └── review-summary-{timestamp}.md
├── coordinator/                       # Release coordination state
│   ├── release-issue.md
│   └── state.json
├── design/                            # Implementation plans
│   └── {topic-slug}-{timestamp}.md
├── debug/                             # Debug sessions
│   ├── debug-{timestamp}.md
│   └── KNOWLEDGE_BASE.md
├── releases/                          # Release notes
│   └── RELEASE_NOTES_v{version}.md
├── status/                            # Development logs
│   ├── {timestamp}.md
│   ├── compact/{timestamp}.md
│   └── INDEX.md
└── CATCH_UP.md                        # Latest summary (overwritten)
```

### Naming Conventions

**Timestamps**: `YYYY-MM-DD_HHMM` (sortable, readable)
```bash
TIMESTAMP=$(date +%Y-%m-%d_%H%M)  # Example: 2025-11-14_2030
```

**Branch slugs**: Replace `/` with `-`, sanitize special characters
```bash
BRANCH_SLUG=$(git branch --show-current 2>/dev/null | sed 's/\//-/g' || echo "standalone")
# feature/auth → feature-auth
```

**Topic slugs**: Lowercase, dashes, alphanumeric only, max 50 chars
```bash
TOPIC_SLUG=$(echo "$TOPIC" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g' | cut -c1-50)
# "JWT Authentication" → jwt-authentication
```

**File types**:
- Special indexes: `UPPERCASE.md` (CATCH_UP.md, INDEX.md, KNOWLEDGE_BASE.md)
- Generated artifacts: `lowercase-{timestamp}.md` or `{type}-{id}.md`

### Standard Helper Functions

Use `.devflow/scripts/docs-helpers.sh` for consistent naming:

```bash
# Source helpers
source .devflow/scripts/docs-helpers.sh 2>/dev/null || {
    # Inline fallback if script not found
    get_timestamp() { date +%Y-%m-%d_%H%M; }
    get_branch_slug() { git branch --show-current 2>/dev/null | sed 's/\//-/g' || echo "standalone"; }
    get_topic_slug() { echo "$1" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g' | cut -c1-50; }
    ensure_docs_dir() { mkdir -p ".docs/$1"; }
}

# Use helpers
TIMESTAMP=$(get_timestamp)
BRANCH_SLUG=$(get_branch_slug)
ensure_docs_dir "reviews/$BRANCH_SLUG"
```

### Agent Persistence Rules

**Persisting commands** (create files in `.docs/`):
- `CatchUp` → `.docs/CATCH_UP.md` (overwrite latest)
- `Debug` → `.docs/debug/debug-{timestamp}.md` + `KNOWLEDGE_BASE.md`
- `devlog` → `.docs/status/{timestamp}.md` + `compact/` + `INDEX.md`
- `*Review` (9 types) → `.docs/reviews/{branch-slug}/{type}-report-{timestamp}.md`
- `Release` → `.docs/releases/RELEASE_NOTES_v{version}.md`

**Orchestration commands** (run in main context, spawn native agents):
- `/specify` - Spawns 4 Explore + 3 Plan agents (requirements focus), creates GitHub issue
- `/implement` - Spawns 4 Explore + 3 Plan + 1-N Coder + 5-8 review-* agents

**Native agents used** (built-in Claude Code agents):
- `Explore` - Fast codebase exploration (patterns, integration, testing)
- `Plan` - Implementation planning with trade-off analysis
- `Coder` - Code implementation in isolated worktrees
- `*Review` (9 types) - Specialized code analysis

**Utility agents** (focused tasks, no sub-spawning):
- `Commit` - Creates git commit only
- `GetIssue` - Fetches GitHub issue details
- `PullRequest` - Creates GitHub PR only
- `Devlog` - Read-only, analyzes project state for CatchUp
- `Comment` - Creates PR comments only
- `TechDebt` - Updates GitHub issue only
- `Debug` - Systematic debugging with hypothesis testing
- `CatchUp` - Context restoration from status logs

### Implementation Checklist

When creating or modifying persisting agents:
- [ ] Use standard timestamp format (`YYYY-MM-DD_HHMM`)
- [ ] Sanitize branch names (replace `/` with `-`)
- [ ] Sanitize topic names (lowercase, dashes, alphanumeric)
- [ ] Create directory with `mkdir -p .docs/{subdir}`
- [ ] Document output location in agent's final message
- [ ] Follow special file naming (UPPERCASE for indexes)
- [ ] Use helper functions from `docs-helpers.sh` when possible

## Development Environment

### Working on DevFlow

**CRITICAL**: This toolkit is designed for live development. When modifying DevFlow:

1. **Immediately Available** - Changes should be testable in global Claude Code configuration
2. **Instantly Testable** - Work in the devflow repo, test in global context
3. **Continuously Improved** - Dogfood your own tools

### Development Loop

```bash
# 1. Modify command or agent in devflow repo
vim commands/review.md

# 2. Rebuild if CLI changes
npm run build

# 3. Reinstall to global context for testing
node dist/cli.js init

# 4. Test immediately
/review

# 5. Iterate until satisfied
# 6. Commit using /commit
```

## Command Design Principles

When creating or modifying commands, follow these principles:

### 1. Brutal Honesty
Commands should expose the truth, not what developers want to hear:
- Security reviews find real vulnerabilities
- Performance reviews reveal actual bottlenecks
- Architecture reviews expose design flaws
- Agent reviews catch AI deception

### 2. Actionable Output
Every review provides:
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
- Reviews err on the side of flagging issues
- Status tracking captures comprehensive context
- Agent reviews assume skepticism

## Adding New Commands

### Command Structure

1. Create command in `commands/new-command.md`
2. Follow this template:

```markdown
# Command: /new-command

## Description
Brief description of what the command does.

## Usage
`/new-command [arguments]`

## Implementation
[Bash script or instructions for AI agent]

## Output Format
[Description of expected output]
```

3. Test locally before committing
4. Update README.md with user-facing documentation
5. Add to init.ts command list if needed

## Adding New Sub-Agents

### Sub-Agent Structure

1. Create agent in `agents/new-agent.md`
2. Follow existing agent patterns:
   - Clear specialty definition
   - Restricted tool access
   - Focused analysis scope
   - Specific output format

3. Test with explicit invocation
4. Document in README.md for users

## Adding New Skills

### Skill Structure

Skills are **model-invoked** capabilities that auto-activate based on context. They enforce quality without requiring manual invocation.

1. Create skill directory in `skills/skill-name/`
2. Create `SKILL.md` with YAML frontmatter:

```markdown
---
name: skill-name
description: When and why to use this skill (critical for auto-activation)
allowed-tools: Read, Grep, Glob, AskUserQuestion
---

# Skill Name

## Purpose
What this skill enforces and why

## When This Skill Activates
Be specific about trigger conditions

## Pattern Validation Process
Detailed checks and enforcement logic

## Violation Report Format
How to report issues found

## Success Criteria
What passes validation
```

3. Follow existing skill patterns:
   - **Focused enforcement** - One skill, one responsibility
   - **Clear activation triggers** - Specific context patterns
   - **Actionable reports** - File/line references, severity, fixes
   - **Read-only tools** - Most skills should not modify code
   - **Philosophy alignment** - Enforce project principles

4. Test skill activation:
   - Write code that should trigger the skill
   - Verify skill activates automatically
   - Check violation reports are clear
   - Ensure fixes are actionable

5. Document in README.md for users

### Skill vs Command Decision

**Use a Skill when:**
- Should activate automatically based on context
- Enforces patterns/quality (proactive)
- Detects violations during implementation
- Read-only analysis and reporting

**Use a Command when:**
- Requires explicit user decision
- Performs state changes (commits, releases)
- User controls timing (devlog, catch-up)
- Orchestrates complex workflows

**Both (Skill + Command):**
- Common workflow that benefits from both auto and manual modes
- Example: research (auto when unfamiliar, manual when user wants deep dive)

### Skills Architecture

DevFlow uses a **tiered skills system** where skills serve as shared knowledge libraries that agents can reference. This eliminates duplication and ensures consistent behavior across agents.

**Tier 1: Foundation Skills** (shared patterns used by multiple agents)

| Skill | Purpose | Used By |
|-------|---------|---------|
| `devflow-core-patterns` | Engineering patterns (Result types, DI, immutability, pure functions) | Coder, TypescriptReview, ArchitectureReview |
| `devflow-review-methodology` | 6-step review process, 3-category issue classification | All Review agents (12 total) |
| `devflow-docs-framework` | Documentation conventions (.docs/ structure, naming, templates) | Devlog, CatchUp, DocumentationReview, Debug |
| `devflow-git-safety` | Git operations, lock handling, commit conventions, sensitive file detection | Commit, Coder, PullRequest, Release |
| `devflow-security-patterns` | Security vulnerability patterns, OWASP mapping, detection strategies | SecurityReview |
| `devflow-implementation-patterns` | Common implementation patterns (CRUD, API endpoints, events, config, logging) | Coder |
| `devflow-codebase-navigation` | Codebase exploration, entry points, data flow tracing, pattern discovery | Coder |

**Tier 2: Specialized Skills** (user-facing, auto-activate based on context)

| Skill | Purpose | Auto-Triggers When |
|-------|---------|---------------------|
| `devflow-test-design` | Test quality enforcement (setup complexity, mocking, behavior testing) | Tests written or modified |
| `devflow-code-smell` | Anti-pattern detection (fake solutions, unlabeled workarounds, magic values) | Features implemented, code reviewed |
| `devflow-research` | Pre-implementation planning, documentation study, integration strategy | Unfamiliar features requested |
| `devflow-debug` | Systematic debugging with hypothesis testing | Errors occur, tests fail |
| `devflow-input-validation` | Boundary validation enforcement (parse-don't-validate, SQL injection prevention) | API endpoints created, external data handled |
| `devflow-worktree` | Git worktree management for parallel development | Parallel implementation, isolated working directories |

**Tier 3: Domain-Specific Skills** (language and framework patterns)

| Skill | Purpose | Used When |
|-------|---------|-----------|
| `devflow-typescript` | Type safety, generics, utility types, type guards, idioms | TypeScript codebases |
| `devflow-react` | Components, hooks, state management, performance optimization | React codebases |

**How Agents Use Skills:**

Agents declare skills in their frontmatter to automatically load shared knowledge:

```yaml
---
name: SecurityReview
description: Security vulnerability detection
model: inherit
skills: devflow-review-methodology, devflow-security-patterns
---
```

### Iron Laws

Every skill has a single, non-negotiable **Iron Law** - a core principle that must never be violated. Iron Laws are enforced automatically when skills activate.

| Skill | Iron Law |
|-------|----------|
| `devflow-core-patterns` | NEVER THROW IN BUSINESS LOGIC |
| `devflow-review-methodology` | NEVER BLOCK FOR PRE-EXISTING ISSUES |
| `devflow-git-safety` | NEVER RUN GIT COMMANDS IN PARALLEL |
| `devflow-debug` | NO FIXES WITHOUT ROOT CAUSE INVESTIGATION |
| `devflow-test-design` | COMPLEX TESTS INDICATE BAD DESIGN |
| `devflow-code-smell` | NO FAKE SOLUTIONS |
| `devflow-research` | NO IMPLEMENTATION WITHOUT EXPLORATION |
| `devflow-input-validation` | ALL EXTERNAL DATA IS HOSTILE |
| `devflow-docs-framework` | ALL ARTIFACTS FOLLOW NAMING CONVENTIONS |
| `devflow-security-patterns` | ASSUME ALL INPUT IS MALICIOUS |
| `devflow-codebase-navigation` | FIND PATTERNS BEFORE IMPLEMENTING |
| `devflow-implementation-patterns` | FOLLOW EXISTING PATTERNS |
| `devflow-react` | COMPOSITION OVER PROPS |
| `devflow-typescript` | UNKNOWN OVER ANY |
| `devflow-worktree` | ONE TASK, ONE WORKTREE |

**Iron Law Format** in SKILL.md files:
```markdown
## Iron Law

> **[CAPITALIZED PRINCIPLE NAME]**
>
> [Rationale explaining the principle and why violations are forbidden]
```

### Clarification Gates

The `/specify` command uses **mandatory clarification gates** - checkpoints that require explicit user confirmation before proceeding:

1. **Gate 0 (Before Exploration)**: Confirm understanding of feature idea
2. **Gate 1 (After Exploration)**: Validate scope and priorities
3. **Gate 2 (Before Issue Creation)**: Confirm acceptance criteria

No gate may be skipped. If user says "whatever you think", state recommendation and get explicit approval.

**Benefits of Tiered Architecture:**
- **No duplication** - Common methodology defined once in foundation skills
- **Consistent behavior** - All review agents follow the same 6-step process
- **Easy maintenance** - Update foundation skill, all agents inherit changes
- **Clear dependencies** - Agent frontmatter shows what knowledge it uses

### Creating New Skills

When creating skills, decide which tier:

**Foundation Skill** (Tier 1) - If multiple agents need the same knowledge:
- Create in `skills/devflow-{name}/SKILL.md`
- Document which agents should use it
- Add `skills:` field to relevant agent frontmatters

**Specialized Skill** (Tier 2) - If user-facing with context triggers:
- Create in `skills/devflow-{name}/SKILL.md`
- Focus on clear trigger conditions in description
- Test auto-activation in various contexts

**Domain-Specific Skill** (Tier 3) - For language/framework patterns:
- Create in `skills/devflow-{language|framework}/SKILL.md`
- Focus on idioms, patterns, and best practices for that domain
- Referenced by Coder agent based on detected tech stack

## CLI Development

### Building and Testing

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Watch mode for development
npm run dev

# Test locally
node dist/cli.js init

# Run specific command
node dist/cli.js uninstall --keep-docs
```

### Release Process

Follow this process for creating new releases of DevFlow Kit:

#### 1. Prepare the Release

**Update Version:**
```bash
# Edit package.json version manually (e.g., 0.1.0 -> 0.1.1)
# For patch: increment third digit (bug fixes, docs)
# For minor: increment second digit (new features, backwards compatible)
# For major: increment first digit (breaking changes)
```

**Update CHANGELOG.md:**
```markdown
## [0.1.x] - 2025-10-03

### Added
- New features added in this release

### Changed
- Changes to existing functionality

### Fixed
- Bug fixes

### Documentation
- Documentation improvements

---

[0.1.x]: https://github.com/dean0x/devflow/releases/tag/v0.1.x
```

#### 2. Build and Test

```bash
# Build the CLI
npm run build

# Test the build locally
node dist/cli.js --version  # Should show new version
node dist/cli.js init       # Test installation works

# Verify package contents
npm pack --dry-run
```

#### 3. Commit Version Bump

```bash
# Commit version and changelog changes
rm -f .git/index.lock && \
git add package.json CHANGELOG.md && \
git commit -m "chore: bump version to 0.1.x

- Update package.json to 0.1.x
- Add CHANGELOG entry for v0.1.x
- Document [summary of changes]"

# Push to GitHub
git push origin main
```

#### 4. Publish to npm

```bash
# Publish to npm registry
npm publish

# Verify publication
npm view devflow-kit version  # Should show new version
```

#### 5. Create Git Tag and GitHub Release

**Create and Push Tag:**
```bash
git tag -a v0.1.x -m "Version 0.1.x - [Brief Description]

- Key change 1
- Key change 2
- Key change 3"

git push origin v0.1.x
```

**Create GitHub Release:**
```bash
gh release create v0.1.x \
  --title "v0.1.x - [Release Title]" \
  --notes "$(cat <<'EOF'
# DevFlow Kit v0.1.x

[Brief description of release]

## 🎯 Highlights

### [Main Feature/Change]
- Key improvement 1
- Key improvement 2

## 📝 Changes

### Added
- New features

### Changed
- Modified functionality

### Fixed
- Bug fixes

### Documentation
- Doc improvements

## 📦 Installation

\`\`\`bash
npx devflow-kit init
\`\`\`

## 🔗 Links
- npm: https://www.npmjs.com/package/devflow-kit
- Changelog: https://github.com/dean0x/devflow/blob/main/CHANGELOG.md
- Previous Release: https://github.com/dean0x/devflow/releases/tag/v0.1.[x-1]
EOF
)"
```

#### 6. Verify Release

```bash
# Check npm
npm view devflow-kit

# Check GitHub releases
gh release view v0.1.x

# Test installation
npx devflow-kit@latest init
```

#### Release Checklist

- [ ] Version bumped in package.json
- [ ] CHANGELOG.md updated with all changes
- [ ] Code built successfully (`npm run build`)
- [ ] Local testing passed
- [ ] Version bump committed and pushed
- [ ] Published to npm successfully
- [ ] Git tag created and pushed
- [ ] GitHub release created with detailed notes
- [ ] Verified npm shows correct version
- [ ] Tested installation with `npx devflow-kit init`

#### Version Numbering Guide

**Patch (0.1.x):**
- Bug fixes
- Documentation improvements
- Minor tweaks without functional changes
- Internal refactoring

**Minor (0.x.0):**
- New features (backwards compatible)
- New commands or sub-agents
- New CLI options
- Significant documentation additions

**Major (x.0.0):**
- Breaking changes
- Removed or renamed commands
- Changed CLI interface
- Incompatible with previous versions

## File Organization

### Source Structure
```
devflow/
├── agents/                   # Sub-agent definitions
├── commands/                 # Slash command definitions
├── skills/                   # Skill source (installed flat to ~/.claude/skills/)
├── scripts/                  # Supporting scripts
└── src/
    └── cli/                  # CLI implementation
        ├── commands/           # CLI command implementations
        │   ├── init.ts          # Installation command
        │   └── uninstall.ts     # Uninstallation command
        └── cli.ts              # CLI entry point
```

### Installation Paths
- Commands: `~/.claude/commands/devflow/`
- Agents: `~/.claude/agents/devflow/`
- Skills: `~/.claude/skills/` (flat structure - no devflow/ subdirectory)
- Scripts: `~/.devflow/scripts/`
- Settings: `~/.claude/settings.json`

**Note:** Skills are installed flat (directly under `skills/`) for Claude Code auto-discovery. Commands and agents use the `devflow/` subdirectory for namespacing.

### Managed Settings (System-Level)

The `--managed-settings` flag installs to Claude Code's system directories for highest precedence:

```bash
sudo devflow init --managed-settings
```

**Paths:**
- **macOS**: `/Library/Application Support/ClaudeCode/managed-settings.json`
- **Linux**: `/etc/claude-code/managed-settings.json`

**What's included in managed settings:**
- `statusLine` - Smart statusline with context percentage
- `env.ENABLE_TOOL_SEARCH` - Deferred MCP tool loading (~85% token savings)
- `permissions.deny` - Security deny list (126 blocked operations)

**Security Deny List Categories:**
| Category | Examples |
|----------|----------|
| System destruction | `rm -rf /`, `dd`, `mkfs`, `shred` |
| Code execution | `curl \| bash`, `eval`, `exec` |
| Privilege escalation | `sudo`, `su`, `doas`, `pkexec` |
| Permission changes | `chmod 777`, `chown root` |
| System control | `kill -9`, `reboot`, `shutdown` |
| Data exfiltration | `netcat`, `socat`, `telnet` |
| Sensitive file reads | `.env`, SSH keys, AWS credentials |
| Package globals | `npm -g`, `pip --system` |
| Resource abuse | Fork bombs, crypto miners |

The full deny list is in `src/templates/settings.json`.

### Statusline Script

The statusline (`scripts/statusline.sh`) displays real-time context:
- Directory name and model
- Git branch with dirty indicator (`*`)
- **Context usage percentage** (color-coded):
  - Green: < 50%
  - Yellow: 50-80%
  - Red: > 80%

Data source: `context_window.current_usage` from Claude Code's JSON stdin.

## Testing Guidelines

### Command Testing
1. Test in isolation first
2. Test with real git repositories
3. Verify output formatting
4. Check error handling
5. Test with various project types

### Sub-Agent Testing
1. Test explicit invocation
2. Verify specialized expertise
3. Check output accuracy
4. Test error scenarios
5. Verify tool restrictions

## Contributing Guidelines

### Code Style
- TypeScript for CLI code
- Markdown for commands and agents
- Clear, self-documenting code
- Comprehensive error messages

### Commit Messages
Use conventional commits:
- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation updates
- `refactor:` Code refactoring
- `test:` Test additions/changes
- `chore:` Maintenance tasks

### Pull Request Process
1. Test all changes locally
2. Update documentation
3. Ensure backward compatibility
4. Add examples for new features
5. Update CHANGELOG.md

## Extending DevFlow

### Custom Project Rules
Projects can extend DevFlow by:
1. Adding custom `.docs/` templates
2. Creating project-specific review rules
3. Extending `.claudeignore` patterns
4. Adding team-specific workflows

### Integration Points
- Git hooks integration
- CI/CD pipeline integration
- Team workflow customization
- Project-specific validations

## Important Implementation Notes

### Git Safety
- Always use `rm -f .git/index.lock &&` before git operations
- Run git commands sequentially, never in parallel
- Preserve user's git configuration
- Never force push without explicit user request

### Token Optimization
- Sub-agents cannot invoke other sub-agents (by design)
- Use parallel execution where possible
- Leverage `.claudeignore` for context reduction
- Keep commands focused and efficient

### Error Handling
- Provide clear error messages
- Suggest fixes for common issues
- Log errors to `.docs/debug/` when appropriate
- Never hide failures from users

## Maintenance Tasks

### Regular Updates
1. Review and update review patterns
2. Optimize command performance
3. Update dependencies
4. Improve error messages
5. Enhance documentation

### Monitoring Usage
- Track common error patterns
- Identify missing features
- Gather performance metrics
- Review user feedback

## Support for Developers

When working on DevFlow:
1. Review existing command patterns
2. Test changes thoroughly
3. Document all modifications
4. Consider backward compatibility
5. Focus on user value

Remember: The goal is reliable, high-quality development with AI assistance, not blind trust in AI output.