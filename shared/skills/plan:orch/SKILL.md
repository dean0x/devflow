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

1. **Discover** — If the planning question is open-ended, ask clarifying questions via AskUserQuestion and present 2-3 approaches with tradeoffs before orienting. Skip if the user's prompt is already specific. If the user says "skip" or "just proceed": skip remaining questions, present inferred scope for confirmation.
2. **Load Feature KBs** — Read `.features/index.json` if it exists. Based on the task, identify relevant KBs, read them, and use as context for direct planning. Set `FEATURE_KNOWLEDGE = (none)` if no KBs exist or none are relevant.
1. **Spawn Skimmer** — `Agent(subagent_type="Skimmer")` targeting the area of interest. Use orientation output to ground design decisions in real file structures and patterns.
2. **Design** — Using Skimmer findings + loaded pattern/design skills + `FEATURE_KNOWLEDGE`, design the approach directly in main session. Apply `devflow:design-review` skill inline to check the plan for anti-patterns before presenting.
3. **Present** — Deliver structured plan using the Output format below. Use AskUserQuestion for ambiguous design choices.

## Worktree Support

If the orchestrator receives a `WORKTREE_PATH` context (e.g., from multi-worktree workflows), pass it through to all spawned agents. Each agent's "Worktree Support" section handles path resolution.

---

## Continuation Detection

Before starting the full pipeline, check for prior planning context:

- **Existing artifact**: `.docs/design/` contains a file matching the current topic
- **Accepted plan in session**: A structured plan was already presented and accepted in this conversation

**Override**: If the user explicitly requests a fresh plan ("start from scratch", "ignore the old plan", "new approach"), execute the full pipeline regardless of prior artifacts.

If EITHER condition is true (and no override) → execute **Refinement Path** instead of Phases 1-12:

1. Read the existing plan (disk artifact or conversation context)
2. Run Phase 5 (Explore) targeting only areas affected by the new request
3. Update the plan with changes, preserving unchanged sections
4. Run Phase 9 (Design Review Lite) on updated sections only
5. Present the delta (what changed and why)
6. Proceed to Phase 11 (Persist) if updated plan is substantial

If NEITHER condition is met → proceed with the full pipeline below.

## Phase 1: Load Knowledge Index

**Produces:** KNOWLEDGE_CONTEXT

Before spawning any agents, load the knowledge index for the current worktree:

```bash
KNOWLEDGE_CONTEXT=$(node scripts/hooks/lib/knowledge-context.cjs index "{worktree}")
```

This produces a compact index of active ADR/PF entries. Pass `KNOWLEDGE_CONTEXT` to Explorer and Designer agents — prior decisions constrain design, known pitfalls inform gap analysis. Agents use `devflow:apply-knowledge` to Read full entry bodies on demand.

## Phase 2: Load Feature Knowledge

**Produces:** FEATURE_KNOWLEDGE

1. Check if `.features/index.json` exists (Read tool). If not, set `FEATURE_KNOWLEDGE = (none)` and skip.
2. Read `.features/index.json` to see available feature KBs.
3. Based on the current task description, identify which KBs are relevant (LLM judgment — match task intent against each KB's `description` and `directories` fields).
4. For each relevant KB:
   a. Run `node scripts/hooks/lib/feature-kb.cjs stale "{worktree}" {slug}` to check staleness
   b. Read `.features/{slug}/KNOWLEDGE.md`
   c. If stale, prefix content with `[STALE — referenced files changed since last update. Verify against current code.]`
5. Concatenate all relevant KB content as `FEATURE_KNOWLEDGE`:
   ```
   --- Feature KB: {slug1} ---
   [content]

   --- Feature KB: {slug2} ---
   [content]
   ```
6. Pass `FEATURE_KNOWLEDGE` to downstream agents alongside `KNOWLEDGE_CONTEXT`.

If no KBs exist or none are relevant, set `FEATURE_KNOWLEDGE = (none)`.

## Phase 3: Requirements Discovery

**Produces:** CONSTRAINED_PROBLEM

Before committing to an approach, surface ambiguity through focused Socratic questioning.

**Skip when** (semantic assessment, not word count):
- User has specified WHAT to build, HOW it should behave, and WHERE it integrates — regardless of prompt length
- Invoked from within another pipeline (pipeline:orch, implement:orch)
- Single clear approach exists with no meaningful alternatives

**Skip examples** (proceed directly to Phase 4):
- "Add retry with exponential backoff to HttpClient in src/http.ts, max 3 retries, configurable timeout" — specific files, clear behavior, defined parameters
- "Implement the design from .docs/design/caching.md" — pre-existing specification

**Discover examples** (run Phase 3):
- "Add a caching layer" — open-ended, multiple valid approaches
- "Improve the auth flow" — vague scope, unclear what aspects need improvement
- "Design a notification system" — system-level, many architectural choices

**Process:**

1. **Assess** — Does the request have meaningful ambiguity or multiple valid approaches? If not, skip to Phase 4.
2. **Question** — Ask clarifying questions via AskUserQuestion. Prefer multiple choice (2-4 options) when tradeoffs exist.
3. **Propose approaches** — Present 2-3 options with explicit tradeoffs:
   - Lead with your recommended approach and why
   - Each option: 2-3 sentences + key tradeoff (complexity, performance, maintenance)
   - Final option: "Other — describe your preferred approach"
4. **Confirm** — Get user's choice, then proceed to Phase 4 with a constrained problem.

If the user says "skip", "just proceed", or signals impatience — skip remaining questions, present your inferred understanding (problem, scope, recommended approach) in one message for confirmation, then proceed to Phase 4 after confirmation. This matches /plan Gate 0 behavior.

**Question design:**
- Ask about constraints and goals, not implementation details
- Surface hidden assumptions ("Does this need to handle concurrent writes?")
- Reveal scope boundaries ("Just the API layer, or the UI as well?")

## Phase 4: Orient

**Produces:** ORIENT_OUTPUT
**Requires:** CONSTRAINED_PROBLEM (or original prompt if Phase 3 skipped)

Spawn `Agent(subagent_type="Skimmer")` to get codebase overview relevant to the planning question:

- Existing patterns and conventions in the affected area
- File structure and module boundaries
- Test patterns and coverage approach
- Related prior implementations (similar features, analogous patterns)

## Phase 5: Explore

**Produces:** EXPLORE_OUTPUT
**Requires:** ORIENT_OUTPUT, KNOWLEDGE_CONTEXT, FEATURE_KNOWLEDGE

Based on Skimmer findings, spawn 2-3 `Agent(subagent_type="Explore")` agents **in a single message** (parallel execution):

- **Integration explorer**: Examine integration points — APIs, shared types, module boundaries the plan must respect
- **Pattern explorer**: Find existing implementations of similar features to follow as templates
- **Constraint explorer**: Identify constraints — test infrastructure, build system, CI requirements, deployment concerns

Each Explore agent receives `KNOWLEDGE_CONTEXT` (from Phase 1), `FEATURE_KNOWLEDGE` (from Phase 2), and the instructions: "follow `devflow:apply-knowledge` for KNOWLEDGE_CONTEXT" and "The FEATURE_KNOWLEDGE is a baseline — your job is to VALIDATE, EXTEND, and CORRECT it, not repeat it. Focus exploration on areas the KB doesn't cover and changes since it was last updated."

Adjust explorer focus based on the specific planning question.

## Phase 6: Gap Analysis Lite

**Produces:** GAP_OUTPUT
**Requires:** EXPLORE_OUTPUT, ORIENT_OUTPUT, KNOWLEDGE_CONTEXT, FEATURE_KNOWLEDGE

Spawn 2 `Agent(subagent_type="Designer")` agents **in a single message** (parallel execution):

```
Agent(subagent_type="Designer"):
"Mode: gap-analysis
Focus: completeness
KNOWLEDGE_CONTEXT: {knowledge_context}
FEATURE_KNOWLEDGE: {feature_knowledge}
Artifacts:
  Planning question: {user's intent}
  Exploration findings: {Phase 5 outputs}
  Codebase context: {Phase 4 output}
Identify missing requirements, undefined error states, vague acceptance criteria.
Follow devflow:apply-knowledge for KNOWLEDGE_CONTEXT."

Agent(subagent_type="Designer"):
"Mode: gap-analysis
Focus: architecture
KNOWLEDGE_CONTEXT: {knowledge_context}
FEATURE_KNOWLEDGE: {feature_knowledge}
Artifacts:
  Planning question: {user's intent}
  Exploration findings: {Phase 5 outputs}
  Codebase context: {Phase 4 output}
Identify pattern violations, missing integration points, layering issues.
Follow devflow:apply-knowledge for KNOWLEDGE_CONTEXT."
```

## Phase 7: Synthesize

**Produces:** SYNTHESIS_OUTPUT
**Requires:** GAP_OUTPUT, EXPLORE_OUTPUT

Spawn `Agent(subagent_type="Synthesizer")` combining gap analysis and explore outputs:

```
Agent(subagent_type="Synthesizer"):
"Mode: design
Designer outputs: {Phase 6 designer outputs}
Combine gap findings with exploration context into blocking vs. should-address categorization."
```

## Phase 8: Plan

**Produces:** PLAN_OUTPUT
**Requires:** ORIENT_OUTPUT, EXPLORE_OUTPUT, SYNTHESIS_OUTPUT, KNOWLEDGE_CONTEXT, FEATURE_KNOWLEDGE

Spawn `Agent(subagent_type="Plan")` with all findings, including `FEATURE_KNOWLEDGE`:

- Design implementation approach with file-level specificity
- Reference existing patterns discovered in Phases 4-5
- Include: architecture decisions, file changes, new files needed, test strategy
- Integrate gap mitigations from Phase 7 into the relevant steps
- Flag areas where existing patterns conflict with the proposed approach

## Phase 9: Design Review Lite

**Produces:** REVIEW_NOTES
**Requires:** PLAN_OUTPUT

Main session reviews the plan inline using the loaded `devflow:design-review` skill:

- Check for N+1 query implications
- Check for god functions
- Check for missing parallelism
- Check for error handling gaps
- Check for missing caching
- Check for poor decomposition

Note findings directly in the plan presentation. This is inline review — no agent spawn needed.

## Phase 10: Present

**Requires:** PLAN_OUTPUT, SYNTHESIS_OUTPUT, REVIEW_NOTES

Present plan to user with:
- Implementation approach (file-level)
- Gap analysis findings (from Phase 7 synthesis)
- Design review notes (from Phase 9 inline check)
- Risk areas

Use AskUserQuestion for any ambiguous design choices that need user input before proceeding to IMPLEMENT.

## Phase 11: Persist

**Requires:** PLAN_OUTPUT

If the plan is substantial (>10 implementation steps or HIGH/CRITICAL context risk):
- Write to `.docs/design/{topic-slug}.{YYYY-MM-DD_HHMM}.md` with YAML frontmatter
- Note the artifact path in the output

Otherwise: plan stays in conversation context, ready for IMPLEMENT to consume directly.

## Phase 12: Feature KB Generation (Conditional)

If Phases 4-5 explored a feature area that does NOT have a matching KB:

1. Identify the feature area slug and name from the explored directories
2. Spawn Agent(subagent_type="KB Builder"):
   ```
   "FEATURE_SLUG: {slug}
   FEATURE_NAME: {name}
   EXPLORATION_OUTPUTS: {combined Phase 4 + Phase 5 outputs}
   DIRECTORIES: {directory prefixes explored}
   KNOWLEDGE_CONTEXT: {from Phase 1}"
   ```
3. Report: "Created feature KB: {slug}"

Skip if all explored areas already have matching KBs.

If a stale KB was detected in Phase 2, also refresh it here — spawn KB Builder with `EXISTING_KB` content + `CHANGED_FILES` from staleness check.

**Failure handling**: KB Builder failure is **non-blocking**. If it crashes, log the failure and complete the plan workflow normally.

**Produces:** `.features/{slug}/KNOWLEDGE.md`, updated `.features/index.json`
**Requires:** Phase 4-5 exploration outputs

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

## Phase Completion Checklist

Before presenting output, verify every phase was announced:

- [ ] Phase 1: Load Knowledge Index → KNOWLEDGE_CONTEXT captured
- [ ] Phase 2: Load Feature Knowledge → FEATURE_KNOWLEDGE captured (or skipped if `.features/` absent)
- [ ] Phase 3: Requirements Discovery → CONSTRAINED_PROBLEM captured (or skipped with stated reason)
- [ ] Phase 4: Orient → ORIENT_OUTPUT captured
- [ ] Phase 5: Explore → EXPLORE_OUTPUT captured
- [ ] Phase 6: Gap Analysis Lite → GAP_OUTPUT captured
- [ ] Phase 7: Synthesize → SYNTHESIS_OUTPUT captured
- [ ] Phase 8: Plan → PLAN_OUTPUT captured
- [ ] Phase 9: Design Review Lite → REVIEW_NOTES captured
- [ ] Phase 10: Present → Output delivered to user
- [ ] Phase 11: Persist → Artifact written (or skipped with stated reason)
- [ ] Phase 12: Feature KB Generation → KB Builder spawned for new feature areas (or skipped if KB exists)

If any phase is unchecked, execute it before proceeding.
