---
description: Specify a single feature through exploration, planning, and interactive clarification - creates a well-defined GitHub issue ready for Swarm
---

# Specify - Feature Specification Command

Transform a rough feature idea into a well-defined, implementation-ready GitHub issue through multi-agent exploration, planning, and user clarification.

**Does NOT implement** - only specifies. Output feeds into `/swarm` for execution.

## Usage

```
/specify User authentication with social login
/specify Rate limiting for API endpoints
/specify Dashboard redesign with real-time updates
```

Specify handles one feature at a time. Run multiple `/specify` commands for multiple features.

---

## Input

You receive:
- `FEATURE_IDEA`: Rough description of the feature

## Your Mission

Transform a vague feature idea into a precise specification:

```
UNDERSTAND → EXPLORE (parallel) → PLAN (parallel) → CLARIFY → CREATE ISSUE
```

**Output**: A GitHub issue with complete specification ready for `/swarm`.

---

## Phase 1: Understand

Parse the feature idea and extract initial understanding:

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

## Phase 2: Explore (Parallel Agents)

Spawn multiple Explore agents in parallel to understand different aspects of the codebase.

**Spawn in a single message (parallel execution):**

```
Task tool with subagent_type="Explore":
"Explore PATTERNS for: ${FEATURE_IDEA}

Find existing patterns in the codebase:
- How similar features are implemented
- API patterns (routes, controllers, handlers)
- Database patterns (models, schemas, migrations)
- Naming conventions used

Thoroughness: medium
Report: patterns found with file:line references"

Task tool with subagent_type="Explore":
"Explore INTEGRATION POINTS for: ${FEATURE_IDEA}

Find where this feature would connect:
- Entry points (routes, event handlers, CLI commands)
- Services/modules it would interact with
- Shared utilities it could use
- Configuration/environment variables needed

Thoroughness: medium
Report: integration points with file:line references"

Task tool with subagent_type="Explore":
"Explore TESTING PATTERNS for: ${FEATURE_IDEA}

Find how testing is done:
- Test file locations and naming
- Testing frameworks and utilities used
- Mocking patterns
- Integration vs unit test separation

Thoroughness: quick
Report: testing patterns with file:line references"
```

### Synthesize Exploration Results

After all Explore agents complete, combine their findings:

```markdown
## Codebase Context

**Patterns to Follow**:
| Pattern | Example | Location |
|---------|---------|----------|
| API routes | REST with Express | src/routes/users.ts:15 |
| Database | Prisma ORM | src/models/user.ts:1 |
| Auth | JWT middleware | src/middleware/auth.ts:20 |

**Integration Points**:
- [where this connects] (file:line)

**Reusable Code**:
- [existing utilities to leverage] (file:line)

**Testing Approach**:
- [how to test this] (file:line examples)
```

---

## Phase 3: Plan (Parallel Agents)

Spawn multiple Plan agents to think through different aspects.

**Spawn in a single message (parallel execution):**

```
Task tool with subagent_type="Plan":
"Plan ARCHITECTURE for: ${FEATURE_IDEA}

Based on codebase patterns found:
${EXPLORATION_SUMMARY}

Design the high-level architecture:
- Components/modules needed
- Data flow
- API design (endpoints, request/response)
- How it fits into existing architecture

Output: Architecture recommendation with trade-offs"

Task tool with subagent_type="Plan":
"Plan DATA MODEL for: ${FEATURE_IDEA}

Based on existing database patterns:
${EXPLORATION_SUMMARY}

Design the data model:
- New tables/collections needed
- Fields and types
- Relationships to existing models
- Migrations required

Output: Data model design with alternatives"
```

### Synthesize Planning Results

```markdown
## Technical Approach (Draft)

**Architecture**:
${ARCHITECTURE_SUMMARY}

**Data Model**:
${DATA_MODEL_DRAFT}

**API Design**:
${API_ENDPOINTS}

**Key Trade-offs**:
| Decision | Option A | Option B | Recommendation |
|----------|----------|----------|----------------|
| ${DECISION} | ${OPT_A} | ${OPT_B} | ${REC} |

**Open Questions**:
- [questions for user clarification]
```

---

## Phase 4: Clarify

Use AskUserQuestion to clarify requirements. Ask in batches of 2-4 related questions.

### 4.1 Feature Scope

```
AskUserQuestion:

1. "What problem does this solve for users?"
   - Options based on interpretation

2. "What's the minimum viable version (v1 scope)?"
   - Options: "Full feature", "Core only", "Phased"

3. "What should be explicitly OUT of scope?"
   - Multi-select common exclusions
```

### 4.2 Technical Decisions

```
AskUserQuestion:

1. "Preferred technical approach?"
   - Options based on Plan agent recommendations

2. "Data storage requirements?"
   - Options: "New table", "Extend existing", "No persistence"

3. "Performance requirements?"
   - Options: "Real-time", "Fast (<1s)", "Async OK"
```

### 4.3 Edge Cases

```
AskUserQuestion:

1. "What happens when dependencies fail?"
   - Options: "Graceful degradation", "Full failure", "Retry"

2. "Rate limiting needed?"
   - Options: "Per user", "Global", "No", "Defer"
```

---

## Phase 5: Create Issue

Compile specification and create GitHub issue automatically.

### Specification Template

```markdown
# Feature: ${FEATURE_TITLE}

## Overview
${ONE_PARAGRAPH_DESCRIPTION}

## Problem Statement
${WHAT_PROBLEM_THIS_SOLVES}

## User Stories
- As a ${USER_TYPE}, I want to ${ACTION} so that ${BENEFIT}

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

### Out of Scope
- ${DEFERRED_1}

## Edge Cases
| Scenario | Behavior |
|----------|----------|
| ${CASE} | ${HANDLING} |

## Acceptance Criteria
- [ ] ${CRITERION_1}
- [ ] ${CRITERION_2}
- [ ] Tests pass
- [ ] Documentation updated

## Labels
- Priority: ${PRIORITY}
- Complexity: ${COMPLEXITY}
```

### Create Issue

```bash
gh issue create \
  --title "${FEATURE_TITLE}" \
  --body "$(cat <<'EOF'
${FULL_SPECIFICATION}

---
Generated by DevFlow /specify
EOF
)" \
  --label "feature" \
  --label "${PRIORITY_LABEL}" \
  --label "${COMPLEXITY_LABEL}"

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
- Scope: ${SCOPE_SUMMARY}
- Complexity: ${COMPLEXITY}
- Priority: ${PRIORITY}

### Ready for Execution
\`\`\`
/swarm #${ISSUE_NUMBER}
\`\`\`
```

---

## Architecture

```
/specify (command - runs in main context)
├── spawns: 3 Explore agents (parallel)
│   ├── Patterns exploration
│   ├── Integration points exploration
│   └── Testing patterns exploration
├── synthesizes exploration results
├── spawns: 2 Plan agents (parallel)
│   ├── Architecture planning
│   └── Data model planning
├── synthesizes planning results
├── clarifies with user (AskUserQuestion)
└── creates: GitHub issue
```

---

## Principles

1. **Parallel exploration** - Multiple agents explore different aspects simultaneously
2. **Parallel planning** - Multiple agents plan different concerns
3. **User drives decisions** - Clarify with user, don't assume
4. **Scope ruthlessly** - Small, focused issues are better
5. **Enable execution** - Output must be actionable by /swarm
