---
description: Plan a release from a rough feature list - explores codebase, plans each feature, creates issues, synthesizes release plan
---

# Plan - Release Planning Command

Transform a rough feature list into a fully specified release plan. Uses multiple Explore and Plan agents to understand context and design each feature, then creates GitHub issues for execution.

**Does NOT implement** - only plans. Output feeds into `/coordinate` for execution.

## Usage

```
/plan Auth, rate limiting, dashboard redesign
/plan "User auth with social login, API rate limiting, Admin dashboard"
```

For single-feature specification, use `/specify` instead.

---

## Input

You receive:
- `FEATURE_LIST`: Rough list of features for the release
- `RELEASE_NAME`: Optional name for this release

## Your Mission

Transform a rough feature list into a complete release plan:

```
PARSE → EXPLORE (parallel) → PLAN (parallel per feature) → CLARIFY → CREATE ISSUES → SYNTHESIZE → REPORT
```

**Output**: A release issue with all feature issues created and dependencies mapped, ready for `/coordinate`.

---

## Phase 1: Parse Feature List

### Extract Features

Parse the input to identify individual features:

```markdown
## Feature Extraction

**Raw Input**: ${FEATURE_LIST}

**Identified Features**:
1. ${FEATURE_1} - [brief interpretation]
2. ${FEATURE_2} - [brief interpretation]
3. ${FEATURE_3} - [brief interpretation]

**Potential Groupings**:
- [features that might be related]

**Initial Questions**:
- [any immediate clarifications needed]
```

### Quick Validation

```
AskUserQuestion:

1. "I identified these features from your list. Is this correct?"
   - Options: "Yes, proceed", "Missing feature", "Remove one", "Merge some"

2. "Any features that MUST be completed before others?"
   - Options: known dependencies + "None" + "Let me specify"
```

---

## Phase 2: Explore Codebase (Parallel)

Spawn Explore agents to understand the codebase context for ALL features.

**Spawn in a single message (parallel execution):**

```
Task tool with subagent_type="Explore":
"Explore PATTERNS for release features: ${FEATURE_LIST}

Find existing patterns in the codebase:
- API patterns (routes, controllers, handlers)
- Database patterns (models, schemas, migrations)
- Authentication/authorization patterns
- Error handling patterns
- Naming conventions

Thoroughness: medium
Report: patterns found with file:line references"

Task tool with subagent_type="Explore":
"Explore ARCHITECTURE for release features: ${FEATURE_LIST}

Find:
- Module/component structure
- How features are organized
- Integration points between components
- Configuration patterns

Thoroughness: medium
Report: architecture overview with file:line references"

Task tool with subagent_type="Explore":
"Explore TESTING PATTERNS for release features: ${FEATURE_LIST}

Find:
- Test file locations and naming
- Testing frameworks used
- Mocking patterns
- Integration test setup

Thoroughness: quick
Report: testing patterns with file:line references"
```

### Synthesize Exploration

```markdown
## Codebase Context

**Patterns to Follow**:
| Pattern | Example | Location |
|---------|---------|----------|
| ${PATTERN} | ${EXAMPLE} | file:line |

**Architecture**:
- Module structure: ${STRUCTURE}
- Integration points: ${POINTS}

**Testing Approach**:
- ${TESTING_SUMMARY}
```

---

## Phase 3: Plan Each Feature (Parallel)

Spawn Plan agents for each feature simultaneously.

**Spawn in a single message (one per feature):**

```
Task tool with subagent_type="Plan":
"Plan feature: ${FEATURE_1}

Codebase context:
${EXPLORATION_SUMMARY}

Design this feature:
- Architecture: How it fits into the system
- Data model: Tables/entities needed
- API design: Endpoints required
- Integration: How it connects to existing code
- Dependencies: What it needs from other features
- Complexity estimate: Low/Medium/High

Output: Feature specification with technical approach"

Task tool with subagent_type="Plan":
"Plan feature: ${FEATURE_2}

Codebase context:
${EXPLORATION_SUMMARY}

Design this feature:
- Architecture: How it fits into the system
- Data model: Tables/entities needed
- API design: Endpoints required
- Integration: How it connects to existing code
- Dependencies: What it needs from other features
- Complexity estimate: Low/Medium/High

Output: Feature specification with technical approach"

Task tool with subagent_type="Plan":
"Plan feature: ${FEATURE_3}
..."
```

### Collect Feature Plans

For each feature, capture:

```json
{
  "feature": "User Authentication",
  "architecture": "JWT with refresh tokens",
  "data_model": ["User table", "Session table"],
  "api_endpoints": ["/auth/login", "/auth/refresh"],
  "dependencies": [],
  "blocks": ["Rate Limiting"],
  "complexity": "High",
  "priority": "P0"
}
```

---

## Phase 4: Clarify

Use AskUserQuestion to validate plans and clarify requirements.

### 4.1 Feature Priorities

```
AskUserQuestion:

1. "What's the priority order for these features?"
   - Options: Ranked list based on dependencies

2. "Any features that could be deferred to v2?"
   - Multi-select of features
```

### 4.2 Technical Decisions

For each feature with multiple approaches:

```
AskUserQuestion:

1. "For ${FEATURE}, which approach?"
   - Options based on Plan agent recommendations
```

### 4.3 Scope Boundaries

```
AskUserQuestion:

1. "What should be explicitly OUT of scope for this release?"
   - Multi-select common exclusions
```

---

## Phase 5: Create Feature Issues

For each feature, create a GitHub issue.

```bash
for FEATURE in ${FEATURES[@]}; do
    gh issue create \
      --title "${FEATURE_TITLE}" \
      --body "$(cat <<'EOF'
# Feature: ${FEATURE_TITLE}

## Overview
${DESCRIPTION}

## Technical Approach

### Architecture
${ARCHITECTURE}

### Data Model
${DATA_MODEL}

### API Design
${API_ENDPOINTS}

### Integration Points
${INTEGRATION}

## Scope

### In Scope
${IN_SCOPE}

### Out of Scope
${OUT_SCOPE}

## Dependencies
- Depends on: ${DEPENDS_ON}
- Blocks: ${BLOCKS}

## Acceptance Criteria
- [ ] ${CRITERIA}
- [ ] Tests pass
- [ ] Documentation updated

## Labels
- Priority: ${PRIORITY}
- Complexity: ${COMPLEXITY}

---
Generated by DevFlow /plan
EOF
)" \
      --label "feature" \
      --label "${PRIORITY_LABEL}"
done
```

### Capture Issue Numbers

```bash
# Collect created issue numbers
FEATURE_ISSUES=()
for ISSUE in $(gh issue list --limit ${NUM_FEATURES} --json number -q '.[].number'); do
    FEATURE_ISSUES+=($ISSUE)
done
```

---

## Phase 6: Synthesize Release Plan

### Build Dependency Graph

```markdown
## Dependency Analysis

### Graph
#101 (User Auth) [P0, High]
  └── blocks: #102, #104

#102 (Rate Limiting) [P1, Medium]
  ├── depends on: #101
  └── blocks: #104

#103 (Dashboard) [P1, Medium]
  └── independent

### Execution Waves

**Wave 1** (no dependencies):
- #101 User Authentication (P0)
- #103 Dashboard Redesign (P1)

**Wave 2** (after Wave 1):
- #102 Rate Limiting (P1)
```

### Create Release Issue

```bash
RELEASE_TITLE="${RELEASE_NAME:-Release $(date +%Y-%m-%d)}"

gh issue create \
  --title "Release: ${RELEASE_TITLE}" \
  --body "$(cat <<'EOF'
# Release: ${RELEASE_TITLE}

## Overview
${RELEASE_DESCRIPTION}

## Features

| Issue | Title | Priority | Complexity | Dependencies |
|-------|-------|----------|------------|--------------|
| #101 | User Authentication | P0 | High | None |
| #102 | Rate Limiting | P1 | Medium | #101 |
| #103 | Dashboard Redesign | P1 | Medium | None |

## Execution Plan

### Wave 1 (Parallel)
- [ ] #101 User Authentication
- [ ] #103 Dashboard Redesign

### Wave 2 (After #101)
- [ ] #102 Rate Limiting

## Dependencies

```
#101 ──> #102
#103 (independent)
```

## Ready for Execution

Run the Coordinator to execute this release:
```
/coordinate #${RELEASE_ISSUE_NUMBER}
```

---
Generated by DevFlow /plan
EOF
)" \
  --label "release"

RELEASE_ISSUE=$(gh issue list --limit 1 --json number -q '.[0].number')
RELEASE_URL=$(gh issue view "$RELEASE_ISSUE" --json url -q '.url')
```

---

## Phase 7: Report

```markdown
## Release Planning Complete

### Release
${RELEASE_TITLE}

### Release Issue
#${RELEASE_ISSUE} - ${RELEASE_URL}

### Features Specified

| Issue | Title | Priority | Wave |
|-------|-------|----------|------|
| #101 | User Authentication | P0 | 1 |
| #103 | Dashboard Redesign | P1 | 1 |
| #102 | Rate Limiting | P1 | 2 |

### Execution Summary
- Total features: ${NUM_FEATURES}
- Waves: ${NUM_WAVES}
- Max parallelization: ${MAX_PARALLEL} features

### Ready for Execution
\`\`\`
/coordinate #${RELEASE_ISSUE}
\`\`\`
```

---

## Error Handling

### Exploration Failure

```markdown
## Exploration Failed

**Error**: ${ERROR}

**Options**:
1. Retry with different focus
2. Proceed with limited context
3. Escalate to user
```

### Planning Failure

```markdown
## Planning Failed for: ${FEATURE}

**Error**: ${ERROR}

**Options**:
1. Retry planning
2. Skip feature, add later
3. Escalate to user
```

---

## Architecture

```
/plan (command - runs in main context)
├── parses feature list from input
├── spawns: 3 Explore agents (parallel)
│   ├── Patterns exploration
│   ├── Architecture exploration
│   └── Testing patterns exploration
├── synthesizes exploration results
├── spawns: N Plan agents (parallel, one per feature)
│   └── Each designs one feature
├── clarifies with user (AskUserQuestion)
├── creates: N GitHub issues (one per feature)
├── creates: 1 Release issue with dependency graph
└── reports results
```

---

## Principles

1. **Parallel exploration** - Understand codebase once for all features
2. **Parallel planning** - Plan all features simultaneously
3. **User validation** - Confirm priorities and scope before creating issues
4. **Dependency mapping** - Identify execution waves
5. **Enable execution** - Output ready for /coordinate
