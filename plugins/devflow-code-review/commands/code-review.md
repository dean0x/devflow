---
description: Comprehensive branch review using specialized sub-agents for PR readiness
---

# Code Review Command

Run a comprehensive code review of the current branch by spawning parallel review agents, then synthesizing results into PR comments. Supports incremental reviews, timestamped report directories, and multi-worktree auto-discovery.

## Usage

```
/code-review           (review current branch — or all worktrees if multiple found)
/code-review #42       (review specific PR)
/code-review --full    (force full-branch review, ignore previous review state)
/code-review --path /path/to/worktree  (review a specific worktree only)
```

## Phases

### Phase 0: Worktree Discovery & Pre-Flight

#### Step 0a: Discover Worktrees

1. Run `git worktree list --porcelain` to discover all worktrees
2. For each worktree, extract path and branch
3. **Filter to reviewable worktrees:**
   - Must be on a named branch (skip detached HEAD)
   - Must NOT be on a protected branch (main, master, develop, release/*, staging, production)
   - Must NOT be mid-rebase or mid-merge (check `git -C {path} status` for "rebase in progress" / "merging")
4. **If `--path` flag provided:** use only that worktree, skip discovery
5. **If only 1 reviewable worktree** (the common case): proceed as single-worktree flow — zero behavior change
6. **If multiple reviewable worktrees:** report "Found N worktrees with reviewable branches: {list with paths and branches}" and proceed with multi-worktree flow
7. **Deduplicate by branch:** if two worktrees are on the same branch, use only the first worktree's path

#### Step 0b: Per-Worktree Pre-Flight (Git Agent)

For each reviewable worktree, spawn Git agent:

```
Task(subagent_type="Git", run_in_background=false):
"OPERATION: ensure-pr-ready
WORKTREE_PATH: {worktree_path}  (omit if cwd)
Validate branch, commit if needed, push, create PR if needed.
Return: branch, base_branch, branch-slug, PR#"
```

In multi-worktree mode, spawn all pre-flight agents **in a single message** (parallel).

**If BLOCKED:** In single-worktree mode, stop and report. In multi-worktree mode, report the failure but continue with other worktrees.

**Extract from response:** `branch`, `base_branch`, `branch_slug`, `pr_number` per worktree.

#### Step 0c: Incremental Detection & Timestamp Setup

For each worktree:

1. Generate timestamp: `YYYY-MM-DD_HHMM`. If directory already exists (same-minute collision), append seconds (`YYYY-MM-DD_HHMMSS`).
2. Create timestamped review directory: `mkdir -p {worktree}/.docs/reviews/{branch-slug}/{timestamp}/`
3. Check if `{worktree}/.docs/reviews/{branch-slug}/.last-review-head` exists:
   - **If yes AND `--full` NOT set:**
     - Read the SHA from the file
     - Verify reachable: `git -C {worktree} cat-file -t {sha}` (handles rebases — if unreachable, fallback to full)
     - Check if SHA == current HEAD → if so, skip review: "No new commits since last review. Use --full for a full re-review."
     - Set `DIFF_RANGE` to `{last-review-sha}...HEAD`
   - **If no (first review), or `--full`:**
     - Set `DIFF_RANGE` to `{base_branch}...HEAD`

### Phase 1: Analyze Changed Files

Per worktree, detect file types in diff using `DIFF_RANGE` to determine conditional reviews:

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
WORKTREE_PATH: {worktree_path}  (omit if cwd)
DIFF_COMMAND: git diff {DIFF_RANGE}  (use this instead of default base_branch...HEAD)
IMPORTANT: Write report to {worktree_path}/.docs/reviews/{branch-slug}/{timestamp}/{focus}.md using Write tool"
```

In multi-worktree mode, spawn ALL reviewers for ALL worktrees in one parallel message.

### Phase 3: Synthesis (Parallel)

**WAIT** for Phase 2, then spawn agents per worktree **in a single message**:

**Git Agent (PR Comments)** per worktree:
```
Task(subagent_type="Git", run_in_background=false):
"OPERATION: comment-pr
WORKTREE_PATH: {worktree_path}  (omit if cwd)
Read reviews from {worktree_path}/.docs/reviews/{branch-slug}/{timestamp}/
<!-- Confidence threshold also in: shared/agents/reviewer.md, shared/agents/synthesizer.md -->
Create inline PR comments for findings with ≥80% confidence only.
Lower-confidence suggestions (60-79%) go in the summary comment, not as inline comments.
Deduplicate findings across reviewers, consolidate skipped into summary.
Check for existing inline comments at same file:line before creating new ones to avoid duplicates."
```

**Synthesizer Agent** per worktree:
```
Task(subagent_type="Synthesizer", run_in_background=false):
"Mode: review
WORKTREE_PATH: {worktree_path}  (omit if cwd)
REVIEW_BASE_DIR: {worktree_path}/.docs/reviews/{branch-slug}/{timestamp}
TIMESTAMP: {timestamp}
Aggregate findings, determine merge recommendation
Output: {worktree_path}/.docs/reviews/{branch-slug}/{timestamp}/review-summary.md"
```

### Phase 4: Write Review Head Marker & Report

Per worktree, after successful completion:
1. Write current HEAD SHA to `{worktree_path}/.docs/reviews/{branch-slug}/.last-review-head`
2. Display results from all agents:
   - Merge recommendation (from Synthesizer)
   - Issue counts by category (🔴 blocking / ⚠️ should-fix / ℹ️ pre-existing)
   - PR comments created/skipped (from Git)
   - Artifact paths

In multi-worktree mode, report results per worktree.

### Phase 5: Record Pitfalls (Sequential)

**IMPORTANT**: Run sequentially across all worktrees (not in parallel) to avoid GitHub API conflicts.

Per worktree, if the review summary contains CRITICAL or HIGH blocking issues:
1. Read `~/.claude/skills/knowledge-persistence/SKILL.md` and follow its extraction procedure to record pitfalls to `.memory/knowledge/pitfalls.md`
2. Source field: `/code-review {branch}`
3. Skip entirely if no CRITICAL/HIGH blocking issues

## Architecture

```
/code-review (orchestrator - spawns agents only)
│
├─ Phase 0: Worktree Discovery & Pre-flight
│  ├─ Step 0a: git worktree list → filter reviewable
│  ├─ Step 0b: Git agent (ensure-pr-ready) per worktree [parallel]
│  └─ Step 0c: Incremental detection + timestamp setup per worktree
│
├─ Phase 1: Analyze changed files per worktree
│  └─ Detect file types for conditional reviews
│
├─ Phase 2: Reviews (PARALLEL — all worktrees in one message)
│  ├─ Reviewer: security (per worktree)
│  ├─ Reviewer: architecture (per worktree)
│  ├─ Reviewer: performance (per worktree)
│  ├─ Reviewer: complexity (per worktree)
│  ├─ Reviewer: consistency (per worktree)
│  ├─ Reviewer: regression (per worktree)
│  ├─ Reviewer: tests (per worktree)
│  └─ Reviewer: [conditional per worktree]
│
├─ Phase 3: Synthesis (PARALLEL per worktree)
│  ├─ Git agent (comment-pr with dedup)
│  └─ Synthesizer agent (mode: review)
│
├─ Phase 4: Write .last-review-head + display results per worktree
│
└─ Phase 5: Record Pitfalls (SEQUENTIAL across worktrees)
```

## Edge Cases

| Case | Handling |
|------|----------|
| No new commits since last review | Skip review, report: "No new commits since last review. Use --full for a full re-review." |
| Rebase invalidates `.last-review-head` SHA | `git cat-file -t` check fails → fallback to full diff |
| Same-minute review collision | `mkdir` fails → retry with seconds appended (`YYYY-MM-DD_HHMMSS`) |
| Worktree in detached HEAD | Filtered out (no branch name → not reviewable) |
| Worktree mid-rebase or mid-merge | Filtered out by status check |
| Two worktrees on same branch | Deduplicate by branch — review once, use first worktree's path |
| Worktree on protected branch | Filtered out (not reviewable) |
| Worktree pre-flight fails | Report failure, continue with other worktrees |
| `--full` in multi-worktree mode | Applies to all worktrees (global modifier) |
| Many worktrees (5+) | Report count and proceed — user manages their worktree count |
| Duplicate PR comments | Git agent checks for existing comments at same file:line before creating |

## Backwards Compatibility

- **Single worktree**: Auto-discovery finds only one worktree → proceeds exactly as before. Zero behavior change.
- **Legacy flat layout**: If `.docs/reviews/{branch-slug}/` contains flat `*.md` files (no timestamped subdirectories), new runs create timestamped subdirectories. Old flat files remain untouched.

## Principles

1. **Orchestration only** - Command spawns agents, doesn't do git/review work itself
2. **Parallel, not background** - Multiple agents in one message, but `run_in_background=false` so phases complete before proceeding
3. **Git agent for git work** - All git operations go through Git agent
4. **Clear ownership** - Each agent owns its output completely
5. **Honest reporting** - Display agent outputs directly
6. **Incremental by default** - Only review new changes unless `--full` specified
7. **Auto-discover worktrees** - One command handles all reviewable branches
