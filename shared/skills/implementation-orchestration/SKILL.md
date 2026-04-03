---
name: implementation-orchestration
description: Agent orchestration for IMPLEMENT intent — pre-flight, Coder, quality gates
user-invocable: false
allowed-tools: Read, Grep, Glob, Bash, Task
---

# Implementation Orchestration

Agent pipeline for IMPLEMENT intent in ambient ORCHESTRATED mode. Pre-flight checks, plan synthesis, Coder execution, and quality gates.

This is a lightweight variant of `/implement` for ambient ORCHESTRATED mode. Excluded: strategy selection (single/sequential/parallel Coders), retry loops, PR creation, knowledge loading.

## Iron Law

> **QUALITY GATES ARE NON-NEGOTIABLE**
>
> Every Coder output passes through Validator → Simplifier → Scrutinizer → re-Validate → Evaluator → Tester.
> Skipping a gate because "it looks fine" is never acceptable. The pipeline runs to completion
> or halts on failure — there is no shortcut.

---

## Phase 1: Pre-flight — Branch Safety

Detect branch type before spawning Coder:

- **Work branches** (`feat/`, `fix/`, `chore/`, `refactor/`, `docs/` prefix): proceed on current branch.
- **Protected branches** (`main`, `master`, `develop`, `integration`, `trunk`, `release/*`, `staging`, `production`): record current branch as `BASE_BRANCH`, then spawn Git agent to auto-create a feature branch:

```
Task(subagent_type="Git"):
"OPERATION: setup-task
BASE_BRANCH: {current branch name}
ISSUE_INPUT: {issue number if ticket mentioned in conversation, otherwise omit}
TASK_DESCRIPTION: {task description from conversation context}
Derive branch name from issue or description, create feature branch, and fetch issue if specified.
Return the branch setup summary."
```

Capture `branch name` and `BASE_BRANCH` from Git agent output for use throughout the pipeline.

## Phase 2: Plan Synthesis

Synthesize conversation context into a structured EXECUTION_PLAN for Coder:

- **If a plan exists** in conversation context (from plan mode — accepted in-session or injected after "accept and clear") → use the plan as-is.
- **Otherwise** → synthesize from conversation: what to build, files/modules affected, constraints, decisions made during discussion.

Format as structured markdown with: Goal, Steps, Files, Constraints, Decisions.

## Worktree Support

If the orchestrator receives a `WORKTREE_PATH` context (e.g., from multi-worktree workflows), pass it through to all spawned agents. Each agent's "Worktree Support" section handles path resolution.

## Phase 3: Coder Execution

Record git SHA before first Coder: `git rev-parse HEAD`

Spawn `Task(subagent_type="Coder")` with input variables:
- **TASK_ID**: Generated from timestamp (e.g., `task-2026-03-19_1430`)
- **TASK_DESCRIPTION**: From conversation context
- **BASE_BRANCH**: Current branch (or newly created branch from Phase 1)
- **EXECUTION_PLAN**: From Phase 2
- **PATTERNS**: Codebase patterns from conversation context
- **CREATE_PR**: `false` (commit only, no push)
- **DOMAIN**: Inferred from files in scope (`backend`, `frontend`, `tests`, `fullstack`)

**Execution strategy**: Single sequential Coder by default. Parallel Coders only when tasks are self-contained — zero shared contracts, no integration points, different files/modules with no imports between them.

If Coder returns **BLOCKED**, halt the pipeline and report to user.

**Handoff artifact** (when HANDOFF_REQUIRED=true): After Coder completes, write the phase summary to `.docs/handoff.md` using the Write tool. The next Coder reads this on startup (see Coder agent Responsibility 1). This survives context compaction — unlike PRIOR_PHASE_SUMMARY which is context-mediated.

## Phase 4: FILES_CHANGED Detection

After Coder completes, detect changed files:

```bash
git diff --name-only {starting_sha}...HEAD
```

Pass FILES_CHANGED to all quality gate agents.

## Phase 5: Quality Gates

Run sequentially — each gate must pass before the next:

1. `Task(subagent_type="Validator")` (build + typecheck + lint + tests) — retry up to 2× on failure (Coder fixes between retries)
2. `Task(subagent_type="Simplifier")` — code clarity and maintainability pass on FILES_CHANGED
3. `Task(subagent_type="Scrutinizer")` — 9-pillar quality evaluation on FILES_CHANGED
4. `Task(subagent_type="Validator")` (re-validate after Simplifier/Scrutinizer changes)
5. `Task(subagent_type="Evaluator")` — verify implementation matches original request — retry up to 2× if misalignment found
6. `Task(subagent_type="Tester")` — scenario-based acceptance testing from user's perspective — retry up to 2× if QA fails

If any gate exhausts retries, halt pipeline and report what passed and what failed.

## Phase 6: Completion

Cleanup: delete `.docs/handoff.md` if it exists (no longer needed after pipeline completes).

Report results:
- Commits created (from Coder)
- Files changed
- Quality gate results (pass/fail per gate)
- No push — user decides when to push

## Error Handling

- **Coder BLOCKED**: Halt immediately, report blocker to user
- **Validator fails after retries**: Report specific failures, halt pipeline
- **Evaluator misalignment after retries**: Report misalignment details, let user decide next steps
- **Tester QA failures after retries**: Report QA failure details, let user decide next steps
