---
description: Unified design planning - combines requirements discovery, gap analysis, implementation planning, and design review into a single workflow
---

# Plan Command

Orchestrate design planning from requirements discovery through gap analysis to implementation design. Produces a machine-readable design artifact consumed by `/implement`.

The orchestrator only spawns agents and gates — all analytical work is done by agents.

## Usage

```
/plan <feature description>
/plan #42                    (GitHub issue)
/plan #12 #15 #18           (multi-issue)
/plan                        (use conversation context)
```

## Input

`$ARGUMENTS` contains whatever follows `/plan`:
- Starts with `#` followed by numbers → issue mode (parse all `#N` tokens, space-separated)
- Path to existing `.md` file → **error**: "Use /implement with plan documents"
- Other text → feature description
- Empty → use conversation context

For **multi-issue** mode: collect all `#N` tokens from `$ARGUMENTS` as `ISSUE_NUMBERS`.

## Clarification Gates

**MANDATORY**: Three gates that must complete before proceeding.

| Gate | Phase | Purpose |
|------|-------|---------|
| Gate 0 | Phase 1 | Confirm understanding before exploration |
| Gate 1 | Phase 7 | Validate scope + gap analysis results |
| Gate 2 | Phase 13 | Confirm final plan + design review |

No gate may be skipped. If user says "proceed" or "whatever you think", state recommendation and get explicit confirmation.

## Phases

---

### Block 1: Requirements Discovery

#### Phase 1: Gate 0 — Confirm Understanding

Present interpretation using AskUserQuestion:
- Core problem this solves
- Target users
- Expected outcome
- Key assumptions

For multi-issue: present unified scope across all issues.

**MANDATORY**: Do not spawn any agents until Gate 0 is confirmed.

#### Phase 2: Orient + Load Knowledge

Spawn Skimmer agent for codebase context:

```
Agent(subagent_type="Skimmer"):
"Orient in codebase for design planning: {feature/issues}
Run rskim on source directories (NOT repo root) to identify:
- Existing patterns and conventions in the affected area
- File structure and module boundaries
- Similar prior implementations
- Test patterns and coverage approach
Return codebase context for requirements analysis."
```

While Skimmer runs, run:

```bash
KNOWLEDGE_CONTEXT=$(node scripts/hooks/lib/knowledge-context.cjs index ".")
```

This produces a compact index (~250 tokens) of active ADR/PF entries. Pass Skimmer context and `KNOWLEDGE_CONTEXT` to all subsequent agents — prior decisions constrain design, known pitfalls inform gap analysis. Agents use `devflow:apply-knowledge` to Read full entry bodies on demand.

#### Phase 3: Explore Requirements (Parallel)

Spawn 4 Explore agents **in a single message**, each with Skimmer context and `KNOWLEDGE_CONTEXT` (from Phase 2). Include instruction: "follow `devflow:apply-knowledge` for KNOWLEDGE_CONTEXT".

| Focus | Thoroughness | Find |
|-------|-------------|------|
| User perspective | medium | Target users, goals, pain points, user journeys |
| Similar features | medium | Comparable features, scope patterns, edge cases |
| Constraints | quick | Dependencies, business rules, prior architectural decisions |
| Failure modes | quick | Error states, edge cases, known pitfalls |

#### Phase 4: Synthesize Exploration

**WAIT** for Phase 3 to complete.

```
Agent(subagent_type="Synthesizer"):
"Synthesize EXPLORATION outputs for: {feature/issues}
Mode: exploration
Explorer outputs: {all 4 outputs}
Combine into: user needs, similar features, constraints, failure modes"
```

---

### Block 2: Gap Analysis

#### Phase 5: Gap Analysis (Parallel)

**Single-issue**: Spawn 4 Designer agents **in a single message**:

| Focus | What it checks |
|-------|----------------|
| completeness | Missing AC, undefined error states, vague requirements |
| architecture | Pattern violations, missing integration points, layering issues |
| security | Auth gaps, input validation, secret handling, OWASP |
| performance | N+1 patterns, missing caching, concurrency, query patterns |

**Multi-issue**: Spawn 6 Designer agents **in a single message** (same 4 plus):

| Focus | What it checks |
|-------|----------------|
| consistency | Cross-issue contradictions, duplicate requirements, conflicting scope |
| dependencies | Inter-issue ordering, shared resources, breaking change propagation |

Each designer receives:
- Mode: `gap-analysis`
- Focus: (their assigned focus from table)
- Exploration synthesis from Phase 4
- Skimmer context from Phase 2
- `KNOWLEDGE_CONTEXT` (index from Phase 2)
- Multi-issue: all issue bodies

```
Agent(subagent_type="Designer"):
"Mode: gap-analysis
Focus: {completeness|architecture|security|performance|consistency|dependencies}
KNOWLEDGE_CONTEXT: {knowledge index from Phase 2, or (none)}
Artifacts:
  Feature/Issues: {feature description or issue bodies}
  Exploration synthesis: {Phase 4 output}
  Codebase context: {Phase 2 output}
Analyze only your assigned focus area. Follow devflow:apply-knowledge for KNOWLEDGE_CONTEXT.
Cite evidence from provided artifacts."
```

#### Phase 6: Synthesize Gap Analysis

**WAIT** for Phase 5 to complete.

```
Agent(subagent_type="Synthesizer"):
"Synthesize GAP ANALYSIS outputs for: {feature/issues}
Mode: design
Designer outputs: {all designer outputs}
Deduplicate, boost confidence for multi-agent flags, categorize by severity."
```

---

### Block 3: Scope Approval

#### Phase 7: Gate 1 — Validate Scope + Gaps

Use AskUserQuestion to present and validate:

1. **Scope Summary**
   - Core problem
   - Priority level (Critical/High/Medium/Low)
   - v1 scope (what's included)
   - Explicit exclusions

2. **Gap Analysis Results** (from Phase 6)
   - Blocking gaps (CRITICAL/HIGH) with proposed resolutions
   - Should-address recommendations (MEDIUM)
   - Informational items (LOW)

User can:
- Accept scope and gaps as presented
- Modify scope (add/remove items)
- Override specific gaps (accept risk and proceed)

**MANDATORY**: Do not proceed to implementation design until Gate 1 is confirmed.

---

### Block 4: Implementation Design

#### Phase 8: Explore Implementation (Parallel)

Spawn 4 Explore agents **in a single message**, each with Skimmer context + accepted scope:

| Focus | Thoroughness | Find |
|-------|-------------|------|
| Architecture | medium | Similar implementations, patterns, module structure |
| Integration | medium | Entry points, services, database models, configuration |
| Reusable code | medium | Utilities, helpers, validation patterns, error handling |
| Edge cases | quick | Error scenarios, race conditions, permission failures |

#### Phase 9: Synthesize Implementation Exploration

**WAIT** for Phase 8 to complete.

```
Agent(subagent_type="Synthesizer"):
"Synthesize IMPLEMENTATION EXPLORATION outputs for: {feature/issues}
Mode: exploration
Explorer outputs: {all 4 outputs}
Combine into: patterns to follow, integration points, reusable code, edge cases"
```

#### Phase 10: Plan Implementation (Parallel)

Spawn 3 Plan agents **in a single message**, each with implementation exploration synthesis:

| Focus | Output |
|-------|--------|
| Implementation steps | Ordered steps with files, dependencies, gap mitigations |
| Testing strategy | Unit tests, integration tests, edge case tests |
| Execution strategy | SINGLE_CODER vs SEQUENTIAL_CODERS vs PARALLEL_CODERS |

Implementation steps planner: include explicit gap mitigations (from Phase 6) in the relevant steps.

#### Phase 11: Synthesize Planning

**WAIT** for Phase 10 to complete.

```
Agent(subagent_type="Synthesizer"):
"Synthesize PLANNING outputs for: {feature/issues}
Mode: planning
Planner outputs: {all 3 outputs}
Combine into: execution plan with strategy decision, gap mitigations integrated"
```

---

### Block 5: Design Review + Approval

#### Phase 12: Design Review

Spawn 1 Designer agent with mode `design-review`:

```
Agent(subagent_type="Designer"):
"Mode: design-review
Artifacts:
  Implementation plan: {Phase 11 planning synthesis}
  Implementation exploration: {Phase 9 exploration synthesis}
  Codebase context: {Phase 2 output}
Review the full plan for all 6 anti-patterns. Report all findings with evidence."
```

#### Phase 13: Gate 2 — Confirm Plan + Design Review

Use AskUserQuestion to present:

1. **Implementation Plan Summary**
   - Execution strategy (SINGLE_CODER / SEQUENTIAL_CODERS / PARALLEL_CODERS)
   - Key implementation steps with files
   - Test strategy

2. **Design Review Findings** (from Phase 12)
   - Each anti-pattern finding with severity and proposed mitigation
   - Which findings are already addressed in the plan

3. **Acceptance Criteria** (from gap analysis + exploration)

4. **Risk Assessment**
   - Context risk level (LOW/MEDIUM/HIGH/CRITICAL)
   - Unresolved gaps carried forward

User can:
- **Accept** — proceed to output phases
- **Revise** — re-run phases 10-12 with new constraints (loop back, no limit on revisions)
- **Cancel** — stop gracefully, no artifact written

**MANDATORY**: Do not write design artifact until Gate 2 is confirmed.

---

### Block 6: Output

#### Phase 14: Output

**Store design artifact:**

Write design artifact to disk:
- If issue number: `.docs/design/{issue-number}-{topic-slug}.{YYYY-MM-DD_HHMM}.md`
- If multi-issue: `.docs/design/{first-issue-number}-multi.{YYYY-MM-DD_HHMM}.md`
- If no issue: `.docs/design/{topic-slug}.{YYYY-MM-DD_HHMM}.md`

Create parent directory if needed.

**Artifact format:**

```yaml
---
type: design-artifact
version: 1
status: APPROVED
issue: 42
title: "Feature Title"
slug: feature-slug
created: 2026-04-07T14:30:00Z
execution-strategy: SINGLE_CODER
context-risk: LOW
---
```

Required sections:
1. **Problem Statement** — core problem and target users
2. **Acceptance Criteria** — testable success conditions (from exploration + gap analysis)
3. **Scope** — v1 included, deferred, excluded
4. **Gap Analysis Results** — blocking gaps with resolutions, should-address items
5. **Execution Strategy** — SINGLE_CODER/SEQUENTIAL/PARALLEL with rationale
6. **Subtask Breakdown** — phases with domains and dependencies (if not SINGLE_CODER)
7. **Implementation Plan** — ordered steps with files and gap mitigations
8. **Patterns to Follow** — from exploration synthesis (file:line references)
9. **Integration Points** — entry points, services, models to connect
10. **Design Review Results** — anti-pattern findings with mitigations
11. **Risk Assessment** — context risk level, unresolved risks

**Create GitHub issue (optional):**

If the feature does not already have a GitHub issue:
- Create via `gh issue create`
- Title: feature name
- Body: problem statement, user stories, v1 scope, acceptance criteria, link to design artifact path
- Labels: feature, priority level

Skip if issue number was provided as input.

**Report:**

Display completion summary:
- Design artifact path
- Issue URL (if created or if pre-existing)
- Gap analysis summary (N blocking, M should-address)
- Design review summary (N anti-patterns found, M mitigated in plan)
- Suggested next step: `/implement {artifact-path}` or `/implement #{issue-number}`

---

## Architecture

```
/plan (orchestrator - spawns agents only)
│
├─ Block 1: Requirements Discovery
│  ├─ Phase 1: GATE 0 - Confirm Understanding ⛔ MANDATORY
│  │  └─ AskUserQuestion: Validate interpretation
│  ├─ Phase 2: Orient + Load Knowledge
│  │  ├─ Skimmer agent (codebase context)
│  │  └─ Load knowledge index (knowledge-context.cjs index)
│  ├─ Phase 3: Explore Requirements (PARALLEL)
│  │  ├─ Explore: User perspective
│  │  ├─ Explore: Similar features
│  │  ├─ Explore: Constraints
│  │  └─ Explore: Failure modes
│  └─ Phase 4: Synthesize Exploration
│     └─ Synthesizer agent (mode: exploration)
│
├─ Block 2: Gap Analysis
│  ├─ Phase 5: Gap Analysis (PARALLEL)
│  │  ├─ Designer: completeness
│  │  ├─ Designer: architecture
│  │  ├─ Designer: security
│  │  ├─ Designer: performance
│  │  ├─ Designer: consistency (multi-issue only)
│  │  └─ Designer: dependencies (multi-issue only)
│  └─ Phase 6: Synthesize Gap Analysis
│     └─ Synthesizer agent (mode: design)
│
├─ Block 3: Scope Approval
│  └─ Phase 7: GATE 1 - Validate Scope + Gaps ⛔ MANDATORY
│     └─ AskUserQuestion: Confirm scope and gap resolutions
│
├─ Block 4: Implementation Design
│  ├─ Phase 8: Explore Implementation (PARALLEL)
│  │  ├─ Explore: Architecture
│  │  ├─ Explore: Integration
│  │  ├─ Explore: Reusable code
│  │  └─ Explore: Edge cases
│  ├─ Phase 9: Synthesize Implementation Exploration
│  │  └─ Synthesizer agent (mode: exploration)
│  ├─ Phase 10: Plan Implementation (PARALLEL)
│  │  ├─ Plan: Implementation steps
│  │  ├─ Plan: Testing strategy
│  │  └─ Plan: Execution strategy
│  └─ Phase 11: Synthesize Planning
│     └─ Synthesizer agent (mode: planning)
│
├─ Block 5: Design Review + Approval
│  ├─ Phase 12: Design Review
│  │  └─ Designer agent (mode: design-review)
│  └─ Phase 13: GATE 2 - Confirm Plan + Design Review ⛔ MANDATORY
│     └─ AskUserQuestion: Final plan approval
│
└─ Block 6: Output
   └─ Phase 14: Output
      ├─ Store design artifact (.docs/design/)
      ├─ Create GitHub issue (optional)
      └─ Report summary + next step
```

## Principles

1. **Orchestration only** — Command spawns agents, never does agent work itself
2. **Three mandatory gates** — Gate 0 (understand), Gate 1 (scope+gaps), Gate 2 (plan+review); none may be skipped
3. **Parallel execution** — Explore phases and gap analysis run in parallel; synthesis phases wait
4. **Evidence-based gaps** — Every gap cites specific text; no speculation
5. **Scope ruthlessly** — Small, focused plans ship faster; gate 1 enforces scope discipline
6. **Strict delegation** — Never synthesize, analyze, or plan in main session; always spawn agents
7. **Design artifacts are machine-readable** — `/implement` can consume the YAML frontmatter directly

## Error Handling

- If any agent fails, report the phase, agent type, and error
- If user selects "Revise" at Gate 2, loop back to Phase 10 with user's constraints
- If user selects "Cancel" at any gate, stop gracefully without writing artifact
- If `.docs/design/` does not exist, create it in Phase 14
