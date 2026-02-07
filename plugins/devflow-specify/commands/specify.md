---
description: Specify a single feature through requirements exploration and interactive clarification - creates a well-defined GitHub issue ready for /implement
---

# Specify Command

Transform a rough feature idea into a well-defined, implementation-ready GitHub issue through multi-perspective requirements exploration and user clarification.

**Focus**: Requirements only (what/why/for whom), not implementation (that's `/implement`'s job).

## Usage

```
/specify User authentication with social login
/specify Rate limiting for API endpoints
/specify   (use conversation context)
```

## Input

`$ARGUMENTS` contains whatever follows `/specify`:
- Feature description: "User authentication with social login"
- Empty: infer from conversation context

## Clarification Gates

**MANDATORY**: Three gates that must complete before proceeding:

| Gate | When | Purpose |
|------|------|---------|
| Gate 0 | Before exploration | Confirm understanding of feature idea |
| Gate 1 | After exploration | Validate scope and priorities |
| Gate 2 | Before issue creation | Confirm acceptance criteria |

No gate may be skipped. If user says "whatever you think", state recommendation and get explicit approval.

## Phases

### Phase 1: Gate 0 - Confirm Understanding

Present interpretation to user:
- Core problem this solves
- Target users
- Expected outcome
- Key assumptions

Use AskUserQuestion to confirm understanding before spawning any agents.

### Phase 2: Orient

Spawn Skimmer agent for codebase context:

```
Task(subagent_type="Skimmer"):
"Orient in codebase for requirements exploration: {feature}
Find: project structure, similar features, patterns, integration points
Return: codebase context for requirements (not implementation details)"
```

### Phase 3: Explore Requirements (Agent Teams)

Create an agent team for collaborative requirements exploration:

```
Create a team named "spec-explore-{feature-slug}" to explore requirements for: {feature}

Spawn exploration teammates (with Skimmer context):

- "User Perspective Explorer"
  Focus: Target users, goals, pain points, user journeys.
  Skimmer context: {skimmer output}

- "Similar Features Explorer"
  Focus: Comparable features in codebase, scope patterns, precedents.
  Skimmer context: {skimmer output}

- "Constraints Explorer"
  Focus: Dependencies, business rules, security requirements, performance limits.
  Skimmer context: {skimmer output}

- "Failure Mode Explorer"
  Focus: Error states, edge cases, validation needs, what could go wrong.
  Skimmer context: {skimmer output}

After initial exploration, teammates debate:
- Constraints challenges user perspective: "This requirement conflicts with X constraint"
- Failure modes challenges similar features: "That pattern failed in Y scenario"
- Similar features validates user perspective: "This UX pattern works well in Z"

Max 2 debate rounds, then submit consensus requirements findings.
```

**Exploration team output**: Consensus findings on user needs, similar features, constraints, failure modes.

Shut down exploration team and clean up. **CRITICAL**: Verify TeamDelete completed before creating planning team.

### Phase 4: Synthesize Exploration

**WAIT** for Phase 3, then spawn Synthesizer:

```
Task(subagent_type="Synthesizer"):
"Synthesize EXPLORATION outputs for: {feature}
Mode: exploration
Explorer consensus: {team exploration consensus output}
Combine into: user needs, similar features, constraints, failure modes"
```

### Phase 5: Plan Scope (Agent Teams)

Create an agent team for collaborative scope planning:

```
Create a team named "spec-plan-{feature-slug}" to plan scope for: {feature}

Context from exploration: {synthesis output from Phase 4}

Spawn planning teammates:

- "User Stories Planner"
  Focus: Actors, actions, outcomes in "As X, I want Y, so that Z" format.
  Exploration context: {synthesis}

- "Scope Boundaries Planner"
  Focus: v1 MVP, v2 deferred, out of scope, dependencies.
  Exploration context: {synthesis}

- "Acceptance Criteria Planner"
  Focus: Success/failure/edge case criteria (testable).
  Exploration context: {synthesis}

After initial planning, teammates debate:
- Scope challenges user stories: "This story is too broad for v1"
- Acceptance challenges scope: "These boundaries leave this edge case uncovered"
- User stories challenges acceptance: "This criterion is untestable"

Max 2 debate rounds, then submit consensus scope plan.
```

**Planning team output**: Consensus on user stories, scope boundaries, acceptance criteria.

Shut down planning team and clean up. Verify TeamDelete completed.

### Phase 6: Synthesize Planning

**WAIT** for Phase 5, then spawn Synthesizer:

```
Task(subagent_type="Synthesizer"):
"Synthesize PLANNING outputs for: {feature}
Mode: planning
Planner consensus: {team planning consensus output}
Combine into: user stories, scope breakdown, acceptance criteria, open questions"
```

### Phase 7: Gate 1 - Validate Scope

Use AskUserQuestion to validate:
- Primary problem being solved
- Priority level (Critical/High/Medium/Low)
- v1 scope selection (minimal/medium/full)
- Explicit exclusions

### Phase 8: Gate 2 - Confirm Criteria

Present specification summary, then use AskUserQuestion for final confirmation:
- Success UX pattern
- Error handling approach
- Ready to create issue / Needs changes / Cancel

### Phase 9: Create Issue

Create GitHub issue with `gh issue create`:
- Title: feature name
- Body: problem statement, user stories, scope (v1/deferred/excluded), acceptance criteria, constraints, priority
- Labels: feature, priority level

Report issue number and URL.

## Architecture

```
/specify (orchestrator - spawns teams and agents)
│
├─ Phase 1: GATE 0 - Confirm Understanding ⛔ MANDATORY
│  └─ AskUserQuestion: Validate interpretation
│
├─ Phase 2: Orient
│  └─ Skimmer agent (codebase context via skim)
│
├─ Phase 3: Explore Requirements (Agent Teams)
│  ├─ User Perspective Explorer (teammate)
│  ├─ Similar Features Explorer (teammate)
│  ├─ Constraints Explorer (teammate)
│  ├─ Failure Mode Explorer (teammate)
│  └─ Debate → consensus requirements findings
│
├─ Phase 4: Synthesize Exploration
│  └─ Synthesizer agent (mode: exploration)
│
├─ Phase 5: Plan Scope (Agent Teams)
│  ├─ User Stories Planner (teammate)
│  ├─ Scope Boundaries Planner (teammate)
│  ├─ Acceptance Criteria Planner (teammate)
│  └─ Debate → consensus scope plan
│
├─ Phase 6: Synthesize Planning
│  └─ Synthesizer agent (mode: planning)
│
├─ Phase 7: GATE 1 - Validate Scope ⛔ MANDATORY
│  └─ AskUserQuestion: Confirm scope and priorities
│
├─ Phase 8: GATE 2 - Confirm Criteria ⛔ MANDATORY
│  └─ AskUserQuestion: Final spec approval
│
├─ Phase 9: Create Issue
│  └─ gh issue create
│
└─ Report: Issue number, URL, /implement command
```

## Principles

1. **Confirm before exploring** - Validate understanding with user before spawning agents
2. **Requirements, not implementation** - Focus on what and why, not how
3. **Multiple perspectives** - Explore from user, scope, constraint, and failure angles
4. **User drives decisions** - Three mandatory gates ensure user approval
5. **Scope ruthlessly** - Small, focused issues ship faster
6. **Testable criteria** - Every requirement must be verifiable
7. **Enable /implement** - Output must be actionable for implementation

## Fallback

If Agent Teams is unavailable (feature not enabled):
- Phase 3: Fall back to 4 parallel Explore subagents (user perspective, similar features, constraints, failure modes)
- Phase 5: Fall back to 3 parallel Plan subagents (user stories, scope boundaries, acceptance criteria)
- Note in report: "Specification run without team debate (Agent Teams not available)"

## Error Handling

If user selects "Needs changes" at any gate, iterate until confirmed. If "Cancel", stop gracefully without creating issue.
