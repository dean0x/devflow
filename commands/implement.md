---
description: Execute a single task through the complete lifecycle - orchestrates exploration, planning, implementation, and simplification with parallel agents
---

# Implement Command

Orchestrate a single task from exploration through implementation by spawning specialized agents. The orchestrator only spawns agents and passes context - all work is done by agents.

## Usage

```
/implement <task description>
/implement #42  (GitHub issue number)
/implement      (use conversation context)
```

## Input

`$ARGUMENTS` contains whatever follows `/implement`:
- Task description: "implement JWT auth"
- GitHub issue: "#42"
- Empty: use conversation context

## Phases

### Phase 1: Setup

Create worktree at `.worktrees/{task-id}` branching from current branch.

If input is a GitHub issue number, spawn Git agent:

```
Task(subagent_type="Git"):
"OPERATION: fetch-issue
ISSUE_INPUT: {issue number}
Return: title, description, acceptance criteria, labels"
```

### Phase 1.5: Orient

Spawn Skimmer agent for codebase overview:

```
Task(subagent_type="Skimmer"):
"Orient in codebase for: {task description}
Working directory: {worktree}
Use skim to identify relevant files, functions, integration points"
```

### Phase 2: Explore (Parallel)

Spawn 4 Explore agents **in a single message**, each with worktree path and Skimmer context:

| Focus | Thoroughness | Find |
|-------|-------------|------|
| Architecture | medium | Similar implementations, patterns, module structure |
| Integration | medium | Entry points, services, database models, configuration |
| Reusable code | medium | Utilities, helpers, validation patterns, error handling |
| Edge cases | quick | Error scenarios, race conditions, permission failures |

Track success/failure of each explorer for synthesis context.

### Phase 3: Synthesize Exploration

**WAIT** for Phase 2, then spawn Synthesizer:

```
Task(subagent_type="Synthesizer"):
"Synthesize EXPLORATION outputs for: {task}
Mode: exploration
Explorer outputs: {all 4 outputs}
Failed explorations: {any failures}
Combine into: patterns, integration points, reusable code, edge cases"
```

### Phase 4: Plan (Parallel)

Spawn 3 Plan agents **in a single message**, each with exploration synthesis:

| Focus | Output |
|-------|--------|
| Implementation steps | Ordered steps with files and dependencies |
| Testing strategy | Unit tests, integration tests, edge case tests |
| Parallelization | PARALLELIZABLE vs SEQUENTIAL work units |

### Phase 5: Synthesize Planning

**WAIT** for Phase 4, then spawn Synthesizer:

```
Task(subagent_type="Synthesizer"):
"Synthesize PLANNING outputs for: {task}
Mode: planning
Planner outputs: {all 3 outputs}
Combine into: execution plan with parallel/sequential decision"
```

### Phase 6: Implement

Based on synthesis, spawn Coder agent(s):

- **PARALLEL** (independent components): Multiple Coders in single message, each with `CREATE_PR: false`
- **SEQUENTIAL** (dependent work): Single Coder with full execution plan, `CREATE_PR: true`

Each Coder receives: task description, task-id, worktree path, target branch, steps/plan.

### Phase 7: Simplify

After Coder completes, spawn Simplifier:

```
Task(subagent_type="Simplifier"):
"Simplify recently implemented code in: {worktree}
Task: {task description}
Focus on code modified by Coder, apply project standards, enhance clarity"
```

### Phase 8: Create PR

If multiple Coders were used, create unified PR using `devflow-pull-request` skill patterns. Push branch and run `gh pr create` with comprehensive description.

### Phase 9: Report

Display completion summary with phase status, PR info, and next steps.

## Architecture

```
/implement (orchestrator - spawns agents only)
│
├─ Phase 1: Setup
│  └─ Git agent (operation: fetch-issue) - if issue number
│
├─ Phase 1.5: Orient
│  └─ Skimmer agent (codebase overview via skim)
│
├─ Phase 2: Explore (PARALLEL, with Skimmer context)
│  ├─ Explore: Architecture
│  ├─ Explore: Integration
│  ├─ Explore: Reusable code
│  └─ Explore: Edge cases
│
├─ Phase 3: Synthesize Exploration
│  └─ Synthesizer agent (mode: exploration)
│
├─ Phase 4: Plan (PARALLEL)
│  ├─ Plan: Implementation steps
│  ├─ Plan: Testing strategy
│  └─ Plan: Parallelization
│
├─ Phase 5: Synthesize Planning
│  └─ Synthesizer agent (mode: planning)
│
├─ Phase 6: Implement
│  └─ 1-N Coder agents (parallel if beneficial)
│  └─ Each Coder runs self-review via Stop hook (9 pillars)
│
├─ Phase 7: Simplify
│  └─ Simplifier agent (refines code clarity and consistency)
│
├─ Phase 8: Create PR (if parallel coders)
│  └─ Apply devflow-pull-request patterns
│
└─ Phase 9: Display agent outputs
```

## Principles

1. **Orchestration only** - Command spawns agents, never does work itself
2. **Parallel by default** - Explore, plan in parallel; sequential phases wait
3. **Agent ownership** - Each agent owns its output completely
4. **Clean handoffs** - Each phase passes structured data to next
5. **Honest reporting** - Display agent outputs directly
6. **Simplification pass** - Code refined for clarity before PR

## Error Handling

If any agent fails, report the phase, agent type, and error. Offer options: retry phase, investigate systematically, or escalate to user.

## Cleanup

After task complete, remove worktree with `git worktree remove --force` and prune.
