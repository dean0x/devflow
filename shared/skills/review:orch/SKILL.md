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

## Phase 1: Pre-flight

Spawn `Agent(subagent_type="Git")` with action `ensure-pr-ready`:
- Extract: branch, base_branch, branch_slug, pr_number
- If BLOCKED (detached HEAD, no commits ahead of base): halt with message

Determine base branch: use PR target if PR exists, otherwise `main`/`master`.

## Phase 2: Incremental Detection

Check `.docs/reviews/{branch_slug}/.last-review-head`:
- If file exists and SHA matches HEAD: "No new commits since last review. Nothing to do." → stop
- If file exists and SHA differs: set `DIFF_RANGE={sha}...HEAD` (incremental)
- If file doesn't exist: set `DIFF_RANGE={base_branch}...HEAD` (full review)

Generate timestamp: `YYYY-MM-DD_HHMM`
Create directory: `mkdir -p .docs/reviews/{branch_slug}/{timestamp}`

## Phase 2b: Load Knowledge Index

After incremental detection, load the knowledge index:

```bash
KNOWLEDGE_CONTEXT=$(node scripts/hooks/lib/knowledge-context.cjs index ".")
```

This produces a compact index (~250 tokens) of active ADR/PF entries. Pass `KNOWLEDGE_CONTEXT` to all Reviewer agents. Reviewers use `devflow:apply-knowledge` to Read full entry bodies on demand.

## Phase 3: File Analysis

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

## Phase 4: Reviews (Parallel)

Spawn all reviewers in a single message (parallel execution):

**7 core reviewers** (always):
- security, architecture, performance, complexity, consistency, testing, regression

**Conditional reviewers** (from Phase 3 file analysis):
- typescript, react, database, dependencies, documentation, go, java, python, rust, accessibility, ui-design

Each reviewer receives:
- **Focus**: Their review type
- **Branch context**: branch → base_branch
- **Output path**: `.docs/reviews/{branch_slug}/{timestamp}/{focus}.md`
- **DIFF_COMMAND**: `git diff {DIFF_RANGE}` (incremental or full)
- **KNOWLEDGE_CONTEXT**: compact index from Phase 2b (or `(none)` when absent) — follow `devflow:apply-knowledge` to Read full ADR/PF bodies on demand

## Phase 5: Synthesis (Parallel)

After all reviewers complete, spawn in parallel:

1. `Agent(subagent_type="Git")` with action `comment-pr` — post review summary as PR comment (deduplicate: check existing comments first)
2. `Agent(subagent_type="Synthesizer")` in review mode — reads all `{focus}.md` files from disk, writes `review-summary.md`

## Phase 6: Finalize

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
