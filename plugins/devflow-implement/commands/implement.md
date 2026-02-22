---
description: Execute a single task through the complete lifecycle - orchestrates exploration, planning, implementation, and simplification with parallel agents
---

# Implement Command

Orchestrate a single task from exploration through implementation by spawning specialized agents. The orchestrator only spawns agents and passes context - all work is done by agents.

## Usage

```
/implement <task description>
/implement #42  (GitHub issue number)
/implement      (use conversation context)
```

## Input

`$ARGUMENTS` contains whatever follows `/implement`:
- Task description: "implement JWT auth"
- GitHub issue: "#42"
- Empty: use conversation context

## Phases

### Phase 1: Setup

Record the current branch name as `BASE_BRANCH` - this will be the PR target.

Generate a unique `TASK_ID`: `task-{YYYY-MM-DD_HHMM}` (e.g., `task-2025-01-15_1430`).

Spawn Git agent to set up task environment:

```
Task(subagent_type="Git"):
"OPERATION: setup-task
TASK_ID: {task-id}
BASE_BRANCH: {current branch name}
ISSUE_INPUT: {issue number if provided, otherwise omit}
Create feature branch and fetch issue if specified.
Return the branch setup summary."
```

**Capture from Git agent output** (used throughout flow):
- `BASE_BRANCH`: Branch this feature was created from (for PR target)
- `ISSUE_NUMBER`: GitHub issue number (if provided)
- `ISSUE_CONTENT`: Full issue body including description (if provided)
- `ACCEPTANCE_CRITERIA`: Extracted acceptance criteria from issue (if provided)

### Phase 1.5: Orient

Spawn Skimmer agent for codebase overview:

```
Task(subagent_type="Skimmer"):
"Orient in codebase for: {task description}
Use skim to identify relevant files, functions, integration points"
```

### Phase 2: Explore (Parallel)

Spawn 4 Explore agents **in a single message**, each with Skimmer context:

| Focus | Thoroughness | Find |
|-------|-------------|------|
| Architecture | medium | Similar implementations, patterns, module structure |
| Integration | medium | Entry points, services, database models, configuration |
| Reusable code | medium | Utilities, helpers, validation patterns, error handling |
| Edge cases | quick | Error scenarios, race conditions, permission failures |

Track success/failure of each explorer for synthesis context.

### Phase 3: Synthesize Exploration

**WAIT** for Phase 2 to complete.

**CRITICAL**: Do NOT synthesize outputs yourself in the main session.
You MUST spawn the Synthesizer agent - "spawn Synthesizer" means delegate to the agent, not do the work yourself.

```
Task(subagent_type="Synthesizer"):
"Synthesize EXPLORATION outputs for: {task}
Mode: exploration
Explorer outputs: {all 4 outputs}
Failed explorations: {any failures}
Combine into: patterns, integration points, reusable code, edge cases"
```

### Phase 4: Plan (Parallel)

Spawn 3 Plan agents **in a single message**, each with exploration synthesis:

| Focus | Output |
|-------|--------|
| Implementation steps | Ordered steps with files and dependencies |
| Testing strategy | Unit tests, integration tests, edge case tests |
| Execution strategy | SINGLE_CODER vs SEQUENTIAL_CODERS vs PARALLEL_CODERS decision |

**Execution Strategy planner analyzes 3 axes:**

| Axis | Signals | Decision Impact |
|------|---------|-----------------|
| **Artifact Independence** | Shared contracts? Integration points? | If coupled → SINGLE_CODER |
| **Context Capacity** | File count, module breadth, pattern complexity | HIGH/CRITICAL → SEQUENTIAL_CODERS |
| **Domain Specialization** | Tech stack detected (backend, frontend, tests) | Determines DOMAIN hints for Coders |

**Context Risk Levels:**
- **LOW**: <10 files, single module → SINGLE_CODER
- **MEDIUM**: 10-20 files, 2-3 modules → Consider SEQUENTIAL_CODERS
- **HIGH**: 20-30 files, multiple modules → SEQUENTIAL_CODERS (2-3 phases)
- **CRITICAL**: >30 files, cross-cutting concerns → SEQUENTIAL_CODERS (more phases)

### Phase 5: Synthesize Planning

**WAIT** for Phase 4 to complete.

**CRITICAL**: Do NOT synthesize outputs yourself in the main session.
You MUST spawn the Synthesizer agent - "spawn Synthesizer" means delegate to the agent, not do the work yourself.

```
Task(subagent_type="Synthesizer"):
"Synthesize PLANNING outputs for: {task}
Mode: planning
Planner outputs: {all 3 outputs}
Combine into: execution plan with strategy decision (SINGLE_CODER | SEQUENTIAL_CODERS | PARALLEL_CODERS)"
```

**Synthesizer returns:**
- Execution strategy type and reasoning
- Context risk level
- Subtask breakdown with DOMAIN hints (if not SINGLE_CODER)
- Implementation plan with dependencies

### Phase 6: Implement

Based on Phase 5 synthesis, use the three-strategy framework:

**Strategy Selection** (from Execution Strategy planner):

| Strategy | When | Frequency |
|----------|------|-----------|
| **SINGLE_CODER** | Default. Coherent A→Z implementation | ~80% |
| **SEQUENTIAL_CODERS** | Context overflow risk, layered dependencies | ~15% |
| **PARALLEL_CODERS** | True artifact independence (rare) | ~5% |

---

**SINGLE_CODER** (default):

```
Task(subagent_type="Coder"):
"TASK_ID: {task-id}
TASK_DESCRIPTION: {description}
BASE_BRANCH: {base branch}
EXECUTION_PLAN: {full plan from synthesis}
PATTERNS: {patterns from exploration}
CREATE_PR: true
DOMAIN: {detected domain or 'fullstack'}"
```

---

**SEQUENTIAL_CODERS** (for HIGH/CRITICAL context risk):

Spawn Coders one at a time, passing handoff summaries between phases:

**Phase 1 Coder:**
```
Task(subagent_type="Coder"):
"TASK_ID: {task-id}
TASK_DESCRIPTION: {phase 1 description}
BASE_BRANCH: {base branch}
EXECUTION_PLAN: {phase 1 steps}
PATTERNS: {patterns from exploration}
CREATE_PR: false
DOMAIN: {phase 1 domain, e.g., 'backend'}
HANDOFF_REQUIRED: true"
```

**Phase 2+ Coders** (after prior phase completes):
```
Task(subagent_type="Coder"):
"TASK_ID: {task-id}
TASK_DESCRIPTION: {phase N description}
BASE_BRANCH: {base branch}
EXECUTION_PLAN: {phase N steps}
PATTERNS: {patterns from exploration}
CREATE_PR: {true if last phase, false otherwise}
DOMAIN: {phase N domain, e.g., 'frontend'}
PRIOR_PHASE_SUMMARY: {summary from previous Coder}
FILES_FROM_PRIOR_PHASE: {list of files created}
HANDOFF_REQUIRED: {true if not last phase}"
```

**Handoff Protocol**: Each sequential Coder receives the prior Coder's implementation summary. The receiving Coder MUST:
1. Check git log to see commits from previous phases
2. Read actual files created - do not trust summary alone
3. Identify patterns from actual code (naming, error handling, testing)
4. Reference handoff summary to validate understanding

---

**PARALLEL_CODERS** (rare - truly independent artifacts):

Spawn multiple Coders **in a single message**, each with independent subtask:

```
Task(subagent_type="Coder"):  # Coder 1
"TASK_ID: {task-id}-part1
TASK_DESCRIPTION: {independent subtask 1}
BASE_BRANCH: {base branch}
EXECUTION_PLAN: {subtask 1 steps}
PATTERNS: {patterns}
CREATE_PR: false
DOMAIN: {subtask 1 domain}"

Task(subagent_type="Coder"):  # Coder 2 (same message)
"TASK_ID: {task-id}-part2
TASK_DESCRIPTION: {independent subtask 2}
BASE_BRANCH: {base branch}
EXECUTION_PLAN: {subtask 2 steps}
PATTERNS: {patterns}
CREATE_PR: false
DOMAIN: {subtask 2 domain}"
```

**Independence criteria** (all must be true for PARALLEL_CODERS):
- No shared contracts or interfaces
- No integration points between subtasks
- Different files/modules with no imports between them
- Each subtask is self-contained

### Phase 6.5: Validate

After Coder completes, spawn Validator to verify correctness:

```
Task(subagent_type="Validator", model="haiku"):
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
   Task(subagent_type="Coder"):
   "TASK_ID: {task-id}
   TASK_DESCRIPTION: Fix validation failures
   OPERATION: validation-fix
   VALIDATION_FAILURES: {parsed failures from Validator}
   SCOPE: Fix only the listed failures, no other changes
   CREATE_PR: false"
   ```
   - Loop back to Phase 6.5 (re-validate)
4. If `validation_retry_count > 2`: Report failures to user and halt

**If PASS:** Continue to Phase 7

### Phase 7: Simplify

After validation passes, spawn Simplifier to polish the code:

```
Task(subagent_type="Simplifier"):
"Simplify recently implemented code
Task: {task description}
FILES_CHANGED: {list of files from Coder output}
Focus on code modified by Coder, apply project standards, enhance clarity"
```

### Phase 8: Self-Review

After Simplifier completes, spawn Scrutinizer as final quality gate:

```
Task(subagent_type="Scrutinizer"):
"TASK_DESCRIPTION: {task description}
FILES_CHANGED: {list of files from Coder output}
Evaluate 9 pillars, fix P0/P1 issues, report status"
```

If Scrutinizer returns BLOCKED, report to user and halt.

### Phase 8.5: Re-Validate (if Scrutinizer made changes)

If Scrutinizer made code changes (status: FIXED), spawn Validator to verify:

```
Task(subagent_type="Validator", model="haiku"):
"FILES_CHANGED: {files modified by Scrutinizer}
VALIDATION_SCOPE: changed-only
Verify Scrutinizer's fixes didn't break anything."
```

**If FAIL:** Report to user - Scrutinizer broke tests, needs manual intervention.

**If PASS:** Continue to Phase 9

### Phase 9: Alignment Check

After Scrutinizer passes (and re-validation if needed), spawn Shepherd to validate alignment:

```
Task(subagent_type="Shepherd"):
"ORIGINAL_REQUEST: {task description or issue content}
EXECUTION_PLAN: {synthesized plan from Phase 5}
FILES_CHANGED: {list of files from Coder output}
ACCEPTANCE_CRITERIA: {extracted criteria if available}
Validate alignment with request and plan. Report ALIGNED or MISALIGNED with details."
```

**If ALIGNED:** Continue to Phase 10

**If MISALIGNED:**
1. Extract misalignment details from Shepherd output
2. Increment `alignment_fix_count`
3. If `alignment_fix_count <= 2`:
   - Spawn Coder to fix misalignments:
   ```
   Task(subagent_type="Coder"):
   "TASK_ID: {task-id}
   TASK_DESCRIPTION: Fix alignment issues
   OPERATION: alignment-fix
   MISALIGNMENTS: {structured misalignments from Shepherd}
   SCOPE: Fix only the listed misalignments, no other changes
   CREATE_PR: false"
   ```
   - Spawn Validator to verify fix didn't break tests:
   ```
   Task(subagent_type="Validator", model="haiku"):
   "FILES_CHANGED: {files modified by fix Coder}
   VALIDATION_SCOPE: changed-only"
   ```
   - If Validator FAIL: Report to user
   - If Validator PASS: Loop back to Phase 9 (re-check alignment)
4. If `alignment_fix_count > 2`: Report misalignments to user for decision

### Phase 10: Create PR

**For SEQUENTIAL_CODERS or PARALLEL_CODERS**: The last sequential Coder (with CREATE_PR: true) handles PR creation. For parallel coders, create unified PR using `git-workflow` skill patterns. Push branch and run `gh pr create` with comprehensive description, targeting `BASE_BRANCH`.

**For SINGLE_CODER**: PR is created by the Coder agent (CREATE_PR: true).

### Phase 11: Report

Display completion summary with phase status, PR info, and next steps.

## Architecture

```
/implement (orchestrator - spawns agents only)
│
├─ Phase 1: Setup
│  └─ Git agent (operation: setup-task) - creates feature branch, fetches issue
│
├─ Phase 1.5: Orient
│  └─ Skimmer agent (codebase overview via skim)
│
├─ Phase 2: Explore (PARALLEL, with Skimmer context)
│  ├─ Explore: Architecture
│  ├─ Explore: Integration
│  ├─ Explore: Reusable code
│  └─ Explore: Edge cases
│
├─ Phase 3: Synthesize Exploration
│  └─ Synthesizer agent (mode: exploration)
│
├─ Phase 4: Plan (PARALLEL)
│  ├─ Plan: Implementation steps
│  ├─ Plan: Testing strategy
│  └─ Plan: Execution strategy (3-strategy decision)
│
├─ Phase 5: Synthesize Planning
│  └─ Synthesizer agent (mode: planning) → returns strategy + DOMAIN hints
│
├─ Phase 6: Implement (3-strategy framework)
│  ├─ SINGLE_CODER (80%): One Coder, full plan, CREATE_PR: true
│  ├─ SEQUENTIAL_CODERS (15%): N Coders with handoff summaries
│  └─ PARALLEL_CODERS (5%): N Coders in single message (rare)
│
├─ Phase 6.5: Validate
│  └─ Validator agent (build, typecheck, lint, test)
│  └─ If FAIL: Coder fix loop (max 2 retries) → re-validate
│
├─ Phase 7: Simplify
│  └─ Simplifier agent (refines code clarity and consistency)
│
├─ Phase 8: Self-Review
│  └─ Scrutinizer agent (final quality gate, fixes P0/P1)
│
├─ Phase 8.5: Re-Validate (if Scrutinizer made changes)
│  └─ Validator agent (verify Scrutinizer fixes)
│
├─ Phase 9: Alignment Check
│  └─ Shepherd agent (validates alignment - reports only, no fixes)
│  └─ If MISALIGNED: Coder fix loop (max 2 iterations) → Validator → re-check
│
├─ Phase 10: Create PR (if needed)
│  └─ SINGLE_CODER: handled by Coder
│  └─ SEQUENTIAL: handled by last Coder
│  └─ PARALLEL: orchestrator creates unified PR
│
└─ Phase 11: Display agent outputs
```

## Principles

1. **Orchestration only** - Command spawns agents, never does work itself
2. **Coherence-first** - Single Coder produces more consistent code (default ~80% of tasks)
3. **Parallel exploration** - Explore and plan phases run in parallel; sequential phases wait
4. **Agent ownership** - Each agent owns its output completely
5. **Clean handoffs** - Each phase passes structured data to next; sequential Coders pass implementation summaries
6. **Honest reporting** - Display agent outputs directly
7. **Simplification pass** - Code refined for clarity before PR
8. **Strict delegation** - Never perform agent work in main session. "Spawn X" means call Task tool with X, not do X's work yourself
9. **Validator owns validation** - Never run `npm test`, `npm run build`, or similar in main session; always delegate to Validator agent
10. **Coder owns fixes** - Never implement fixes in main session; spawn Coder for validation failures and alignment fixes
11. **Loop limits** - Max 2 validation retries, max 2 alignment fix iterations before escalating to user

## Error Handling

If any agent fails, report the phase, agent type, and error. Offer options: retry phase, investigate systematically, or escalate to user.
