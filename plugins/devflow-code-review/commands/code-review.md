---
description: Comprehensive branch review using specialized sub-agents for PR readiness
---

# Code Review Command

Run a comprehensive code review of the current branch by spawning parallel review agents, then synthesizing results into PR comments.

## Usage

```
/code-review           (review current branch)
/code-review #42       (review specific PR)
```

## Phases

### Phase 0: Pre-Flight (Git Agent)

Spawn Git agent to validate and prepare branch:

```
Task(subagent_type="Git", run_in_background=false):
"OPERATION: ensure-pr-ready
Validate branch, commit if needed, push, create PR if needed.
Return: branch, base_branch, branch-slug, PR#"
```

**If BLOCKED:** Stop and report the blocker to user.

**Extract from response:** `branch`, `base_branch`, `branch_slug`, `pr_number` for use in subsequent phases.



### Phase 1: Analyze Changed Files

Detect file types in diff to determine conditional reviews:

| Condition | Adds Review |
|-----------|-------------|
| Any .ts or .tsx files | typescript |
| .tsx or .jsx files (React components) | react |
| .tsx or .jsx files (React components) | accessibility |
| .tsx/.jsx/.css/.scss files | frontend-design |
| .go files | go |
| .java files | java |
| .py files | python |
| .rs files | rust |
| DB/migration files | database |
| Dependency files changed | dependencies |
| Docs or significant code | documentation |

**Skill availability check**: Language/ecosystem reviews (typescript, react, accessibility, frontend-design, go, java, python, rust) require their optional skill plugin to be installed. Before spawning a conditional Reviewer for these focuses, use Read to check if `~/.claude/skills/{focus}/SKILL.md` exists. If Read returns an error (file not found), **skip that review** — the language plugin isn't installed. Non-language reviews (database, dependencies, documentation) use skills bundled with this plugin and are always available.

### Phase 2: Run Reviews (Parallel)

Spawn Reviewer agents **in a single message**. Always run 7 core reviews; conditionally add more based on changed file types:

| Focus | Always | Pattern Skill |
|-------|--------|---------------|
| security | ✓ | security-patterns |
| architecture | ✓ | architecture-patterns |
| performance | ✓ | performance-patterns |
| complexity | ✓ | complexity-patterns |
| consistency | ✓ | consistency-patterns |
| regression | ✓ | regression-patterns |
| tests | ✓ | test-patterns |
| typescript | conditional | typescript |
| react | conditional | react |
| accessibility | conditional | accessibility |
| frontend-design | conditional | frontend-design |
| go | conditional | go |
| java | conditional | java |
| python | conditional | python |
| rust | conditional | rust |
| database | conditional | database-patterns |
| dependencies | conditional | dependencies-patterns |
| documentation | conditional | documentation-patterns |

Each Reviewer invocation (all in one message, **NOT background**):
```
Task(subagent_type="Reviewer", run_in_background=false):
"Review focusing on {focus}. Apply {focus}-patterns.
Follow 6-step process from review-methodology.
PR: #{pr_number}, Base: {base_branch}
IMPORTANT: Write report to .docs/reviews/{branch-slug}/{focus}.md using Write tool"
```

### Phase 3: Synthesis (Parallel)

**WAIT** for Phase 2, then spawn 3 agents **in a single message**:

**Git Agent (PR Comments)**:
```
Task(subagent_type="Git", run_in_background=false):
"OPERATION: comment-pr
Read reviews from .docs/reviews/{branch-slug}/
Create inline PR comments, deduplicate, consolidate skipped into summary"
```

**Synthesizer Agent**:
```
Task(subagent_type="Synthesizer", run_in_background=false):
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
/code-review (orchestrator - spawns agents only)
│
├─ Phase 0: Pre-flight
│  └─ Git agent (ensure-pr-ready)
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
│  └─ Reviewer: [conditional: typescript, react, a11y, design, go, java, python, rust, database, deps, docs]
│
├─ Phase 3: Synthesis (PARALLEL)
│  ├─ Git agent (comment-pr)
│  └─ Synthesizer agent (mode: review)
│
└─ Phase 4: Display results
```

## Principles

1. **Orchestration only** - Command spawns agents, doesn't do git/review work itself
2. **Parallel, not background** - Multiple agents in one message, but `run_in_background=false` so phases complete before proceeding
3. **Git agent for git work** - All git operations go through Git agent
4. **Clear ownership** - Each agent owns its output completely
5. **Honest reporting** - Display agent outputs directly
