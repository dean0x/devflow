---
description: Specify a single feature through batched interactive clarification - automatically creates a well-defined GitHub issue ready for Swarm
---

# Specifier - Feature Specification Unit

Transform a rough feature idea into a well-defined, implementation-ready GitHub issue through batched interactive clarification.

**Does NOT implement** - only specifies. Output feeds into Swarm for execution.

## Usage

```
/specify User authentication with social login
/specify Rate limiting for API endpoints
/specify Dashboard redesign with real-time updates
```

For multi-feature release planning, use `/plan` instead.

---

## Input

You receive:
- `FEATURE_IDEA`: Rough description of the feature (e.g., "User authentication with social login")
- `REPO_CONTEXT`: Optional existing codebase context

## Your Mission

Transform a vague feature idea into a precise specification:

```
UNDERSTAND → EXPLORE → PLAN → CLARIFY → SPECIFY → CREATE ISSUE
```

**Output**: A GitHub issue with complete specification ready for Swarm.

---

## Phase 1: Understand

### Parse the Feature Idea

Extract initial understanding:

```markdown
## Initial Understanding

**Raw Input**: ${FEATURE_IDEA}

**My Interpretation**:
- Core functionality: [what I think this does]
- Target users: [who uses this]
- Key interactions: [how users interact]

**Assumptions I'm Making**:
- [list assumptions that need validation]

**Unknowns**:
- [list things I don't know yet]
```

---

## Phase 2: Explore (Inline)

Use Glob, Grep, and Read tools directly to understand existing patterns.

### 2.1 Find Related Features

```
Glob: **/*.ts, **/*.py, **/*.go
Grep: keywords related to ${FEATURE_IDEA}
```

Search for:
- Related existing functionality
- Similar feature implementations
- How the codebase handles similar concerns

### 2.2 Identify Patterns

Read files found to extract:

1. **API patterns** in use
   ```
   Grep: route, endpoint, handler, controller
   ```

2. **Database models** that might be affected
   ```
   Grep: model, schema, entity, table
   ```

3. **Authentication/authorization patterns**
   ```
   Grep: auth, permission, role, token
   ```

4. **Testing patterns**
   ```
   Glob: **/*.test.*, **/*.spec.*
   ```

### 2.3 Synthesize Context

```markdown
## Codebase Context

**Existing Related Features**:
- [feature]: [how it relates] (file:line)

**Patterns to Follow**:
- API: [pattern] (file:line)
- Database: [pattern] (file:line)
- Auth: [pattern] (file:line)
- Testing: [pattern] (file:line)

**Integration Points**:
- [where this feature connects to existing code]
```

---

## Phase 3: Plan (Inline)

Based on exploration findings, think through the technical design.

### 3.1 Technical Approach Analysis

Consider and document:

1. **Architecture** - How does this fit into the existing system?
2. **Data model** - What entities/tables are needed?
3. **API design** - What endpoints/interfaces are required?
4. **Integration** - How does this connect to existing code?
5. **Edge cases** - What could go wrong?
6. **Trade-offs** - What are the key design decisions?

### 3.2 Synthesize Technical Plan

```markdown
## Technical Approach (Draft)

**Recommended Architecture**:
${ARCHITECTURE_SUMMARY}

**Data Model**:
${DATA_MODEL_DRAFT}

**API Design**:
${API_DESIGN_DRAFT}

**Key Trade-offs**:
| Decision | Option A | Option B | Recommendation |
|----------|----------|----------|----------------|
| ${DECISION_1} | ${OPT_A} | ${OPT_B} | ${REC} |

**Open Questions for User**:
- [questions that emerged from planning]
```

This draft informs better questions during clarification.

---

## Phase 4: Clarify

Use AskUserQuestion tool to clarify requirements interactively. Ask questions in batches of 2-4 related questions.

### 4.1 Feature Scope

```
AskUserQuestion:

Questions about: "${FEATURE_IDEA}"

1. "What problem does this solve for users?"
   - Options based on interpretation + "Other"

2. "What's the minimum viable version (v1 scope)?"
   - Options: "Full feature as described", "Core functionality only", "Phased rollout"

3. "What should be explicitly OUT of scope?"
   - Multi-select options based on related features
```

### 4.2 User Flows

```
AskUserQuestion:

1. "Who are the primary users of this feature?"
   - Options based on existing user types + "New user type"

2. "What's the main user flow (happy path)?"
   - Options showing different flow patterns

3. "What triggers this feature?"
   - Options: "User action", "System event", "Scheduled", "API call"
```

### 4.3 Technical Decisions

```
AskUserQuestion:

1. "What's the preferred technical approach?"
   - Options based on codebase patterns + alternatives

2. "Data storage requirements?"
   - Options: "New database table", "Extend existing model", "No persistence", "External service"

3. "Authentication/authorization needs?"
   - Options based on existing auth patterns
```

### 4.4 Scale & Performance

```
AskUserQuestion:

1. "Expected usage scale?"
   - Options: "Low (< 100/day)", "Medium (100-10k/day)", "High (10k+/day)", "Unknown"

2. "Performance requirements?"
   - Options: "Real-time (<100ms)", "Fast (<1s)", "Async acceptable", "Background processing OK"

3. "Caching strategy?"
   - Options based on existing caching patterns
```

### 4.5 Edge Cases & Error Handling

```
AskUserQuestion:

1. "What happens when [primary dependency] fails?"
   - Options: "Graceful degradation", "Full failure", "Retry with backoff", "Queue for later"

2. "Rate limiting needed?"
   - Options: "Yes - per user", "Yes - global", "No", "Defer to v2"

3. "What are the critical error scenarios?"
   - Multi-select common error types
```

### 4.6 Dependencies

```
AskUserQuestion:

1. "Does this feature depend on other features?"
   - Options: existing features + "None" + "New feature needed"

2. "Will other features depend on this?"
   - Options: "Yes - blocking other work", "Possibly - future features", "No - standalone"
```

---

## Phase 5: Specify

### Compile Specification

Based on all clarifications, compile the full specification:

```markdown
# Feature Specification: ${FEATURE_TITLE}

## Overview
${ONE_PARAGRAPH_DESCRIPTION}

## Problem Statement
${WHAT_PROBLEM_THIS_SOLVES}

## User Stories

### Primary User: ${USER_TYPE}
- As a ${USER_TYPE}, I want to ${ACTION} so that ${BENEFIT}

### User Flow
1. ${STEP_1}
2. ${STEP_2}
3. ${STEP_3}

## Technical Approach

### Architecture
${TECHNICAL_APPROACH}

### Data Model
${DATABASE_CHANGES}

### API Design
${API_ENDPOINTS}

### Integration Points
${WHERE_IT_CONNECTS}

## Scope

### In Scope (v1)
- ${FEATURE_1}
- ${FEATURE_2}

### Out of Scope (deferred)
- ${DEFERRED_1}
- ${DEFERRED_2}

## Scale & Performance

- Expected load: ${SCALE}
- Performance target: ${PERFORMANCE}
- Caching: ${CACHING_STRATEGY}

## Edge Cases & Error Handling

| Scenario | Expected Behavior |
|----------|-------------------|
| ${EDGE_CASE_1} | ${BEHAVIOR_1} |
| ${EDGE_CASE_2} | ${BEHAVIOR_2} |

## Dependencies

### Depends On
- ${DEPENDENCY_1}

### Blocks
- ${BLOCKED_FEATURE_1}

## Acceptance Criteria

- [ ] ${CRITERION_1}
- [ ] ${CRITERION_2}
- [ ] ${CRITERION_3}
- [ ] Tests pass
- [ ] Documentation updated

## Labels
- Priority: ${PRIORITY}
- Complexity: ${COMPLEXITY}
- Type: feature
```

---

## Phase 6: Create Issue

After compiling the specification, **automatically create the GitHub issue** - no confirmation needed since user already clarified requirements through the Q&A process.

### Create GitHub Issue

```bash
gh issue create \
  --title "${FEATURE_TITLE}" \
  --body "$(cat <<'EOF'
${FULL_SPECIFICATION}

---
🤖 Generated by DevFlow Specifier
EOF
)" \
  --label "feature" \
  --label "${PRIORITY_LABEL}" \
  --label "${COMPLEXITY_LABEL}"
```

### Capture Issue Number

```bash
ISSUE_NUMBER=$(gh issue list --limit 1 --json number -q '.[0].number')
ISSUE_URL=$(gh issue view "$ISSUE_NUMBER" --json url -q '.url')

echo "✅ Created issue #${ISSUE_NUMBER}"
echo "   URL: ${ISSUE_URL}"
```

---

## Phase 7: Report

Return results:

```markdown
## ✅ Feature Specification Complete

### Feature
${FEATURE_TITLE}

### GitHub Issue
- Number: #${ISSUE_NUMBER}
- URL: ${ISSUE_URL}

### Specification Summary
- Scope: ${SCOPE_SUMMARY}
- Complexity: ${COMPLEXITY}
- Priority: ${PRIORITY}
- Dependencies: ${DEPENDENCIES}

### Ready for Execution
This issue is ready for Swarm execution:
\`\`\`
/swarm #${ISSUE_NUMBER}
\`\`\`

Or add to a release for coordinated execution:
\`\`\`
Reference #${ISSUE_NUMBER} in your release issue, then run /coordinate
\`\`\`
```

---

## Clarification Patterns

### When User Says "I don't know"

```markdown
That's fine! Let me suggest some options based on:
- How similar features work in this codebase
- Common patterns for this type of feature
- Sensible defaults that can be changed later

[Provide concrete suggestions with trade-offs]
```

### When Requirements Conflict

```markdown
I notice a potential conflict:
- ${REQUIREMENT_1} suggests ${IMPLICATION_1}
- ${REQUIREMENT_2} suggests ${IMPLICATION_2}

These might not work together because ${REASON}.

Options:
1. Prioritize ${REQUIREMENT_1} (trade-off: ${TRADEOFF})
2. Prioritize ${REQUIREMENT_2} (trade-off: ${TRADEOFF})
3. Find middle ground: ${COMPROMISE}
```

### When Scope Creeps

```markdown
This is growing beyond the original scope. Let's split it:

**Core Feature (v1)**: ${CORE}
- Can be delivered independently
- Provides immediate value

**Enhancement (v2)**: ${ENHANCEMENT}
- Builds on v1
- Can be a separate issue

Should I create two issues instead?
```

---

## Principles

1. **Clarify, don't assume** - Ask when uncertain, don't guess
2. **User is the authority** - They know their product best
3. **Suggest, don't dictate** - Offer options with trade-offs
4. **Scope ruthlessly** - Small, focused issues are better
5. **Be concrete** - Vague specs lead to vague implementations
6. **Document decisions** - Capture the "why" not just the "what"
7. **Enable execution** - Output must be actionable by Swarm
