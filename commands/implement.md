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

Record the current branch name as `BASE_BRANCH` - this will be the PR target.

Generate a unique `TASK_ID`: `task-{YYYY-MM-DD_HHMM}` (e.g., `task-2025-01-15_1430`).

Spawn Git agent to set up task environment:

```
Task(subagent_type="Git"):
"OPERATION: setup-task
TASK_ID: {task-id}
BASE_BRANCH: {current branch name}
ISSUE_INPUT: {issue number if provided, otherwise omit}
Create feature branch and fetch issue if specified.
Return the branch setup summary."
```

**Capture from Git agent output** (used throughout flow):
- `BASE_BRANCH`: Branch this feature was created from (for PR target)
- `ISSUE_NUMBER`: GitHub issue number (if provided)
- `ISSUE_CONTENT`: Full issue body including description (if provided)
- `ACCEPTANCE_CRITERIA`: Extracted acceptance criteria from issue (if provided)

### Phase 1.5: Orient

Spawn Skimmer agent for codebase overview:

```
Task(subagent_type="Skimmer"):
"Orient in codebase for: {task description}
Use skim to identify relevant files, functions, integration points"
```

### Phase 2: Explore (Parallel)

Spawn 4 Explore agents **in a single message**, each with Skimmer context:

| Focus | Thoroughness | Find |
|-------|-------------|------|
| Architecture | medium | Similar implementations, patterns, module structure |
| Integration | medium | Entry points, services, database models, configuration |
| Reusable code | medium | Utilities, helpers, validation patterns, error handling |
| Edge cases | quick | Error scenarios, race conditions, permission failures |

Track success/failure of each explorer for synthesis context.

### Phase 3: Synthesize Exploration

**WAIT** for Phase 2 to complete.

**CRITICAL**: Do NOT synthesize outputs yourself in the main session.
You MUST spawn the Synthesizer agent - "spawn Synthesizer" means delegate to the agent, not do the work yourself.

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

**WAIT** for Phase 4 to complete.

**CRITICAL**: Do NOT synthesize outputs yourself in the main session.
You MUST spawn the Synthesizer agent - "spawn Synthesizer" means delegate to the agent, not do the work yourself.

```
Task(subagent_type="Synthesizer"):
"Synthesize PLANNING outputs for: {task}
Mode: planning
Planner outputs: {all 3 outputs}
Combine into: execution plan with parallel/sequential decision"
```

### Phase 6: Implement

Based on Phase 5 synthesis (which includes the Parallelization planner's decision):

**Decision criteria** (from Parallelization planner):
- **PARALLELIZABLE**: Work units have no shared state, different files/modules, can run independently
- **SEQUENTIAL**: Work units have dependencies, shared state, or must execute in order

**Spawning pattern**:
- **PARALLEL**: Multiple Coders in single message, each with subset of steps, `CREATE_PR: false`
- **SEQUENTIAL**: Single Coder with full execution plan, `CREATE_PR: true`

Each Coder receives: task description, task-id, BASE_BRANCH, steps/plan.

### Phase 7: Simplify

After Coder completes, spawn Simplifier to polish the code:

```
Task(subagent_type="Simplifier"):
"Simplify recently implemented code
Task: {task description}
FILES_CHANGED: {list of files from Coder output}
Focus on code modified by Coder, apply project standards, enhance clarity"
```

### Phase 8: Self-Review

After Simplifier completes, spawn Scrutinizer as final quality gate:

```
Task(subagent_type="Scrutinizer"):
"TASK_DESCRIPTION: {task description}
FILES_CHANGED: {list of files from Coder output}
Evaluate 9 pillars, fix P0/P1 issues, report status"
```

If Scrutinizer returns BLOCKED, report to user and halt.

### Phase 9: Alignment Check

After Scrutinizer passes, spawn Shepherd to validate alignment:

```
Task(subagent_type="Shepherd"):
"ORIGINAL_REQUEST: {task description or issue content}
EXECUTION_PLAN: {synthesized plan from Phase 5}
FILES_CHANGED: {list of files from Coder output}
ACCEPTANCE_CRITERIA: {extracted criteria if available}
Validate alignment, fix misalignments, report status"
```

If Shepherd returns BLOCKED, report to user for decision.

### Phase 10: Create PR

If multiple Coders were used, create unified PR using `devflow-pull-request` skill patterns. Push branch and run `gh pr create` with comprehensive description, targeting `BASE_BRANCH`.

### Phase 11: Report

Display completion summary with phase status, PR info, and next steps.

## Architecture

```
/implement (orchestrator - spawns agents only)
│
├─ Phase 1: Setup
│  └─ Git agent (operation: setup-task) - creates feature branch, fetches issue
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
│
├─ Phase 7: Simplify
│  └─ Simplifier agent (refines code clarity and consistency)
│
├─ Phase 8: Self-Review
│  └─ Scrutinizer agent (final quality gate, fixes P0/P1)
│
├─ Phase 9: Alignment Check
│  └─ Shepherd agent (validates alignment with request/plan)
│
├─ Phase 10: Create PR (if parallel coders)
│  └─ Apply devflow-pull-request patterns, target BASE_BRANCH
│
└─ Phase 11: Display agent outputs
```

## Principles

1. **Orchestration only** - Command spawns agents, never does work itself
2. **Parallel by default** - Explore, plan in parallel; sequential phases wait
3. **Agent ownership** - Each agent owns its output completely
4. **Clean handoffs** - Each phase passes structured data to next
5. **Honest reporting** - Display agent outputs directly
6. **Simplification pass** - Code refined for clarity before PR
7. **Strict delegation** - Never perform agent work in main session. "Spawn X" means call Task tool with X, not do X's work yourself

## Error Handling

If any agent fails, report the phase, agent type, and error. Offer options: retry phase, investigate systematically, or escalate to user.
