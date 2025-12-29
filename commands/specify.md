---
description: Specify a single feature through requirements exploration and interactive clarification - creates a well-defined GitHub issue ready for /implement
---

# Specify - Requirements Engineering Command

Transform a rough feature idea into a well-defined, implementation-ready GitHub issue through multi-perspective requirements exploration and user clarification.

**Does NOT explore technical implementation** - that's `/implement`'s job. This command focuses purely on requirements: what to build, why, for whom, and what success looks like.

## Usage

```
/specify User authentication with social login
/specify Rate limiting for API endpoints
/specify Dashboard redesign with real-time updates
```

Specify handles one feature at a time. Run multiple `/specify` commands for multiple features.

---

## Input

`$ARGUMENTS` contains whatever follows `/specify`:

- `/specify User authentication with social login` → `$ARGUMENTS` = "User authentication with social login"
- `/specify Rate limiting for API` → `$ARGUMENTS` = "Rate limiting for API"
- `/specify` → `$ARGUMENTS` = "" (use conversation context)

```bash
FEATURE_IDEA="$ARGUMENTS"

# If blank, infer from conversation context
if [ -z "$FEATURE_IDEA" ]; then
    echo "No feature specified - using conversation context"
fi
```

## Your Mission

Transform a vague feature idea into precise requirements:

```
UNDERSTAND → EXPLORE REQUIREMENTS (parallel) → PLAN SCOPE (parallel) → CLARIFY → CREATE ISSUE
```

**Output**: A GitHub issue with complete requirements ready for `/implement`.

---

## Phase 1: Understand

Parse the feature idea and extract initial understanding:

```markdown
## Initial Understanding

**Raw Input**: ${FEATURE_IDEA}

**My Interpretation**:
- Core value: [what problem this solves]
- Target users: [who benefits]
- Key behavior: [what it does, not how]

**Assumptions**:
- [assumptions that need validation with user]

**Unknowns**:
- [questions to explore]
```

---

## Phase 2: Explore Requirements (Parallel Agents)

Spawn multiple Explore agents to understand requirements from different perspectives.

**Spawn in a single message (parallel execution):**

```
Task tool with subagent_type="Explore":
"Explore USER PERSPECTIVE for: ${FEATURE_IDEA}

Find user-facing context:
- Who are the target users? What are their goals?
- What existing user journeys does this touch?
- What pain points or requests led to this feature?
- Look for: user documentation, onboarding flows, support patterns, user-facing error messages

Thoroughness: medium
Report: user context and needs with references"

Task tool with subagent_type="Explore":
"Explore SIMILAR FEATURES for: ${FEATURE_IDEA}

Find comparable features in the codebase:
- What similar features exist? How do they behave?
- What scope did similar features have?
- What edge cases do similar features handle?
- What was explicitly excluded from similar features?

Thoroughness: medium
Report: similar features with scope comparisons"

Task tool with subagent_type="Explore":
"Explore CONSTRAINTS for: ${FEATURE_IDEA}

Find constraints that affect requirements:
- What external dependencies exist? (APIs, services, data sources)
- What business rules or policies apply?
- What security or compliance requirements exist?
- What performance expectations are set by similar features?

Thoroughness: quick
Report: constraints that shape requirements"

Task tool with subagent_type="Explore":
"Explore FAILURE MODES for: ${FEATURE_IDEA}

Find how things can go wrong from user perspective:
- What error states do users encounter in similar features?
- What edge cases cause confusion or frustration?
- What validation or feedback do users need?
- What happens when external dependencies fail?

Thoroughness: quick
Report: failure scenarios users care about"
```

### Synthesize Exploration Results

**WAIT** for all Phase 2 explorers to complete, then spawn Synthesize agent:

```
Task(subagent_type="Synthesize"):

"Synthesize EXPLORATION outputs for requirements: ${FEATURE_IDEA}

Mode: exploration

Explorer outputs:
${USER_PERSPECTIVE_OUTPUT}
${SIMILAR_FEATURES_OUTPUT}
${CONSTRAINTS_OUTPUT}
${FAILURE_MODES_OUTPUT}

Combine into requirements context:
- User needs (primary and secondary)
- Similar features as scope reference
- Hard constraints that limit scope
- User-facing failure modes

Output format: Requirements Context summary for planning phase"
```

---

## Phase 3: Plan Scope (Parallel Agents)

Spawn multiple Plan agents to define scope from different angles.

**Spawn in a single message (parallel execution):**

```
Task tool with subagent_type="Plan":
"Plan USER STORIES for: ${FEATURE_IDEA}

Based on requirements context:
${EXPLORATION_SUMMARY}

Define user stories:
- Who are the actors?
- What actions do they take?
- What outcomes do they expect?
- What variations exist (happy path, edge cases)?

Output: User stories in 'As a X, I want Y, so that Z' format"

Task tool with subagent_type="Plan":
"Plan SCOPE BOUNDARIES for: ${FEATURE_IDEA}

Based on requirements context:
${EXPLORATION_SUMMARY}

Define clear boundaries:
- What's the minimum viable version (v1)?
- What should be explicitly deferred to v2?
- What's permanently out of scope?
- What are the dependencies between scope items?

Output: Scope breakdown with reasoning"

Task tool with subagent_type="Plan":
"Plan ACCEPTANCE CRITERIA for: ${FEATURE_IDEA}

Based on requirements context:
${EXPLORATION_SUMMARY}

Define success criteria:
- How do we know this works? (testable assertions)
- What does the user see/experience when successful?
- What does the user see/experience when something fails?
- What are the performance expectations?

Output: Concrete, testable acceptance criteria"
```

### Synthesize Planning Results

**WAIT** for all Phase 3 planners to complete, then spawn Synthesize agent:

```
Task(subagent_type="Synthesize"):

"Synthesize PLANNING outputs for requirements: ${FEATURE_IDEA}

Mode: planning

Planner outputs:
${USER_STORIES_OUTPUT}
${SCOPE_BOUNDARIES_OUTPUT}
${ACCEPTANCE_CRITERIA_OUTPUT}

Combine into requirements draft:
- User stories (primary and secondary)
- Scope breakdown (v1 MVP, v2 deferred, out of scope)
- Acceptance criteria (success, failure, edge cases)
- Open questions requiring user input

Output format: Requirements Draft ready for user clarification"
```

---

## Phase 4: Clarify

Use AskUserQuestion to validate and refine requirements. Ask in batches of 2-4 related questions.

### 4.1 Value & Priority

```
AskUserQuestion:
  questions:
    - question: "What's the primary problem this solves?"
      header: "Problem"
      options:
        - label: "[Interpreted problem 1]"
          description: "Based on exploration findings"
        - label: "[Interpreted problem 2]"
          description: "Alternative interpretation"
        - label: "[Different problem]"
          description: "Something else entirely"
      multiSelect: false

    - question: "How urgent is this feature?"
      header: "Priority"
      options:
        - label: "Critical - blocking users"
          description: "Users can't accomplish their goals"
        - label: "High - significant pain"
          description: "Users work around it with difficulty"
        - label: "Medium - improvement"
          description: "Nice to have, not blocking"
        - label: "Low - future consideration"
          description: "Backlog for later"
      multiSelect: false
```

### 4.2 Scope Decisions

```
AskUserQuestion:
  questions:
    - question: "What's the right scope for v1?"
      header: "MVP Scope"
      options:
        - label: "[Minimal scope] (Recommended)"
          description: "${MINIMAL_SCOPE_DESCRIPTION}"
        - label: "[Medium scope]"
          description: "${MEDIUM_SCOPE_DESCRIPTION}"
        - label: "[Full scope]"
          description: "${FULL_SCOPE_DESCRIPTION}"
      multiSelect: false

    - question: "Anything to explicitly exclude?"
      header: "Exclusions"
      options:
        - label: "[Common exclusion 1]"
          description: "Often deferred for this type of feature"
        - label: "[Common exclusion 2]"
          description: "Adds complexity without core value"
        - label: "[Common exclusion 3]"
          description: "Can be added later if needed"
        - label: "Nothing specific"
          description: "Proceed with recommended exclusions"
      multiSelect: true
```

### 4.3 Success Criteria

```
AskUserQuestion:
  questions:
    - question: "How should users experience success?"
      header: "Success UX"
      options:
        - label: "[Success pattern 1]"
          description: "Based on similar features"
        - label: "[Success pattern 2]"
          description: "Alternative approach"
      multiSelect: false

    - question: "How should failures be communicated?"
      header: "Error UX"
      options:
        - label: "Inline validation"
          description: "Immediate feedback as user interacts"
        - label: "Summary after action"
          description: "Show all issues after submission"
        - label: "Silent retry then alert"
          description: "Try to recover, only alert if persistent"
      multiSelect: false
```

---

## Phase 5: Create Issue

Compile requirements and create GitHub issue.

### Requirements Template

```markdown
# Feature: ${FEATURE_TITLE}

## Problem Statement
${WHAT_PROBLEM_THIS_SOLVES}

## User Stories

### Primary
- As a ${USER_TYPE}, I want to ${ACTION} so that ${BENEFIT}

### Secondary
- As a ${USER_TYPE}, I want to ${ACTION} so that ${BENEFIT}

## Scope

### v1 (This Issue)
- [ ] ${REQUIREMENT_1}
- [ ] ${REQUIREMENT_2}
- [ ] ${REQUIREMENT_3}

### Deferred (v2+)
- ${DEFERRED_1}
- ${DEFERRED_2}

### Out of Scope
- ${EXCLUDED_1}

## Acceptance Criteria

### Happy Path
- [ ] ${SUCCESS_CRITERION_1}
- [ ] ${SUCCESS_CRITERION_2}

### Error Handling
- [ ] ${ERROR_CRITERION_1}
- [ ] ${ERROR_CRITERION_2}

### Edge Cases
- [ ] ${EDGE_CASE_1}

## Constraints
- ${CONSTRAINT_1}
- ${CONSTRAINT_2}

## Priority
${PRIORITY_LEVEL} - ${PRIORITY_REASONING}

---
Generated by DevFlow /specify
```

### Create Issue

```bash
gh issue create \
  --title "${FEATURE_TITLE}" \
  --body "$(cat <<'EOF'
${FULL_SPECIFICATION}
EOF
)" \
  --label "feature" \
  --label "${PRIORITY_LABEL}"

ISSUE_NUMBER=$(gh issue list --limit 1 --json number -q '.[0].number')
ISSUE_URL=$(gh issue view "$ISSUE_NUMBER" --json url -q '.url')

echo "Created issue #${ISSUE_NUMBER}: ${ISSUE_URL}"
```

---

## Phase 6: Report

```markdown
## Feature Specification Complete

### Feature
${FEATURE_TITLE}

### GitHub Issue
#${ISSUE_NUMBER} - ${ISSUE_URL}

### Summary
| Aspect | Details |
|--------|---------|
| Problem | ${PROBLEM_SUMMARY} |
| Scope | ${SCOPE_SIZE} items in v1 |
| Priority | ${PRIORITY} |
| Acceptance Criteria | ${NUM_CRITERIA} criteria defined |

### Ready for Implementation
```
/implement #${ISSUE_NUMBER}
```
```

---

## Architecture

```
/specify (orchestrator - spawns agents only)
│
├─ Phase 1: Understand
│  └─ Parse input, identify unknowns
│
├─ Phase 2: Explore Requirements (PARALLEL)
│  ├─ Explore: User perspective
│  ├─ Explore: Similar features
│  ├─ Explore: Constraints
│  └─ Explore: Failure modes
│
├─ Phase 3: Synthesize Exploration
│  └─ Synthesize agent (mode: exploration)
│
├─ Phase 4: Plan Scope (PARALLEL)
│  ├─ Plan: User stories
│  ├─ Plan: Scope boundaries
│  └─ Plan: Acceptance criteria
│
├─ Phase 5: Synthesize Planning
│  └─ Synthesize agent (mode: planning)
│
├─ Phase 6: Clarify
│  └─ AskUserQuestion (batched)
│
├─ Phase 7: Create Issue
│  └─ gh issue create
│
└─ Phase 8: Report
   └─ Display issue details
```

---

## Principles

1. **Requirements, not implementation** - Focus on what and why, not how
2. **Multiple perspectives** - Explore requirements from user, scope, constraint, and failure angles
3. **User drives decisions** - Clarify with user, don't assume
4. **Scope ruthlessly** - Small, focused issues ship faster
5. **Testable criteria** - Every requirement must be verifiable
6. **Enable /implement** - Output must be actionable for implementation
