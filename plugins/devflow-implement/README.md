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
5. **Simplification** - Simplifier refines code clarity
6. **Self-Review** - Scrutinizer evaluates against 9-pillar framework
7. **Alignment Check** - Evaluator validates against original request
8. **QA Testing** - Tester executes scenario-based acceptance tests
9. **PR Creation** - Git agent creates pull request

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
- `evaluator` - Alignment validation
- `tester` - Scenario-based QA testing
- `validator` - Build/test validation

### Skills (6)
- `agent-teams` - Agent Teams orchestration patterns
- `patterns` - CRUD, API, events
- `knowledge-persistence` - Architectural decision recording
- `qa` - Scenario-based acceptance testing
- `self-review` - 9-pillar framework
- `worktree-support` - Worktree-aware path resolution

## Output

- Feature branch with atomic commits
- Validated implementation (tests pass)
- Pull request with summary and test plan

## Related Plugins

- [devflow-specify](../devflow-specify) - Specify the task first
- [devflow-code-review](../devflow-code-review) - Review the implementation
- [devflow-resolve](../devflow-resolve) - Fix review issues
