---
description: Comprehensive branch review using specialized sub-agents for PR readiness
---

<!--
@devflow-design-decision D8
Phase 5 previously recorded pitfalls retrospectively after reading knowledge-persistence SKILL.
Removed in v2 because agent-summaries produced low-signal entries. Knowledge is now extracted
from user transcripts by scripts/hooks/background-learning.
-->

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

1. **Discover reviewable worktrees** using the `devflow:worktree-support` skill discovery algorithm:
   - Run `git worktree list --porcelain` → parse, filter (skip protected/detached/mid-rebase), dedup by branch, sort by recent commit
   - See `~/.claude/skills/devflow:worktree-support/SKILL.md` for the full 7-step algorithm and canonical protected branch list
2. **If `--path` flag provided:** use only that worktree, skip discovery
   **`--path` validation**: Before proceeding, verify the path exists as a directory and appears in `git worktree list` output. If not: report error and stop.
3. **If only 1 reviewable worktree** (the common case): proceed as single-worktree flow — zero behavior change
4. **If multiple reviewable worktrees:** report "Found N worktrees with reviewable branches: {list with paths and branches}" and proceed with multi-worktree flow

#### Step 0b: Per-Worktree Pre-Flight (Git Agent)

For each reviewable worktree, spawn Git agent:

```
Agent(subagent_type="Git", run_in_background=false):
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
| .tsx/.jsx/.css/.scss files | ui-design |
| .go files | go |
| .java files | java |
| .py files | python |
| .rs files | rust |
| DB/migration files | database |
| Dependency files changed | dependencies |
| Docs or significant code | documentation |

**Skill availability check**: Language/ecosystem reviews (typescript, react, accessibility, ui-design, go, java, python, rust) require their optional skill plugin to be installed. Before spawning a conditional Reviewer for these focuses, use Read to check if `~/.claude/skills/devflow:{focus}/SKILL.md` exists. If Read returns an error (file not found), **skip that review** — the language plugin isn't installed. Non-language reviews (database, dependencies, documentation) use skills bundled with this plugin and are always available.

### Phase 1b: Load Knowledge Index

While file analysis runs (or just before spawning reviewers), load the knowledge index for the current worktree:

```bash
KNOWLEDGE_CONTEXT=$(node scripts/hooks/lib/knowledge-context.cjs index "{worktree}")
```

This produces a compact index (~250 tokens) of active ADR/PF entries. Pass `KNOWLEDGE_CONTEXT` to all Reviewer agents. Reviewers use `devflow:apply-knowledge` to Read full entry bodies on demand.

### Phase 2: Run Reviews (Parallel)

Spawn Reviewer agents **in a single message**. Always run 7 core reviews; conditionally add more based on changed file types:

| Focus | Always | Pattern Skill |
|-------|--------|---------------|
| security | ✓ | devflow:security |
| architecture | ✓ | devflow:architecture |
| performance | ✓ | devflow:performance |
| complexity | ✓ | devflow:complexity |
| consistency | ✓ | devflow:consistency |
| regression | ✓ | devflow:regression |
| testing | ✓ | devflow:testing |
| typescript | conditional | devflow:typescript |
| react | conditional | devflow:react |
| accessibility | conditional | devflow:accessibility |
| ui-design | conditional | devflow:ui-design |
| go | conditional | devflow:go |
| java | conditional | devflow:java |
| python | conditional | devflow:python |
| rust | conditional | devflow:rust |
| database | conditional | devflow:database |
| dependencies | conditional | devflow:dependencies |
| documentation | conditional | devflow:documentation |

Each Reviewer invocation (all in one message, **NOT background**):
```
Agent(subagent_type="Reviewer", run_in_background=false):
"Review focusing on {focus}. Load the pattern skill for your focus from the Focus Areas table.
Follow 6-step process from devflow:review-methodology.
PR: #{pr_number}, Base: {base_branch}
WORKTREE_PATH: {worktree_path}  (omit if cwd)
DIFF_COMMAND: git -C {WORKTREE_PATH} diff {DIFF_RANGE}  (omit -C flag if no WORKTREE_PATH)
KNOWLEDGE_CONTEXT: {knowledge_context or '(none)'}
Follow devflow:apply-knowledge to scan the index and Read full ADR/PF bodies on demand.
IMPORTANT: Write report to {worktree_path}/.docs/reviews/{branch-slug}/{timestamp}/{focus}.md using Write tool"
```

In multi-worktree mode, process worktrees **sequentially** (one worktree at a time). Complete Phases 1-4 for each worktree before starting the next. This prevents agent overload — spawning 7-18 reviewers per worktree across multiple worktrees simultaneously overwhelms the system.

### Phase 3: Synthesis (Parallel)

**WAIT** for Phase 2, then spawn agents per worktree **in a single message**:

**Git Agent (PR Comments)** per worktree:
```
Agent(subagent_type="Git", run_in_background=false):
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
Agent(subagent_type="Synthesizer", run_in_background=false):
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
├─ Per worktree (SEQUENTIAL — one worktree at a time):
│  │
│  ├─ Phase 1: Analyze changed files
│  │  └─ Detect file types for conditional reviews
│  │
│  ├─ Phase 2: Reviews (PARALLEL within worktree)
│  │  ├─ Reviewer: security
│  │  ├─ Reviewer: architecture, performance, complexity
│  │  ├─ Reviewer: consistency, regression, testing
│  │  └─ Reviewer: [conditional]
│  │
│  ├─ Phase 3: Synthesis (PARALLEL within worktree)
│  │  ├─ Git agent (comment-pr with dedup)
│  │  └─ Synthesizer agent (mode: review)
│  │
│  └─ Phase 4: Write .last-review-head + display results
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
