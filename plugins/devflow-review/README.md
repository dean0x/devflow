# devflow-review

Comprehensive code review plugin for Claude Code. Runs parallel specialized review agents covering security, architecture, performance, and more.

## Installation

```bash
# Via DevFlow CLI
npx devflow-kit init --plugin=review

# Via Claude Code (when available)
/plugin install dean0x/devflow-review
```

## Usage

```
/review                    # Review current branch
/review <branch-name>      # Review specific branch
/review #123               # Review PR by number
```

## Review Focus Areas

The plugin spawns 7-11 parallel Reviewer agents, each with a specific focus:

| Focus | What It Checks |
|-------|----------------|
| security | Injection, auth, crypto, OWASP vulnerabilities |
| architecture | SOLID violations, coupling, layering |
| performance | Algorithms, N+1 queries, memory, I/O |
| complexity | Cyclomatic complexity, readability |
| consistency | Pattern violations, style drift |
| regression | Lost functionality, broken behavior |
| tests | Coverage gaps, brittle tests |
| database | Schema issues, slow queries |
| dependencies | CVEs, outdated packages |
| documentation | Doc drift, stale comments |

## Components

### Command
- `/review` - Comprehensive branch review

### Agents
- `git` - GitHub operations (PR comments)
- `reviewer` - Universal parameterized reviewer
- `synthesizer` - Combines review outputs

### Skills (11)
- `review-methodology` - 6-step review process
- `security-patterns` - Security vulnerabilities
- `architecture-patterns` - Design patterns
- `performance-patterns` - Performance issues
- `complexity-patterns` - Complexity metrics
- `consistency-patterns` - Pattern violations
- `regression-patterns` - Regression detection
- `tests-patterns` - Test quality
- `database-patterns` - Database issues
- `dependencies-patterns` - Dependency management
- `documentation-patterns` - Documentation quality

## Output

- Review summary in `.docs/reviews/{branch-slug}/`
- Individual reports per focus area
- Issues categorized as P0/P1/P2 with file:line references
- Actionable fixes for each issue

## Related Plugins

- [devflow-implement](../devflow-implement) - Implement features
- [devflow-resolve](../devflow-resolve) - Fix review issues
