---
name: explore:orch
description: Agent orchestration for EXPLORE intent — codebase analysis, flow tracing, architecture mapping
user-invocable: false
---

# Explore Orchestration

Agent pipeline for EXPLORE intent in ambient GUIDED and ORCHESTRATED modes. Codebase analysis, flow tracing, dependency mapping, and architecture understanding.

## Iron Law

> **EXPLORATION WITHOUT STRUCTURE IS JUST BROWSING**
>
> Every exploration must produce file:line references. Vague summaries like "the auth
> system is complex" are failures. Every claim must point to concrete code locations,
> real call chains, and actual file paths. If you can't cite it, you don't know it.

---

## GUIDED Behavior

For GUIDED depth, the main session performs exploration directly:

1. **Spawn Skimmer** — `Agent(subagent_type="Skimmer")` targeting the area of interest. Use orientation output to ground exploration in real file structures and patterns.
2. **Trace** — Using Skimmer findings, trace the flow or analyze the subsystem directly in main session. Follow call chains, read key files, map integration points.
3. **Present** — Deliver structured findings using the Output format below. Use AskUserQuestion to offer drill-down into specific areas.

## ORCHESTRATED Pipeline

### Phase 1: Orient

Spawn `Agent(subagent_type="Skimmer")` to get codebase overview relevant to the exploration question:

- File structure and module boundaries in the target area
- Entry points and key abstractions
- Related patterns and conventions

### Phase 2: Explore

Based on Skimmer findings, spawn 2-3 `Agent(subagent_type="Explore")` agents **in a single message** (parallel execution):

- **Flow explorer**: Trace the primary call chain end-to-end — entry point through to side effects
- **Dependency explorer**: Map imports, shared types, module boundaries, and integration points
- **Pattern explorer**: Identify recurring patterns, conventions, and architectural decisions in the area

Adjust explorer focus based on the specific exploration question.

### Phase 3: Synthesize

Spawn `Agent(subagent_type="Synthesizer")` in `exploration` mode with combined findings:

- Merge overlapping discoveries from parallel explorers
- Resolve any contradictions between explorer findings
- Organize into the Output format below

### Phase 4: Present

Main session reviews synthesis for:

- **Gaps**: Areas the explorers missed or couldn't reach
- **Surprises**: Unexpected patterns, hidden dependencies, non-obvious design choices
- **Depth**: Areas where the user might want to drill deeper

Present findings to user. Use AskUserQuestion to offer focused follow-up exploration.

## Worktree Support

If the orchestrator receives a `WORKTREE_PATH` context (e.g., from multi-worktree workflows), pass it through to all spawned agents. Each agent's "Worktree Support" section handles path resolution.

## Output

Structured exploration findings with concrete code references:

- Scope (what was explored and boundaries)
- Architecture Map (modules, layers, key abstractions with file:line)
- Flow Trace (call chain from entry to exit with file:line at each step)
- Integration Points (module boundaries, shared types, external dependencies)
- Patterns (recurring conventions, design decisions observed)
- Key Insights (non-obvious findings, surprises, potential concerns)
