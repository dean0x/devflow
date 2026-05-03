---
name: implement:orch
description: Agent orchestration for IMPLEMENT intent — pre-flight, Coder, quality gates
user-invocable: false
---

# Implementation Orchestration

Agent pipeline for IMPLEMENT intent in ambient ORCHESTRATED mode. Pre-flight checks, plan synthesis, Coder execution, and quality gates.

This is a lightweight variant of `/implement` for ambient ORCHESTRATED mode. Excluded: strategy selection (single/sequential/parallel Coders), retry loops, PR creation.

## Iron Law

> **QUALITY GATES ARE NON-NEGOTIABLE**
>
> Every Coder output passes through Validator → Simplifier → Scrutinizer → re-Validate → Evaluator → Tester.
> Skipping a gate because "it looks fine" is never acceptable. The pipeline runs to completion
> or halts on failure — there is no shortcut.

---

## Continuation Detection

Before starting the full pipeline, check for re-validation context:

- **Re-validation after manual fix**: User explicitly asks to re-validate, re-check, or re-run gates after making their own changes

If this condition is true → execute **Re-validation Path**:
1. **Branch safety check**: If current branch is protected (main, master, etc.), execute Phase 1 first to create/switch to a work branch. If already on a work branch, skip Phase 1.
2. Skip Phases 3-4 (no Coder needed)
3. Run Phase 5 (FILES_CHANGED Detection) using the existing branch
4. Run Phase 6 (Quality Gates) on detected changes
5. Proceed to Phase 7 (Completion)

If not → proceed with the full pipeline below.

## Phase 1: Pre-flight — Branch Safety

**Produces:** BASE_BRANCH, FEATURE_BRANCH

Detect branch type before spawning Coder:

- **Work branches** (`feat/`, `fix/`, `chore/`, `refactor/`, `docs/` prefix): proceed on current branch.
- **Protected branches** (`main`, `master`, `develop`, `integration`, `trunk`, `release/*`, `staging`, `production`): record current branch as `BASE_BRANCH`, then spawn Git agent to auto-create a feature branch:

```
Agent(subagent_type="Git"):
"OPERATION: setup-task
BASE_BRANCH: {current branch name}
ISSUE_INPUT: {issue number if ticket mentioned in conversation, otherwise omit}
TASK_DESCRIPTION: {task description from conversation context}
Derive branch name from issue or description, create feature branch, and fetch issue if specified.
Return the branch setup summary."
```

Capture `branch name` and `BASE_BRANCH` from Git agent output for use throughout the pipeline.

## Phase 2: Load Decisions

**Produces:** DECISIONS_CONTEXT, FEATURE_KNOWLEDGE, STALE_KB_SLUGS

Load the decisions index:
```bash
DECISIONS_CONTEXT=$(node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "{worktree}" 2>/dev/null || echo "(none)")
```
Pass `DECISIONS_CONTEXT` to Coder (Phase 4) and Scrutinizer (Phase 6).

1. Check if `.features/index.json` exists. If not, set `FEATURE_KNOWLEDGE = (none)` and skip.
2. Read `.features/index.json`.
3. Based on the EXECUTION_PLAN file targets and task description, identify relevant KBs.
4. For each relevant KB: check staleness via `node ~/.devflow/scripts/hooks/lib/feature-kb.cjs stale "{worktree}" {slug} 2>/dev/null`, read `.features/{slug}/KNOWLEDGE.md`, mark stale if needed.
5. Concatenate as `FEATURE_KNOWLEDGE` (or `(none)` if no matches).
6. Collect slugs where staleness check returned stale → `STALE_KB_SLUGS`.

## Phase 3: Plan Synthesis

**Produces:** EXECUTION_PLAN
**Requires:** FEATURE_BRANCH

Synthesize conversation context into a structured EXECUTION_PLAN for Coder:

- **If a plan exists** in conversation context (from plan mode — accepted in-session or injected after "accept and clear") → use the plan as-is.
- **Otherwise** → synthesize from conversation: what to build, files/modules affected, constraints, decisions made during discussion.

Format as structured markdown with: Goal, Steps, Files, Constraints, Decisions.

## Worktree Support

If the orchestrator receives a `WORKTREE_PATH` context (e.g., from multi-worktree workflows), pass it through to all spawned agents. Each agent's "Worktree Support" section handles path resolution.

## Phase 4: Coder Execution

**Produces:** CODER_COMMITS, PRE_CODER_SHA
**Requires:** EXECUTION_PLAN, FEATURE_BRANCH

Record git SHA before first Coder: `git rev-parse HEAD`

Spawn `Agent(subagent_type="Coder")` with input variables:
- **TASK_ID**: Generated from timestamp (e.g., `task-2026-03-19_1430`)
- **TASK_DESCRIPTION**: From conversation context
- **BASE_BRANCH**: Current branch (or newly created branch from Phase 1)
- **EXECUTION_PLAN**: From Phase 3
- **PATTERNS**: Codebase patterns from conversation context
- **CREATE_PR**: `false` (commit only, no push)
- **DOMAIN**: Inferred from files in scope (`backend`, `frontend`, `tests`, `fullstack`)
- **FEATURE_KNOWLEDGE**: From Phase 2 (or `(none)`)
- **DECISIONS_CONTEXT**: From Phase 2 (or `(none)`)

**Execution strategy**: Single sequential Coder by default. Parallel Coders only when tasks are self-contained — zero shared contracts, no integration points, different files/modules with no imports between them.

**TDD Enforcement**: Coder MUST follow TDD (RED-GREEN-REFACTOR). Test commits must precede production code. This is defense-in-depth — even if Coder frontmatter changes, the orchestrator enforces TDD.

If Coder returns **BLOCKED**, halt the pipeline and report to user.

**Handoff artifact** (when HANDOFF_REQUIRED=true): After Coder completes, write the phase summary to `.docs/handoff.md` using the Write tool. The next Coder reads this on startup (see Coder agent Responsibility 1). This survives context compaction — unlike PRIOR_PHASE_SUMMARY which is context-mediated.

## Phase 5: FILES_CHANGED Detection

**Produces:** FILES_CHANGED
**Requires:** PRE_CODER_SHA

After Coder completes, detect changed files:

```bash
git diff --name-only {starting_sha}...HEAD
```

Pass FILES_CHANGED to all quality gate agents.

## Phase 6: Quality Gates

**Produces:** GATE_RESULTS
**Requires:** FILES_CHANGED, CODER_COMMITS

Run sequentially — each gate must pass before the next:

1. `Agent(subagent_type="Validator")` (build + typecheck + lint + tests) — retry up to 2× on failure (Coder fixes between retries)
2. `Agent(subagent_type="Simplifier")` — code clarity and maintainability pass on FILES_CHANGED
3. `Agent(subagent_type="Scrutinizer")` — 9-pillar quality evaluation on FILES_CHANGED, with `DECISIONS_CONTEXT` and `FEATURE_KNOWLEDGE` from Phase 2
4. `Agent(subagent_type="Validator")` (re-validate after Simplifier/Scrutinizer changes)
5. `Agent(subagent_type="Evaluator")` — verify implementation matches original request, with `FEATURE_KNOWLEDGE` from Phase 2 — retry up to 2× if misalignment found
6. `Agent(subagent_type="Tester")` — scenario-based acceptance testing from user's perspective — retry up to 2× if QA fails

If any gate exhausts retries, halt pipeline and report what passed and what failed.

## Phase 7: Completion

**Requires:** GATE_RESULTS, FILES_CHANGED, CODER_COMMITS

Cleanup: delete `.docs/handoff.md` if it exists (no longer needed after pipeline completes).

After quality gates pass, check for overlapping KBs whose `referencedFiles` intersect FILES_CHANGED:
```bash
OVERLAPPING_SLUGS=$(node ~/.devflow/scripts/hooks/lib/feature-kb.cjs find-overlapping "{worktree}" {files_changed...} 2>/dev/null)
```
Parse the JSON array output to get slug strings. Pass `OVERLAPPING_SLUGS` to Phase 8.

Report results:
- Commits created (from Coder)
- Files changed
- Quality gate results (pass/fail per gate)
- No push — user decides when to push

## Phase 8: Feature KB Generation (Conditional)

**Requires:** FILES_CHANGED, STALE_KB_SLUGS, OVERLAPPING_SLUGS, DECISIONS_CONTEXT
**Produces:** Updated `.features/index.json` (or skipped)

If `.features/.disabled` exists, skip entirely.

**New KB creation**: If FILES_CHANGED touch a feature area that does NOT have a matching KB in `.features/index.json`:

**Slug derivation**: Derive the slug from the primary directory name using kebab-case. Examples: `src/cli/commands/` → `cli-commands`, `src/payments/stripe/` → `payments-stripe`, `scripts/hooks/` → `hooks`. Strip common prefixes like `src/` and `lib/`. The slug must match `^[a-z0-9][a-z0-9-]*$`.

1. Identify the feature area slug and human-readable name from the implemented directories
2. Spawn Agent(subagent_type="Knowledge"):
   ```
   "FEATURE_SLUG: {slug}
   FEATURE_NAME: {name}
   FILES_CHANGED: {files_changed list}
   DIRECTORIES: {directory prefixes from FILES_CHANGED}
   DECISIONS_CONTEXT: {from Phase 2}

   Load the devflow:feature-kb skill and follow its 4-phase process exactly.
   Read the FILES_CHANGED to understand the implemented code.
   Read .features/index.json to see existing KBs for cross-referencing."
   ```
3. Read sidecar (`.features/{slug}/.create-result.json`), then run:
   ```bash
   node ~/.devflow/scripts/hooks/lib/feature-kb.cjs update-index "{worktree}" \
     --slug="{slug}" --name="{name}" \
     --directories='["{dir1}", "{dir2}"]' \
     --referencedFiles='{referencedFiles_json_from_sidecar}' \
     --description="{description_from_sidecar}" \
     --createdBy="implement" 2>/dev/null
   ```
   Clean up: `rm -f .features/{slug}/.create-result.json`
   If the sidecar file does not exist (agent failed to write it), use empty defaults:
   `referencedFiles='[]'`, `description=""`.
4. Report: "Created feature KB: {slug}"

Skip if all touched areas already have matching KBs.

**Refresh stale KBs**: Combine STALE_KB_SLUGS (from Phase 2) and OVERLAPPING_SLUGS (from Phase 7), deduplicate. For each slug, refresh:

1. Read `.features/{slug}/KNOWLEDGE.md` and index entry
2. Spawn Agent(subagent_type="Knowledge"):
   ```
   "FEATURE_SLUG: {slug}
   FEATURE_NAME: {name from index}
   DIRECTORIES: {directories from index}
   EXISTING_KB: {content of .features/{slug}/KNOWLEDGE.md}
   CHANGED_FILES: {FILES_CHANGED that overlap this KB}
   DECISIONS_CONTEXT: {from Phase 2}

   Load the devflow:feature-kb skill. This is a REFRESH, not a new creation.
   Read the CHANGED_FILES to understand what changed, then update the EXISTING_KB.
   Maintain quality standards from the skill. Do NOT regenerate from scratch.
   Write updated KB to .features/{slug}/KNOWLEDGE.md
   Write .features/{slug}/.refresh-result.json with referencedFiles and description."
   ```
3. Read sidecar, update index (same CLI call as step 3 above), clean up sidecar.

**Failure handling**: Non-blocking. If Knowledge agent crashes, log failure and report results normally.

## Error Handling

- **Coder BLOCKED**: Halt immediately, report blocker to user
- **Validator fails after retries**: Report specific failures, halt pipeline
- **Evaluator misalignment after retries**: Report misalignment details, let user decide next steps
- **Tester QA failures after retries**: Report QA failure details, let user decide next steps

## Phase Completion Checklist

Before reporting results, verify every phase was announced:

- [ ] Phase 1: Pre-flight → BASE_BRANCH, FEATURE_BRANCH captured
- [ ] Phase 2: Load Decisions → DECISIONS_CONTEXT and FEATURE_KNOWLEDGE captured (or skipped)
- [ ] Phase 3: Plan Synthesis → EXECUTION_PLAN captured
- [ ] Phase 4: Coder Execution → CODER_COMMITS, PRE_CODER_SHA captured
- [ ] Phase 5: FILES_CHANGED Detection → FILES_CHANGED captured
- [ ] Phase 6: Quality Gates → GATE_RESULTS captured (per gate: pass/fail)
- [ ] Phase 7: Completion → Results reported, OVERLAPPING_SLUGS captured
- [ ] Phase 8: Feature KB Generation → Knowledge agent spawned and index updated (or skipped if all areas covered or feature disabled)

If any phase is unchecked, execute it before proceeding.
