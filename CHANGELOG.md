# Changelog

All notable changes to DevFlow will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Comprehensive guide in CLAUDE.md
- Quick reference in README.md
- Self-documenting commands

---

[0.1.0]: https://github.com/dean0x/devflow/releases/tag/v0.1.0