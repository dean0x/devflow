---
description: Process review issues using agent teams with cross-validation debate
---

# Resolve Command

Process issues from code review reports: validate them (false positive check), assess risk for FIX vs TECH_DEBT decision, and implement fixes for low-risk issues. Defaults to the latest timestamped review directory. Supports multi-worktree auto-discovery.

## Usage

```
/resolve                        (resolve latest review on current branch — or all worktrees)
/resolve #42                    (resolve issues for specific PR)
/resolve --review 2026-03-28_0900  (resolve a specific review run by timestamp)
/resolve --path /path/to/worktree  (resolve a specific worktree only)
```

## Phases

### Phase 0: Worktree Discovery & Pre-Flight

#### Step 0a: Discover Worktrees

1. **Discover resolvable worktrees** using the `worktree-support` skill discovery algorithm:
   - Run `git worktree list --porcelain` → parse, filter (skip protected/detached/mid-rebase), dedup by branch, sort by recent commit
   - See `~/.claude/skills/devflow:worktree-support/SKILL.md` for the full 7-step algorithm and canonical protected branch list
   - Additional filter: must have unresolved reviews (latest review directory has no `resolution-summary.md`)
2. **If `--path` flag provided:** use only that worktree, skip discovery
   **`--path` validation**: Before proceeding, verify the path exists as a directory and appears in `git worktree list` output. If not: report error and stop.
3. **If only 1 resolvable worktree** (the common case): proceed as single-worktree flow — zero behavior change
4. **If multiple resolvable worktrees:** report "Found N worktrees with unresolved reviews: {list}" and proceed with multi-worktree flow

#### Step 0b: Per-Worktree Pre-Flight (Git Agent)

For each resolvable worktree, spawn Git agent:

```
Task(subagent_type="Git", run_in_background=false):
"OPERATION: validate-branch
WORKTREE_PATH: {worktree_path}  (omit if cwd)
Check feature branch, clean working directory, reviews exist.
Return: branch, branch-slug, PR#, review count"
```

In multi-worktree mode, spawn all pre-flight agents **in a single message** (parallel).

**If BLOCKED:** In single-worktree mode, stop and report. In multi-worktree mode, report failure, continue with other worktrees.

**Extract from response:** `branch`, `branch_slug`, `pr_number`, `review_count` per worktree.

#### Step 0c: Target Review Directory

For each worktree:

1. List directories in `{worktree}/.docs/reviews/{branch-slug}/`
2. **If `--review {timestamp}` provided:** use that specific directory (not supported in multi-worktree mode)
3. **Otherwise:** sort directories by name (timestamps are naturally sortable), select the latest that contains `review-summary.md` (complete review)
4. **If latest directory already has `resolution-summary.md`:** skip worktree — already resolved
5. **Legacy fallback:** if no timestamped subdirectories exist but flat `*.md` files do, read them directly (backwards compatible)

Set `TARGET_DIR` to the selected review directory path.

### Phase 1: Parse Issues

Read review reports from `{TARGET_DIR}/*.md` and extract:

**Exclude from issue extraction:**
- `review-summary.md` (synthesizer output, not individual findings)
- `resolution-summary.md` (if it exists from a previous partial run)

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

### Phase 4: Resolve (Agent Teams with cross-validation)

**With Agent Teams:**

**Note**: In multi-worktree mode, process worktrees sequentially for Agent Teams (one team per session constraint).

Create a resolution team for cross-validated fixes:

```
Create a team named "resolve-{branch-slug}" to resolve review issues.

Spawn resolver teammates with self-contained prompts (one per independent batch):

- Name: "resolver-batch-1"
  Prompt: |
    You are resolving review issues on branch {branch} (PR #{pr_number}).
    WORKTREE_PATH: {worktree_path}  (omit if cwd)
    1. Read your skill: `Read ~/.claude/skills/devflow:implementation-patterns/SKILL.md`
    2. Your issues to resolve:
       {batch 1 issues — full structured list with id, file, line, severity, type, description, suggested_fix}
    3. For each issue:
       a. Read the code context around file:line (use WORKTREE_PATH prefix if provided)
       b. Validate: is this a real issue or false positive?
       c. If real: assess risk (LOW → FIX now, HIGH → defer to TECH_DEBT)
       d. If FIX: implement the fix, commit with descriptive message
       e. If TECH_DEBT: document why it's deferred
    4. Report completion:
       SendMessage(type: "message", recipient: "team-lead",
         summary: "Batch 1: {n} fixed, {n} deferred, {n} false positive")

- Name: "resolver-batch-2"
  Prompt: |
    You are resolving review issues on branch {branch} (PR #{pr_number}).
    WORKTREE_PATH: {worktree_path}  (omit if cwd)
    1. Read your skill: `Read ~/.claude/skills/devflow:implementation-patterns/SKILL.md`
    2. Your issues to resolve:
       {batch 2 issues — full structured list with id, file, line, severity, type, description, suggested_fix}
    3. For each issue:
       a. Read the code context around file:line (use WORKTREE_PATH prefix if provided)
       b. Validate: is this a real issue or false positive?
       c. If real: assess risk (LOW → FIX now, HIGH → defer to TECH_DEBT)
       d. If FIX: implement the fix, commit with descriptive message
       e. If TECH_DEBT: document why it's deferred
    4. Report completion:
       SendMessage(type: "message", recipient: "team-lead",
         summary: "Batch 2: {n} fixed, {n} deferred, {n} false positive")

(Additional resolvers for additional batches — same pattern)

After initial fixes complete, lead initiates cross-validation debate:
SendMessage(type: "broadcast", summary: "Cross-validate: check for conflicts between fixes"):
"Review each other's fixes. Does my fix in file-a conflict with your fix in file-b?
Did either of us introduce a regression?"

Resolvers cross-validate using direct messages:
- SendMessage(type: "message", recipient: "resolver-batch-2", summary: "Conflict: interface change in file-a")
  "My fix changes the interface used by your files — check imports"
- SendMessage(type: "message", recipient: "resolver-batch-1", summary: "Confirmed: updating import")
  "Confirmed — updating my import after your change"
- SendMessage(type: "message", recipient: "team-lead", summary: "Escalation: conflicting fixes")
  for unresolvable conflicts

Max 2 debate rounds, then submit consensus resolution.
```

Shut down resolution team explicitly:

```
For each teammate in [resolver-batch-1, resolver-batch-2, ...]:
  SendMessage(type: "shutdown_request", recipient: "{name}", content: "Resolution complete")
  Wait for shutdown_response (approve: true)

TeamDelete
Verify TeamDelete succeeded. If failed, retry once after 5s. If retry fails, HALT.
```

For dependent batches that cannot run in parallel, spawn sequentially within the team and wait for completion before spawning dependents.

### Phase 5: Collect Results

Aggregate from all Resolvers:
- **Fixed**: Issues resolved with commits
- **False positives**: Issues that don't exist or were misunderstood
- **Deferred**: High-risk issues marked for tech debt
- **Blocked**: Issues that couldn't be fixed

### Phase 6: Record Pitfalls (Sequential)

**IMPORTANT**: Run sequentially across all worktrees (not in parallel) to avoid GitHub API conflicts.

For each issue deferred as TECH_DEBT:
1. Read `~/.claude/skills/devflow:knowledge-persistence/SKILL.md` and follow its extraction procedure to record pitfalls to `.memory/knowledge/pitfalls.md`
2. Source field: `/resolve {branch}`
3. Skip entirely if no TECH_DEBT deferrals

### Phase 7: Simplify

If any fixes were made, spawn Simplifier agent to refine the changed code:

```
Task(subagent_type="Simplifier", run_in_background=false):
"TASK_DESCRIPTION: Issue resolution fixes
WORKTREE_PATH: {worktree_path}  (omit if cwd)
FILES_CHANGED: {list of files modified by Resolvers}
Simplify and refine the fixes for clarity and consistency"
```

### Phase 8: Manage Tech Debt (Sequential)

**IMPORTANT**: Run sequentially across all worktrees (not in parallel) to avoid GitHub API conflicts.

If any issues were deferred, spawn Git agent:

```
Task(subagent_type="Git"):
"OPERATION: manage-debt
WORKTREE_PATH: {worktree_path}  (omit if cwd)
REVIEW_DIR: {TARGET_DIR}
TIMESTAMP: {timestamp}
Note: Deferred issues from resolution are already in resolution-summary.md"
```

### Phase 9: Report

**Write the resolution summary** to `{TARGET_DIR}/resolution-summary.md` using Write tool, then display:

```
## Resolution Summary

**Branch**: {branch}
**Reviews Processed**: {n} reports from {TARGET_DIR}
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
- Resolution report: {TARGET_DIR}/resolution-summary.md
```

In multi-worktree mode, report results per worktree with aggregate summary.

## Architecture

```
/resolve (orchestrator - spawns teams and agents)
│
├─ Phase 0: Worktree Discovery & Pre-flight
│  ├─ Step 0a: git worktree list → filter resolvable
│  ├─ Step 0b: Git agent (validate-branch) per worktree [parallel]
│  └─ Step 0c: Target latest review directory per worktree
│
├─ Phase 1: Parse issues from TARGET_DIR
│  └─ Extract Blocking + Should-Fix (skip Pre-existing, exclude summaries)
│
├─ Phase 2: Analyze dependencies
│  └─ Build dependency graph
│
├─ Phase 3: Plan batches
│  └─ Group issues, determine parallel vs sequential
│
├─ Phase 4: Resolve (Agent Teams with cross-validation, per worktree sequential)
│  ├─ Resolver: Batch 1 (teammate)
│  ├─ Resolver: Batch 2 (teammate)
│  ├─ Resolver: Batch 3 (teammate, waits if depends on 1 or 2)
│  └─ Cross-validation debate → consensus on conflicts
│
├─ Phase 5: Collect results
│  └─ Aggregate fixed, false positives, deferred, blocked
│
├─ Phase 6: Record Pitfalls (SEQUENTIAL across worktrees)
│
├─ Phase 7: Simplify
│  └─ Simplifier agent (refine fixes)
│
├─ Phase 8: Git agent (manage-debt) — SEQUENTIAL across worktrees
│  └─ Add deferred items to Tech Debt Backlog
│
└─ Phase 9: Write resolution-summary.md + display results
```

## Edge Cases

| Case | Handling |
|------|----------|
| No reviews exist | Error message, suggest `/code-review` first |
| All false positives | Normal completion, report shows 0 fixes |
| Fix attempt fails | Revert changes, mark BLOCKED, continue others |
| Issue dependencies | Sequential chain, skip dependents if predecessor blocked |
| No actionable issues | Report "No issues to resolve" (all were pre-existing or LOW) |
| Incomplete review directory | Skip — resolve only targets complete reviews |
| Latest review already resolved | Skip worktree, suggest /code-review first |
| Legacy flat layout | Read flat *.md files directly (backwards compatible) |
| `--review` in multi-worktree mode | Not supported — use `--path` + `--review` for specific worktree |
| Multi-worktree with Agent Teams | Process worktrees sequentially (one team per session) |

## Principles

1. **Orchestration only** - Command spawns agents, doesn't do git/resolve work itself
2. **Git agent for git work** - All git operations go through Git agent
3. **Parallel execution** - Run independent batches in parallel
4. **Conservative risk** - When Resolvers are unsure, defer to tech debt
5. **Honest reporting** - Display agent outputs directly
6. **Complete tracking** - Every issue gets a decision recorded
7. **Latest review by default** - Only process the most recent complete review
8. **Auto-discover worktrees** - One command handles all resolvable branches

## Output Artifact

Written by orchestrator in Phase 9 to `{TARGET_DIR}/resolution-summary.md`:

```markdown
# Resolution Summary

**Branch**: {branch} -> {base}
**Date**: {timestamp}
**Review**: {TARGET_DIR}
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
