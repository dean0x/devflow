---
description: Process review issues - validate, assess risk, fix low-risk issues, defer high-risk to tech debt
---

<!--
@devflow-design-decision D8
Phase 6 previously recorded pitfalls retrospectively after reading knowledge-persistence SKILL.
Removed in v2 because agent-summaries produced low-signal entries. Knowledge is now extracted
from user transcripts by scripts/hooks/background-learning.
-->

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

1. **Discover resolvable worktrees** using the `devflow:worktree-support` skill discovery algorithm:
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
Agent(subagent_type="Git", run_in_background=false):
"OPERATION: validate-branch
WORKTREE_PATH: {worktree_path}  (omit if cwd)
Check feature branch, clean working directory, reviews exist.
Return: branch, branch-slug, PR#, review count"
```

In multi-worktree mode, spawn all pre-flight agents **in a single message** (parallel).

**If BLOCKED:** In single-worktree mode, stop and report the blocker to user. If no reviews found, suggest `/code-review` first. In multi-worktree mode, report the failure but continue with other worktrees.

**Extract from response:** `branch`, `branch_slug`, `pr_number`, `review_count` per worktree.

#### Step 0c: Target Review Directory

For each worktree:

1. List directories in `{worktree}/.docs/reviews/{branch-slug}/`
2. **If `--review {timestamp}` provided:** use that specific directory (not supported in multi-worktree mode)
3. **Otherwise:** sort directories by name (timestamps are naturally sortable), select the latest that contains `review-summary.md` (complete review)
4. **If latest directory already has `resolution-summary.md`:** skip worktree — already resolved. Report: "Latest review already resolved. Run /code-review for a new review first."
5. **Legacy fallback:** if no timestamped subdirectories exist but flat `*.md` files do in `{worktree}/.docs/reviews/{branch-slug}/`, read them directly (backwards compatible)

Set `TARGET_DIR` to the selected review directory path.

#### Step 0d: Load Project Knowledge

For each worktree, run:

```bash
KNOWLEDGE_CONTEXT=$(node scripts/hooks/lib/knowledge-context.cjs index "<worktree>")
```

This produces a compact index (~250 tokens) of active ADR/PF entries from `decisions.md` and `pitfalls.md`, with Deprecated/Superseded entries already stripped. Falls back to `(none)` when both files are absent or all entries are filtered. Pass `KNOWLEDGE_CONTEXT` to every Resolver agent in Phase 4. Resolver agents use `devflow:apply-knowledge` to Read full entry bodies on demand — no fan-out of the full corpus.

### Phase 1: Parse Issues

Read review reports from `{TARGET_DIR}/*.md` and extract:

**Exclude from issue extraction:**
- `review-summary.md` (synthesizer output, not individual findings)
- `resolution-summary.md` (if it exists from a previous partial run)

**Include:** ALL issues from all categories and severities, including Suggestions.

Issues are extracted from `{TARGET_DIR}` only — never cross-reference reviews from other worktrees.

**Extract per issue:**
- `id`: Generated from file:line:type
- `file`: Full path
- `line`: Line number
- `severity`: CRITICAL/HIGH/MEDIUM/LOW
- `category`: blocking/should-fix/pre-existing
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
Agent(subagent_type="Resolver"):
"ISSUES: [{issue1}, {issue2}, ...]
BRANCH: {branch-slug}
BATCH_ID: batch-{n}
WORKTREE_PATH: {worktree_path}  (omit if cwd)
KNOWLEDGE_CONTEXT: {knowledge index from Step 0d, or (none)}
Validate, decide FIX vs TECH_DEBT, implement fixes. Follow devflow:apply-knowledge to Read full ADR/PF bodies on demand."
```

> Resolvers follow a 3-tier risk approach:
> - **Standard fixes** (null checks, validation, docs, logging, isolated security): applied directly
> - **Careful fixes** (public API, shared state, >3 files, core logic): systematic refactoring — understand broader context, plan changes, test at all call sites, implement, verify, commit
> - **Architectural overhaul** (complete system redesign, multi-service DB migrations): defer to tech debt — LAST RESORT, avoided at almost all costs

For dependent batches, spawn sequentially and wait for completion before spawning dependents.

### Phase 5: Collect Results

Aggregate from all Resolvers:
- **Fixed**: Issues resolved with commits
- **False positives**: Issues that don't exist or were misunderstood
- **Deferred**: High-risk issues marked for tech debt
- **Blocked**: Issues that couldn't be fixed

Extract all knowledge citations from Resolver Reasoning columns. Collect unique `applies ADR-NNN` and `avoids PF-NNN` references across all batches. These will populate the `## Knowledge Citations` section in Phase 8.

### Phase 6: Simplify

If any fixes were made, spawn Simplifier agent to refine the changed code:

```
Agent(subagent_type="Simplifier", run_in_background=false):
"TASK_DESCRIPTION: Issue resolution fixes
WORKTREE_PATH: {worktree_path}  (omit if cwd)
FILES_CHANGED: {list of files modified by Resolvers}
Simplify and refine the fixes for clarity and consistency"
```

### Phase 7: Manage Tech Debt (Sequential)

**IMPORTANT**: Run sequentially across all worktrees (not in parallel) to avoid GitHub API conflicts.

If any issues were deferred, spawn Git agent:

```
Agent(subagent_type="Git"):
"OPERATION: manage-debt
WORKTREE_PATH: {worktree_path}  (omit if cwd)
REVIEW_DIR: {TARGET_DIR}
TIMESTAMP: {timestamp}
Note: Deferred issues from resolution are already in resolution-summary.md"
```

### Phase 8: Report

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
/resolve (orchestrator - spawns agents only)
│
├─ Phase 0: Worktree Discovery & Pre-flight
│  ├─ Step 0a: git worktree list → filter resolvable
│  ├─ Step 0b: Git agent (validate-branch) per worktree [parallel]
│  ├─ Step 0c: Target latest review directory per worktree
│  └─ Step 0d: Load project knowledge → KNOWLEDGE_CONTEXT
│
├─ Phase 1: Parse issues from TARGET_DIR
│  └─ Extract ALL issues (including Suggestions, exclude summaries)
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
│  └─ Aggregate fixed, false positives, deferred
│
├─ Phase 6: Simplify
│  └─ Simplifier agent (refine fixes)
│
├─ Phase 7: Git agent (manage-debt) — SEQUENTIAL across worktrees
│  └─ Add deferred items to Tech Debt Backlog
│
└─ Phase 8: Write resolution-summary.md + display results
```

## Edge Cases

| Case | Handling |
|------|----------|
| No reviews exist | Error message, suggest `/code-review` first |
| All false positives | Normal completion, report shows 0 fixes |
| Fix attempt fails | Revert changes, mark BLOCKED, continue others |
| Issue dependencies | Sequential chain, skip dependents if predecessor blocked |
| No actionable issues | Report "No issues to resolve" |
| Incomplete review directory (no review-summary.md) | Skip — resolve only targets complete reviews |
| Latest review already resolved | Skip worktree, report suggestion to run /code-review first |
| Legacy flat layout (no subdirectories) | Read flat *.md files directly (backwards compatible) |
| `--review {timestamp}` in multi-worktree mode | Not supported — use `--path` + `--review` to target specific worktree + review |
| Worktree pre-flight fails | Report failure, continue with other worktrees |

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

Written by orchestrator in Phase 8 to `{TARGET_DIR}/resolution-summary.md`:

```markdown
# Resolution Summary

**Branch**: {branch} -> {base}
**Date**: {timestamp}
**Review**: {TARGET_DIR}
**Command**: /resolve

## Knowledge Citations

- applies ADR-{NNN} — {batch-id}, {issue-id}
- avoids PF-{NNN} — {batch-id}, {issue-id}

(Omit section if no citations were made)

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
