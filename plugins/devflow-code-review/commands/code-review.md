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

**Produces:** WORKTREES

1. **Discover reviewable worktrees** using the `devflow:worktree-support` skill discovery algorithm:
   - Run `git worktree list --porcelain` → parse, filter (skip protected/detached/mid-rebase), dedup by branch, sort by recent commit
   - See `~/.claude/skills/devflow:worktree-support/SKILL.md` for the full 7-step algorithm and canonical protected branch list
2. **If `--path` flag provided:** use only that worktree, skip discovery
   **`--path` validation**: Before proceeding, verify the path exists as a directory and appears in `git worktree list` output. If not: report error and stop.
3. **If only 1 reviewable worktree** (the common case): proceed as single-worktree flow — zero behavior change
4. **If multiple reviewable worktrees:** report "Found N worktrees with reviewable branches: {list with paths and branches}" and proceed with multi-worktree flow

#### Step 0b: Per-Worktree Pre-Flight (Git Agent)

**Produces:** BRANCH_INFO, PR_INFO, PR_DESCRIPTION, PR_DESCRIPTION_GUIDANCE
**Requires:** WORKTREES

Discover PR description guidance from plan artifact (per worktree):
1. List `{worktree}/.devflow/docs/design/*.md` files
2. Sort by timestamp in filename (descending -- timestamps are YYYY-MM-DD_HHMM, naturally sortable)
3. Read the most recent file, extract `## PR Description Guidance` section
4. If no plan files exist or section not found, set `PR_DESCRIPTION_GUIDANCE` to `(none)`

For each reviewable worktree, spawn Git agent:

```
Agent(subagent_type="Git", run_in_background=false):
"OPERATION: ensure-pr-ready
WORKTREE_PATH: {worktree_path}  (omit if cwd)
PR_DESCRIPTION_GUIDANCE: {pr_description_guidance}
Validate branch, commit if needed, push, create PR if needed.
Return: branch, base_branch, branch-slug, PR#"
```

In multi-worktree mode, spawn all pre-flight agents **in a single message** (parallel).

**If BLOCKED:** In single-worktree mode, stop and report. In multi-worktree mode, report the failure but continue with other worktrees.

**Extract from response:** `branch`, `base_branch`, `branch_slug`, `pr_number` per worktree.

**Fetch PR body** (after extracting `pr_number`):
```bash
PR_DESCRIPTION=$(gh pr view {pr_number} --json body --jq '.body' 2>/dev/null || echo "(none)")
```
If `pr_number` is absent or the command fails, set `PR_DESCRIPTION` to `(none)`.

#### Step 0c: Incremental Detection & Timestamp Setup

**Produces:** DIFF_RANGE, REVIEW_DIR, TIMESTAMP
**Requires:** BRANCH_INFO

For each worktree:

1. Generate timestamp: `YYYY-MM-DD_HHMM`. If directory already exists (same-minute collision), append seconds (`YYYY-MM-DD_HHMMSS`).
2. Create timestamped review directory: `mkdir -p {worktree}/.devflow/docs/reviews/{branch-slug}/{timestamp}/`
3. Check if `{worktree}/.devflow/docs/reviews/{branch-slug}/.last-review-head` exists:
   - **If yes AND `--full` NOT set:**
     - Read the SHA from the file
     - Verify reachable: `git -C {worktree} cat-file -t {sha}` (handles rebases — if unreachable, fallback to full)
     - Check if SHA == current HEAD → if so, skip review: "No new commits since last review. Use --full for a full re-review."
     - Set `DIFF_RANGE` to `{last-review-sha}...HEAD`
   - **If no (first review), or `--full`:**
     - Set `DIFF_RANGE` to `{base_branch}...HEAD`

#### Step 0d-i: Load Prior Resolution and Count Cycles

**Produces:** PRIOR_RESOLUTIONS, CYCLE_NUMBER
**Requires:** BRANCH_INFO

For each worktree, perform a single pass over timestamped directories:
1. List timestamped directories in `{worktree}/.devflow/docs/reviews/{branch-slug}/` sorted descending: `ls -1d {worktree}/.devflow/docs/reviews/{branch-slug}/20* 2>/dev/null | sort -r`
2. Iterate once: accumulate CYCLE_NUMBER count for each directory containing `resolution-summary.md`; capture the first (most-recent) such directory as PRIOR_DIR.
3. If CYCLE_NUMBER = 0: set PRIOR_RESOLUTIONS=(none), CYCLE_NUMBER=1, proceed.
4. Otherwise: set CYCLE_NUMBER = count + 1. Read `{PRIOR_DIR}/resolution-summary.md` as PRIOR_RESOLUTIONS.
5. If `--full`: still load PRIOR_RESOLUTIONS (valuable for reviewer cross-cycle awareness) but skip Step 0d-ii.

#### Step 0d-ii: Convergence Assessment

**Produces:** (refines CYCLE_NUMBER)
**Requires:** PRIOR_RESOLUTIONS, BRANCH_INFO

MAX_REVIEW_CYCLES = 10

1. If CYCLE_NUMBER > MAX_REVIEW_CYCLES:
   Halt via AskUserQuestion:
   "Review pipeline has run {CYCLE_NUMBER-1} cycles. Halting to prevent infinite review-resolve loop. Use --full to override."
   - If user confirms override (--full): proceed; otherwise abort.
   (Design intent: interactive commands allow user override of hard cap; ambient review:orch enforces a non-overridable hard-stop. Asymmetry is intentional.)
2. Parse Statistics table from PRIOR_RESOLUTIONS:
   - Extract False Positive, Fixed, Deferred counts
   - fp_ratio = fp_count / (fp_count + fixed_count + deferred_count)
   - If denominator = 0: fp_ratio = 0, skip warning
   - If parsing fails: fp_ratio = 0, skip warning; note in output: "Warning: Could not parse Statistics table from prior resolution. FP ratio unavailable — convergence tracking degraded."
3. If fp_ratio > 0.7 AND CYCLE_NUMBER >= 3:
   Warn via AskUserQuestion:
   "⚠️ Convergence: {ratio}% false positives in cycle {N-1}. Options: Merge / Review anyway / Stop"
   - Merge or Stop: skip Phase 2 onward
   - Review anyway: proceed with PRIOR_RESOLUTIONS loaded

**Decision table — Step 0d-ii paths:**

| Condition | Outcome |
|-----------|---------|
| CYCLE_NUMBER > MAX_REVIEW_CYCLES | Halt (AskUserQuestion), abort unless user overrides |
| denominator = 0 OR parsing failed | fp_ratio = 0, skip warning (degraded note on parse failure) |
| fp_ratio > 0.7 AND CYCLE_NUMBER >= 3 | Warn (AskUserQuestion): Merge / Review anyway / Stop |

NOTE: Convergence logic mirrored in code-review-teams.md — parity enforced by tests/review/convergence-detection.test.ts ("Cross-cutting convergence consistency").

### Phase 1: Analyze Changed Files

**Produces:** REVIEWER_LIST
**Requires:** DIFF_RANGE

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

### Phase 1b: Load Decisions Index

**Produces:** DECISIONS_CONTEXT, FEATURE_KNOWLEDGE

**Load Companion Skills** — Load via Skill tool: `devflow:quality-gates`, `devflow:software-design`. If a skill fails to load, continue without it.

While file analysis runs (or just before spawning reviewers), load the decisions index for the current worktree:

```bash
DECISIONS_CONTEXT=$(node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "{worktree}" 2>/dev/null || echo "(none)")
```

This produces a compact index of active ADR/PF entries. Pass `DECISIONS_CONTEXT` to all Reviewer agents. Reviewers use `devflow:apply-decisions` to Read full entry bodies on demand.

**Load Feature Knowledge:**
1. Read `.devflow/features/index.json` if it exists
2. Based on changed files from Phase 1 analysis, identify relevant feature knowledge (match file paths against each feature knowledge entry's `directories` and `referencedFiles`)
3. For each match: check staleness via `node ~/.devflow/scripts/hooks/lib/feature-knowledge.cjs stale "{worktree}" {slug} 2>/dev/null`, read `.devflow/features/{slug}/KNOWLEDGE.md`
4. Set `FEATURE_KNOWLEDGE` (or `(none)` if no feature knowledge exists or none is relevant)

Pass `FEATURE_KNOWLEDGE` to all Reviewer agents alongside `DECISIONS_CONTEXT`.

### Phase 2: Run Reviews (Parallel)

**Produces:** REVIEWER_OUTPUTS
**Requires:** DIFF_RANGE, REVIEW_DIR, TIMESTAMP, DECISIONS_CONTEXT, FEATURE_KNOWLEDGE, PR_DESCRIPTION, PRIOR_RESOLUTIONS, REVIEWER_LIST

Spawn Reviewer agents **in a single message**. Always run 8 core reviews; conditionally add more based on changed file types:

| Focus | Always | Pattern Skill |
|-------|--------|---------------|
| security | ✓ | devflow:security |
| architecture | ✓ | devflow:architecture |
| performance | ✓ | devflow:performance |
| complexity | ✓ | devflow:complexity |
| consistency | ✓ | devflow:consistency |
| regression | ✓ | devflow:regression |
| testing | ✓ | devflow:testing |
| reliability | ✓ | devflow:reliability |
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
DECISIONS_CONTEXT: {decisions_context}
FEATURE_KNOWLEDGE: {feature_knowledge}
PR_DESCRIPTION: <pr-description>{pr_description}</pr-description>
PRIOR_RESOLUTIONS: <prior-resolution-summary>{prior_resolutions}</prior-resolution-summary>
If PRIOR_RESOLUTIONS is not (none), follow Cross-Cycle Awareness in reviewer.md.
Follow devflow:apply-decisions to scan the index and Read full ADR/PF bodies on demand.
Follow devflow:apply-feature-knowledge for FEATURE_KNOWLEDGE — feature-specific patterns and anti-patterns inform findings.
IMPORTANT: Write report to {worktree_path}/.devflow/docs/reviews/{branch-slug}/{timestamp}/{focus}.md using Write tool"
```

In multi-worktree mode, process worktrees **sequentially** (one worktree at a time). Complete Phases 1-4 for each worktree before starting the next. This prevents agent overload — spawning 8-19 reviewers per worktree across multiple worktrees simultaneously overwhelms the system.

### Phase 3: Synthesis (Parallel)

**Produces:** REVIEW_SUMMARY
**Requires:** REVIEWER_OUTPUTS, REVIEW_DIR, PR_INFO

**WAIT** for Phase 2, then spawn agents per worktree **in a single message**:

**Git Agent (PR Comments)** per worktree:
```
Agent(subagent_type="Git", run_in_background=false):
"OPERATION: comment-pr
WORKTREE_PATH: {worktree_path}  (omit if cwd)
Read reviews from {worktree_path}/.devflow/docs/reviews/{branch-slug}/{timestamp}/
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
REVIEW_BASE_DIR: {worktree_path}/.devflow/docs/reviews/{branch-slug}/{timestamp}
TIMESTAMP: {timestamp}
CYCLE_NUMBER: {cycle_number}
PRIOR_RESOLUTIONS: <prior-resolution-summary>{prior_resolutions}</prior-resolution-summary>
Include Convergence Status section in review-summary.md.
Aggregate findings, determine merge recommendation
Output: {worktree_path}/.devflow/docs/reviews/{branch-slug}/{timestamp}/review-summary.md"
```

### Phase 4: Write Review Head Marker & Report

**Requires:** BRANCH_INFO, REVIEW_DIR

Per worktree, after successful completion:
1. Write current HEAD SHA to `{worktree_path}/.devflow/docs/reviews/{branch-slug}/.last-review-head`
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
│  ├─ Step 0c: Incremental detection + timestamp setup per worktree
│  ├─ Step 0d-i: Load prior resolution-summary.md
│  └─ Step 0d-ii: Convergence assessment (warn if FP ratio > 70%)
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
| First review (no prior resolution) | PRIOR_RESOLUTIONS=(none), no convergence check |
| fp_ratio denominator = 0 | fp_ratio = 0, no warning |
| `--full` flag | Bypass convergence warning, still load PRIOR_RESOLUTIONS |
| Parsing failure on resolution-summary.md | fp_ratio = 0, convergence tracking degraded (see Step 0d-ii) |
| Concurrent sessions | Advisory only, each session computes independently |

## Backwards Compatibility

- **Single worktree**: Auto-discovery finds only one worktree → proceeds exactly as before. Zero behavior change.
- **Legacy flat layout**: If `.devflow/docs/reviews/{branch-slug}/` contains flat `*.md` files (no timestamped subdirectories), new runs create timestamped subdirectories. Old flat files remain untouched.

## Principles

1. **Orchestration only** - Command spawns agents, doesn't do git/review work itself
2. **Parallel, not background** - Multiple agents in one message, but `run_in_background=false` so phases complete before proceeding
3. **Git agent for git work** - All git operations go through Git agent
4. **Clear ownership** - Each agent owns its output completely
5. **Honest reporting** - Display agent outputs directly
6. **Incremental by default** - Only review new changes unless `--full` specified
7. **Auto-discover worktrees** - One command handles all reviewable branches
