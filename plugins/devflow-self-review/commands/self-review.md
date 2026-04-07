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

Detect changed files and build context:

1. If arguments provided, use those as FILES_CHANGED
2. Else run `git diff --name-only HEAD` + `git diff --name-only --cached` to get staged + unstaged
3. If no changes found, report "No changes to review" and exit
4. Build TASK_DESCRIPTION from recent commit messages or branch name
5. Read `.memory/knowledge/pitfalls.md` and `.memory/knowledge/decisions.md`. Pass as KNOWLEDGE_CONTEXT to Simplifier and Scrutinizer — known pitfalls help identify reintroduced issues, prior decisions help validate architectural consistency.

**Extract:** FILES_CHANGED (list), TASK_DESCRIPTION (string), KNOWLEDGE_CONTEXT (string, optional)

### Phase 1: Simplifier (Code Refinement)

Spawn Simplifier agent to refine code for clarity and consistency:

Agent(subagent_type="Simplifier", run_in_background=false):
"TASK_DESCRIPTION: {task_description}
FILES_CHANGED: {files_changed}
KNOWLEDGE_CONTEXT: {knowledge_context or 'None'}
Simplify and refine the code for clarity and consistency while preserving functionality.
If knowledge context is provided, verify no known pitfall patterns are being reintroduced."

**Wait for completion.** Simplifier commits changes directly.

### Phase 2: Scrutinizer (9-Pillar Quality Gate)

Spawn Scrutinizer agent for quality evaluation and fixing:

Agent(subagent_type="Scrutinizer", run_in_background=false):
"TASK_DESCRIPTION: {task_description}
FILES_CHANGED: {files_changed}
KNOWLEDGE_CONTEXT: {knowledge_context or 'None'}
Evaluate against 9-pillar framework. Fix P0/P1 issues. Return structured report.
If knowledge context is provided, check whether any known pitfall patterns are being reintroduced and verify architectural consistency with prior decisions."

**Wait for completion.** Extract: STATUS (PASS|FIXED|BLOCKED), changes_made (bool)

### Phase 3: Conditional Validation

If Scrutinizer made changes (STATUS == FIXED):

Agent(subagent_type="Validator", run_in_background=false):
"FILES_CHANGED: {scrutinizer_modified_files}
VALIDATION_SCOPE: changed-only
Run build, typecheck, lint, test on modified files"

**If FAIL:** Report validation failures to user and halt
**If PASS:** Continue to report

### Phase 4: Report

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
│  └─ Read project knowledge (decisions.md + pitfalls.md)
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
