---
description: Create detailed implementation design with multi-agent exploration and planning - use '/design [feature description]'
---

Create a comprehensive implementation design for: `$ARGUMENTS`

If no arguments provided, ask the user what feature they want to design.

---

## Critical Design Philosophy

**NEVER create generic plans.** Every design must be:

1. **Grounded in actual code** - Read files, find patterns, reference specific file:line locations
2. **Aligned with existing architecture** - Follow established patterns, don't introduce new ones without justification
3. **Detailed enough to execute** - Someone unfamiliar with the feature could implement it by following the steps
4. **Honest about trade-offs** - Surface risks, edge cases, and limitations explicitly

**Evaluation Priority** (in order):
1. Alignment with existing patterns
2. Follows project philosophy (Result types, DI, immutability)
3. Minimal disruption to existing code
4. Testability with current test infrastructure
5. Maintainability and readability
6. Performance requirements

---

## Phase 1: Parallel Exploration

Launch **3 Explore agents in parallel** to thoroughly understand the codebase:

```
Task tool (run all 3 in parallel):

1. subagent_type="Explore", model="haiku":
   "Analyze architecture and patterns for implementing: {FEATURE}

   CRITICAL: Read actual code files. Never assume - verify by reading.

   Focus on:
   - How similar features are currently implemented (find examples, read them)
   - Code patterns in use (Result types, DI, error handling) with file:line proof
   - File/directory structure conventions
   - Naming conventions for similar components

   Thoroughness: very thorough

   Report MUST include specific file:line references for every pattern claimed."

2. subagent_type="Explore", model="haiku":
   "Find ALL integration points and dependencies for: {FEATURE}

   CRITICAL: Search exhaustively. Missing an integration point causes bugs.

   Focus on:
   - Where this feature would be invoked (entry points) - search for similar invocations
   - What existing modules it needs to use - read their interfaces
   - What existing code needs to know about this feature (side effects)
   - Configuration, database, API, UI changes needed

   Thoroughness: very thorough

   Report MUST include file:line for EVERY integration point. If unsure, list it anyway."

3. subagent_type="Explore", model="haiku":
   "Find reusable code and utilities for: {FEATURE}

   CRITICAL: Avoid duplication. Find existing code before planning new code.

   Focus on:
   - Existing utilities, helpers, common functions - READ them to understand usage
   - Similar implementations to reference or extend
   - Validation, error handling, logging patterns already in use
   - Test patterns, fixtures, and mocking strategies to leverage

   Thoroughness: very thorough

   Report MUST include file:line AND usage example for each reusable component."
```

---

## Phase 2: Synthesize Exploration & Clarify

After explorers complete, **synthesize findings** into key insights:

1. **Architecture constraints** - What patterns must be followed
2. **Integration complexity** - How many touchpoints exist
3. **Reuse opportunities** - What existing code to leverage
4. **Design decisions needed** - Choices that affect implementation

**Use AskUserQuestion** to clarify:
- Ambiguous requirements
- Design decisions with multiple valid approaches
- Scope boundaries (what's in/out)
- Priority trade-offs (speed vs completeness, etc.)

Example clarification:

```
AskUserQuestion:
  questions:
    - question: "How should we handle [specific scenario]?"
      header: "Edge case"
      options:
        - label: "Option A"
          description: "Approach and trade-off"
        - label: "Option B"
          description: "Approach and trade-off"
```

---

## Phase 3: Dual Planning

Launch **2 Plan agents** for implementation planning with self-review:

```
Task tool (sequential - Planner 2 reviews Planner 1's output):

1. subagent_type="Plan":
   "Create implementation plan for: {FEATURE}

   CRITICAL REQUIREMENTS:
   - Every step MUST reference specific files from exploration findings
   - Follow existing patterns exactly - don't introduce new patterns
   - Include edge case handling in each step
   - Plan must be detailed enough for someone unfamiliar to execute

   Context from exploration:
   {Summary of Phase 1 findings - patterns, integration points, reusable code}

   User clarifications:
   {Summary of Phase 2 decisions}

   For each step provide:
   - Files to create/modify (specific paths)
   - What pattern to follow (reference file:line)
   - Edge cases to handle
   - How to test this step

   Evaluation priority: pattern alignment > philosophy > minimal disruption > testability"

2. subagent_type="Plan":
   "Critically review this implementation plan for: {FEATURE}

   ROLE: You are a skeptical reviewer. Find problems.

   Original plan:
   {Planner 1's output}

   Check for these common failures:
   - Generic steps without file:line references (REJECT)
   - Missing edge cases (invalid input, missing deps, race conditions, permissions)
   - Wrong order (dependencies not respected)
   - Unnecessary complexity (simpler approach exists)
   - Pattern violations (doesn't match existing code)
   - Missing integration points (will cause bugs)
   - Inadequate testing strategy

   Output:
   1. List of issues found (be harsh)
   2. Refined plan with fixes
   3. Remaining risks that cannot be eliminated"
```

---

## Phase 4: Synthesize & Persist

After both planners complete:

1. **Merge the plans** - Combine original + refinements
2. **Create design document** - Save to `.docs/design/`

```bash
mkdir -p .docs/design
TIMESTAMP=$(date +%Y-%m-%d_%H%M)
TOPIC_SLUG=$(echo "{FEATURE}" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | sed 's/[^a-z0-9-]//g' | cut -c1-50)
DESIGN_FILE=".docs/design/${TOPIC_SLUG}-${TIMESTAMP}.md"
```

**Design document format:**

```markdown
# Implementation Design: {FEATURE}

**Created**: {TIMESTAMP}
**Status**: Ready for implementation

---

## Overview

{High-level summary of what will be built}

---

## Architecture Context

{Key patterns and constraints from exploration}

---

## Integration Points

{Where this touches existing code - file:line references}

---

## Code Reuse

{Existing code to leverage - file:line with usage}

---

## Design Decisions

{Decisions made during clarification phase}

| Decision | Choice | Rationale |
|----------|--------|-----------|
| {topic} | {choice} | {why} |

---

## Implementation Plan

{Refined step-by-step plan from Phase 3}

### Step 1: {Action}
- **Files**: {paths}
- **Changes**: {what to do}
- **Pattern**: Follow {reference file:line}
- **Test**: {verification approach}

### Step 2: {Action}
...

---

## Edge Cases & Risks

{From Planner 2's review}

| Risk | Mitigation |
|------|------------|
| {risk} | {how to handle} |

---

## Testing Strategy

{How to verify the implementation}

---

## Out of Scope

{What is explicitly NOT included}
```

Save the document:

```bash
cat > "$DESIGN_FILE" << 'EOF'
{Generated design content}
EOF

echo "Design saved to: $DESIGN_FILE"
```

---

## Final Output

Present summary to user:

```markdown
## Design Complete: {FEATURE}

**Exploration**: 3 agents analyzed architecture, integration points, and reusable code
**Planning**: 2 agents created and refined implementation plan
**Document**: `{DESIGN_FILE}`

### Key Insights

{Most important findings from exploration}

### Implementation Overview

{High-level plan summary - N steps}

### Ready to Implement

Run `/implement` or start with Step 1 from the design document.
```

---

## Quality Gates (Before Completing)

**Verify the design passes ALL checks:**

- [ ] **No generic steps** - Every step has specific file:line references
- [ ] **Patterns verified** - Read actual code to confirm patterns claimed
- [ ] **All integration points found** - Searched exhaustively, nothing missed
- [ ] **Edge cases explicit** - Invalid input, missing deps, race conditions, permissions
- [ ] **Code reuse maximized** - Found existing utilities, not reinventing
- [ ] **Testing strategy concrete** - Specific test files and approaches
- [ ] **Scope boundaries clear** - What's in and what's explicitly out
- [ ] **Risks surfaced** - Remaining risks documented with mitigations

**If any check fails**, iterate with additional exploration or planning before completing.

---

## Usage Examples

- `/design user authentication with JWT`
- `/design file upload with validation`
- `/design real-time notifications via WebSocket`
- `/design search with filters and pagination`
