---
description: Execute a single task through implementation, quality gates, and PR creation - accepts plan documents, issues, or task descriptions
---

<!--
@devflow-design-decision D8
Phase 10 previously recorded decisions retrospectively after reading knowledge-persistence SKILL.
Removed in v2 because agent-summaries produced low-signal entries. Knowledge is now extracted
from user transcripts by scripts/hooks/background-learning.
-->

# Implement Command

Orchestrate a single task through implementation by spawning specialized agents. The orchestrator only spawns agents and passes context - all work is done by agents.

## Usage

```
/implement <task description>
/implement #42                                     (GitHub issue number)
/implement .docs/design/42-jwt-auth.2026-04-07_1430.md  (plan document from /plan)
/implement                                         (use conversation context)
```

## Input

`$ARGUMENTS` contains whatever follows `/implement`:
- Plan document path: `.docs/design/42-jwt-auth.2026-04-07_1430.md` (path to an existing `.md` file)
- GitHub issue: `#42`
- Task description: "implement JWT auth"
- Empty: use conversation context

> **Tip**: For best results, run `/plan` first to produce a design artifact, then pass it to `/implement`.

## Phases

### Phase 1: Setup

**Produces:** TASK_ID, BASE_BRANCH, EXECUTION_PLAN, FEATURE_KNOWLEDGE

Record the current branch name as `BASE_BRANCH` - this will be the PR target.

Spawn Git agent to set up task environment. The Git agent derives the branch name automatically from the issue or task description:

```
Agent(subagent_type="Git"):
"OPERATION: setup-task
BASE_BRANCH: {current branch name}
ISSUE_INPUT: {issue number if $ARGUMENTS starts with #, otherwise omit}
TASK_DESCRIPTION: {task description from $ARGUMENTS if not an issue number or .md path, otherwise omit}
Derive branch name from issue or description, create feature branch, and fetch issue if specified.
Return the branch setup summary."
```

**Capture from Git agent output** (used throughout flow):
- `TASK_ID`: The branch name created by Git agent (use as TASK_ID for rest of flow)
- `BASE_BRANCH`: Branch this feature was created from (for PR target)
- `ISSUE_NUMBER`: GitHub issue number (if provided)
- `ISSUE_CONTENT`: Full issue body including description (if provided)
- `ACCEPTANCE_CRITERIA`: Extracted acceptance criteria from issue (if provided)

**Plan Document Handling** (when $ARGUMENTS is a path ending in `.md`):
1. Read the plan document from the path provided
2. Extract from YAML frontmatter: `execution-strategy`, `context-risk`, `issue` number
3. Extract from body: Subtask Breakdown, Implementation Plan, Patterns to Follow, Acceptance Criteria
4. If `issue` field present in frontmatter: pass to Git agent as ISSUE_INPUT
5. Use extracted content as EXECUTION_PLAN for the Coder phase (replaces exploration/planning output)
6. Captured values override defaults from Git agent where present

**Load Feature Knowledge:**
1. Read `.features/index.json` if it exists
2. Based on task description and file targets, identify relevant KBs
3. For each match: check staleness via `node scripts/hooks/lib/feature-kb.cjs stale "{worktree}" {slug}`, read `.features/{slug}/KNOWLEDGE.md`
4. Set `FEATURE_KNOWLEDGE` (or `(none)` if no KBs exist or none are relevant)

### Phase 2: Implement

**Produces:** CODER_OUTPUT, FILES_CHANGED
**Requires:** TASK_ID, BASE_BRANCH, EXECUTION_PLAN

Based on Setup context (plan document, issue body, or conversation context), use the three-strategy framework:

**Strategy Selection**:
- If plan document provided: use `execution-strategy` from frontmatter (default: SINGLE_CODER if absent)
- Otherwise: default to SINGLE_CODER unless task description signals high complexity

| Strategy | When | Frequency |
|----------|------|-----------|
| **SINGLE_CODER** | Default. Coherent A→Z implementation | ~80% |
| **SEQUENTIAL_CODERS** | Context overflow risk, layered dependencies | ~15% |
| **PARALLEL_CODERS** | True artifact independence (rare) | ~5% |

---

**SINGLE_CODER** (default):

```
Agent(subagent_type="Coder"):
"TASK_ID: {task-id}
TASK_DESCRIPTION: {description}
BASE_BRANCH: {base branch}
EXECUTION_PLAN: {full plan from setup context}
PATTERNS: {patterns from plan document or empty}
CREATE_PR: true
DOMAIN: {detected domain or 'fullstack'}
FEATURE_KNOWLEDGE: {feature_knowledge}"
```

---

**SEQUENTIAL_CODERS** (for HIGH/CRITICAL context risk):

Spawn Coders one at a time, passing handoff summaries between phases:

**Phase 1 Coder:**
```
Agent(subagent_type="Coder"):
"TASK_ID: {task-id}
TASK_DESCRIPTION: {phase 1 description}
BASE_BRANCH: {base branch}
EXECUTION_PLAN: {phase 1 steps}
PATTERNS: {patterns from plan document or empty}
CREATE_PR: false
DOMAIN: {phase 1 domain, e.g., 'backend'}
FEATURE_KNOWLEDGE: {feature_knowledge}
HANDOFF_REQUIRED: true"
```

**Phase 2+ Coders** (after prior phase completes):
```
Agent(subagent_type="Coder"):
"TASK_ID: {task-id}
TASK_DESCRIPTION: {phase N description}
BASE_BRANCH: {base branch}
EXECUTION_PLAN: {phase N steps}
PATTERNS: {patterns from plan document or empty}
CREATE_PR: {true if last phase, false otherwise}
DOMAIN: {phase N domain, e.g., 'frontend'}
PRIOR_PHASE_SUMMARY: {summary from previous Coder}
FILES_FROM_PRIOR_PHASE: {list of files created}
FEATURE_KNOWLEDGE: {feature_knowledge}
HANDOFF_REQUIRED: {true if not last phase}"
```

**Handoff Protocol**: Each sequential Coder receives the prior Coder's implementation summary via PRIOR_PHASE_SUMMARY and FILES_FROM_PRIOR_PHASE. The Coder's built-in branch orientation step handles git log scanning, file reading, and pattern discovery automatically.

---

**PARALLEL_CODERS** (rare - truly independent artifacts):

Spawn multiple Coders **in a single message**, each with independent subtask:

```
Agent(subagent_type="Coder"):  # Coder 1
"TASK_ID: {task-id}-part1
TASK_DESCRIPTION: {independent subtask 1}
BASE_BRANCH: {base branch}
EXECUTION_PLAN: {subtask 1 steps}
PATTERNS: {patterns}
CREATE_PR: false
DOMAIN: {subtask 1 domain}
FEATURE_KNOWLEDGE: {feature_knowledge}"

Agent(subagent_type="Coder"):  # Coder 2 (same message)
"TASK_ID: {task-id}-part2
TASK_DESCRIPTION: {independent subtask 2}
BASE_BRANCH: {base branch}
EXECUTION_PLAN: {subtask 2 steps}
PATTERNS: {patterns}
CREATE_PR: false
DOMAIN: {subtask 2 domain}
FEATURE_KNOWLEDGE: {feature_knowledge}"
```

**Independence criteria** (all must be true for PARALLEL_CODERS):
- No shared contracts or interfaces
- No integration points between subtasks
- Different files/modules with no imports between them
- Each subtask is self-contained

### Phase 3: Validate

**Produces:** VALIDATION_RESULT
**Requires:** FILES_CHANGED

After Coder completes, spawn Validator to verify correctness:

```
Agent(subagent_type="Validator", model="haiku"):
"FILES_CHANGED: {list of files from Coder output}
VALIDATION_SCOPE: full
Run build, typecheck, lint, test. Report pass/fail with failure details."
```

**If FAIL:**
1. Extract failure details from Validator output
2. Increment `validation_retry_count`
3. If `validation_retry_count <= 2`:
   - Spawn Coder with fix context:
   ```
   Agent(subagent_type="Coder"):
   "TASK_ID: {task-id}
   TASK_DESCRIPTION: Fix validation failures
   OPERATION: validation-fix
   VALIDATION_FAILURES: {parsed failures from Validator}
   SCOPE: Fix only the listed failures, no other changes
   CREATE_PR: false"
   ```
   - Loop back to Phase 3 (re-validate)
4. If `validation_retry_count > 2`: Report failures to user and halt

**If PASS:** Continue to Phase 4

### Phase 4: Simplify

**Produces:** SIMPLIFIER_OUTPUT
**Requires:** FILES_CHANGED

After validation passes, spawn Simplifier to polish the code:

```
Agent(subagent_type="Simplifier"):
"Simplify recently implemented code
Task: {task description}
FILES_CHANGED: {list of files from Coder output}
Focus on code modified by Coder, apply project standards, enhance clarity"
```

### Phase 5: Self-Review

**Produces:** SCRUTINIZER_OUTPUT
**Requires:** FILES_CHANGED

After Simplifier completes, spawn Scrutinizer as final quality gate:

```
Agent(subagent_type="Scrutinizer"):
"TASK_DESCRIPTION: {task description}
FILES_CHANGED: {list of files from Coder output}
FEATURE_KNOWLEDGE: {feature_knowledge}
Evaluate 9 pillars, fix P0/P1 issues, report status"
```

If Scrutinizer returns BLOCKED, report to user and halt.

### Phase 6: Re-Validate (if Scrutinizer made changes)

**Produces:** REVALIDATION_RESULT
**Requires:** SCRUTINIZER_OUTPUT

If Scrutinizer made code changes (status: FIXED), spawn Validator to verify:

```
Agent(subagent_type="Validator", model="haiku"):
"FILES_CHANGED: {files modified by Scrutinizer}
VALIDATION_SCOPE: changed-only
Verify Scrutinizer's fixes didn't break anything."
```

**If FAIL:** Report to user - Scrutinizer broke tests, needs manual intervention.

**If PASS:** Continue to Phase 7

### Phase 7: Alignment Check

**Produces:** ALIGNMENT_RESULT
**Requires:** FILES_CHANGED, EXECUTION_PLAN

After Scrutinizer passes (and re-validation if needed), spawn Evaluator to validate alignment:

```
Agent(subagent_type="Evaluator"):
"ORIGINAL_REQUEST: {task description or issue content}
EXECUTION_PLAN: {execution plan from Phase 1}
FILES_CHANGED: {list of files from Coder output}
ACCEPTANCE_CRITERIA: {extracted criteria if available}
Validate alignment with request and plan. Report ALIGNED or MISALIGNED with details."
```

**If ALIGNED:** Continue to Phase 8

**If MISALIGNED:**
1. Extract misalignment details from Evaluator output
2. Increment `alignment_fix_count`
3. If `alignment_fix_count <= 2`:
   - Spawn Coder to fix misalignments:
   ```
   Agent(subagent_type="Coder"):
   "TASK_ID: {task-id}
   TASK_DESCRIPTION: Fix alignment issues
   OPERATION: alignment-fix
   MISALIGNMENTS: {structured misalignments from Evaluator}
   SCOPE: Fix only the listed misalignments, no other changes
   CREATE_PR: false"
   ```
   - Spawn Validator to verify fix didn't break tests:
   ```
   Agent(subagent_type="Validator", model="haiku"):
   "FILES_CHANGED: {files modified by fix Coder}
   VALIDATION_SCOPE: changed-only"
   ```
   - If Validator FAIL: Report to user
   - If Validator PASS: Loop back to Phase 7 (re-check alignment)
4. If `alignment_fix_count > 2`: Report misalignments to user for decision

### Phase 8: QA Testing

**Produces:** QA_RESULT
**Requires:** FILES_CHANGED, EXECUTION_PLAN

After Evaluator passes, spawn Tester for scenario-based acceptance testing:

```
Agent(subagent_type="Tester"):
"ORIGINAL_REQUEST: {task description or issue content}
EXECUTION_PLAN: {execution plan from Phase 1}
FILES_CHANGED: {list of files from Coder output}
ACCEPTANCE_CRITERIA: {extracted criteria if available}
Design and execute scenario-based acceptance tests. Report PASS or FAIL with evidence."
```

**If PASS:** Continue to Phase 9

**If FAIL:**
1. Extract failure details from Tester output
2. Increment `qa_retry_count`
3. If `qa_retry_count <= 2`:
   - Spawn Coder to fix QA failures:
   ```
   Agent(subagent_type="Coder"):
   "TASK_ID: {task-id}
   TASK_DESCRIPTION: Fix QA test failures
   OPERATION: qa-fix
   QA_FAILURES: {structured failures from Tester}
   SCOPE: Fix only the listed failures, no other changes
   CREATE_PR: false"
   ```
   - Spawn Validator to verify fix didn't break tests:
   ```
   Agent(subagent_type="Validator", model="haiku"):
   "FILES_CHANGED: {files modified by fix Coder}
   VALIDATION_SCOPE: changed-only"
   ```
   - If Validator FAIL: Report to user
   - If Validator PASS: Loop back to Phase 8 (re-run Tester)
4. If `qa_retry_count > 2`: Report QA failures to user for decision

### Phase 9: Create PR

**Produces:** PR_URL
**Requires:** BASE_BRANCH, TASK_ID

**For SEQUENTIAL_CODERS or PARALLEL_CODERS**: The last sequential Coder (with CREATE_PR: true) handles PR creation. For parallel coders, create unified PR using `devflow:git` skill patterns. Push branch and run `gh pr create` with comprehensive description, targeting `BASE_BRANCH`.

**For SINGLE_CODER**: PR is created by the Coder agent (CREATE_PR: true).

### Phase 10: Report

**Requires:** VALIDATION_RESULT, ALIGNMENT_RESULT, QA_RESULT, PR_URL

After quality gates pass, check for overlapping feature KBs whose `referencedFiles` intersect the changed files:
```bash
node scripts/hooks/lib/feature-kb.cjs find-overlapping "{worktree}" {files_changed...}
```

Display completion summary with phase status, PR info, and next steps.

## Architecture

```
/implement (orchestrator - spawns agents only)
│
├─ Phase 1: Setup
│  └─ Git agent (operation: setup-task) - creates feature branch, fetches issue
│  └─ Plan document parsing (if .md path provided) - extracts execution plan, strategy
│
├─ Phase 2: Implement (3-strategy framework)
│  ├─ SINGLE_CODER (80%): One Coder, full plan, CREATE_PR: true
│  ├─ SEQUENTIAL_CODERS (15%): N Coders with handoff summaries
│  └─ PARALLEL_CODERS (5%): N Coders in single message (rare)
│
├─ Phase 3: Validate
│  └─ Validator agent (build, typecheck, lint, test)
│  └─ If FAIL: Coder fix loop (max 2 retries) → re-validate
│
├─ Phase 4: Simplify
│  └─ Simplifier agent (refines code clarity and consistency)
│
├─ Phase 5: Self-Review
│  └─ Scrutinizer agent (final quality gate, fixes P0/P1)
│
├─ Phase 6: Re-Validate (if Scrutinizer made changes)
│  └─ Validator agent (verify Scrutinizer fixes)
│
├─ Phase 7: Alignment Check
│  └─ Evaluator agent (validates alignment - reports only, no fixes)
│  └─ If MISALIGNED: Coder fix loop (max 2 iterations) → Validator → re-check
│
├─ Phase 8: QA Testing
│  └─ Tester agent (scenario-based acceptance tests)
│  └─ If FAIL: Coder fix loop (max 2 retries) → Validator → re-test
│
├─ Phase 9: Create PR (if needed)
│  └─ SINGLE_CODER: handled by Coder
│  └─ SEQUENTIAL: handled by last Coder
│  └─ PARALLEL: orchestrator creates unified PR
│
└─ Phase 10: Report
```

## Principles

1. **Orchestration only** - Command spawns agents, never does work itself
2. **Plan-first** - Plan documents from `/plan` skip exploration/planning overhead entirely
3. **Coherence-first** - Single Coder produces more consistent code (default ~80% of tasks)
4. **Agent ownership** - Each agent owns its output completely
5. **Clean handoffs** - Each phase passes structured data to next; sequential Coders pass implementation summaries
6. **Honest reporting** - Display agent outputs directly
7. **Simplification pass** - Code refined for clarity before PR
8. **Strict delegation** - Never perform agent work in main session. "Spawn X" means call Agent tool with X, not do X's work yourself
9. **Validator owns validation** - Never run `npm test`, `npm run build`, or similar in main session; always delegate to Validator agent
10. **Coder owns fixes** - Never implement fixes in main session; spawn Coder for validation failures and alignment fixes
11. **Loop limits** - Max 2 validation retries, max 2 alignment fix iterations before escalating to user

## Error Handling

If any agent fails, report the phase, agent type, and error. Offer options: retry phase, investigate systematically, or escalate to user.
