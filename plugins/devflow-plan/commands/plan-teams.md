---
description: Unified design planning with agent teams - collaborative exploration, gap analysis, and planning with team debate for higher-confidence outputs
---

# Plan Command (Teams Variant)

Same as `/plan` but uses Agent Teams for exploration and planning phases to enable team debate and consensus. Gap analysis and design review remain as parallel subagents (independent checkers — debate adds no value there).

The orchestrator only spawns agents, teams, and gates — all work is done by agents and teammates.

## Usage

```
/plan <feature description>
/plan #42                    (GitHub issue)
/plan #12 #15 #18           (multi-issue)
/plan                        (use conversation context)
```

## Input

`$ARGUMENTS` contains whatever follows `/plan`:
- Starts with `#` followed by numbers → issue mode (parse all `#N` tokens, space-separated)
- Path to existing `.md` file → **error**: "Use /implement with plan documents"
- Other text → feature description
- Empty → use conversation context

For **multi-issue** mode: collect all `#N` tokens from `$ARGUMENTS` as `ISSUE_NUMBERS`.

## Clarification Gates

**MANDATORY**: Three gates that must complete before proceeding.

| Gate | Phase | Purpose |
|------|-------|---------|
| Gate 0 | Phase 1 | Confirm understanding before exploration |
| Gate 1 | Phase 8 | Validate scope + gap analysis results |
| Gate 2 | Phase 14 | Confirm final plan + design review |

No gate may be skipped. If user says "proceed" or "whatever you think", state recommendation and get explicit confirmation.

## Phases

---

### Block 1: Requirements Discovery

#### Phase 1: Gate 0 — Confirm Understanding

Present interpretation using AskUserQuestion:
- Core problem this solves
- Target users
- Expected outcome
- Key assumptions

For multi-issue: present unified scope across all issues.

**MANDATORY**: Do not spawn any agents or teams until Gate 0 is confirmed.

#### Phase 2: Orient

Spawn Skimmer agent for codebase context:

```
Agent(subagent_type="Skimmer"):
"Orient in codebase for design planning: {feature/issues}
Run rskim on source directories (NOT repo root) to identify:
- Existing patterns and conventions in the affected area
- File structure and module boundaries
- Similar prior implementations
- Test patterns and coverage approach
Return codebase context for requirements analysis."
```

#### Phase 3: Load Project Knowledge

Read `.memory/knowledge/decisions.md` and `.memory/knowledge/pitfalls.md`. Pass their content to all subsequent agents and teammates.

#### Phase 4: Exploration Team

Create an agent team for collaborative requirements exploration:

```
Create a team named "explore-reqs-{feature-slug}" for requirements exploration of: {feature/issues}

Spawn exploration teammates with self-contained prompts:

- Name: "user-perspective-explorer"
  Prompt: |
    You are exploring requirements for: {feature/issues}
    1. Skimmer context: {Phase 2 output}
    2. Project knowledge: {Phase 3 decisions + pitfalls}
    3. Your deliverable: Target users, their goals, pain points, user journeys,
       and success scenarios. What does the user need this to do?
    4. Report completion: SendMessage(type: "message", recipient: "team-lead",
       summary: "User perspective exploration done")

- Name: "similar-features-explorer"
  Prompt: |
    You are exploring requirements for: {feature/issues}
    1. Skimmer context: {Phase 2 output}
    2. Project knowledge: {Phase 3 decisions + pitfalls}
    3. Your deliverable: Comparable features in the codebase or domain, scope
       patterns, edge cases discovered from similar implementations.
    4. Report completion: SendMessage(type: "message", recipient: "team-lead",
       summary: "Similar features exploration done")

- Name: "constraints-explorer"
  Prompt: |
    You are exploring requirements for: {feature/issues}
    1. Skimmer context: {Phase 2 output}
    2. Project knowledge: {Phase 3 decisions + pitfalls}
    3. Your deliverable: Dependencies, business rules, security constraints,
       performance constraints, and prior architectural decisions that constrain scope.
    4. Report completion: SendMessage(type: "message", recipient: "team-lead",
       summary: "Constraints exploration done")

- Name: "failure-modes-explorer"
  Prompt: |
    You are exploring requirements for: {feature/issues}
    1. Skimmer context: {Phase 2 output}
    2. Project knowledge: {Phase 3 decisions + pitfalls}
    3. Your deliverable: Error states, edge cases, validation needs, known pitfalls,
       and failure scenarios that must be handled.
    4. Report completion: SendMessage(type: "message", recipient: "team-lead",
       summary: "Failure modes exploration done")

After initial exploration, lead initiates debate:
SendMessage(type: "broadcast", summary: "Debate: challenge requirements findings"):
- User perspective challenges constraints: "This constraint blocks the core user need"
- Similar features challenges failure modes: "These edge cases are handled differently elsewhere"
- Failure modes challenges user perspective: "This user journey has an unhandled failure"
- Constraints challenges similar features: "That pattern violated an architectural decision"
Teammates use SendMessage(type: "message", recipient: "{name}") for direct challenges.

Max 2 debate rounds, then submit consensus requirements findings.
```

**Exploration team output**: Consensus findings on user needs, similar features, constraints, failure modes.

**Team Shutdown Protocol** (must complete before Phase 5):

```
Step 1: Shutdown each teammate
  SendMessage(type: "shutdown_request", recipient: "user-perspective-explorer", content: "Exploration complete")
  SendMessage(type: "shutdown_request", recipient: "similar-features-explorer", content: "Exploration complete")
  SendMessage(type: "shutdown_request", recipient: "constraints-explorer", content: "Exploration complete")
  SendMessage(type: "shutdown_request", recipient: "failure-modes-explorer", content: "Exploration complete")
  Wait for each shutdown_response (approve: true)

Step 2: TeamDelete

Step 3: GATE — Verify TeamDelete succeeded
  If failed → retry once after 5s
  If retry failed → HALT and report: "Exploration team cleanup failed. Cannot create gap analysis agents."
```

#### Phase 5: Synthesize Exploration

```
Agent(subagent_type="Synthesizer"):
"Synthesize EXPLORATION outputs for: {feature/issues}
Mode: exploration
Team consensus output: {Phase 4 team output}
Combine into: user needs, similar features, constraints, failure modes"
```

---

### Block 2: Gap Analysis

#### Phase 6: Gap Analysis (Parallel Subagents)

Gap analysis uses parallel subagents, not a team — designers work independently on different focus areas; debate between them has no value.

**Single-issue**: Spawn 4 Designer agents **in a single message**:

| Focus | What it checks |
|-------|----------------|
| completeness | Missing AC, undefined error states, vague requirements |
| architecture | Pattern violations, missing integration points, layering issues |
| security | Auth gaps, input validation, secret handling, OWASP |
| performance | N+1 patterns, missing caching, concurrency, query patterns |

**Multi-issue**: Spawn 6 Designer agents **in a single message** (same 4 plus):

| Focus | What it checks |
|-------|----------------|
| consistency | Cross-issue contradictions, duplicate requirements, conflicting scope |
| dependencies | Inter-issue ordering, shared resources, breaking change propagation |

Each designer receives:
- Mode: `gap-analysis`
- Focus: (their assigned focus)
- Exploration synthesis from Phase 5
- Skimmer context from Phase 2
- Project knowledge from Phase 3
- Multi-issue: all issue bodies

#### Phase 7: Synthesize Gap Analysis

```
Agent(subagent_type="Synthesizer"):
"Synthesize GAP ANALYSIS outputs for: {feature/issues}
Mode: design
Designer outputs: {all designer outputs}
Deduplicate, boost confidence for multi-agent flags, categorize by severity."
```

---

### Block 3: Scope Approval

#### Phase 8: Gate 1 — Validate Scope + Gaps

Use AskUserQuestion to present:

1. **Scope Summary** — core problem, priority, v1 included, exclusions
2. **Gap Analysis Results** — blocking gaps with resolutions, should-address items, informational

User can: accept, modify scope, or override specific gaps.

**MANDATORY**: Do not proceed to implementation design until Gate 1 is confirmed.

---

### Block 4: Implementation Design

#### Phase 9: Explore Implementation (Parallel Subagents)

Spawn 4 Explore agents **in a single message**, each with Skimmer context + accepted scope:

| Focus | Thoroughness | Find |
|-------|-------------|------|
| Architecture | medium | Similar implementations, patterns, module structure |
| Integration | medium | Entry points, services, database models, configuration |
| Reusable code | medium | Utilities, helpers, validation patterns, error handling |
| Edge cases | quick | Error scenarios, race conditions, permission failures |

#### Phase 10: Synthesize Implementation Exploration

```
Agent(subagent_type="Synthesizer"):
"Synthesize IMPLEMENTATION EXPLORATION outputs for: {feature/issues}
Mode: exploration
Explorer outputs: {all 4 outputs}
Combine into: patterns to follow, integration points, reusable code, edge cases"
```

#### Phase 11: Planning Team

Create an agent team for collaborative implementation planning:

```
Create a team named "plan-design-{feature-slug}" to plan implementation of: {feature/issues}

Spawn planning teammates with self-contained prompts:

- Name: "implementation-planner"
  Prompt: |
    You are planning implementation for: {feature/issues}
    1. Read your skill: `Read ~/.claude/skills/devflow:patterns/SKILL.md`
    2. Exploration synthesis: {Phase 10 output}
    3. Gap analysis (accepted): {Phase 7 synthesis — blocking gaps need mitigations}
    4. Your deliverable: Step-by-step implementation approach with specific files
       to create/modify, dependencies between steps, and explicit gap mitigations.
    5. Report completion: SendMessage(type: "message", recipient: "team-lead",
       summary: "Implementation plan ready")

- Name: "testing-planner"
  Prompt: |
    You are planning the test strategy for: {feature/issues}
    1. Read your skill: `Read ~/.claude/skills/devflow:testing/SKILL.md`
    2. Exploration synthesis: {Phase 10 output}
    3. Gap analysis (accepted): {Phase 7 synthesis — gaps to verify coverage for}
    4. Your deliverable: Test strategy — unit tests, integration tests,
       edge case coverage, testing patterns from codebase, gap verification tests.
    5. Report completion: SendMessage(type: "message", recipient: "team-lead",
       summary: "Test plan ready")

- Name: "risk-planner"
  Prompt: |
    You are assessing risk and execution strategy for: {feature/issues}
    1. Read your skill: `Read ~/.claude/skills/devflow:patterns/SKILL.md`
    2. Exploration synthesis: {Phase 10 output}
    3. Gap analysis (accepted): {Phase 7 synthesis — unresolved risks}
    4. Your deliverable: Risk assessment, rollback strategy, and execution
       strategy decision (SINGLE_CODER vs SEQUENTIAL_CODERS vs PARALLEL_CODERS)
       based on artifact independence, context capacity, and domain specialization.
    5. Report completion: SendMessage(type: "message", recipient: "team-lead",
       summary: "Risk assessment ready")

After initial planning, lead initiates debate:
SendMessage(type: "broadcast", summary: "Debate: challenge implementation plans"):
- Testing challenges implementation: "This approach is untestable without major refactoring"
- Risk challenges both: "Rollback is impossible with this migration strategy"
- Implementation challenges testing: "Full coverage here adds 3x complexity for minimal value"
Teammates use SendMessage(type: "message", recipient: "{name}") for direct challenges.

Max 2 debate rounds, then submit consensus plan.
```

**Team Shutdown Protocol** (must complete before Phase 12):

```
Step 1: Shutdown each teammate
  SendMessage(type: "shutdown_request", recipient: "implementation-planner", content: "Planning complete")
  SendMessage(type: "shutdown_request", recipient: "testing-planner", content: "Planning complete")
  SendMessage(type: "shutdown_request", recipient: "risk-planner", content: "Planning complete")
  Wait for each shutdown_response (approve: true)

Step 2: TeamDelete

Step 3: GATE — Verify TeamDelete succeeded
  If failed → retry once after 5s
  If retry failed → HALT and report: "Planning team cleanup failed. Cannot proceed to design review."
```

#### Phase 12: Synthesize Planning

```
Agent(subagent_type="Synthesizer"):
"Synthesize PLANNING outputs for: {feature/issues}
Mode: planning
Team consensus output: {Phase 11 team output}
Combine into: execution plan with strategy decision, gap mitigations integrated"
```

---

### Block 5: Design Review

#### Phase 13: Design Review (Single Subagent)

Design review uses a single independent agent — not a team.

```
Agent(subagent_type="Designer"):
"Mode: design-review
Artifacts:
  Implementation plan: {Phase 12 planning synthesis}
  Implementation exploration: {Phase 10 exploration synthesis}
  Codebase context: {Phase 2 output}
Review the full plan for all 6 anti-patterns. Report all findings with evidence."
```

---

### Block 6: Plan Approval

#### Phase 14: Gate 2 — Confirm Plan + Design Review

Use AskUserQuestion to present:
1. Implementation plan summary (execution strategy, key steps, test strategy)
2. Design review findings with proposed mitigations
3. Acceptance criteria
4. Risk assessment

User can: accept, revise (re-run phases 11-13), or cancel.

**MANDATORY**: Do not write design artifact until Gate 2 is confirmed.

---

### Block 7: Output

#### Phase 15: Store Design Artifact

Write design artifact to disk:
- If issue number: `.docs/design/{issue-number}-{topic-slug}.{YYYY-MM-DD_HHMM}.md`
- If multi-issue: `.docs/design/{first-issue-number}-multi.{YYYY-MM-DD_HHMM}.md`
- If no issue: `.docs/design/{topic-slug}.{YYYY-MM-DD_HHMM}.md`

Create parent directory if needed.

**Artifact YAML frontmatter:**
```yaml
---
type: design-artifact
version: 1
status: APPROVED
issue: 42
title: "Feature Title"
slug: feature-slug
created: {ISO timestamp}
execution-strategy: SINGLE_CODER
context-risk: LOW
---
```

Required sections: Problem Statement, Acceptance Criteria, Scope, Gap Analysis Results, Execution Strategy, Subtask Breakdown, Implementation Plan, Patterns to Follow, Integration Points, Design Review Results, Risk Assessment.

#### Phase 16: Create GitHub Issue (Optional)

If the feature does not already have a GitHub issue, create via `gh issue create` with problem statement, user stories, scope, acceptance criteria, and link to design artifact.

#### Phase 17: Report

Display: artifact path, issue URL, gap analysis summary, design review summary, suggested next step (`/implement`).

---

## Architecture

```
/plan-teams (orchestrator - spawns agents and teams only)
│
├─ Block 1: Requirements Discovery
│  ├─ Phase 1: GATE 0 - Confirm Understanding ⛔ MANDATORY
│  ├─ Phase 2: Orient (Skimmer agent)
│  ├─ Phase 3: Load Project Knowledge
│  ├─ Phase 4: Exploration Team (4 teammates + debate)
│  │  ├─ user-perspective-explorer
│  │  ├─ similar-features-explorer
│  │  ├─ constraints-explorer
│  │  └─ failure-modes-explorer
│  │  [Team Shutdown Protocol]
│  └─ Phase 5: Synthesize Exploration (Synthesizer agent)
│
├─ Block 2: Gap Analysis (PARALLEL SUBAGENTS — no team)
│  ├─ Phase 6: Designer: completeness
│  │           Designer: architecture
│  │           Designer: security
│  │           Designer: performance
│  │           Designer: consistency (multi-issue only)
│  │           Designer: dependencies (multi-issue only)
│  └─ Phase 7: Synthesize Gap Analysis (Synthesizer: design)
│
├─ Block 3: Scope Approval
│  └─ Phase 8: GATE 1 - Validate Scope + Gaps ⛔ MANDATORY
│
├─ Block 4: Implementation Design
│  ├─ Phase 9: Explore Implementation (PARALLEL SUBAGENTS)
│  ├─ Phase 10: Synthesize Implementation Exploration
│  ├─ Phase 11: Planning Team (3 teammates + debate)
│  │  ├─ implementation-planner
│  │  ├─ testing-planner
│  │  └─ risk-planner
│  │  [Team Shutdown Protocol]
│  └─ Phase 12: Synthesize Planning (Synthesizer: planning)
│
├─ Block 5: Design Review (SUBAGENT — no team)
│  └─ Phase 13: Designer agent (mode: design-review)
│
├─ Block 6: Plan Approval
│  └─ Phase 14: GATE 2 - Confirm Plan + Design Review ⛔ MANDATORY
│
└─ Block 7: Output
   ├─ Phase 15: Store Design Artifact
   ├─ Phase 16: Create GitHub Issue (optional)
   └─ Phase 17: Report
```

## Principles

1. **Orchestration only** — Command spawns agents and teams, never does work itself
2. **Three mandatory gates** — None may be skipped
3. **Teams for exploration and planning** — Debate increases confidence in subjective analysis
4. **Subagents for gap analysis and design review** — Independent checks; debate adds no value
5. **One team at a time** — Always complete Team Shutdown Protocol before creating next team
6. **Evidence-based gaps** — Every gap cites specific text; no speculation
7. **Design artifacts are machine-readable** — `/implement` can consume the YAML frontmatter directly

## Error Handling

- Team cleanup failures halt execution — one team at a time is a hard constraint
- If user selects "Revise" at Gate 2, loop back to Phase 11 (spawn new planning team)
- If user selects "Cancel" at any gate, stop gracefully without writing artifact
- If any subagent fails outside a team, report phase, agent, error, and offer retry
