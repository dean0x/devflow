---
name: plan:orch
description: Agent orchestration for PLAN intent — codebase orientation, gap analysis, design exploration, implementation planning, design review
user-invocable: false
---

# Plan Orchestration

Agent pipeline for PLAN intent in ambient ORCHESTRATED mode. Codebase orientation, gap analysis, targeted exploration, implementation planning, and design review.

This is a focused variant of the `/plan` command pipeline for ambient ORCHESTRATED mode — no user gates, lighter weight, stays in conversation context.

## Iron Law

> **PLANS WITHOUT CODEBASE GROUNDING ARE FANTASIES**
>
> Orient before architecting. Every design decision must reference existing patterns,
> real file structures, and actual integration points. A plan that ignores the codebase
> will fail on contact with implementation.

---

## GUIDED Behavior

For GUIDED depth, the main session performs planning directly:

1. **Spawn Skimmer** — `Agent(subagent_type="Skimmer")` targeting the area of interest. Use orientation output to ground design decisions in real file structures and patterns.
2. **Design** — Using Skimmer findings + loaded pattern/design skills, design the approach directly in main session. Apply `devflow:design-review` skill inline to check the plan for anti-patterns before presenting.
3. **Present** — Deliver structured plan using the Output format below. Use AskUserQuestion for ambiguous design choices.

## Worktree Support

If the orchestrator receives a `WORKTREE_PATH` context (e.g., from multi-worktree workflows), pass it through to all spawned agents. Each agent's "Worktree Support" section handles path resolution.

---

## Phase 0: Load Knowledge Index

Before spawning any agents, load the knowledge index for the current worktree:

```bash
KNOWLEDGE_CONTEXT=$(node scripts/hooks/lib/knowledge-context.cjs index ".")
```

This produces a compact index (~250 tokens) of active ADR/PF entries. Pass `KNOWLEDGE_CONTEXT` to Explorer and Designer agents — prior decisions constrain design, known pitfalls inform gap analysis. Agents use `devflow:apply-knowledge` to Read full entry bodies on demand.

## Phase 1: Orient

Spawn `Agent(subagent_type="Skimmer")` to get codebase overview relevant to the planning question:

- Existing patterns and conventions in the affected area
- File structure and module boundaries
- Test patterns and coverage approach
- Related prior implementations (similar features, analogous patterns)

## Phase 2: Explore

Based on Skimmer findings, spawn 2-3 `Agent(subagent_type="Explore")` agents **in a single message** (parallel execution):

- **Integration explorer**: Examine integration points — APIs, shared types, module boundaries the plan must respect
- **Pattern explorer**: Find existing implementations of similar features to follow as templates
- **Constraint explorer**: Identify constraints — test infrastructure, build system, CI requirements, deployment concerns

Each Explore agent receives `KNOWLEDGE_CONTEXT` (from Phase 0) and the instruction: "follow `devflow:apply-knowledge` for KNOWLEDGE_CONTEXT".

Adjust explorer focus based on the specific planning question.

## Phase 3: Gap Analysis Lite

Spawn 2 `Agent(subagent_type="Designer")` agents **in a single message** (parallel execution):

```
Agent(subagent_type="Designer"):
"Mode: gap-analysis
Focus: completeness
KNOWLEDGE_CONTEXT: {knowledge index from Phase 0, or (none)}
Artifacts:
  Planning question: {user's intent}
  Exploration findings: {Phase 2 outputs}
  Codebase context: {Phase 1 output}
Identify missing requirements, undefined error states, vague acceptance criteria.
Follow devflow:apply-knowledge for KNOWLEDGE_CONTEXT."

Agent(subagent_type="Designer"):
"Mode: gap-analysis
Focus: architecture
KNOWLEDGE_CONTEXT: {knowledge index from Phase 0, or (none)}
Artifacts:
  Planning question: {user's intent}
  Exploration findings: {Phase 2 outputs}
  Codebase context: {Phase 1 output}
Identify pattern violations, missing integration points, layering issues.
Follow devflow:apply-knowledge for KNOWLEDGE_CONTEXT."
```

## Phase 4: Synthesize

Spawn `Agent(subagent_type="Synthesizer")` combining gap analysis and explore outputs:

```
Agent(subagent_type="Synthesizer"):
"Mode: design
Designer outputs: {Phase 3 designer outputs}
Combine gap findings with exploration context into blocking vs. should-address categorization."
```

## Phase 5: Plan

Spawn `Agent(subagent_type="Plan")` with all findings:

- Design implementation approach with file-level specificity
- Reference existing patterns discovered in Phases 1-2
- Include: architecture decisions, file changes, new files needed, test strategy
- Integrate gap mitigations from Phase 4 into the relevant steps
- Flag areas where existing patterns conflict with the proposed approach

## Phase 6: Design Review Lite

Main session reviews the plan inline using the loaded `devflow:design-review` skill:

- Check for N+1 query implications
- Check for god functions
- Check for missing parallelism
- Check for error handling gaps
- Check for missing caching
- Check for poor decomposition

Note findings directly in the plan presentation. This is inline review — no agent spawn needed.

## Phase 7: Present

Present plan to user with:
- Implementation approach (file-level)
- Gap analysis findings (from Phase 4 synthesis)
- Design review notes (from Phase 6 inline check)
- Risk areas

Use AskUserQuestion for any ambiguous design choices that need user input before proceeding to IMPLEMENT.

## Phase 8: Persist

If the plan is substantial (>10 implementation steps or HIGH/CRITICAL context risk):
- Write to `.docs/design/{topic-slug}.{YYYY-MM-DD_HHMM}.md` with YAML frontmatter
- Note the artifact path in the output

Otherwise: plan stays in conversation context, ready for IMPLEMENT to consume directly.

---

## Output

Structured plan ready to feed into IMPLEMENT/ORCHESTRATED if user proceeds:

- Goal and scope
- Gap analysis findings (blocking vs. should-address)
- Architecture decisions with rationale
- File-level change list (create/modify/delete)
- Test strategy
- Design review notes (anti-patterns checked, any concerns)
- Risks and mitigations
- Open questions (if any)
- Design artifact path (if written to disk)
