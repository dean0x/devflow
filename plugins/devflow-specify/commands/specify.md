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

### Phase 3: Explore Requirements (Parallel)

Spawn 4 Explore agents **in a single message**, each with Skimmer context:

| Focus | Thoroughness | Find |
|-------|-------------|------|
| User perspective | medium | Target users, goals, pain points, user journeys |
| Similar features | medium | Comparable features, scope patterns, edge cases |
| Constraints | quick | Dependencies, business rules, security, performance |
| Failure modes | quick | Error states, edge cases, validation needs |

### Phase 4: Synthesize Exploration

**WAIT** for Phase 3, then spawn Synthesizer:

```
Task(subagent_type="Synthesizer"):
"Synthesize EXPLORATION outputs for: {feature}
Mode: exploration
Combine into: user needs, similar features, constraints, failure modes"
```

### Phase 5: Plan Scope (Parallel)

Spawn 3 Plan agents **in a single message**, each with exploration synthesis:

| Focus | Output |
|-------|--------|
| User stories | Actors, actions, outcomes in "As X, I want Y, so that Z" format |
| Scope boundaries | v1 MVP, v2 deferred, out of scope, dependencies |
| Acceptance criteria | Success/failure/edge case criteria (testable) |

### Phase 6: Synthesize Planning

**WAIT** for Phase 5, then spawn Synthesizer:

```
Task(subagent_type="Synthesizer"):
"Synthesize PLANNING outputs for: {feature}
Mode: planning
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
/specify (orchestrator - spawns agents only)
│
├─ Phase 1: GATE 0 - Confirm Understanding ⛔ MANDATORY
│  └─ AskUserQuestion: Validate interpretation
│
├─ Phase 2: Orient
│  └─ Skimmer agent (codebase context via skim)
│
├─ Phase 3: Explore Requirements (PARALLEL)
│  ├─ Explore: User perspective
│  ├─ Explore: Similar features
│  ├─ Explore: Constraints
│  └─ Explore: Failure modes
│
├─ Phase 4: Synthesize Exploration
│  └─ Synthesizer agent (mode: exploration)
│
├─ Phase 5: Plan Scope (PARALLEL)
│  ├─ Plan: User stories
│  ├─ Plan: Scope boundaries
│  └─ Plan: Acceptance criteria
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

## Error Handling

If user selects "Needs changes" at any gate, iterate until confirmed. If "Cancel", stop gracefully without creating issue.
