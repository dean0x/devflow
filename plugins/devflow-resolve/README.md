# devflow-resolve

Review issue resolution plugin for Claude Code. Processes review findings, assesses risk, and implements fixes or defers to tech debt.

## Installation

```bash
# Via DevFlow CLI
npx devflow-kit init --plugin=resolve

# Via Claude Code (when available)
/plugin install dean0x/devflow-resolve
```

## Usage

```
/resolve                           # Resolve issues from latest review
/resolve .docs/reviews/feature-x/  # Resolve from specific review
```

## Workflow

1. **Load Issues** - Parse review reports for actionable items
2. **Validate** - Confirm issues are real and still present
3. **Risk Assessment** - Evaluate fix complexity and impact
4. **Decision** - FIX (low risk) or TECH_DEBT (high risk)
5. **Implementation** - Resolver agent implements fixes
6. **Simplification** - Simplifier refines the changes
7. **Tech Debt Tracking** - Git agent manages deferred items

## Risk Assessment Criteria

| Decision | Criteria |
|----------|----------|
| FIX | Localized change, low regression risk, clear solution |
| TECH_DEBT | Cross-cutting change, high complexity, needs design |

## Components

### Command
- `/resolve` - Process and fix review issues

### Agents
- `git` - GitHub operations (tech debt management)
- `resolver` - Validates and implements fixes
- `simplifier` - Code refinement after fixes

### Skills (5)
- `core-patterns` - Result types, DI
- `git-safety` - Safe git operations
- `commit` - Atomic commit patterns
- `implementation-patterns` - Implementation guidance
- `security-patterns` - Security fix patterns

## Output

- Fixed issues committed to branch
- Tech debt items tracked in GitHub
- Resolution summary with fix/defer breakdown

## Related Plugins

- [devflow-code-review](../devflow-code-review) - Generate review issues
- [devflow-implement](../devflow-implement) - Original implementation
