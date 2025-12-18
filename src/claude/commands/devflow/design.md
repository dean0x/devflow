---
description: Create detailed implementation design with multi-agent exploration and planning - use '/design [feature description]'
---

Create a comprehensive implementation design for: `$ARGUMENTS`

If no arguments provided, ask the user what feature they want to design.

---

## Phase 1: Parallel Exploration

Launch **3 Explore agents in parallel** to thoroughly understand the codebase:

```
Task tool (run all 3 in parallel):

1. subagent_type="Explore", model="haiku":
   "Analyze architecture and patterns for implementing: {FEATURE}

   Focus on:
   - How similar features are currently implemented
   - Code patterns in use (Result types, DI, error handling)
   - File/directory structure conventions
   - Naming conventions for similar components

   Thoroughness: very thorough

   Report: existing patterns, conventions, and architectural constraints"

2. subagent_type="Explore", model="haiku":
   "Find integration points and dependencies for: {FEATURE}

   Focus on:
   - Where this feature would be invoked (entry points)
   - What existing modules it needs to use
   - What existing code needs to know about this feature
   - Configuration, database, API changes needed

   Thoroughness: very thorough

   Report: all integration points with file:line references"

3. subagent_type="Explore", model="haiku":
   "Find reusable code and utilities for: {FEATURE}

   Focus on:
   - Existing utilities, helpers, and common functions
   - Similar implementations to reference or extend
   - Validation, error handling, logging patterns to reuse
   - Test patterns and fixtures to leverage

   Thoroughness: very thorough

   Report: reusable code with file:line and usage examples"
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

   Context from exploration:
   {Summary of Phase 1 findings}

   User clarifications:
   {Summary of Phase 2 decisions}

   Create a detailed step-by-step implementation plan with:
   - Specific files to create/modify
   - Code changes needed at each step
   - Dependencies between steps
   - Testing approach for each component

   Be specific - reference actual files and patterns found."

2. subagent_type="Plan":
   "Review and improve this implementation plan for: {FEATURE}

   Original plan:
   {Planner 1's output}

   Critically evaluate:
   - Are there missing steps or edge cases?
   - Is the order optimal (dependencies correct)?
   - Are there simpler approaches?
   - Does it follow the codebase patterns correctly?
   - Are there risks or gotchas not addressed?

   Output: Refined plan with improvements and risk mitigations"
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

## Usage Examples

- `/design user authentication with JWT`
- `/design file upload with validation`
- `/design real-time notifications via WebSocket`
- `/design search with filters and pagination`
