# DevFlow Development Guide

This document contains instructions for developers and AI agents working on the DevFlow codebase. For user documentation, see README.md.

## Purpose for AI Agents

When working on DevFlow code, understand that this toolkit is designed to enhance Claude Code with intelligent development workflows. Your modifications should:

- Maintain brutal honesty in audit outputs
- Preserve context across sessions
- Enhance developer empowerment without replacing judgment
- Ensure all commands are self-documenting

## Architecture Overview

DevFlow consists of three main components:

1. **CLI Tool** (`src/cli/`) - TypeScript-based installer and manager
2. **Claude Code Commands** (`src/claude/commands/`) - Markdown-based slash commands
3. **Sub-Agents** (`src/claude/agents/`) - Specialized AI assistants for focused tasks

## Development Environment

### Working on DevFlow

**CRITICAL**: This toolkit is designed for live development. When modifying DevFlow:

1. **Immediately Available** - Changes should be testable in global Claude Code configuration
2. **Instantly Testable** - Work in the devflow repo, test in global context
3. **Continuously Improved** - Dogfood your own tools

### Development Loop

```bash
# 1. Modify command or agent in devflow repo
vim devflow/src/claude/commands/devflow/pre-commit.md

# 2. Rebuild if CLI changes
npm run build

# 3. Reinstall to global context for testing
node dist/cli.js init

# 4. Test immediately
/pre-commit

# 5. Iterate until satisfied
# 6. Commit using /commit
```

## Command Design Principles

When creating or modifying commands, follow these principles:

### 1. Brutal Honesty
Commands should expose the truth, not what developers want to hear:
- Security audits find real vulnerabilities
- Performance audits reveal actual bottlenecks
- Architecture audits expose design flaws
- Agent reviews catch AI deception

### 2. Actionable Output
Every audit provides:
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
- Audits err on the side of flagging issues
- Status tracking captures comprehensive context
- Agent reviews assume skepticism

## Adding New Commands

### Command Structure

1. Create command in `src/claude/commands/devflow/new-command.md`
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

1. Create agent in `src/claude/agents/devflow/new-agent.md`
2. Follow existing agent patterns:
   - Clear specialty definition
   - Restricted tool access
   - Focused analysis scope
   - Specific output format

3. Test with explicit invocation
4. Document in README.md for users

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

### Publishing Updates

```bash
# Update version in package.json
npm version patch|minor|major

# Build and publish
npm run build
npm publish

# Tag release
git tag v0.1.x
git push origin v0.1.x
```

## File Organization

### Source Structure
```
src/
├── cli/                      # CLI implementation
│   ├── commands/               # CLI command implementations
│   │   ├── init.ts              # Installation command
│   │   └── uninstall.ts         # Uninstallation command
│   └── cli.ts                  # CLI entry point
└── claude/                   # Claude Code assets
    ├── agents/devflow/         # Sub-agent definitions
    ├── commands/devflow/       # Slash command definitions
    ├── scripts/                # Supporting scripts
    └── settings.json           # Claude Code settings
```

### Installation Paths
- Commands: `~/.claude/commands/devflow/`
- Agents: `~/.claude/agents/devflow/`
- Scripts: `~/.devflow/scripts/`
- Settings: `~/.claude/settings.json`

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
2. Creating project-specific audit rules
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
1. Review and update audit patterns
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