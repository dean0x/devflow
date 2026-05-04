# devflow-explore

Codebase exploration plugin for Claude Code. Explores code areas with parallel agents for flow tracing, dependency mapping, and pattern analysis, with optional feature KB creation.

## Installation

```bash
# Via Devflow CLI
npx devflow-kit init --plugin=explore

# Via Claude Code (when available)
/plugin install dean0x/devflow-explore
```

## Prerequisites

Requires Agent Teams feature (for teams variant):
- Set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings (included in Devflow settings)
- Or install Devflow with `--override-settings` to enable automatically

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
5. **KB Creation** - Optionally create a feature KB to capture discovered patterns

### Teams Variant

The teams variant adds cross-validation between explorers:
1. **Team Spawning** - Creates named explorer agents (flow, dependency, pattern)
2. **Cross-Validation** - Explorers validate and extend each other's findings
3. **Convergence** - Findings categorized as validated, corrected, or unvalidated

## Components

### Command
- `/explore` - Codebase exploration with structured analysis

### Skills
- `agent-teams` - Team coordination patterns
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
- Building feature KBs for areas you've explored

## Related Plugins

- [devflow-debug](../devflow-debug) - Bug investigation with competing hypotheses
- [devflow-plan](../devflow-plan) - Design planning with gap analysis
- [devflow-implement](../devflow-implement) - Implementation with quality gates
