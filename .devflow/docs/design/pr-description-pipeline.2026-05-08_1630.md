---
type: design-artifact
version: 1
status: APPROVED
title: "PR Description Pipeline"
slug: pr-description-pipeline
created: 2026-05-08T16:30:00Z
execution-strategy: SEQUENTIAL_CODERS
context-risk: MEDIUM
---

# PR Description Pipeline

Thread PR descriptions through Plan -> Implement -> Review -> Resolve workflows so that code reviews are grounded in the plan's intent and resolvers understand what feature they are protecting.

## Problem Statement

PR descriptions in devflow are write-only artifacts. The Coder generates them independently with no structured input from the plan, and Review/Resolve never read them back. Reviewers analyze code in a vacuum without knowing the stated intent, and Resolvers fix issues without understanding what the PR was trying to accomplish. Rich plan context (problem statement, scope, gap analysis, risks) is available but discarded at the Plan-to-Implement handoff.

## Acceptance Criteria

1. Plan artifacts include `## PR Description Guidance` section with 4 subsections (Problem Being Solved, Key Changes to Highlight, Breaking Changes, Reviewer Focus Areas)
2. All 3 Coder strategies (SINGLE/SEQUENTIAL/PARALLEL) receive and use `PR_DESCRIPTION_GUIDANCE` when creating PRs
3. Ambient mode (implement:orch) persists guidance to `.docs/pr-description-guidance.md` for deferred PR creation
4. Git agent `ensure-pr-ready` consumes guidance file when creating new PRs
5. Review workflows (`/code-review` and `review:orch`) fetch `PR_DESCRIPTION` from GitHub and pass to all Reviewer agents
6. Resolve workflows (`/resolve` and `resolve:orch`) fetch `PR_DESCRIPTION` from GitHub and pass to all Resolver agents
7. Graceful degradation: all variables default to `(none)` when absent — no errors, no behavioral changes
8. Cleanup: `.docs/pr-description-guidance.md` deleted after PR creation
9. No backward-compatibility shims (per ADR-001)

## Scope

### v1 Included
- New plan artifact section #12: PR Description Guidance
- PR_DESCRIPTION_GUIDANCE variable threading through Implement
- PR_DESCRIPTION variable threading through Review and Resolve
- Git agent ensure-pr-ready consuming guidance file
- Ambient mode persistence via `.docs/pr-description-guidance.md`

### Deferred
- PR body update after resolve (post-resolution refresh)
- PR description quality validation
- Caching of PR body across pipeline:orch sub-orchestrators

### Excluded
- New Git agent operations (orchestrators fetch directly via `gh pr view`)
- Changes to the PR template format in git/SKILL.md or references/patterns.md
- TypeScript CLI changes

## Gap Analysis Results

### Blocking (resolved in this design)
1. **Plan-to-Implement handoff format undefined** — Resolved: Section #12 with 4 structured subsections + extraction in implement.md
2. **Three-way PR creation ownership** — Resolved: SINGLE/SEQUENTIAL pass to Coder; PARALLEL uses at orchestrator; ambient persists to file
3. **Ambient mode CREATE_PR: false** — Resolved: `.docs/pr-description-guidance.md` bridges implement:orch to ensure-pr-ready
4. **Git agent PR body retrieval** — Resolved: Orchestrators fetch directly via `gh pr view` (no new Git agent operation needed)
5. **Agent consumption rules undefined** — Resolved: Advisory-only rules (intent context, not review target)

### Should-Address (integrated into implementation steps)
- Variable naming standardized: PR_DESCRIPTION_GUIDANCE (plan->implement) vs PR_DESCRIPTION (GitHub->review/resolve)
- plan:orch Output section includes guidance
- Cleanup of guidance file in multiple locations

## Architecture Decisions

### AD-1: Two Distinct Variable Names

`PR_DESCRIPTION_GUIDANCE` carries structured guidance from plan to Coder (prospective — what to write). `PR_DESCRIPTION` carries the actual PR body fetched from GitHub (retrospective — what was written). These are different data serving different purposes.

### AD-2: Plan Section #12 — PR Description Guidance

Required section in plan artifacts with 4 subsections:
- Problem Being Solved (1-2 sentences, the "why")
- Key Changes to Highlight (bulleted, user-facing framing)
- Breaking Changes (from gap analysis or "None expected")
- Reviewer Focus Areas (areas needing attention, with reasons)

### AD-3: All Three Coder Strategies Receive Guidance

- SINGLE_CODER: Coder receives PR_DESCRIPTION_GUIDANCE, uses in Responsibility 7
- SEQUENTIAL_CODERS: Last Coder (CREATE_PR: true) receives guidance
- PARALLEL_CODERS: Orchestrator uses guidance directly when creating unified PR in Phase 9

### AD-4: Ambient Persistence via `.docs/pr-description-guidance.md`

implement:orch writes guidance to file since CREATE_PR is false. Git agent ensure-pr-ready reads this file when creating a PR in review:orch. File is deleted after PR creation.

### AD-5: Orchestrators Fetch PR Body Directly

Both review and resolve orchestrators run `gh pr view {pr_number} --json body --jq '.body'` directly rather than adding a new Git agent operation. A single API call doesn't warrant a dedicated agent operation.

### AD-6: PR_DESCRIPTION is Advisory Context

Reviewers use it to understand author intent (distinguish intentional choices from oversights). Resolvers use it for validation context (is code intentional?). Neither reviews the description itself.

## Execution Strategy

SEQUENTIAL_CODERS (2 phases)

**Rationale**: Total change touches 14 canonical files. Two phases keep scope manageable. Phase 2 depends on Phase 1's variable names and format.

## Subtask Breakdown

### Phase 1: Plan-Side + Agent Inputs

**Domain**: docs (all markdown)
**Dependencies**: None
**Files**:
- `plugins/devflow-plan/commands/plan.md` — Add section #12
- `shared/skills/plan:orch/SKILL.md` — Add guidance to Output + Phase 8
- `shared/agents/coder.md` — Accept PR_DESCRIPTION_GUIDANCE
- `shared/agents/reviewer.md` — Accept PR_DESCRIPTION
- `shared/agents/resolver.md` — Accept PR_DESCRIPTION
- `shared/agents/git.md` — Extend ensure-pr-ready

### Phase 2: Implement/Review/Resolve Threading

**Domain**: docs (all markdown)
**Dependencies**: Phase 1 (variable names and format settled)
**Files**:
- `plugins/devflow-implement/commands/implement.md` — Extract guidance, thread to strategies
- `shared/skills/implement:orch/SKILL.md` — Extract in Phase 3, pass in Phase 4, persist to file
- `plugins/devflow-code-review/commands/code-review.md` — Fetch PR body, pass to reviewers
- `shared/skills/review:orch/SKILL.md` — Fetch PR body, pass in Phase 5, cleanup
- `plugins/devflow-resolve/commands/resolve.md` — Fetch PR body, pass to resolvers
- `shared/skills/resolve:orch/SKILL.md` — Fetch PR body, pass in Phase 5

## Implementation Plan

### Phase 1 Steps

1. **plan.md — Add section #12 to artifact format** (line 383)
   - After section 11 (Risk Assessment), add: `12. **PR Description Guidance** — structured hints for PR body (problem being solved, key changes, breaking changes, reviewer focus areas)`
   - Add format specification showing the 4 subsections

2. **plan:orch/SKILL.md — Add guidance to output** (lines 256-268)
   - Add `- PR Description Guidance (problem, key changes, breaking changes, reviewer focus areas)` to Output list
   - In Phase 8 Plan agent spawn, add instruction to generate the guidance section

3. **coder.md — Accept PR_DESCRIPTION_GUIDANCE** (after line 35)
   - Add optional input: `PR_DESCRIPTION_GUIDANCE (optional): Structured hints for PR body from plan artifact`
   - Extend Responsibility 7 (line 78): map guidance subsections to PR template sections
   - Mapping: Problem Being Solved -> Summary, Key Changes -> Changes, Breaking Changes -> Breaking Changes, Reviewer Focus Areas -> Reviewer Focus Areas

4. **reviewer.md — Accept PR_DESCRIPTION** (after line 24)
   - Add optional input: `PR_DESCRIPTION (optional): PR body text from GitHub. Author's stated intent. Use to contextualize findings. Do NOT review the description itself.`

5. **resolver.md — Accept PR_DESCRIPTION** (after line 26)
   - Add optional input: `PR_DESCRIPTION (optional): PR body text from GitHub. Original author intent and scope. Use during validation to assess whether code is intentional.`

6. **git.md — Extend ensure-pr-ready** (lines 43-49, step 4)
   - Extend PR creation step: when creating a new PR, check for `.docs/pr-description-guidance.md`. If found, read it and use its content to compose the PR body via git skill template. If not found, existing behavior.
   - Add to output: `- PR Description Source: {guidance-file | generated | existing}`

### Phase 2 Steps

7. **implement.md — Extract and thread guidance** (lines 55-74)
   - Add to Plan Document Handling: extract `## PR Description Guidance` section, set `PR_DESCRIPTION_GUIDANCE` variable (or `(none)`)
   - Add `PR_DESCRIPTION_GUIDANCE` to Phase 1 Produces list (line 32)
   - Add to SINGLE_CODER spawn (line 107): `PR_DESCRIPTION_GUIDANCE: {pr_description_guidance}`
   - Add to SEQUENTIAL last Coder spawn: `PR_DESCRIPTION_GUIDANCE: {pr_description_guidance}`
   - Add to PARALLEL Phase 9 (line 360): use guidance when composing unified PR body

8. **implement:orch/SKILL.md — Extract and persist guidance** (lines 76-116)
   - Phase 3 Plan Synthesis: extract `## PR Description Guidance` as `PR_DESCRIPTION_GUIDANCE`
   - Phase 4 Coder spawn: add `PR_DESCRIPTION_GUIDANCE` to variable list
   - After Coder completes: if guidance is not `(none)`, write to `.docs/pr-description-guidance.md`
   - Phase 7 cleanup: delete `.docs/pr-description-guidance.md` if exists

9. **code-review.md — Fetch and thread PR body** (lines 34-157)
   - After Step 0b Extract (line 53): add `gh pr view {pr_number} --json body --jq '.body'` to set `PR_DESCRIPTION`
   - Add `PR_DESCRIPTION` to Step 0b Produces
   - Phase 2 Reviewer spawn (line 154): add `PR_DESCRIPTION: {pr_description}`

10. **review:orch/SKILL.md — Fetch and thread PR body** (lines 24-108)
    - After Phase 1 Extract (line 29): add PR body fetch command
    - Add `PR_DESCRIPTION` to Phase 1 Produces
    - Phase 5 reviewer list: add PR_DESCRIPTION to each reviewer's inputs
    - Phase 7 cleanup: delete `.docs/pr-description-guidance.md` if exists

11. **resolve.md — Fetch and thread PR body** (lines 35-155)
    - After Step 0b Extract (line 54): add PR body fetch command
    - Add `PR_DESCRIPTION` to Step 0b Produces
    - Phase 4 Resolver spawn (line 153): add `PR_DESCRIPTION: {pr_description}`

12. **resolve:orch/SKILL.md — Fetch and thread PR body** (lines 23-90)
    - Phase 1: detect PR number, fetch body
    - Add `PR_DESCRIPTION` to Phase 1 Produces
    - Phase 5 Resolver list: add PR_DESCRIPTION to each resolver's inputs

### Post-Implementation

13. **npm run build** — Distributes shared agents and skills to all plugin copies

## Patterns to Follow

- Variable threading: `**NAME** (optional): Description. (none) when absent.` (per coder.md:33-36)
- Agent spawn: code blocks with `KEY: {value}` lines (per implement.md:99-107)
- Produces/Requires: `**Produces:** VAR1, VAR2` at phase top (per review:orch:24-26)
- Fallback: `|| echo "(none)"` for bash commands (per implement.md:65)
- Cleanup: file deletion in finalization phases (per implement:orch:151)

## Integration Points

- Plan artifact → implement.md Plan Document Handling (line 59 extraction list)
- Coder agent → git skill PR template (loaded via frontmatter skill reference)
- Git agent ensure-pr-ready → `.docs/pr-description-guidance.md` (ambient bridge)
- Review/Resolve orchestrators → GitHub API (`gh pr view`)
- Reviewer/Resolver agents → optional PR_DESCRIPTION context variable

## Design Review Results

Anti-patterns checked:
- N+1 risk: None (single `gh pr view` per orchestrator run)
- God functions: None (guidance flows through existing threading)
- Missing parallelism: None (Reviewers still spawn in parallel)
- Error handling: Covered (`|| echo "(none)"` fallback everywhere)
- Missing caching: Acceptable (2 API calls in pipeline:orch vs. caching complexity)
- Poor decomposition: Clean (two distinct variables for two distinct data flows)

## Risk Assessment

**Context Risk: MEDIUM**

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Plugin copy drift | HIGH | MEDIUM | `npm run build` distributes shared assets |
| Line number shifts | LOW | LOW | Use surrounding text anchors |
| `gh pr view` failure | LOW | LOW | `\|\| echo "(none)"` fallback |
| Guidance file orphaned | MEDIUM | LOW | Multiple cleanup points + file is inert |
| Coder ignores guidance | MEDIUM | MEDIUM | Explicit mapping in Responsibility 7 |
| Old plans lack section #12 | CERTAIN | NONE | Graceful degradation to `(none)` |

## PR Description Guidance

### Problem Being Solved
PR descriptions are write-only artifacts — the Coder generates them independently with no plan context, and Review/Resolve never read them. This disconnects code review from the design reasoning behind the implementation.

### Key Changes to Highlight
- New `## PR Description Guidance` section in plan artifacts (section #12)
- Two new pipeline variables: `PR_DESCRIPTION_GUIDANCE` and `PR_DESCRIPTION`
- Ambient mode persistence via `.docs/pr-description-guidance.md`
- Git agent ensure-pr-ready reads guidance file for plan-informed PR creation

### Breaking Changes
None expected

### Reviewer Focus Areas
- Variable threading consistency across all 4 workflows
- Graceful degradation when variables are `(none)`
- Cleanup of `.docs/pr-description-guidance.md` in all paths
