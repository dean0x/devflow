# Changelog

All notable changes to DevFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-02-13

### Added
- **Agent Teams integration** - Peer-to-peer agent collaboration across workflows
  - `/review` uses adversarial review team with debate round and consensus findings
  - `/implement` uses exploration and planning teams with debate, Shepherd↔Coder direct dialogue
  - New `/debug` command for competing hypothesis investigation with agent teams
  - `agent-teams` foundation skill with team spawning, challenge protocol, consensus formation
  - `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` enabled in default settings
  - Graceful fallback to parallel subagents when Agent Teams is unavailable
- **`devflow-debug` plugin** - New plugin for bug investigation
  - `/debug` command spawns 3-5 hypothesis investigators
  - Adversarial debate where agents actively disprove each other's theories
  - Root cause analysis report with confidence levels
- **`accessibility` skill** - WCAG 2.1 AA patterns for keyboard navigation, ARIA, contrast
  - Iron Law: EVERY INTERACTION MUST BE POSSIBLE WITHOUT A MOUSE
  - Auto-triggers when creating UI components, forms, or interactive elements
- **`frontend-design` skill** - Intentional visual design patterns (Anthropic's 4 Dimensions)
  - Iron Law: AESTHETICS MUST HAVE INTENT
  - AI slop detection (purple-pink gradients, Inter without rationale, everything centered)
  - Auto-triggers when working with CSS, styling, or visual design
- **Enhanced `react` skill** - Added 5 new categories from Vercel best practices
  - Async Parallelization (Promise.all for independent fetches)
  - Bundle Size (no barrel imports, lazy loading)
  - Re-render Optimization (primitive deps, stable callbacks)
  - Image Optimization (dimensions, lazy loading, aspect-ratio)
  - Data Structure Performance (Set/Map for O(1) lookups)
- **Conditional frontend reviews** in `/review` command
  - `react` review (if .tsx/.jsx files changed)
  - `accessibility` review (if .tsx/.jsx files changed)
  - `frontend-design` review (if .tsx/.jsx/.css/.scss files changed)
- **Glob pattern activation schema** for skills
  - Skills can declare `activation.file-patterns` and `activation.exclude` in frontmatter
  - Future-proofs for conditional skill loading
- **`devflow-github-patterns` skill** - Foundation skill for GitHub API interactions
  - Rate limiting patterns (1-2s delays, 60s wait if <10 remaining)
  - Comment deduplication algorithms
  - Line-in-diff validation for PR comments
  - Issue data parsing (acceptance criteria, dependencies)
  - Branch name generation from issues
  - Tech debt management patterns (archive on overflow)
  - Iron Law: RESPECT RATE LIMITS OR FAIL GRACEFULLY
- **Unified `Git` agent** - Single parameterized agent for all git/GitHub operations
  - `fetch-issue` operation: Fetches GitHub issue details with acceptance criteria and suggested branch name
  - `comment-pr` operation: Creates PR inline comments with deduplication and rate limiting
  - `manage-debt` operation: Updates tech debt backlog issue with semantic deduplication
  - `create-release` operation: Creates GitHub release with version tag
  - Replaces: GetIssue, Comment, TechDebt agents
- **`devflow-commit` skill** - Atomic commit patterns, message format, safety scanning
  - Iron Law: ATOMIC COMMITS OR NO COMMITS
  - Auto-triggers when staging files or creating commits
- **`devflow-pull-request` skill** - PR quality, descriptions, size assessment
  - Iron Law: HONEST DESCRIPTIONS OR NO PR
  - Auto-triggers when creating PRs or generating descriptions
- **Iron Laws** - Every skill now has a single, non-negotiable core principle
  - 28 Iron Laws across all skills (e.g., "NEVER THROW IN BUSINESS LOGIC", "NO FAKE SOLUTIONS")
  - Automatically enforced when skills activate
  - Consistent format: `## Iron Law` section in each SKILL.md
- **Clarification Gates** for `/specify` command
  - Gate 0: Confirm understanding before exploration
  - Gate 1: Validate scope and priorities after exploration
  - Gate 2: Confirm acceptance criteria before issue creation
  - No gate may be skipped - explicit user approval required
- **`--override-settings` flag** for `devflow init`
  - Override existing settings.json with DevFlow configuration
  - Prompts for confirmation if settings.json exists
  - No sudo required - writes to `~/.claude/settings.json`
- **Security deny list** (140 blocked operations)
  - System destruction (rm -rf, dd, mkfs, shred)
  - Code execution (curl|bash, eval, exec)
  - Privilege escalation (sudo, su, doas, pkexec)
  - Permission changes (chmod 777, chown root)
  - System control (kill -9, reboot, shutdown)
  - Data exfiltration (netcat, socat, telnet)
  - Sensitive file reads (.env, SSH keys, AWS credentials)
  - Package globals (npm -g, pip --system)
  - Resource abuse (fork bombs, crypto miners)
- **`ENABLE_TOOL_SEARCH`** environment variable in settings
  - Deferred MCP tool loading until needed
  - ~85% token reduction for conversations with many MCP tools
- **Context usage percentage** in statusline
  - Replaces binary "exceeds 200k" warning
  - Color-coded: Green (<50%), Yellow (50-80%), Red (>80%)
  - Calculated from `context_window.current_usage` data
- **Working Memory hooks** — Automatic session continuity via stop/session-start/pre-compact hooks (#59)
  - Background haiku updater writes `.docs/WORKING-MEMORY.md` asynchronously
  - SessionStart hook injects previous memory + git state on startup
  - mkdir-based locking for concurrent session safety
- **Teams/no-teams command variants** — Install-time selection of Agent Teams vs parallel subagents (#61)
  - `--teams`/`--no-teams` CLI flags with TTY confirmation prompt
  - Variant-aware installer copies correct `.md` files
  - `stripTeamsConfig()` removes teams env vars when disabled

### Changed
- **Lean agent and command redesign** - Major refactoring reducing 3,653 lines to 844 (-77%)
  - Commands: `/implement` (479→182), `/specify` (631→179), `/devlog` (408→113), `/review` (312→136)
  - Agents: Coder, Synthesizer, Reviewer, Git, Devlog, CatchUp, Skimmer, Simplifier
  - Removed embedded bash scripts, verbose templates, redundant explanations
  - Preserved all workflows, agent invocations, and architecture
- **Agent model assignments** - Simplified to inherit vs haiku
  - `inherit`: Coder, Reviewer, Simplifier, Skimmer (use orchestrator's model)
  - `haiku`: Synthesizer, Git, Devlog, CatchUp (fast, simple operations)
- `/specify` now requires explicit user confirmation at each gate
- Statusline shows actual percentage instead of just large context warning
- Settings template includes permissions.deny and env configuration
- Commit and PR patterns now auto-activate via skills instead of requiring explicit commands
- **Git skills deduplication** - Removed ~80 lines of duplicated content across git-related skills
  - `devflow-git-safety`: Canonical source for lock handling, sequential ops, sensitive file detection
  - `devflow-commit`: Canonical source for commit message format, atomic grouping
  - `devflow-worktree`: Simplified lock handling with cross-reference
  - All 5 git skills now have Related Skills table for discoverability

### Removed
- **`/commit` command** - Replaced by `devflow-commit` skill (use `git commit` directly)
- **`/debug` command** - Removed entirely (Claude Code's built-in debugging is sufficient)
- **`/pull-request` command** - Replaced by `devflow-pull-request` skill (use `gh pr create` directly)
- **`/breakdown` command** - Removed (use natural conversation or TodoWrite directly)
- **`/release` command** - Removed (use manual release process documented in CLAUDE.md)
- **`/resolve-comments` command** - Removed (address PR comments directly)
- **`/run` command** - Removed (use `/implement` for full lifecycle)
- **`Commit` agent** - Patterns moved to `devflow-commit` skill
- **`Debug` agent** - Removed entirely
- **`PullRequest` agent** - Patterns moved to `devflow-pull-request` skill
- **`Release` agent** - Removed (release process documented in CLAUDE.md)
- **`/catch-up` command** - Superseded by Working Memory hooks (automatic context restoration)
- **`/devlog` command** - Superseded by Working Memory hooks (automatic session logging)
- **`catch-up` agent** - No longer needed with automatic Working Memory
- **`devlog` agent** - No longer needed with automatic Working Memory
- **`devflow-debug` skill** - Removed entirely
- **`GetIssue` agent** - Replaced by Git agent (operation: fetch-issue)
- **`Comment` agent** - Replaced by Git agent (operation: comment-pr)
- **`TechDebt` agent** - Replaced by Git agent (operation: manage-debt)

### Fixed
- **Skimmer agent** — Use `npx rskim` to eliminate global install requirement (#60)
- **Working Memory throttle race** — Marker file prevents concurrent updater spawns during Agent Teams sessions (#62)
- **Working Memory diagnostics** — stderr captured to log file instead of swallowed (#62)

---

## [0.9.0] - 2025-12-04

### Added
- **`/get-issue` command** - Fetch GitHub issue details and create working branch
  - Fetch issue by number (`/get-issue 42`) or search term (`/get-issue fix login`)
  - Display comprehensive issue details (title, body, labels, assignees, comments)
  - Auto-generate branch names: `{type}/{number}-{slug}`
  - Branch type derived from labels (feature, fix, docs, refactor, chore)
  - Pre-flight checks for gh authentication and repository validation
- **`get-issue` sub-agent** - Specialized agent for GitHub issue workflow

### Changed
- Optimized sub-agent model selection - 5 sub-agents switched to haiku model (get-issue, pull-request, project-state, tech-debt, pr-comments)
- Minimized command files - `/get-issue` (16 lines) and `/pull-request` (20 lines) delegate to sub-agents

---

## [0.8.1] - 2025-12-02

### Added
- **`--verbose` flag for `devflow init`** - Clean, command-focused output by default
  - Default output shows only version, available commands, and docs link
  - Use `--verbose` for detailed installation progress, paths, and skills list
  - Improves first-run experience by reducing noise

### Changed
- Refactored init command output rendering into separate functions
- Extracted command and skill lists into maintainable constants

---

## [0.8.0] - 2025-11-21

### Added
- PR comments and tech debt tracking for code-review command
- Robustness improvements (rate limiting, auto-archive for tech debt)

### Changed
- Split code-review into three specialized sub-agents (code-review, pr-comments, tech-debt)
- Simplified code-review Phase 1 setup

---

## [0.7.0] - 2025-11-16

### Added
- **`/brainstorm` command** - Explore design decisions and architectural approaches
  - Launches brainstorm sub-agent for structured exploration
  - Analyzes trade-offs between different approaches
  - Saves exploration to `.docs/brainstorm/`
- **`/design` command** - Create detailed implementation plans with integration points
  - Launches design sub-agent for concrete planning
  - Studies existing codebase patterns
  - Saves implementation plan to `.docs/design/`
- **`/breakdown` command** - Quick task decomposition without interaction
  - Renamed from `/plan-next-steps` for conciseness
  - Extracts action items from conversation
  - Saves todos immediately without triage

### Changed
- **`/plan` command** - Redesigned for deliberate issue triage
  - Examine each issue individually (what, why, severity)
  - Three-way decision: implement now, defer to GitHub issue, or skip
  - Creates and locks actual GitHub issues via `gh` CLI
  - Applies orchestration principle (minimal tools)
- **`/commit` command** - Execute immediately without user confirmation
  - Trust agent judgment after safety checks pass
  - Only abort for genuine issues (secrets, credentials)
  - Faster workflow without back-and-forth
- **`/run` command** - Streamlined from 507 to ~100 lines (renamed from `/implement`)
  - Removed over-engineered interactive triage
  - Focus on efficient task execution
  - Only stop for genuine design decisions
- **Documentation framework** - Standardized across all agents
  - Timestamps: YYYY-MM-DD_HHMM (sortable, readable)
  - Branch slugs: sanitize `/` to `-` for file paths
  - Consistent `.docs/` directory structure
- **Research skill** - Updated to use brainstorm agent
  - Auto-launches brainstorm for unfamiliar features
  - Suggests `/design` after exploration completes

### Removed
- **`/research` command** - Replaced by `/brainstorm` + `/design` workflow
- **`/plan-next-steps` command** - Renamed to `/breakdown`
- **research sub-agent** - Replaced by brainstorm and design agents

### Breaking Changes
- `/plan-next-steps` renamed to `/breakdown`
- `/research` command removed (use `/brainstorm` + `/design`)
- `/plan` behavior completely changed (triage vs batch selection)

## [0.6.1] - 2025-11-04

### Fixed
- Skills installation structure for auto-discovery - Skills are now installed directly under `~/.claude/skills/` instead of `~/.claude/skills/devflow/`, enabling Claude Code to properly discover and auto-activate them
- Uninstall command now correctly removes individual skill directories
- Migration cleanup for users upgrading from nested to flat skill structure

## [0.6.0] - 2025-11-03

### Added

#### Complete PR Workflow Commands
- **`/plan` command** - Interactive planning with design decisions
  - Extracts actionable tasks from discussion
  - Presents tasks to user for selection via interactive UI
  - Saves only chosen tasks to todo list
  - Enables focused, intentional work sessions
- **`/pull-request` command** - Smart PR creation with auto-generated descriptions
  - Analyzes all commits and changes in branch
  - Generates comprehensive PR description automatically
  - Includes summary, key changes, and test plan
  - Supports `--draft` flag and custom base branch
  - Uses new pull-request sub-agent for deep analysis
- **`/resolve-comments` command** - Systematic PR feedback resolution
  - Fetches PR review comments via GitHub CLI
  - Triages comments with user (implement, respond, defer)
  - Implements changes and updates PR
  - Posts replies to reviewers
  - Tracks completion status

#### Enhanced Audit System
- **Three-category reporting** - All 9 review agents refactored for clearer feedback
  - **🔴 Issues in Your Changes** - NEW vulnerabilities/problems introduced (BLOCKING)
  - **⚠️ Issues in Code You Touched** - Problems near your changes (SHOULD FIX)
  - **ℹ️ Pre-existing Issues** - Legacy problems unrelated to PR (INFORMATIONAL)
  - Prevents scope creep in code reviews by clearly separating what you introduced
- **New pull-request sub-agent** - Comprehensive PR analysis specialist
  - Analyzes commit history and code changes
  - Generates structured PR descriptions
  - Identifies breaking changes and migration paths
  - Creates test plans and verification steps

### Changed

#### Code Review Command Rewrite
- **Completely rewritten `/code-review` command** - Better orchestration and synthesis
  - Orchestrates all review sub-agents in parallel for faster execution
  - Synthesizes findings from three-category reports
  - Generates actionable summary with clear priorities
  - Separates blocking issues from informational findings
  - Provides focused feedback on what actually needs fixing

#### Type Safety Improvements
- **Enhanced error handling in CLI** - Proper TypeScript type guards
  - Added `NodeSystemError` interface with proper typing
  - Created `isNodeSystemError()` type guard function
  - Replaced `error: any` with `error: unknown` in init command
  - Safely checks `error.code` property with type guard
  - Maintains runtime behavior while improving type safety

### Fixed

#### Documentation
- **README CLI examples** - Corrected command invocation format
  - Fixed examples to use `npx devflow-kit` instead of `devflow`
  - Ensures users can successfully run installation commands
- **Statusline metrics** - Fixed container-specific resource monitoring
  - Now reads container-specific CPU and memory metrics correctly
  - Removed redundant CPU and memory metrics from statusline implementation
  - Improved accuracy for Docker container environments

---

[0.6.0]: https://github.com/dean0x/devflow/compare/v0.5.0...v0.6.0

## [0.5.0] - 2025-10-24

### Added

#### Installation Scope Support
- **Two-tier installation strategy** - Choose between user-wide and project-specific installation
  - **User scope** (default): Install to `~/.claude/` for all projects
  - **Local scope**: Install to `<git-root>/.claude/` for current project only
  - Interactive prompt with clear descriptions when `--scope` flag not provided
  - CLI flag: `devflow init --scope <user|local>`
  - Automatic .gitignore updates for local scope (excludes `.claude/` and `.devflow/`)
  - Perfect for team projects where DevFlow should be project-specific

#### Smart Uninstall with Scope Detection
- **Auto-detection of installed scopes** - Intelligently finds and removes DevFlow installations
  - Automatically detects which scopes have DevFlow installed (user and/or local)
  - Default behavior: Remove from all detected scopes
  - Manual override: `--scope <user|local>` to target specific scope
  - Clear feedback showing which scopes are being uninstalled
  - Graceful handling when no installation found

### Changed

#### Code Quality Improvements
- **Extracted shared utilities** - Eliminated code duplication between init and uninstall commands
  - Created `src/cli/utils/paths.ts` for path resolution functions
  - Created `src/cli/utils/git.ts` for git repository operations
  - Reduced duplication by ~65 lines
  - Single source of truth for path and git logic

#### Performance Optimizations
- **Eliminated redundant git detection** - Cache git root result for reuse
  - Previously called `git rev-parse` twice during installation
  - Now cached once and reused throughout installation process
  - Faster installation, especially in large repositories

### Fixed

#### CI/CD Compatibility
- **TTY detection for interactive prompts** - Prevents hanging in non-interactive environments
  - Detects when running in CI/CD pipelines, Docker containers, or automated scripts
  - Falls back to default scope (user) when no TTY available
  - Clear messaging when non-interactive environment detected
  - Explicit instructions for CI/CD usage: `devflow init --scope <user|local>`

#### Security Hardening
- **Environment variable path validation** - Prevents malicious path overrides
  - Validates `CLAUDE_CODE_DIR` and `DEVFLOW_DIR` are absolute paths
  - Warns when paths point outside user's home directory
  - Prevents path traversal attacks via environment variables
  - Security-first approach to custom path configuration

### Documentation
- **Installation Scopes section** in README with clear use cases
- **Updated CLI commands table** with scope options for init and uninstall
- **Migration guide** for existing users (scope defaults to user for compatibility)
- **.gitignore patterns** documented for local scope installations

---

## [0.4.0] - 2025-10-21

### Added

#### Skills Infrastructure
- **Auto-activating skills system** - Intelligent context-aware capabilities that activate when relevant
  - Skills replace standalone commands with intelligent activation patterns
  - 7 new skills: research, debug, devlog, test-generation, api-integration, data-migration, refactoring-assistant
  - Skills displayed on devflow init with clear descriptions
  - Installed to `~/.claude/skills/devflow/` directory
  - Automatic activation based on conversation context

#### Smart Interactive Commands
- **/run command** - Orchestrator for guided feature implementation (originally `/implement`)
  - Interactive workflow for planning, research, and execution
  - Integrates with project-state agent for context gathering
  - Guides through research, design, implementation, and testing phases
  - Prevents blind coding by requiring user approval at each stage

#### Command→Agent→Skill Architecture
- **Dual-mode pattern** - Commands for explicit invocation, skills for auto-activation
  - Commands: `/research`, `/debug` for explicit user requests
  - Skills: Auto-activated versions when conversation context matches
  - Clear separation of concerns and activation modes
  - Documented pattern for extending DevFlow functionality

#### Enhanced /devlog Command
- **Orchestrator pattern** - Refactored to use project-state agent
  - Delegates project analysis to specialized agent
  - Cleaner separation of orchestration vs analysis logic
  - More maintainable and extensible architecture
  - Comprehensive session documentation with context gathering

### Changed
- **Skills-first approach** - research and debug migrated to dual-mode (command + skill)
  - Commands remain for explicit invocation
  - Skills provide automatic activation based on context
  - No loss of functionality, enhanced discoverability

### Fixed
- **Security vulnerability** - Added input validation for execSync to prevent command injection
  - Validates all user input before shell execution
  - Proper escaping and sanitization
  - Security hardening in CLI commands

- **Uninstall bug** - Fixed cleanup issue and refactored CLI to namespace pattern
  - Proper cleanup of all installed assets
  - Consistent namespace pattern across CLI
  - Improved error handling and user feedback

### Documentation
- **Comprehensive skills guide** - Added to README and CLAUDE.md
  - Detailed explanation of skills infrastructure
  - How to create new skills
  - When to use skills vs commands
  - Auto-activation patterns and best practices

- **Development guide updates** - Enhanced CLAUDE.md for contributors
  - Skills development patterns
  - Command→Agent→Skill architecture explanation
  - Testing guidelines for dual-mode functionality

- **Documentation gap fixes** - Addressed critical gaps from code review
  - Improved clarity and completeness
  - Fixed missing examples and use cases
  - Better organization and navigation

---

## [0.3.3] - 2025-10-19

### Fixed
- **Statusline path resolution** - Use absolute paths instead of tilde (~) for reliable execution
- **Audit report organization** - Formalized structured storage for all review reports
  - Branch-specific directories: `.docs/reviews/<branch-name>/`
  - Timestamped reports for historical tracking
  - Standardized naming: `<review-type>-report.<timestamp>.md`
  - Standalone directory for direct agent invocations
  - Applied consistently across all 9 review agents

### Added
- **Release notes persistence** - Save comprehensive release notes to `.docs/releases/RELEASE_NOTES_v<version>.md`
- **Documentation verification** - Release agent now verifies documentation alignment
  - Checks version references across ROADMAP, READMEs, CHANGELOG
  - Detects monorepo subpackages
  - Provides search-and-replace commands for fixing mismatches
- **Production build standards** - Global CLAUDE.md guidelines for production optimization
  - Never ship test files, debug symbols, or sourcemaps
  - Separate dev/prod build configurations
- **Test suite safety** - Sequential test execution standards to prevent Claude Code crashes
  - Memory limits and resource cleanup requirements
  - Framework-specific configuration flags

---

## [0.3.2] - 2025-10-17

### Changed
- **Simplified init command output** - Reduced installation output from ~60-80 lines to ~10-15 lines
- **Unified review commands** - Consolidated /pre-commit and /pre-pr into single /code-review command
- **Streamlined statusline** - Removed cost/API metrics, added CPU/memory monitoring (28% code reduction)

### Improved
- Replaced /catch-up suggestion with comprehensive commands reference for better initial UX

---

## [0.3.1] - 2025-10-17

### Fixed
- **catch-up agent crashes** - Prevent Claude Code session crashes from expensive operations
  - Replaced full-project filesystem scans with surgical `git diff --name-only HEAD~1`
  - Removed automatic test suite execution (prevents timeout crashes)
  - Removed automatic build execution (prevents resource exhaustion)
  - Scoped TODO/FIXME search to recently modified files only (git-based)
  - Maintains user-preferred 5 status document limit
  - Cleaner code with reduced safety comment overhead
  - Critical fix for large codebases that caused Claude Code to hang/crash

## [0.3.0] - 2025-10-16

### Added

#### Language-Agnostic Global CLAUDE.md
- **Global engineering principles** - Universal CLAUDE.md works across all programming languages
  - Strips language-specific syntax, focuses on concepts (Result types, DI, immutability, pure functions)
  - Critical anti-patterns enforcement (NO FAKE SOLUTIONS, FAIL HONESTLY, BE TRANSPARENT)
  - Code quality enforcement (root cause analysis over workarounds)
  - Architecture documentation standards (document patterns, boundaries, exceptions)
  - Type safety best practices, security requirements, naming conventions
  - Structured as ~330 lines of precise, non-bloated global instructions

#### Smart CLAUDE.md Installation
- **Intelligent mounting logic** - Preserves user's existing global configuration
  - Fresh install: Directly installs CLAUDE.md (no conflicts)
  - Existing CLAUDE.md: Preserves user file, creates CLAUDE.devflow.md with merge instructions
  - `--force` flag: Prompts for confirmation, backs up to .backup before override
  - `-y` flag: Auto-approves prompts for automation/CI/CD workflows
  - Parallel implementation to settings.json (consistent UX across installations)
  - Never overwrites without explicit permission

#### TypeScript Auditor Sub-Agent
- **review-typescript** - Specialized TypeScript code quality and type safety auditor
  - Conditional execution: Runs only if .ts/.tsx files changed OR tsconfig.json exists
  - Built-in detection logic (gracefully skips non-TypeScript projects)
  - Comprehensive reviews: type safety config, `any` usage, type assertions, branded types
  - Advanced patterns: discriminated unions, immutability, Result types
  - Code quality: naming conventions, dependency injection, pure functions
  - Severity-based reporting (CRITICAL/HIGH/MEDIUM/LOW) with file:line references
  - Integrated into `/pre-commit` and `/pre-pr` workflows

#### Release Automation Workflow
- **`/release` command** - Project-agnostic release automation for professional releases
  - Multi-step interactive workflow with user confirmations
  - Preview changes before committing, pushing, or publishing
  - Clear rollback instructions if any step fails
  - Comprehensive final summary with verification links

- **release sub-agent** - Specialized agent for safe, automated release management
  - Universal project detection (10+ ecosystems supported)
  - Intelligent version bumping based on conventional commit analysis
  - Auto-generated changelogs from git history
  - Built-in safety checks (clean directory, builds, tests)
  - Platform integration (creates GitHub/GitLab releases via gh/glab)

#### Supported Release Ecosystems
- Node.js (package.json + npm)
- Rust (Cargo.toml + cargo)
- Python (pyproject.toml/setup.py + pip/twine)
- Go (go.mod + git tags)
- Ruby (gemspec + gem)
- PHP (composer.json + composer)
- Java/Maven (pom.xml + mvn)
- Java/Gradle (build.gradle + gradle)
- Swift (Package.swift + git tags)
- Generic (VERSION file + git tags)

#### Release Workflow Steps
1. Detect project type and configuration
2. Verify clean working directory
3. Analyze commits since last release
4. Generate changelog entry from commit history
5. Update version files (automatic detection)
6. Build and test project
7. Preview changes and await user confirmation
8. Commit version bump
9. Push to remote repository
10. Publish to package registry (npm, crates.io, PyPI, etc.)
11. Create annotated git tag
12. Create platform release (GitHub/GitLab)
13. Provide verification links and next steps

### Changed
- **Pre-commit workflow** - Integrated review-typescript into 5-agent review
  - Conditionally executes for TypeScript projects
  - No manual configuration needed
- **Pre-PR workflow** - Integrated review-typescript into comprehensive review
  - Automatic TypeScript detection and execution
  - Preserves existing review orchestration patterns

### Documentation
- Added `/release` command to README commands table
- Added `release` sub-agent to README sub-agents table
- Added `review-typescript` sub-agent to README sub-agents table
- Created "Creating a Release" workflow section in README
- Documented smart CLAUDE.md installation behavior
- Included release automation in integration examples


## [0.2.0] - 2025-10-16

### Added
- **review-documentation sub-agent** - Ensures documentation stays aligned with code
  - Validates README accuracy (installation, usage, examples)
  - Checks API documentation matches actual function signatures
  - Detects stale code comments and commented-out code
  - Verifies code examples actually work
  - Language-agnostic documentation pattern detection
  - Severity-based reporting (CRITICAL/HIGH/MEDIUM/LOW)
- **Smart settings.json management** - 3-tier backup strategy prevents data loss
  - First install: Direct installation
  - Existing settings: Backup to managed-settings.json
  - Both exist: Save as settings.devflow.json with clear instructions
  - User maintains control of their configuration
- **Surgical test execution** - Prevents Claude Code session crashes
  - Static analysis by default (80% value, 0% crash risk)
  - Smart test selection based on git changes
  - Individual test file execution with 30s timeouts
  - Max 10 test files per run with resource limits
  - Early termination on repeated error patterns
- **Language-agnostic agents** - Works with any programming language
  - Auto-detection for 9+ package managers
  - Universal ORM and database patterns
  - Smart test command detection from manifests
  - Generic file search patterns for all ecosystems

### Changed
- **Pre-commit strategy** - Lightweight 5-agent review for fast feedback
  - Core reviews: Security, Performance, Architecture, Tests, Complexity
  - Typical execution: 30-60 seconds
  - Additional reviews available on explicit request
- **Pre-pr strategy** - Comprehensive 7-8 agent review
  - All core reviews plus Dependencies and Documentation
  - Conditional Database review (only if DB files changed)
  - Typical execution: 2-3 minutes
  - Thorough branch review before PR creation
- **Path handling** - No longer assumes HOME environment variable
  - Uses Node.js homedir() as fallback
  - Environment variable overrides: CLAUDE_CODE_DIR, DEVFLOW_DIR
  - Cross-platform compatibility improvements

### Fixed
- **Git lock file conflicts** - Wait-based prevention instead of deletion
  - Implemented wait_for_lock_release() with 10s timeout
  - Explicit wait commands after each git operation
  - Command substitution patterns for synchronous execution
  - Prevents zombie process lock file issues
  - No more `.git/index.lock` errors
- **Settings overwrite issue** - User settings preserved with backup strategy
- **Hardcoded path assumptions** - Proper fallbacks and environment overrides

### Documentation
- Added review-documentation to sub-agents table in README
- Clarified review strategies for pre-commit vs pre-pr
- Updated workflow examples with refined command usage

## [0.1.2] - 2025-10-05

### Added
- `/research [topic]` - Comprehensive pre-implementation research and planning command
- `research` sub-agent - Specialized agent for systematic implementation research with 10-step workflow
  - Analyzes multiple implementation approaches with pros/cons/trade-offs
  - Studies official documentation and code examples
  - Reviews existing codebase patterns and conventions
  - Designs integration strategy with specific file paths
  - Identifies risks and creates actionable implementation plans
  - Saves research reports to `.docs/research/`

### Documentation
- Updated README.md with `/research` command in workflow examples
- Added research sub-agent to sub-agents table

## [0.1.1] - 2025-10-03

### Changed
- **Simplified Installation**: Single command installation using `npx devflow-kit init` (no global install needed)
- **Improved Documentation**: Commands and sub-agents now displayed in easy-to-scan tables
- **Better Organization**: Separated user documentation (README.md) from developer guide (CLAUDE.md)
- **Reduced Duplication**: Eliminated redundant information throughout README

### Documentation
- Reorganized README.md with table-based layout for commands and sub-agents
- Moved developer/AI agent instructions to CLAUDE.md
- Updated installation to promote npx usage over global install
- Reduced README from 289 lines to 204 lines while preserving all information

## [0.1.0] - 2024-10-03

### 🎉 Initial Release

DevFlow is an Agentic Development Toolkit designed to enhance Claude Code with intelligent commands and workflows for AI-assisted development.

### Added

#### Core Commands
- `/catch-up` - Smart summaries for starting new sessions with status validation
- `/devlog` - Development log for comprehensive session documentation (formerly note-to-future-self)
- `/plan-next-steps` - Extract actionable next steps from current discussion
- `/pre-commit` - Review uncommitted changes using specialized sub-agents
- `/pre-pr` - Comprehensive branch review for PR readiness assessment
- `/commit` - Intelligent atomic commit creation with safety checks
- `/debug [issue]` - Systematic debugging with issue-specific investigation

#### Sub-Agents (Audit Specialists)
- `review-security` - Security vulnerability detection and analysis
- `review-performance` - Performance optimization and bottleneck detection
- `review-architecture` - Software architecture and design pattern analysis
- `review-tests` - Test quality and coverage analysis
- `review-dependencies` - Dependency management and security analysis
- `review-complexity` - Code complexity and maintainability assessment
- `review-database` - Database design and optimization review

#### Workflow Sub-Agents
- `catch-up` - Project status and context restoration with validation
- `commit` - Intelligent commit creation with safety checks

#### Features
- **Smart Statusline** - Real-time project context display with git status and cost tracking
- **Security & Optimization** - Automatic `.claudeignore` file creation for token efficiency
- **Parallel Sub-Agent Execution** - Run multiple reviews simultaneously for better performance
- **Git Safety** - Sequential git operations to prevent lock file conflicts
- **Structured Documentation** - Organized tracking in `.docs/` directory

### Technical Details
- Built with TypeScript and Commander.js
- Supports Claude Code on macOS, Linux, and Windows
- Requires Node.js 18.0.0 or higher
- Modular architecture with isolated sub-agents

### Installation
```bash
npm install -g devflow-kit
devflow init
```

### Documentation
- Comprehensive guide in README.md
- Quick reference in README.md
- Self-documenting commands

---

[1.0.0]: https://github.com/dean0x/devflow/compare/v0.9.0...v1.0.0
[0.9.0]: https://github.com/dean0x/devflow/releases/tag/v0.9.0
[0.8.1]: https://github.com/dean0x/devflow/releases/tag/v0.8.1
[0.8.0]: https://github.com/dean0x/devflow/releases/tag/v0.8.0
[0.7.0]: https://github.com/dean0x/devflow/releases/tag/v0.7.0
[0.6.1]: https://github.com/dean0x/devflow/releases/tag/v0.6.1
[0.6.0]: https://github.com/dean0x/devflow/releases/tag/v0.6.0
[0.5.0]: https://github.com/dean0x/devflow/releases/tag/v0.5.0
[0.4.0]: https://github.com/dean0x/devflow/releases/tag/v0.4.0
[0.3.3]: https://github.com/dean0x/devflow/releases/tag/v0.3.3
[0.3.2]: https://github.com/dean0x/devflow/releases/tag/v0.3.2
[0.3.1]: https://github.com/dean0x/devflow/releases/tag/v0.3.1
[0.3.0]: https://github.com/dean0x/devflow/releases/tag/v0.3.0
[0.2.0]: https://github.com/dean0x/devflow/releases/tag/v0.2.0
[0.1.2]: https://github.com/dean0x/devflow/releases/tag/v0.1.2
[0.1.1]: https://github.com/dean0x/devflow/releases/tag/v0.1.1
[0.1.0]: https://github.com/dean0x/devflow/releases/tag/v0.1.0
