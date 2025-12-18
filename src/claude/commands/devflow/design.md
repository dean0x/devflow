---
description: Create detailed implementation design with multi-agent exploration and planning - use '/design [feature description]'
---

Create implementation design for: `$ARGUMENTS`

If no arguments, ask the user what feature to design.

---

## Phase 1: Parallel Exploration (3 agents)

Launch in parallel with `model="haiku"`:

```
subagent_type="Explore": "Architecture & patterns for {FEATURE}
- Find similar features, read their code
- Identify patterns (Result types, DI, error handling) with file:line proof
- Document conventions (naming, file structure)
Thoroughness: very thorough. Every claim needs file:line reference."

subagent_type="Explore": "Integration points for {FEATURE}
- Entry points, dependencies, side effects
- Config, database, API, UI touchpoints
Thoroughness: very thorough. List ALL integration points with file:line."

subagent_type="Explore": "Reusable code for {FEATURE}
- Utilities, helpers, validators to leverage
- Similar implementations to extend
- Test patterns and fixtures
Thoroughness: very thorough. Include usage examples."
```

---

## Phase 2: Clarify with User

Synthesize exploration findings, then use **AskUserQuestion** for:
- Design decisions with multiple valid approaches
- Ambiguous requirements
- Scope boundaries

---

## Phase 3: Dual Planning (sequential)

```
subagent_type="Plan": "Create plan for {FEATURE}

Context: {Phase 1 findings}
Decisions: {Phase 2 answers}

Requirements:
- Every step references specific files from exploration
- Follow existing patterns exactly
- Include edge case handling per step
- Evaluation: pattern alignment > philosophy > minimal disruption > testability"

subagent_type="Plan": "Review plan for {FEATURE}

Plan: {Planner 1 output}

Be harsh. Check for:
- Generic steps without file:line (REJECT)
- Missing edge cases
- Pattern violations
- Missing integration points

Output: Issues found, refined plan, remaining risks."
```

---

## Phase 4: Persist

Save to `.docs/design/{topic-slug}-{timestamp}.md`

---

## Quality Gates

Before completing, verify:
- [ ] No generic steps - every step has file:line
- [ ] All integration points found
- [ ] Edge cases explicit
- [ ] Risks documented
