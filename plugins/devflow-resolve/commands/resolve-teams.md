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

**Produces:** WORKTREES

1. **Discover resolvable worktrees** using the `devflow:worktree-support` skill discovery algorithm:
   - Run `git worktree list --porcelain` → parse, filter (skip protected/detached/mid-rebase), dedup by branch, sort by recent commit
   - See `~/.claude/skills/devflow:worktree-support/SKILL.md` for the full 7-step algorithm and canonical protected branch list
   - Additional filter: must have unresolved reviews (latest review directory has no `resolution-summary.md`)
2. **If `--path` flag provided:** use only that worktree, skip discovery
   **`--path` validation**: Before proceeding, verify the path exists as a directory and appears in `git worktree list` output. If not: report error and stop.
3. **If only 1 resolvable worktree** (the common case): proceed as single-worktree flow — zero behavior change
4. **If multiple resolvable worktrees:** report "Found N worktrees with unresolved reviews: {list}" and proceed with multi-worktree flow

#### Step 0b: Per-Worktree Pre-Flight (Git Agent)

**Produces:** BRANCH_INFO
**Requires:** WORKTREES

For each resolvable worktree, spawn Git agent:

```
Agent(subagent_type="Git", run_in_background=false):
"OPERATION: validate-branch
WORKTREE_PATH: {worktree_path}  (omit if cwd)
Check feature branch, clean working directory, reviews exist.
Return: branch, branch-slug, PR#, review count"
```

In multi-worktree mode, spawn all pre-flight agents **in a single message** (parallel).

**If BLOCKED:** In single-worktree mode, stop and report. In multi-worktree mode, report failure, continue with other worktrees.

**Extract from response:** `branch`, `branch_slug`, `pr_number`, `review_count` per worktree.

#### Step 0c: Target Review Directory

**Produces:** TARGET_DIR
**Requires:** BRANCH_INFO

For each worktree:

1. List directories in `{worktree}/.docs/reviews/{branch-slug}/`
2. **If `--review {timestamp}` provided:** use that specific directory (not supported in multi-worktree mode)
3. **Otherwise:** sort directories by name (timestamps are naturally sortable), select the latest that contains `review-summary.md` (complete review)
4. **If latest directory already has `resolution-summary.md`:** skip worktree — already resolved
5. **Legacy fallback:** if no timestamped subdirectories exist but flat `*.md` files do, read them directly (backwards compatible)

Set `TARGET_DIR` to the selected review directory path.

#### Step 0d: Load Project Decisions

**Produces:** DECISIONS_CONTEXT, FEATURE_KNOWLEDGE

For each worktree, run:

```bash
DECISIONS_CONTEXT=$(node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "{worktree}" 2>/dev/null || echo "(none)")
```

This produces a compact index of active ADR/PF entries from `decisions.md` and `pitfalls.md`, with Deprecated/Superseded entries already stripped. Falls back to `(none)` when both files are absent or all entries are filtered. Pass `DECISIONS_CONTEXT` to every Resolver agent in Phase 4. Resolver agents use `devflow:apply-decisions` to Read full entry bodies on demand — no fan-out of the full corpus.

**Load Feature Knowledge:**
1. Read `.features/index.json` if it exists
2. Based on file paths from review report issue entries, identify relevant KBs
3. For each match: check staleness via `node ~/.devflow/scripts/hooks/lib/feature-knowledge.cjs stale "{worktree}" {slug} 2>/dev/null`, read `.features/{slug}/KNOWLEDGE.md`
4. Set `FEATURE_KNOWLEDGE` (or `(none)` if no KBs exist or none are relevant)

Pass `FEATURE_KNOWLEDGE` to every Resolver teammate in Phase 4.

### Phase 1: Parse Issues

**Produces:** ISSUES
**Requires:** TARGET_DIR

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

**Produces:** DEPENDENCY_GRAPH
**Requires:** ISSUES

Group issues by relationship:

1. **Same file** - Issues in same file go in same batch
2. **Same function** - Issues affecting same function go together
3. **Independent** - No relationship, can run in parallel

Build dependency graph to determine execution order.

### Phase 3: Plan Batches

**Produces:** BATCHES
**Requires:** DEPENDENCY_GRAPH

Create execution plan:
- **Independent batches** - Mark for PARALLEL execution
- **Dependent batches** - Mark for SEQUENTIAL execution
- **Max 5 issues per batch** - Keep batches manageable

### Phase 4: Resolve (Agent Teams with cross-validation)

**Produces:** RESOLUTION_RESULTS
**Requires:** BATCHES, DECISIONS_CONTEXT, BRANCH_INFO

**With Agent Teams:**

**Note**: In multi-worktree mode, process worktrees sequentially for Agent Teams (one team per session constraint).

Create a resolution team for cross-validated fixes:

```
Create a team named "resolve-{branch-slug}" to resolve review issues.

#### Resolver Teammate Prompt Template

Each resolver teammate receives the following instructions (only the issue list varies per batch):

    You are resolving review issues on branch {branch} (PR #{pr_number}).
    WORKTREE_PATH: {worktree_path}  (omit if cwd)
    DECISIONS_CONTEXT: {decisions_context}
    FEATURE_KNOWLEDGE: {feature_knowledge}
    1. Read your skill: `Read ~/.claude/skills/devflow:patterns/SKILL.md`
       Follow devflow:apply-decisions to scan DECISIONS_CONTEXT and Read full ADR/PF bodies on demand. Skip if (none).
       Follow devflow:apply-feature-knowledge for FEATURE_KNOWLEDGE — feature patterns inform whether a fix follows area conventions. Skip if (none).
    2. Your issues to resolve:
       {BATCH_ISSUES}
    3. For each issue:
       a. Read the code context around file:line (use WORKTREE_PATH prefix if provided)
       b. Validate: is this a real issue or false positive?
       c. If real: assess risk:
          - Standard (null checks, validation, docs, logging, isolated security) → FIX directly
          - Careful (public API, shared state, >3 files, core logic) → systematic refactoring: understand 50+ lines context → plan → test at all call sites → implement → verify → commit
          - Architectural overhaul (complete redesign, multi-service DB migrations) → TECH_DEBT (LAST RESORT — avoided at almost all costs)
       d. If FIX: implement the fix, commit with descriptive message
       e. If TECH_DEBT: document why it's deferred
    4. Report completion:
       SendMessage(type: "message", recipient: "team-lead",
         summary: "Batch {N}: {n} fixed, {n} deferred, {n} false positive")

#### Spawn teammates using the template above (one per independent batch):

- Name: "resolver-batch-1"
  Prompt: Use Resolver Teammate Prompt Template with BATCH_ISSUES =
    {batch 1 issues — full structured list with id, file, line, severity, category, type, description, suggested_fix}

- Name: "resolver-batch-2"
  Prompt: Use Resolver Teammate Prompt Template with BATCH_ISSUES =
    {batch 2 issues}

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

**Produces:** AGGREGATED_RESULTS, KNOWLEDGE_CITATIONS
**Requires:** RESOLUTION_RESULTS

Aggregate from all Resolvers:
- **Fixed**: Issues resolved with commits
- **False positives**: Issues that don't exist or were misunderstood
- **Deferred**: High-risk issues marked for tech debt
- **Blocked**: Issues that couldn't be fixed

Extract all decisions citations from Resolver Reasoning columns. Collect unique `applies ADR-NNN` and `avoids PF-NNN` references across all batches. These will populate the `## Decisions Citations` section in Phase 8.

### Phase 6: Simplify

**Produces:** SIMPLIFICATION_RESULT
**Requires:** RESOLUTION_RESULTS

If any fixes were made, spawn Simplifier agent to refine the changed code:

```
Agent(subagent_type="Simplifier", run_in_background=false):
"TASK_DESCRIPTION: Issue resolution fixes
WORKTREE_PATH: {worktree_path}  (omit if cwd)
FILES_CHANGED: {list of files modified by Resolvers}
Simplify and refine the fixes for clarity and consistency"
```

### Phase 7: Manage Tech Debt (Sequential)

**Produces:** DEBT_RESULT
**Requires:** RESOLUTION_RESULTS, TARGET_DIR

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

**Requires:** AGGREGATED_RESULTS, KNOWLEDGE_CITATIONS, TARGET_DIR

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
│  ├─ Step 0c: Target latest review directory per worktree
│  └─ Step 0d: Load project decisions → DECISIONS_CONTEXT
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
├─ Phase 4: Resolve (Agent Teams with cross-validation, per worktree sequential)
│  ├─ Resolver: Batch 1 (teammate)
│  ├─ Resolver: Batch 2 (teammate)
│  ├─ Resolver: Batch 3 (teammate, waits if depends on 1 or 2)
│  └─ Cross-validation debate → consensus on conflicts
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

Written by orchestrator in Phase 8 to `{TARGET_DIR}/resolution-summary.md`:

```markdown
# Resolution Summary

**Branch**: {branch} -> {base}
**Date**: {timestamp}
**Review**: {TARGET_DIR}
**Command**: /resolve

## Decisions Citations

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
