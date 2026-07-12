# devflow-explore

Codebase exploration plugin for Claude Code. Explores code areas with parallel agents for flow tracing, dependency mapping, and pattern analysis, with optional feature knowledge base creation.

## Installation

```bash
npx devflow-kit init --plugin=explore
```

## Usage

```
/explore "how does the auth system work"
/explore "trace the request lifecycle from API to database"
/explore "what patterns does the payments module use"
```

## How It Works

1. **Orient** - Skimmer identifies relevant files and module boundaries
2. **Explore** - 2-3 parallel agents trace flows, dependencies, and patterns
3. **Synthesize** - Findings merged and contradictions resolved
4. **Present** - Structured findings with file:line references and drill-down offer
5. **Knowledge Base Creation** - Optionally create a feature knowledge base to capture discovered patterns

## Components

### Command
- `/explore` - Codebase exploration with structured analysis

### Skills
- `worktree-support` - Git worktree path resolution
- `apply-feature-knowledge` - Feature knowledge base consumption
- `feature-knowledge` - Feature knowledge base creation

## Output

Produces structured exploration findings including:
- Architecture map with module boundaries
- Flow traces with file:line references
- Integration points and shared types
- Recurring patterns and conventions
- Key insights and non-obvious findings

## When to Use

- Understanding unfamiliar code areas
- Tracing request or data flows end-to-end
- Mapping module dependencies and integration points
- Discovering patterns and conventions in a subsystem
- Building feature knowledge bases for areas you've explored

## Related Plugins

- [devflow-debug](../devflow-debug) - Bug investigation with competing hypotheses
- [devflow-plan](../devflow-plan) - Design planning with gap analysis
- [devflow-implement](../devflow-implement) - Implementation with quality gates
