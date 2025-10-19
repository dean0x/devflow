# Changelog

All notable changes to DevFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.3] - 2025-10-19

### Fixed
- **Statusline path resolution** - Use absolute paths instead of tilde (~) for reliable execution
- **Audit report organization** - Formalized structured storage for all audit reports
  - Branch-specific directories: `.docs/audits/<branch-name>/`
  - Timestamped reports for historical tracking
  - Standardized naming: `<audit-type>-report.<timestamp>.md`
  - Standalone directory for direct agent invocations
  - Applied consistently across all 9 audit agents

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
- **audit-typescript** - Specialized TypeScript code quality and type safety auditor
  - Conditional execution: Runs only if .ts/.tsx files changed OR tsconfig.json exists
  - Built-in detection logic (gracefully skips non-TypeScript projects)
  - Comprehensive audits: type safety config, `any` usage, type assertions, branded types
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
- **Pre-commit workflow** - Integrated audit-typescript into 5-agent review
  - Conditionally executes for TypeScript projects
  - No manual configuration needed
- **Pre-PR workflow** - Integrated audit-typescript into comprehensive review
  - Automatic TypeScript detection and execution
  - Preserves existing audit orchestration patterns

### Documentation
- Added `/release` command to README commands table
- Added `release` sub-agent to README sub-agents table
- Added `audit-typescript` sub-agent to README sub-agents table
- Created "Creating a Release" workflow section in README
- Documented smart CLAUDE.md installation behavior
- Included release automation in integration examples


## [0.2.0] - 2025-10-16

### Added
- **audit-documentation sub-agent** - Ensures documentation stays aligned with code
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
  - Core audits: Security, Performance, Architecture, Tests, Complexity
  - Typical execution: 30-60 seconds
  - Additional audits available on explicit request
- **Pre-pr strategy** - Comprehensive 7-8 agent review
  - All core audits plus Dependencies and Documentation
  - Conditional Database audit (only if DB files changed)
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
- Added audit-documentation to sub-agents table in README
- Clarified audit strategies for pre-commit vs pre-pr
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
- `audit-security` - Security vulnerability detection and analysis
- `audit-performance` - Performance optimization and bottleneck detection
- `audit-architecture` - Software architecture and design pattern analysis
- `audit-tests` - Test quality and coverage analysis
- `audit-dependencies` - Dependency management and security analysis
- `audit-complexity` - Code complexity and maintainability assessment
- `audit-database` - Database design and optimization review

#### Workflow Sub-Agents
- `catch-up` - Project status and context restoration with validation
- `commit` - Intelligent commit creation with safety checks

#### Features
- **Smart Statusline** - Real-time project context display with git status and cost tracking
- **Security & Optimization** - Automatic `.claudeignore` file creation for token efficiency
- **Parallel Sub-Agent Execution** - Run multiple audits simultaneously for better performance
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

[0.3.3]: https://github.com/dean0x/devflow/releases/tag/v0.3.3
[0.3.2]: https://github.com/dean0x/devflow/releases/tag/v0.3.2
[0.3.1]: https://github.com/dean0x/devflow/releases/tag/v0.3.1
[0.3.0]: https://github.com/dean0x/devflow/releases/tag/v0.3.0
[0.2.0]: https://github.com/dean0x/devflow/releases/tag/v0.2.0
[0.1.2]: https://github.com/dean0x/devflow/releases/tag/v0.1.2
[0.1.1]: https://github.com/dean0x/devflow/releases/tag/v0.1.1
[0.1.0]: https://github.com/dean0x/devflow/releases/tag/v0.1.0
