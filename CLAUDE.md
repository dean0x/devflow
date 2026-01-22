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
├── design/                            # Implementation plans
│   └── {topic-slug}-{timestamp}.md
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
- `devlog` → `.docs/status/{timestamp}.md` + `compact/` + `INDEX.md`
- `Reviewer` → `.docs/reviews/{branch-slug}/{focus}.md` (one file per focus area)
- `Synthesizer` → `.docs/reviews/{branch-slug}/review-summary.{timestamp}.md` (review mode)
**Orchestration commands** (run in main context, spawn agents):
- `/specify` - Spawns Skimmer + 4 Explore + Synthesizer + 3 Plan + Synthesizer, creates GitHub issue
- `/implement` - Spawns Git (fetch-issue) + Skimmer + 4 Explore + Synthesizer + 3 Plan + Synthesizer + 1-N Coder + Simplifier + Scrutinizer + Shepherd, creates PR
- `/review` - Spawns 7-11 Reviewer agents (different focus areas) + Git (comment-pr) + Synthesizer
- `/resolve` - Spawns N Resolver agents (batches) + Git (manage-debt), creates resolution summary

**Native agents used** (built-in Claude Code agents):
- `Explore` - Fast codebase exploration (patterns, integration, testing)
- `Plan` - Implementation planning with trade-off analysis

**Implementation agents**:
- `Coder` - Autonomous implementation on feature branches
- `Resolver` - Validates review issues, decides FIX vs TECH_DEBT based on risk, implements fixes
- `Scrutinizer` - Self-review agent that evaluates and fixes P0/P1 issues (runs in fresh context after Coder)
- `Simplifier` - Post-implementation code refinement for clarity and consistency
- `Shepherd` - Validates implementation alignment with request/plan, fixes misalignments

**Review agents**:
- `Reviewer` - Universal parameterized reviewer (focus via prompt injection)
- `Synthesizer` - Combines outputs from multiple agents (modes: exploration, planning, review)

**GitHub operations agent** (unified parameterized agent):
- `Git` - Handles all git/GitHub operations via operations: `setup-task`, `fetch-issue`, `comment-pr`, `manage-debt`, `create-release`

**Utility agents** (focused tasks, no sub-spawning):
- `Devlog` - Read-only, analyzes project state for CatchUp
- `CatchUp` - Context restoration from status logs
- `Skimmer` - Codebase orientation using skim for file/function discovery

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
# 6. Commit changes
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
| `devflow-core-patterns` | Engineering patterns (Result types, DI, immutability, pure functions) | Coder, Reviewer |
| `devflow-review-methodology` | 6-step review process, 3-category issue classification | Reviewer |
| `devflow-self-review` | 9-pillar self-review framework (Design, Functionality, Security, Complexity, Error Handling, Tests, Naming, Consistency, Documentation) | Scrutinizer |
| `devflow-docs-framework` | Documentation conventions (.docs/ structure, naming, templates) | Devlog, CatchUp |
| `devflow-git-safety` | Git operations, lock handling, commit conventions, sensitive file detection | Coder, Git |
| `devflow-github-patterns` | GitHub API patterns (rate limiting, PR comments, issue management, releases) | Git |
| `devflow-implementation-patterns` | Common implementation patterns (CRUD, API endpoints, events, config, logging) | Coder |
| `devflow-codebase-navigation` | Codebase exploration, entry points, data flow tracing, pattern discovery | Coder |

**Tier 1b: Pattern Skills** (domain expertise for Reviewer agent focus areas)

| Skill | Purpose | Reviewer Focus |
|-------|---------|----------------|
| `devflow-security-patterns` | Injection, auth, crypto, OWASP vulnerabilities | `security` |
| `devflow-architecture-patterns` | SOLID violations, coupling, layering, modularity | `architecture` |
| `devflow-performance-patterns` | Algorithms, N+1, memory, I/O, caching | `performance` |
| `devflow-complexity-patterns` | Cyclomatic complexity, readability, maintainability | `complexity` |
| `devflow-consistency-patterns` | Pattern violations, simplification, truncation | `consistency` |
| `devflow-tests-patterns` | Coverage, quality, brittle tests, mocking | `tests` |
| `devflow-database-patterns` | Schema, queries, migrations, indexes | `database` |
| `devflow-documentation-patterns` | Docs quality, alignment, code-comment drift | `documentation` |
| `devflow-dependencies-patterns` | CVEs, versions, licenses, supply chain | `dependencies` |
| `devflow-regression-patterns` | Lost functionality, broken behavior, migrations | `regression` |

**Tier 2: Specialized Skills** (user-facing, auto-activate based on context)

| Skill | Purpose | Auto-Triggers When |
|-------|---------|---------------------|
| `devflow-test-design` | Test quality enforcement (setup complexity, mocking, behavior testing) | Tests written or modified |
| `devflow-code-smell` | Anti-pattern detection (fake solutions, unlabeled workarounds, magic values) | Features implemented, code reviewed |
| `devflow-commit` | Atomic commit patterns, message format, safety scanning | Staging files, creating commits |
| `devflow-pull-request` | PR quality, descriptions, size assessment, breaking change detection | Creating PRs, generating descriptions |
| `devflow-input-validation` | Boundary validation enforcement (parse-don't-validate, SQL injection prevention) | API endpoints created, external data handled |

**Tier 3: Domain-Specific Skills** (language and framework patterns)

| Skill | Purpose | Used When |
|-------|---------|-----------|
| `devflow-typescript` | Type safety, generics, utility types, type guards, idioms | TypeScript codebases |
| `devflow-react` | Components, hooks, state management, performance optimization | React codebases |

**How Agents Use Skills:**

Agents declare skills in their frontmatter to automatically load shared knowledge:

```yaml
---
name: Reviewer
description: Universal code review agent with parameterized focus
model: inherit
skills: devflow-review-methodology, devflow-security-patterns, devflow-architecture-patterns, ...
---
```

The unified `Reviewer` agent loads ALL pattern skills and applies the relevant one based on the focus area specified in its invocation prompt.

### Iron Laws

Every skill has a single, non-negotiable **Iron Law** - a core principle that must never be violated. Iron Laws are enforced automatically when skills activate.

**Foundation Skills:**

| Skill | Iron Law |
|-------|----------|
| `devflow-core-patterns` | NEVER THROW IN BUSINESS LOGIC |
| `devflow-review-methodology` | NEVER BLOCK FOR PRE-EXISTING ISSUES |
| `devflow-self-review` | FIX BEFORE RETURNING |
| `devflow-git-safety` | NEVER RUN GIT COMMANDS IN PARALLEL |
| `devflow-github-patterns` | RESPECT RATE LIMITS OR FAIL GRACEFULLY |
| `devflow-docs-framework` | ALL ARTIFACTS FOLLOW NAMING CONVENTIONS |
| `devflow-implementation-patterns` | FOLLOW EXISTING PATTERNS |
| `devflow-codebase-navigation` | FIND PATTERNS BEFORE IMPLEMENTING |

**Pattern Skills (Reviewer focus areas):**

| Skill | Iron Law |
|-------|----------|
| `devflow-security-patterns` | ASSUME ALL INPUT IS MALICIOUS |
| `devflow-architecture-patterns` | SEPARATION OF CONCERNS IS NON-NEGOTIABLE |
| `devflow-performance-patterns` | MEASURE BEFORE OPTIMIZING |
| `devflow-complexity-patterns` | IF YOU CAN'T UNDERSTAND IT IN 5 MINUTES, IT'S TOO COMPLEX |
| `devflow-consistency-patterns` | MATCH EXISTING PATTERNS OR JUSTIFY DEVIATION |
| `devflow-tests-patterns` | TESTS VALIDATE BEHAVIOR, NOT IMPLEMENTATION |
| `devflow-database-patterns` | EVERY QUERY MUST HAVE AN EXECUTION PLAN |
| `devflow-documentation-patterns` | DOCUMENTATION MUST MATCH REALITY |
| `devflow-dependencies-patterns` | EVERY DEPENDENCY IS AN ATTACK SURFACE |
| `devflow-regression-patterns` | WHAT WORKED BEFORE MUST WORK AFTER |

**Specialized & Domain Skills:**

| Skill | Iron Law |
|-------|----------|
| `devflow-test-design` | COMPLEX TESTS INDICATE BAD DESIGN |
| `devflow-code-smell` | NO FAKE SOLUTIONS |
| `devflow-commit` | ATOMIC COMMITS OR NO COMMITS |
| `devflow-pull-request` | HONEST DESCRIPTIONS OR NO PR |
| `devflow-input-validation` | ALL EXTERNAL DATA IS HOSTILE |
| `devflow-react` | COMPOSITION OVER PROPS |
| `devflow-typescript` | UNKNOWN OVER ANY |

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

## Agent Design Guidelines

Agents should be lean, focused, and trust the system around them. Follow these guidelines when creating or modifying agents.

### Target Structure

Every agent should follow this template (~50-150 lines total):

```markdown
---
frontmatter (name, description, model, skills, hooks)
---

# Agent Name

[Identity paragraph - 2-4 sentences describing role and autonomy level]

## Input Context
[What the orchestrator passes: structured list of parameters]

## Responsibilities
[5-7 numbered items: what this agent does]

## Principles
[4-6 focused principles guiding behavior]

## Output
[Simple structured report format]

## Boundaries
[What to escalate vs handle autonomously]
```

### Length Guidelines

| Agent Type | Target Lines | Examples |
|------------|-------------|----------|
| Utility | 50-80 | Skimmer, Simplifier, CatchUp |
| Worker | 80-120 | Coder, Reviewer, Git |
| Orchestration | 100-150 | (Commands handle orchestration, not agents) |

### What Belongs Where

| Content | Location | Rationale |
|---------|----------|-----------|
| Engineering patterns (Result types, DI) | Skills | Shared across agents |
| Git safety, commit conventions | Skills | Consistent enforcement |
| Review methodology | Skills | Reusable across review types |
| Branch setup | Orchestrator | Agent receives ready feature branch |
| Codebase exploration | Explore agents | Dedicated agents do exploration |
| Implementation planning | Plan agents | Dedicated agents do planning |
| Task identity + responsibilities | Agent | Core agent definition |
| Input/output contract | Agent | Interface with orchestrator |
| Escalation boundaries | Agent | Clear handoff points |

### Anti-Patterns to Avoid

1. **Duplicating skill content** - Don't re-document what skills provide. Reference skills via frontmatter.

2. **Embedding bash scripts** - Agents know how to code. Don't over-specify implementation details.

3. **Re-doing orchestrator work** - If orchestrator creates feature branch, agent shouldn't document branch creation.

4. **Verbose phase documentation** - A worker agent implements; it doesn't need exploration and planning phases.

5. **Progress tracking templates** - Trust the agent to log appropriately without detailed echo scripts.

6. **Listing auto-activating skills** - Skills auto-activate based on context; no need to enumerate triggers.

### Quality Checklist

Before committing a new or modified agent:

- [ ] Under 150 lines (ideally under 120)
- [ ] Single identity paragraph (not multiple paragraphs of context)
- [ ] Input contract clearly defined
- [ ] Output format simple and structured
- [ ] Boundaries section present (escalate vs handle)
- [ ] No duplicated skill content
- [ ] No bash script templates
- [ ] Skills referenced in frontmatter, not re-documented in body

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

### Settings Override

The `--override-settings` flag replaces existing `~/.claude/settings.json`:

```bash
devflow init --override-settings
```

If settings.json exists, prompts for confirmation before overwriting.

**What's included in DevFlow settings (`src/templates/settings.json`):**
- `statusLine` - Smart statusline with context percentage
- `env.ENABLE_TOOL_SEARCH` - Deferred MCP tool loading (~85% token savings)
- `permissions.deny` - Security deny list (126 blocked operations)

**Security Deny List Categories:**
| Category | Examples |
|----------|----------|
| System destruction | `rm -rf /`, `dd`, `mkfs`, `shred`, `fdisk` |
| Code injection | `curl \| bash`, `base64 -d \| sh`, `eval` |
| Privilege escalation | `sudo`, `su`, `doas`, `pkexec`, `passwd` |
| User management | `useradd`, `userdel`, `usermod`, `groupadd` |
| Permission changes | `chmod 777 /`, `chown root` |
| System control | `kill -9`, `reboot`, `shutdown`, `systemctl stop` |
| Reverse shells | `nc -l`, `netcat`, `socat`, python/php/perl sockets |
| Network scanning | `nmap`, `masscan` |
| Firewall bypass | `ufw disable`, `iptables -F` |
| Kernel modification | `insmod`, `rmmod`, `modprobe`, `sysctl -w` |
| Container escapes | `docker --privileged`, `nsenter`, `--pid=host` |
| Cloud metadata | `curl 169.254.169.254` (AWS/GCP metadata) |
| Log tampering | `rm /var/log`, `history -c` |
| Crypto miners | `xmrig`, `cgminer`, `ethminer`, `minerd` |
| Sensitive files | `.env`, SSH keys, AWS/GCP credentials, `.pem` |
| Package globals | `npm install -g`, `pip install --system` |

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