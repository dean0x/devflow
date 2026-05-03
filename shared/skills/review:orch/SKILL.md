---
name: review:orch
description: Agent orchestration for REVIEW intent in ambient ORCHESTRATED mode — multi-agent code review with parallel reviewers
user-invocable: false
---

# Review Orchestration

Agent pipeline for REVIEW intent in ambient ORCHESTRATED mode. Full multi-agent review with parallel specialized reviewers, incremental detection, and disk-persisted reports.

This is a lightweight variant of `/code-review` for ambient ORCHESTRATED mode. Excluded: pitfall recording, tech debt management, Agent Teams debate, CLI flag parsing.

## Iron Law

> **EVERY REVIEWER WRITES TO DISK**
>
> A review that exists only in agent output disappears on compaction.
> No disk artifact, no review. The Synthesizer reads from disk, not memory.

---

**Continuation**: Phase 2 handles incremental detection via `.last-review-head` — no separate continuation path needed.

## Phase 1: Pre-flight

**Produces:** BRANCH_INFO, PR_INFO

Spawn `Agent(subagent_type="Git")` with action `ensure-pr-ready`:
- Extract: branch, base_branch, branch_slug, pr_number
- If BLOCKED (detached HEAD, no commits ahead of base): halt with message

Determine base branch: use PR target if PR exists, otherwise `main`/`master`.

## Phase 2: Incremental Detection

**Produces:** DIFF_RANGE, REVIEW_DIR, TIMESTAMP
**Requires:** BRANCH_INFO

Check `.docs/reviews/{branch_slug}/.last-review-head`:
- If file exists and SHA matches HEAD: "No new commits since last review. Nothing to do." → stop
- If file exists and SHA differs: set `DIFF_RANGE={sha}...HEAD` (incremental)
- If file doesn't exist: set `DIFF_RANGE={base_branch}...HEAD` (full review)

Generate timestamp: `YYYY-MM-DD_HHMM`
Create directory: `mkdir -p .docs/reviews/{branch_slug}/{timestamp}`

## Phase 3: Load Decisions Index

**Produces:** DECISIONS_CONTEXT, FEATURE_KNOWLEDGE
**Requires:** REVIEW_DIR

After incremental detection, load the decisions index:

```bash
DECISIONS_CONTEXT=$(node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "{worktree}" 2>/dev/null || echo "(none)")
```

This produces a compact index of active ADR/PF entries. Pass `DECISIONS_CONTEXT` to all Reviewer agents. Reviewers use `devflow:apply-decisions` to Read full entry bodies on demand.

Also load feature knowledge:
1. Read `.features/index.json` if it exists
2. Based on changed files from Phase 4 file analysis, identify relevant KBs (match file paths against KB `directories` and `referencedFiles`)
3. For each match: check staleness via `node ~/.devflow/scripts/hooks/lib/feature-kb.cjs stale "{worktree}" {slug} 2>/dev/null`, read `.features/{slug}/KNOWLEDGE.md`
4. Concatenate as `FEATURE_KNOWLEDGE` (or `(none)`)

## Phase 4: File Analysis

**Produces:** REVIEWER_LIST
**Requires:** DIFF_RANGE

Run `git diff --name-only {DIFF_RANGE}` to get changed files.

Detect conditional reviewers from file types:

| File Pattern | Reviewer Focus |
|-------------|---------------|
| `*.ts`, `*.tsx` | typescript |
| `*.tsx`, `*.jsx` | react |
| `*.go` | go |
| `*.java` | java |
| `*.py` | python |
| `*.rs` | rust |
| `*.css`, `*.scss` | ui-design |
| `*.tsx`, `*.jsx` (with UI) | accessibility |
| migration/schema files | database |
| `package.json`, lock files | dependencies |
| `*.md`, doc files | documentation |

## Phase 5: Reviews (Parallel)

**Produces:** REVIEWER_OUTPUTS
**Requires:** DIFF_RANGE, REVIEW_DIR, TIMESTAMP, DECISIONS_CONTEXT, FEATURE_KNOWLEDGE, REVIEWER_LIST

Spawn all reviewers in a single message (parallel execution):

**7 core reviewers** (always):
- security, architecture, performance, complexity, consistency, testing, regression

**Conditional reviewers** (from Phase 4 file analysis):
- typescript, react, database, dependencies, documentation, go, java, python, rust, accessibility, ui-design

Each reviewer receives:
- **Focus**: Their review type
- **Branch context**: branch → base_branch
- **Output path**: `.docs/reviews/{branch_slug}/{timestamp}/{focus}.md`
- **DIFF_COMMAND**: `git diff {DIFF_RANGE}` (incremental or full)
- **DECISIONS_CONTEXT**: compact index from Phase 3 (or `(none)` when absent) — follow `devflow:apply-decisions` to Read full ADR/PF bodies on demand
- **FEATURE_KNOWLEDGE**: feature area context from Phase 3 (or `(none)`) — follow `devflow:apply-feature-kb` for consumption algorithm

## Phase 6: Synthesis (Parallel)

**Requires:** REVIEWER_OUTPUTS, REVIEW_DIR, PR_INFO

After all reviewers complete, spawn in parallel:

1. `Agent(subagent_type="Git")` with action `comment-pr` — post review summary as PR comment (deduplicate: check existing comments first)
2. `Agent(subagent_type="Synthesizer")` in review mode — reads all `{focus}.md` files from disk, writes `review-summary.md`

## Phase 7: Finalize

**Requires:** BRANCH_INFO, REVIEW_DIR

Write HEAD SHA to `.docs/reviews/{branch_slug}/.last-review-head` for next incremental review.

Report to user:
- Merge recommendation (from Synthesizer)
- Issue counts by severity
- Artifacts: list of report files written
- Next steps: suggest `/resolve` or `resolve the review issues` if blocking issues found

## Error Handling

- **Git pre-flight BLOCKED**: Halt immediately, report to user
- **No changed files**: "No changes to review." → stop
- **Reviewer fails**: Report which reviewer failed, continue with remaining
- **Synthesizer fails**: Reports are still on disk — user can read them directly

## Phase Completion Checklist

Before reporting results, verify every phase was announced:

- [ ] Phase 1: Pre-flight → BRANCH_INFO, PR_INFO captured
- [ ] Phase 2: Incremental Detection → DIFF_RANGE, REVIEW_DIR, TIMESTAMP captured
- [ ] Phase 3: Load Knowledge Index → DECISIONS_CONTEXT captured, FEATURE_KNOWLEDGE loaded (or skipped if `.features/` absent)
- [ ] Phase 4: File Analysis → REVIEWER_LIST captured
- [ ] Phase 5: Reviews → REVIEWER_OUTPUTS written to disk
- [ ] Phase 6: Synthesis → review-summary.md written
- [ ] Phase 7: Finalize → .last-review-head updated, results reported

If any phase is unchecked, execute it before proceeding.
