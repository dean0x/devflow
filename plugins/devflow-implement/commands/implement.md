---
description: Execute a single task through the complete lifecycle - orchestrates team-based exploration, planning, implementation, and quality gates
---

# Implement Command

Orchestrate a single task from exploration through implementation by spawning specialized agent teams for collaborative exploration and planning, then implementation agents for coding and quality gates.

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

### Phase 2: Exploration Team

Create an agent team for collaborative codebase exploration:

```
Create a team named "explore-{task-id}" to explore the codebase for: {task description}

Spawn exploration teammates (with Skimmer context):

- "Architecture Explorer"
  Focus: Find similar implementations, established patterns, module structure.
  Skimmer context: {skimmer output}

- "Integration Explorer"
  Focus: Find entry points, services, database models, configuration.
  Skimmer context: {skimmer output}

- "Reusable Code Explorer"
  Focus: Find utilities, helpers, validation patterns, error handling to reuse.
  Skimmer context: {skimmer output}

- "Edge Case Explorer"
  Focus: Find error scenarios, race conditions, permission failures, boundary cases.
  Skimmer context: {skimmer output}

After initial exploration, teammates debate:
- Architecture challenges edge cases: "This boundary isn't handled by existing patterns"
- Integration challenges reusable code: "That helper doesn't cover our integration point"
- Edge cases challenges architecture: "This pattern fails under concurrent access"

Max 2 debate rounds, then submit consensus exploration findings.
```

**Exploration team output**: Consensus findings on patterns, integration points, reusable code, edge cases.

Shut down exploration team and clean up. **CRITICAL**: Verify team cleanup completed (TeamDelete confirmed) before creating the planning team in Phase 4. One team per session — racing to create the next team before cleanup finishes will fail silently.

### Phase 3: Synthesize Exploration

**CRITICAL**: Do NOT synthesize outputs yourself in the main session.
You MUST spawn the Synthesizer agent.

```
Task(subagent_type="Synthesizer"):
"Synthesize EXPLORATION outputs for: {task}
Mode: exploration
Explorer consensus: {team exploration consensus output}
Combine into: patterns, integration points, reusable code, edge cases"
```

### Phase 4: Planning Team

Create an agent team for collaborative implementation planning:

```
Create a team named "plan-{task-id}" to plan implementation of: {task description}

Context from exploration: {synthesis output from Phase 3}

Spawn planning teammates:

- "Implementation Planner"
  Focus: Step-by-step coding approach with files, dependencies, and order.
  Exploration context: {synthesis}

- "Testing Planner"
  Focus: Test strategy - unit tests, integration tests, edge case coverage.
  Exploration context: {synthesis}

- "Risk & Execution Planner"
  Focus: Potential issues, rollback strategy, and execution strategy decision
  (SINGLE_CODER vs SEQUENTIAL_CODERS vs PARALLEL_CODERS).
  Exploration context: {synthesis}

After initial planning, teammates debate:
- Testing challenges implementation: "This approach is untestable without major refactoring"
- Risk challenges both: "Rollback is impossible with this migration strategy"
- Implementation challenges testing: "Full coverage here adds 3x complexity for minimal value"

Max 2 debate rounds, then submit consensus plan.
```

**Execution Strategy** (from Risk & Execution planner, validated by team):

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

Shut down planning team and clean up. **CRITICAL**: Verify team cleanup completed (TeamDelete confirmed) before creating the alignment team in Phase 9. One team per session — racing to create the next team before cleanup finishes will fail silently.

### Phase 5: Synthesize Planning

**CRITICAL**: Do NOT synthesize outputs yourself in the main session.
You MUST spawn the Synthesizer agent.

```
Task(subagent_type="Synthesizer"):
"Synthesize PLANNING outputs for: {task}
Mode: planning
Planner consensus: {team planning consensus output}
Combine into: execution plan with strategy decision (SINGLE_CODER | SEQUENTIAL_CODERS | PARALLEL_CODERS)"
```

**Synthesizer returns:**
- Execution strategy type and reasoning
- Context risk level
- Subtask breakdown with DOMAIN hints (if not SINGLE_CODER)
- Implementation plan with dependencies

### Phase 6: Implement

Based on Phase 5 synthesis, use the three-strategy framework:

**Strategy Selection** (from planning team consensus):

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

### Phase 9: Shepherd↔Coder Dialogue

After Scrutinizer passes (and re-validation if needed), check alignment using direct dialogue when Agent Teams is available:

**With Agent Teams:**

Create a mini-team for alignment validation:

```
Create a team named "align-{task-id}" for alignment check.

Spawn teammates:
- "Shepherd"
  Context: Validate implementation aligns with original request.
  ORIGINAL_REQUEST: {task description or issue content}
  EXECUTION_PLAN: {synthesized plan from Phase 5}
  FILES_CHANGED: {list of files from Coder output}
  ACCEPTANCE_CRITERIA: {extracted criteria if available}

- "Coder"
  Context: Respond to alignment concerns and fix issues.
  TASK_ID: {task-id}
  SCOPE: Fix only misalignments identified by Shepherd

Rules:
1. Shepherd analyzes alignment, sends findings to Coder
2. Coder responds with fix or clarification
3. Shepherd validates response
4. Max 2 exchanges before escalating to lead
```

After dialogue completes, shut down alignment team and verify cleanup (TeamDelete confirmed).

**Without Agent Teams (fallback):**

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

**For SEQUENTIAL_CODERS or PARALLEL_CODERS**: The last sequential Coder (with CREATE_PR: true) handles PR creation. For parallel coders, create unified PR using `pull-request` skill patterns. Push branch and run `gh pr create` with comprehensive description, targeting `BASE_BRANCH`.

**For SINGLE_CODER**: PR is created by the Coder agent (CREATE_PR: true).

### Phase 11: Report

Display completion summary with phase status, PR info, and next steps.

## Architecture

```
/implement (orchestrator - spawns teams and agents)
│
├─ Phase 1: Setup
│  └─ Git agent (operation: setup-task) - creates feature branch, fetches issue
│
├─ Phase 1.5: Orient
│  └─ Skimmer agent (codebase overview via skim)
│
├─ Phase 2: Exploration Team (Agent Teams)
│  ├─ Architecture Explorer (teammate)
│  ├─ Integration Explorer (teammate)
│  ├─ Reusable Code Explorer (teammate)
│  ├─ Edge Case Explorer (teammate)
│  └─ Debate → consensus exploration findings
│
├─ Phase 3: Synthesize Exploration
│  └─ Synthesizer agent (mode: exploration)
│
├─ Phase 4: Planning Team (Agent Teams)
│  ├─ Implementation Planner (teammate)
│  ├─ Testing Planner (teammate)
│  ├─ Risk & Execution Planner (teammate)
│  └─ Debate → consensus plan with strategy decision
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
├─ Phase 9: Shepherd↔Coder Dialogue (Agent Teams) or Shepherd check (fallback)
│  └─ With teams: direct Shepherd↔Coder messaging (max 2 exchanges)
│  └─ Without teams: Shepherd subagent → Coder fix loop if misaligned
│
├─ Phase 10: Create PR (if needed)
│  └─ SINGLE_CODER: handled by Coder
│  └─ SEQUENTIAL: handled by last Coder
│  └─ PARALLEL: orchestrator creates unified PR
│
└─ Phase 11: Display agent outputs
```

## Principles

1. **Orchestration only** - Command spawns teams/agents, never does work itself
2. **Team-based exploration** - Exploration and planning use Agent Teams for debate
3. **Coherence-first** - Single Coder produces more consistent code (default ~80% of tasks)
4. **Bounded debate** - Max 2 exchange rounds in any team, then converge
5. **Agent ownership** - Each agent owns its output completely
6. **Clean handoffs** - Each phase passes structured data to next; sequential Coders pass implementation summaries
7. **Honest reporting** - Display agent outputs directly
8. **Simplification pass** - Code refined for clarity before PR
9. **Strict delegation** - Never perform agent work in main session. "Spawn X" means call Task tool with X, not do X's work yourself
10. **Validator owns validation** - Never run `npm test`, `npm run build`, or similar in main session; always delegate to Validator agent
11. **Coder owns fixes** - Never implement fixes in main session; spawn Coder for validation failures and alignment fixes
12. **Loop limits** - Max 2 validation retries, max 2 alignment fix iterations before escalating to user
13. **Cleanup always** - Team resources released after exploration and planning phases

## Fallback

If Agent Teams is unavailable (feature not enabled):
- Phase 2: Fall back to 4 parallel Explore subagents (current behavior)
- Phase 4: Fall back to 3 parallel Plan subagents (current behavior)
- Phase 9: Fall back to Shepherd subagent → orchestrator-mediated Coder fix loop
- Note in report: "Implementation run without team debate (Agent Teams not available)"

## Error Handling

If any agent or team fails, report the phase, agent type, and error. Offer options: retry phase, investigate systematically, or escalate to user.
