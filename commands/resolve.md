---
description: Process review issues - validate, assess risk, fix low-risk issues, defer high-risk to tech debt
---

# Resolve Command

Process issues from code review reports: validate them (false positive check), assess risk for FIX vs TECH_DEBT decision, and implement fixes for low-risk issues.

## Usage

```
/resolve           (resolve issues on current branch)
/resolve #42       (resolve issues for specific PR)
```

## Phases

### Phase 0: Pre-Flight (Git Agent)

Spawn Git agent to validate branch state:

```
Task(subagent_type="Git", run_in_background=false):
"OPERATION: validate-branch
Check feature branch, clean working directory, reviews exist.
Return: branch, branch-slug, PR#, review count"
```

**If BLOCKED:** Stop and report the blocker to user. If no reviews found, suggest `/review` first.

**Extract from response:** `branch`, `branch_slug`, `pr_number`, `review_count` for use in subsequent phases.

### Phase 1: Parse Issues

Read all review reports from `.docs/reviews/{branch-slug}/*.md` and extract:

**Include only:**
- Blocking issues (CRITICAL, HIGH)
- Should-Fix issues (HIGH, MEDIUM)

**Skip:**
- Pre-existing issues (belong in tech debt, not resolution)
- LOW severity (informational only)

**Extract per issue:**
- `id`: Generated from file:line:type
- `file`: Full path
- `line`: Line number
- `severity`: CRITICAL/HIGH/MEDIUM
- `type`: Issue type from review
- `description`: Problem statement
- `suggested_fix`: From review report

### Phase 2: Analyze Dependencies

Group issues by relationship:

1. **Same file** - Issues in same file go in same batch
2. **Same function** - Issues affecting same function go together
3. **Independent** - No relationship, can run in parallel

Build dependency graph to determine execution order.

### Phase 3: Plan Batches

Create execution plan:
- **Independent batches** - Mark for PARALLEL execution
- **Dependent batches** - Mark for SEQUENTIAL execution
- **Max 5 issues per batch** - Keep batches manageable

### Phase 4: Resolve (Parallel where possible)

Spawn Resolver agents based on dependency analysis. For independent batches, spawn **in a single message**:

```
Task(subagent_type="Resolver"):
"ISSUES: [{issue1}, {issue2}, ...]
BRANCH: {branch-slug}
BATCH_ID: batch-{n}
Validate, decide FIX vs TECH_DEBT, implement fixes"
```

For dependent batches, spawn sequentially and wait for completion before spawning dependents.

### Phase 5: Collect Results

Aggregate from all Resolvers:
- **Fixed**: Issues resolved with commits
- **False positives**: Issues that don't exist or were misunderstood
- **Deferred**: High-risk issues marked for tech debt
- **Blocked**: Issues that couldn't be fixed

### Phase 6: Manage Tech Debt

If any issues were deferred, spawn Git agent:

```
Task(subagent_type="Git"):
"OPERATION: manage-debt
REVIEW_DIR: .docs/reviews/{branch-slug}/
TIMESTAMP: {timestamp}
Note: Deferred issues from resolution are already in resolution-summary.{timestamp}.md"
```

### Phase 7: Report

**Write the resolution summary** to `.docs/reviews/{branch-slug}/resolution-summary.{timestamp}.md` using Write tool, then display:

```
## Resolution Summary

**Branch**: {branch}
**Reviews Processed**: {n} reports
**Total Issues**: {n}

### Results
| Outcome | Count |
|---------|-------|
| Fixed | {n} |
| False Positive | {n} |
| Tech Debt | {n} |
| Blocked | {n} |

### Commits Created
- {sha} {message}

### Tech Debt Added
- {n} items added to backlog

### Artifacts
- Resolution report: .docs/reviews/{branch}/resolution-summary.{timestamp}.md
```

## Architecture

```
/resolve (orchestrator - spawns agents only)
│
├─ Phase 0: Pre-flight
│  └─ Git agent (validate-branch)
│
├─ Phase 1: Parse issues
│  └─ Extract Blocking + Should-Fix (skip Pre-existing)
│
├─ Phase 2: Analyze dependencies
│  └─ Build dependency graph
│
├─ Phase 3: Plan batches
│  └─ Group issues, determine parallel vs sequential
│
├─ Phase 4: Resolve (PARALLEL where independent)
│  ├─ Resolver: Batch 1 (file-a issues)
│  ├─ Resolver: Batch 2 (file-b issues)
│  └─ Resolver: Batch 3 (waits if depends on 1 or 2)
│
├─ Phase 5: Collect results
│  └─ Aggregate fixed, false positives, deferred, blocked
│
├─ Phase 6: Git agent (manage-debt)
│  └─ Add deferred items to Tech Debt Backlog
│
└─ Phase 7: Display resolution summary
```

## Edge Cases

| Case | Handling |
|------|----------|
| No reviews exist | Error message, suggest `/review` first |
| All false positives | Normal completion, report shows 0 fixes |
| Fix attempt fails | Revert changes, mark BLOCKED, continue others |
| Issue dependencies | Sequential chain, skip dependents if predecessor blocked |
| No actionable issues | Report "No issues to resolve" (all were pre-existing or LOW) |

## Principles

1. **Orchestration only** - Command spawns agents, doesn't do git/resolve work itself
2. **Git agent for git work** - All git operations go through Git agent
3. **Parallel execution** - Run independent batches in parallel
4. **Conservative risk** - When Resolvers are unsure, defer to tech debt
5. **Honest reporting** - Display agent outputs directly
6. **Complete tracking** - Every issue gets a decision recorded

## Output Artifact

Written by orchestrator in Phase 7 to `.docs/reviews/{branch-slug}/resolution-summary.{timestamp}.md`:

```markdown
# Resolution Summary

**Branch**: {branch} -> {base}
**Date**: {timestamp}
**Command**: /resolve

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | {n} |
| Fixed | {n} |
| False Positive | {n} |
| Deferred | {n} |
| Blocked | {n} |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| {description} | {file}:{line} | {sha} |

## False Positives
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| {description} | {file}:{line} | {why} |

## Deferred to Tech Debt
| Issue | File:Line | Risk Factor |
|-------|-----------|-------------|
| {description} | {file}:{line} | {criteria} |

## Blocked
| Issue | File:Line | Blocker |
|-------|-----------|---------|
| {description} | {file}:{line} | {why} |
```
