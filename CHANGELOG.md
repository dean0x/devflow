# Changelog

All notable changes to DevFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/dean0x/devflow/releases/tag/v0.2.0
[0.1.2]: https://github.com/dean0x/devflow/releases/tag/v0.1.2
[0.1.1]: https://github.com/dean0x/devflow/releases/tag/v0.1.1
[0.1.0]: https://github.com/dean0x/devflow/releases/tag/v0.1.0