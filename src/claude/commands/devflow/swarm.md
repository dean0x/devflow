---
description: Orchestrate parallel task implementation using git worktrees
---

Execute multiple tasks in parallel using isolated git worktrees.

## Usage

```
/swarm task1, task2, task3
```

Or:
```
/swarm
- Implement user authentication
- Add rate limiting
- Refactor database pooling
```

---

## Your Task

Invoke the `SwarmOrchestrator` agent:

```
Task(subagent_type="SwarmOrchestrator"):

"Orchestrate parallel task implementation for:

${TASKS_FROM_ARGUMENTS}

Execute the full swarm workflow:
1. SETUP - Create release branch and worktrees
2. EXPLORE - Launch parallel Explore agents for all tasks
3. PLAN - Launch parallel Plan agents after exploration
4. ANALYZE - Build dependency matrix, identify conflicts, propose merge order
5. [CHECKPOINT] - Present analysis, get user approval before implementing
6. IMPLEMENT - Launch Coder agents (parallel where safe, sequential for dependencies)
7. REVIEW - Launch CodeReview agents for each PR
8. MERGE - Merge PRs in dependency order to release branch
9. RELEASE - Create final PR from release branch to main
10. CLEANUP - Remove worktrees, archive state

Key requirements:
- Parallelize aggressively (Explore all, Plan all, Review all)
- Sequence when needed (implement dependent tasks after dependencies)
- User checkpoint after analysis, before implementing
- Track all state in .docs/swarm/state.json
- Create per-task PRs targeting release branch
- Final release PR aggregates all changes

Report back with:
- Tasks completed
- PRs created and merged
- Release PR number
- Any issues encountered"
```

If no arguments provided, ask user to list tasks to implement.
