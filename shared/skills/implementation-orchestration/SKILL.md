---
name: implementation-orchestration
description: Agent orchestration for IMPLEMENT intent — pre-flight, Coder, quality gates
user-invocable: false
allowed-tools: Read, Grep, Glob, Bash, Task, AskUserQuestion
---

# Implementation Orchestration

Agent pipeline for IMPLEMENT intent in ambient ORCHESTRATED mode. Pre-flight checks, plan synthesis, Coder execution, and quality gates.

## Iron Law

> **QUALITY GATES ARE NON-NEGOTIABLE**
>
> Every Coder output passes through Validator → Simplifier → Scrutinizer → re-Validate → Shepherd.
> Skipping a gate because "it looks fine" is never acceptable. The pipeline runs to completion
> or halts on failure — there is no shortcut.

---

## Phase 1: Pre-flight — Branch Safety

Detect branch type before spawning Coder:

- **Work branches** (`feat/`, `fix/`, `chore/`, `refactor/`, `docs/` prefix): proceed on current branch.
- **Protected branches** (`main`, `master`, `develop`, `release/*`, `staging`, `production`): ask user via AskUserQuestion with 2-3 suggested branch names following `{type}/{ticket}-{slug}` convention. Include ticket number if available from conversation context.
- **If user declines branch creation**: proceed on the protected branch. Respect the user's choice.

## Phase 2: Plan Synthesis

Synthesize conversation context into a structured EXECUTION_PLAN for Coder:

- **If a plan exists** in conversation context (from plan mode — accepted in-session or injected after "accept and clear") → use the plan as-is.
- **Otherwise** → synthesize from conversation: what to build, files/modules affected, constraints, decisions made during discussion.

Format as structured markdown with: Goal, Steps, Files, Constraints, Decisions.

## Phase 3: Coder Execution

Record git SHA before first Coder: `git rev-parse HEAD`

Spawn Coder agent with input variables:
- **TASK_ID**: Generated from timestamp (e.g., `task-2026-03-19_1430`)
- **TASK_DESCRIPTION**: From conversation context
- **BASE_BRANCH**: Current branch (or newly created branch from Phase 1)
- **EXECUTION_PLAN**: From Phase 2
- **PATTERNS**: Codebase patterns from conversation context
- **CREATE_PR**: `false` (commit only, no push)
- **DOMAIN**: Inferred from files in scope (`backend`, `frontend`, `tests`, `fullstack`)

**Execution strategy**: Single sequential Coder by default. Parallel Coders only when tasks are self-contained — zero shared contracts, no integration points, different files/modules with no imports between them.

If Coder returns **BLOCKED**, halt the pipeline and report to user.

## Phase 4: FILES_CHANGED Detection

After Coder completes, detect changed files:

```bash
git diff --name-only {starting_sha}...HEAD
```

Pass FILES_CHANGED to all quality gate agents.

## Phase 5: Quality Gates

Run sequentially — each gate must pass before the next:

1. **Validator** (build + typecheck + lint + tests) — retry up to 2× on failure (Coder fixes between retries)
2. **Simplifier** — code clarity and maintainability pass on FILES_CHANGED
3. **Scrutinizer** — 9-pillar quality evaluation on FILES_CHANGED
4. **Validator** (re-validate after Simplifier/Scrutinizer changes)
5. **Shepherd** — verify implementation matches original request — retry up to 2× if misalignment found

If any gate exhausts retries, halt pipeline and report what passed and what failed.

## Phase 6: Completion

Report results:
- Commits created (from Coder)
- Files changed
- Quality gate results (pass/fail per gate)
- No push — user decides when to push

## Error Handling

- **Coder BLOCKED**: Halt immediately, report blocker to user
- **Validator fails after retries**: Report specific failures, halt pipeline
- **Shepherd misalignment after retries**: Report misalignment details, let user decide next steps
