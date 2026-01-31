# devflow-implement

Complete task implementation workflow for Claude Code. Orchestrates exploration, planning, coding, validation, and PR creation through specialized agents.

## Installation

```bash
# Via DevFlow CLI
npx devflow-kit init --plugin=implement

# Via Claude Code (when available)
/plugin install dean0x/devflow-implement
```

## Usage

```
/implement <task-description>
/implement #123              # GitHub issue number
/implement <github-issue-url>
```

## Workflow

1. **Exploration** - Skimmer + Explore agents understand the codebase
2. **Planning** - Plan agents design implementation approach
3. **Implementation** - Coder agent implements on feature branch
4. **Validation** - Validator runs build/test/lint checks
5. **Self-Review** - Scrutinizer evaluates against 9-pillar framework
6. **Alignment Check** - Shepherd validates against original request
7. **Simplification** - Simplifier refines code clarity
8. **PR Creation** - Git agent creates pull request

## Components

### Command
- `/implement` - Execute complete task lifecycle

### Agents
- `git` - GitHub operations (setup, PR creation)
- `skimmer` - Codebase orientation
- `synthesizer` - Output synthesis
- `coder` - Autonomous implementation
- `simplifier` - Code refinement
- `scrutinizer` - Self-review (9-pillar framework)
- `shepherd` - Alignment validation
- `validator` - Build/test validation

### Skills (12)
- `core-patterns` - Result types, DI, immutability
- `git-safety` - Safe git operations
- `commit` - Atomic commit patterns
- `pull-request` - PR quality enforcement
- `implementation-patterns` - CRUD, API, events
- `codebase-navigation` - Pattern discovery
- `test-design` - Test quality
- `code-smell` - Anti-pattern detection
- `input-validation` - Boundary validation
- `self-review` - 9-pillar framework
- `typescript` - TypeScript patterns
- `react` - React patterns

## Output

- Feature branch with atomic commits
- Validated implementation (tests pass)
- Pull request with summary and test plan

## Related Plugins

- [devflow-specify](../devflow-specify) - Specify the task first
- [devflow-review](../devflow-review) - Review the implementation
- [devflow-resolve](../devflow-resolve) - Fix review issues
