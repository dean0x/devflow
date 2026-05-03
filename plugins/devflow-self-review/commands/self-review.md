---
description: Self-review workflow - Simplifier (code clarity) then Scrutinizer (9-pillar quality gate)
---

# Self-Review Command

Run Simplifier and Scrutinizer sequentially on changed files for post-implementation quality refinement.

## Usage

/self-review              (auto-detect changed files from git)
/self-review <file>...    (review specific files)

## Phases

### Phase 0: Context Gathering

**Produces:** FILES_CHANGED, TASK_DESCRIPTION, DECISIONS_CONTEXT, FEATURE_KNOWLEDGE

Detect changed files and build context:

1. If arguments provided, use those as FILES_CHANGED
2. Else run `git diff --name-only HEAD` + `git diff --name-only --cached` to get staged + unstaged
3. If no changes found, report "No changes to review" and exit
4. Build TASK_DESCRIPTION from recent commit messages or branch name
5. Load decisions index:
   ```bash
   DECISIONS_CONTEXT=$(node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "{worktree}" 2>/dev/null || echo "(none)")
   ```
   Pass `DECISIONS_CONTEXT` to Scrutinizer — the compact index lists active ADR/PF entries; Scrutinizer uses `devflow:apply-decisions` to Read full entry bodies on demand. Known pitfalls help identify reintroduced issues, prior decisions help validate architectural consistency. (Simplifier does not consume decisions — it operates at code-shape level and Scrutinizer runs after to catch any architectural drift.)
6. Load feature knowledge:
   - Read `.features/index.json` if it exists
   - Based on FILES_CHANGED, identify relevant KBs (match file paths against KB `directories` and `referencedFiles`)
   - For each match: check staleness via `node ~/.devflow/scripts/hooks/lib/feature-kb.cjs stale "{worktree}" {slug} 2>/dev/null`, read `.features/{slug}/KNOWLEDGE.md`
   - Set `FEATURE_KNOWLEDGE` (or `(none)` if no KBs exist or none are relevant)
   - Pass `FEATURE_KNOWLEDGE` to Scrutinizer

**Extract:** FILES_CHANGED (list), TASK_DESCRIPTION (string), DECISIONS_CONTEXT (string, optional), FEATURE_KNOWLEDGE (string, optional)

### Phase 1: Simplifier (Code Refinement)

**Produces:** SIMPLIFIER_COMMITS
**Requires:** FILES_CHANGED, TASK_DESCRIPTION

Spawn Simplifier agent to refine code for clarity and consistency:

Agent(subagent_type="Simplifier", run_in_background=false):
"TASK_DESCRIPTION: {task_description}
FILES_CHANGED: {files_changed}
Simplify and refine the code for clarity and consistency while preserving functionality."

**Wait for completion.** Simplifier commits changes directly.

### Phase 2: Scrutinizer (9-Pillar Quality Gate)

**Produces:** SCRUTINIZER_STATUS, SCRUTINIZER_CHANGES
**Requires:** FILES_CHANGED, TASK_DESCRIPTION, DECISIONS_CONTEXT

Spawn Scrutinizer agent for quality evaluation and fixing:

Agent(subagent_type="Scrutinizer", run_in_background=false):
"TASK_DESCRIPTION: {task_description}
FILES_CHANGED: {files_changed}
DECISIONS_CONTEXT: {decisions_context}
FEATURE_KNOWLEDGE: {feature_knowledge}
Evaluate against 9-pillar framework. Fix P0/P1 issues. Return structured report.
Follow devflow:apply-decisions to scan DECISIONS_CONTEXT and Read full ADR/PF bodies on demand. Skip if (none).
Follow devflow:apply-feature-kb for FEATURE_KNOWLEDGE. Skip if (none)."

**Wait for completion.** Extract: STATUS (PASS|FIXED|BLOCKED), changes_made (bool)

### Phase 3: Conditional Validation

**Produces:** VALIDATION_RESULT
**Requires:** SCRUTINIZER_CHANGES

If Scrutinizer made changes (STATUS == FIXED):

Agent(subagent_type="Validator", run_in_background=false):
"FILES_CHANGED: {scrutinizer_modified_files}
VALIDATION_SCOPE: changed-only
Run build, typecheck, lint, test on modified files"

**If FAIL:** Report validation failures to user and halt
**If PASS:** Continue to report

### Phase 4: Report

**Requires:** SCRUTINIZER_STATUS, VALIDATION_RESULT

Display summary:

## Self-Review Complete

**Files Reviewed**: {n}
**Status**: {PASS|FIXED|BLOCKED}

### Simplifier
- {n} files refined for clarity

### Scrutinizer (9-Pillar Evaluation)
| Pillar | Status |
|--------|--------|
| Design | {status} |
| Functionality | {status} |
| Security | {status} |
| Complexity | {status} |
| Error Handling | {status} |
| Tests | {status} |
| Naming | {status} |
| Consistency | {status} |
| Documentation | {status} |

### Commits Created
- {sha} {message}

{If BLOCKED: ### Blocking Issue\n{description}}

## Architecture

/self-review (orchestrator)
│
├─ Phase 0: Context gathering
│  ├─ Git diff for changed files
│  └─ Load decisions index (decisions-index.cjs index)
│
├─ Phase 1: Simplifier
│  └─ Code refinement (commits directly)
│
├─ Phase 2: Scrutinizer
│  └─ 9-pillar quality gate (may fix and commit)
│
├─ Phase 3: Validator (conditional)
│  └─ If Scrutinizer made changes, verify tests pass
│
└─ Phase 4: Report
   └─ Display summary with pillar status

## Edge Cases

| Case | Handling |
|------|----------|
| No changes | Report "No changes to review" and exit |
| Simplifier finds nothing | Normal, continue to Scrutinizer |
| Scrutinizer BLOCKED | Report blocking issue, halt workflow |
| Validation fails | Report failures, halt (don't create broken state) |
| Not in git repo | Report error, suggest running in git repo |

## Principles

1. **Orchestration only** - Command spawns agents, doesn't do the work
2. **Sequential execution** - Simplifier must complete before Scrutinizer
3. **Validation gate** - If Scrutinizer changes code, must pass validation
4. **Honest reporting** - Display actual agent outputs
5. **Fail fast** - Stop on BLOCKED or validation failure
