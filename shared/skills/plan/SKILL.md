---
name: plan
description: Agent orchestration for PLAN intent — codebase orientation, design exploration, gap validation
user-invocable: false
allowed-tools: Read, Grep, Glob, Bash, Task, AskUserQuestion
---

# Plan Orchestration

Agent pipeline for PLAN intent in ambient ORCHESTRATED mode. Codebase orientation, targeted exploration, architecture design, and gap validation.

This is a lightweight variant of the Plan phase in `/implement` for ambient ORCHESTRATED mode.

## Iron Law

> **PLANS WITHOUT CODEBASE GROUNDING ARE FANTASIES**
>
> Orient before architecting. Every design decision must reference existing patterns,
> real file structures, and actual integration points. A plan that ignores the codebase
> will fail on contact with implementation.

---

## Worktree Support

If the orchestrator receives a `WORKTREE_PATH` context (e.g., from multi-worktree workflows), pass it through to all spawned agents. Each agent's "Worktree Support" section handles path resolution.

## Phase 1: Orient

Spawn `Task(subagent_type="Skimmer")` to get codebase overview relevant to the planning question:

- Existing patterns and conventions in the affected area
- File structure and module boundaries
- Test patterns and coverage approach
- Related prior implementations (similar features, analogous patterns)

## Phase 2: Explore

Based on Skimmer findings, spawn 2-3 `Task(subagent_type="Explore")` agents **in a single message** (parallel execution):

- **Integration explorer**: Examine integration points — APIs, shared types, module boundaries the plan must respect
- **Pattern explorer**: Find existing implementations of similar features to follow as templates
- **Constraint explorer**: Identify constraints — test infrastructure, build system, CI requirements, deployment concerns

Adjust explorer focus based on the specific planning question.

## Phase 3: Design

Spawn `Task(subagent_type="Plan")` with combined Skimmer + Explore findings:

- Design implementation approach with file-level specificity
- Reference existing patterns discovered in Phase 1-2
- Include: architecture decisions, file changes, new files needed, test strategy
- Flag any areas where existing patterns conflict with the proposed approach

## Phase 4: Validate

Main session reviews the plan for:

- **Gaps**: Missing files, unhandled edge cases, integration points not addressed
- **Risks**: Areas where the plan deviates from existing patterns, potential regressions
- **Ambiguities**: Design choices that need user input

Present plan to user with identified risks. Use AskUserQuestion for any ambiguous design choices.

## Output

Structured plan ready to feed into IMPLEMENT/ORCHESTRATED if user proceeds:

- Goal and scope
- Architecture decisions with rationale
- File-level change list (create/modify/delete)
- Test strategy
- Risks and mitigations
- Open questions (if any)
