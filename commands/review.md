---
description: Comprehensive branch review using specialized sub-agents for PR readiness
---

# Review Command

Run a comprehensive code review of the current branch by spawning parallel review agents, then synthesizing results into PR comments.

## Usage

```
/review           (review current branch)
/review #42       (review specific PR)
```

## Pre-Flight Checks

Before spawning review agents, ensure:
1. On a feature branch (not main/master)
2. Has commits ahead of base branch
3. Uncommitted changes → apply `devflow-commit` patterns first
4. Branch pushed to remote
5. PR exists → if not, apply `devflow-pull-request` patterns

## Phases

### Phase 1: Analyze Changed Files

Detect file types in diff to determine conditional reviews:

| Condition | Adds Review |
|-----------|-------------|
| .ts/.tsx files | typescript |
| DB/migration files | database |
| Dependency files changed | dependencies |
| Docs or significant code | documentation |

### Phase 2: Run Reviews (Parallel)

Spawn Reviewer agents **in a single message**. Always run 7 core reviews; conditionally add up to 4 more:

| Focus | Always | Pattern Skill |
|-------|--------|---------------|
| security | ✓ | devflow-security-patterns |
| architecture | ✓ | devflow-architecture-patterns |
| performance | ✓ | devflow-performance-patterns |
| complexity | ✓ | devflow-complexity-patterns |
| consistency | ✓ | devflow-consistency-patterns |
| regression | ✓ | devflow-regression-patterns |
| tests | ✓ | devflow-tests-patterns |
| typescript | conditional | devflow-typescript |
| database | conditional | devflow-database-patterns |
| dependencies | conditional | devflow-dependencies-patterns |
| documentation | conditional | devflow-documentation-patterns |

Each Reviewer invocation:
```
Task(subagent_type="Reviewer"):
"Review focusing on {focus}. Apply devflow-{focus}-patterns.
Follow 6-step process from devflow-review-methodology.
PR: #{pr_number}, Base: {base_branch}
Output to: .docs/reviews/{branch-slug}/{focus}.md"
```

### Phase 3: Synthesis (Parallel)

**WAIT** for Phase 2, then spawn 3 agents **in a single message**:

**Git Agent (PR Comments)**:
```
Task(subagent_type="Git"):
"OPERATION: comment-pr
Read reviews from .docs/reviews/{branch-slug}/
Create inline PR comments, deduplicate, consolidate skipped into summary"
```

**Synthesizer Agent**:
```
Task(subagent_type="Synthesizer"):
"Mode: review
Aggregate findings, determine merge recommendation
Output: .docs/reviews/{branch-slug}/review-summary.{timestamp}.md"
```

### Phase 4: Report

Display results from all agents:
- Merge recommendation (from Synthesizer)
- Issue counts by category (🔴 blocking / ⚠️ should-fix / ℹ️ pre-existing)
- PR comments created/skipped (from Git)
- Artifact paths

## Architecture

```
/review (orchestrator - spawns agents only)
│
├─ Pre-flight: Ensure committed, pushed, PR exists
│
├─ Phase 1: Analyze changed files
│  └─ Detect file types for conditional reviews
│
├─ Phase 2: Reviews (PARALLEL)
│  ├─ Reviewer: security
│  ├─ Reviewer: architecture
│  ├─ Reviewer: performance
│  ├─ Reviewer: complexity
│  ├─ Reviewer: consistency
│  ├─ Reviewer: regression
│  ├─ Reviewer: tests
│  └─ Reviewer: [conditional: typescript, database, deps, docs]
│
├─ Phase 3: Synthesis (PARALLEL)
│  ├─ Git agent (comment-pr)
│  └─ Synthesizer agent (mode: review)
│
└─ Phase 4: Display results
```

## Principles

1. **Orchestration only** - Command spawns agents, doesn't review itself
2. **Parallel execution** - Reviews parallel, then synthesis agents parallel
3. **Clear ownership** - Each agent owns its output completely
4. **Full automation** - Handles commit/push/PR creation via skill patterns
5. **Honest reporting** - Display agent outputs directly
