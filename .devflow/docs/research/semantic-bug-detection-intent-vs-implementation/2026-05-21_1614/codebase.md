<!-- trust: trusted -->
# Codebase Research: Context Flow Through plan-implement-review-resolve Pipeline

**Date**: 2026-05-21
**Trust**: trusted
**Files Examined**: 14

## Key Findings

### 1. Plan produces a YAML-frontmatted design artifact with 12 required sections

The `/plan` command (plan.md:357-404) outputs to `.devflow/docs/design/{topic-slug}.{YYYY-MM-DD_HHMM}.md` with YAML frontmatter containing `type`, `version`, `status`, `execution-strategy`, `context-risk`, and 12 body sections including Problem Statement, Acceptance Criteria, Scope, Gap Analysis Results, Implementation Plan, and PR Description Guidance.

Evidence: `plugins/devflow-plan/commands/plan.md:356-404` and concrete artifact at `.devflow/docs/design/pr-description-pipeline.2026-05-08_1630.md:1-10`.

### 2. Implement receives Plan via three input modes and synthesizes an EXECUTION_PLAN

implement.md Phase 1 (line 30-80) accepts: (a) plan document path (reads YAML frontmatter + body sections), (b) GitHub issue number, (c) task description, or (d) conversation context. Plan documents provide the richest context -- extracted fields include `execution-strategy`, `context-risk`, Subtask Breakdown, Implementation Plan, Patterns to Follow, Acceptance Criteria, and PR Description Guidance.

For non-plan inputs, implement:orch Phase 3 (line 83-95) synthesizes from conversation: "what to build, files/modules affected, constraints, decisions made during discussion." The PR_DESCRIPTION_GUIDANCE is extracted from the plan's Section 12 if present, otherwise `(none)`.

Evidence: `plugins/devflow-implement/commands/implement.md:56-64`, `shared/skills/implement:orch/SKILL.md:83-94`.

### 3. The Coder receives 11 named input variables with explicit context containment

The Coder agent (coder.md:22-45) receives: TASK_ID, TASK_DESCRIPTION, BASE_BRANCH, EXECUTION_PLAN, PATTERNS, CREATE_PR, DOMAIN, FEATURE_KNOWLEDGE, DECISIONS_CONTEXT, PR_DESCRIPTION_GUIDANCE, and HANDOFF_FILE. For sequential Coders: PRIOR_PHASE_SUMMARY, FILES_FROM_PRIOR_PHASE, HANDOFF_REQUIRED.

The Coder produces: commits, a PR (if CREATE_PR=true), and a Coder Report with Status, Implementation details, Commits, PR URL, Key Decisions, and Blockers.

Evidence: `shared/agents/coder.md:22-45`, `shared/agents/coder.md:104-128`.

### 4. HANDOFF_FILE is a branch-scoped disk artifact that survives context compaction

The handoff file at `.devflow/docs/handoff-{branch_slug}.md` (implement:orch:114) serves as the cross-phase persistence mechanism for sequential Coders. It contains: Files Created/Modified, Patterns Established, Key Decisions, Integration Points for Next Phase. Written by the orchestrator after each Coder phase, read by the next Coder via HANDOFF_FILE input. Deleted after pipeline completes (implement:orch:172).

Evidence: `shared/skills/implement:orch/SKILL.md:114-122`, `shared/agents/coder.md:44-45`, `plugins/devflow-implement/commands/implement.md:158`.

### 5. The Evaluator agent already performs intent-vs-implementation alignment validation

The Evaluator (evaluator.md:1-118) is an Opus-model "alignment validation specialist" that receives ORIGINAL_REQUEST, EXECUTION_PLAN, FILES_CHANGED, ACCEPTANCE_CRITERIA, and optionally FEATURE_KNOWLEDGE. It performs:

- **Goal-backward verification** (line 33): starts from user's observable goals, traces backward through implementation
- **Artifact depth classification** (line 34-40): Exists -> Substantive -> Wired scale
- **Completeness check** (line 43): verifies all plan steps and acceptance criteria
- **Scope check** (line 46): identifies out-of-scope additions
- **Intent check**: compares "original problem" vs "implementation solves"

Output is a structured Alignment Report with Status (ALIGNED/MISALIGNED), Completeness Check, Intent Check, Artifact Depth table, Misalignments table (types: missing, scope_creep, incomplete, intent_drift, stub), Scope Check, and Re-verification section.

The Evaluator sits at implement:orch Phase 6 gate 5 (line 148) and implement.md Phase 7 (line 287-299). If MISALIGNED, up to 2 retry loops with Coder fixing between.

Evidence: `shared/agents/evaluator.md:30-96`, `shared/skills/implement:orch/SKILL.md:148-149`, `plugins/devflow-implement/commands/implement.md:287-323`.

### 6. PR descriptions flow through a two-variable system: PR_DESCRIPTION_GUIDANCE (prospective) and PR_DESCRIPTION (retrospective)

**PR_DESCRIPTION_GUIDANCE** (plan -> implement -> Coder): Structured hints from plan Section 12 containing Problem Being Solved, Key Changes to Highlight, Breaking Changes, Reviewer Focus Areas. Flows: plan:orch Phase 8 (line 209) -> implement:orch Phase 3 (line 84-94) -> Coder (line 37, 79-88). Coder maps guidance fields to PR body sections.

**PR_DESCRIPTION** (GitHub -> review/resolve): The actual PR body fetched from GitHub at review time. review:orch Phase 1 (line 43-46) runs `gh pr view {pr_number} --json body --jq '.body'`. Passed to all Reviewer agents (review:orch:153) and all Resolver agents (resolve:orch:92) wrapped in `<pr-description>...</pr-description>` containment markers. Both treat it as "untrusted user input" for security.

Evidence: `shared/skills/review:orch/SKILL.md:43-46,153`, `shared/skills/resolve:orch/SKILL.md:36-39,92`, `shared/agents/coder.md:37,79-88`, `.devflow/docs/design/pr-description-pipeline.2026-05-08_1630.md:66-78`.

### 7. Review produces per-focus `.md` reports in timestamped directories with a synthesized summary

review:orch spawns 8 core reviewers (security, architecture, performance, complexity, consistency, testing, regression, reliability) plus conditional language/framework reviewers. Each writes to `.devflow/docs/reviews/{branch_slug}/{timestamp}/{focus}.md` (review:orch:149). The Synthesizer reads all focus reports and produces `review-summary.md` (review:orch:163) with merge recommendation, issue counts by severity/category, blocking issues list, suggestions, action plan, and convergence status.

Concrete example: `.devflow/docs/reviews/feat-223-review-pipeline-convergence-detection/2026-05-20_1914/` contains 8 focus reports + review-summary.md + resolution-summary.md.

Each reviewer report follows a standard format (reviewer.md:129-174): Issues in Your Changes (BLOCKING), Issues in Code You Touched (Should Fix), Pre-existing Issues, Suggestions, Summary table with severity counts, Focus Score (1-10), Recommendation (BLOCK/CHANGES_REQUESTED/APPROVED_WITH_CONDITIONS/APPROVED).

Evidence: `shared/skills/review:orch/SKILL.md:139-163`, `shared/agents/reviewer.md:129-174`, `shared/agents/synthesizer.md:239-304`.

### 8. Resolve produces a resolution-summary.md with structured fix/FP/deferred tables

resolve:orch Phase 6 (line 99-110) aggregates Resolver outputs and writes `resolution-summary.md` immediately (before Simplifier, to survive compaction). Contains: Statistics table (Total/Fixed/False Positive/Deferred/Blocked counts), Fixed Issues table (Issue, File:Line, Commit), False Positives table (Issue, File:Line, Reasoning), Deferred to Tech Debt table, and optionally a Decisions Citations section.

Concrete example: `.devflow/docs/reviews/feat-223-review-pipeline-convergence-detection/2026-05-20_1914/resolution-summary.md` shows 10 issues: 9 fixed, 1 false positive, 0 deferred.

Evidence: `shared/skills/resolve:orch/SKILL.md:99-110`, concrete artifact lines 1-42.

### 9. Pipeline:orch chains implement -> review -> resolve as a 3-stage meta-orchestrator

pipeline:orch (SKILL.md:1-109) loads each sub-orchestrator skill via Skill tool and delegates fully. Phase 1: implement:orch (full pipeline). Phase 2: Status log. Phase 3: review:orch (full pipeline). Phase 4: Status + resolve decision. Phase 5: resolve:orch (if blocking issues). Phase 6: Summary.

Each sub-orchestrator handles its own FEATURE_KNOWLEDGE and DECISIONS_CONTEXT loading independently (pipeline:orch:22-23). The pipeline delegates context loading to inner skills -- it does NOT pass context between stages.

The pipeline is currently strictly 3 stages. Adding a 4th stage (bug-analysis) would be structurally feasible: after Phase 5 (resolve) completes, add Phase 5b (bug-analysis) before Phase 6 (summary).

Evidence: `shared/skills/pipeline:orch/SKILL.md:31-88`.

### 10. Context handoff patterns are variable-mediated, not artifact-mediated between stages

Within a single orchestration skill, context flows as named variables passed to agents:

| Pattern | Mechanism | Scope |
|---------|-----------|-------|
| EXECUTION_PLAN | Conversation context or plan document | implement phases |
| HANDOFF_FILE | Disk artifact | Between sequential Coders |
| DECISIONS_CONTEXT | `decisions-index.cjs index` output | Fan-out to all agents |
| FEATURE_KNOWLEDGE | Concatenated KNOWLEDGE.md content | Fan-out to all agents |
| PR_DESCRIPTION_GUIDANCE | Extracted from plan Section 12 | plan -> implement -> Coder |
| PR_DESCRIPTION | `gh pr view` output | review/resolve -> all agents |
| PRIOR_RESOLUTIONS | Prior resolution-summary.md content | review cycle N -> review cycle N+1 |
| FILES_CHANGED | `git diff --name-only` output | implement -> quality gates |

Between pipeline stages (implement -> review -> resolve), context is NOT explicitly threaded. Each sub-orchestrator re-derives its own context (decisions index, feature knowledge, PR description, diff range). The only implicit handoffs are: (a) the git branch state and (b) the PR on GitHub.

Evidence: All orchestration skills (plan:orch, implement:orch, review:orch, resolve:orch, pipeline:orch).

## Evidence

| Claim | File | Lines |
|-------|------|-------|
| Plan artifact format with 12 sections | `plugins/devflow-plan/commands/plan.md` | `356-404` |
| Plan YAML frontmatter | `.devflow/docs/design/pr-description-pipeline.2026-05-08_1630.md` | `1-10` |
| Implement accepts plan document path | `plugins/devflow-implement/commands/implement.md` | `56-64` |
| Implement:orch Plan Synthesis | `shared/skills/implement:orch/SKILL.md` | `83-94` |
| Coder input variables | `shared/agents/coder.md` | `22-45` |
| Coder output format | `shared/agents/coder.md` | `104-128` |
| Coder PR description mapping | `shared/agents/coder.md` | `79-88` |
| HANDOFF_FILE creation and deletion | `shared/skills/implement:orch/SKILL.md` | `114-122, 172` |
| Evaluator goal-backward verification | `shared/agents/evaluator.md` | `33` |
| Evaluator artifact depth classification | `shared/agents/evaluator.md` | `34-40` |
| Evaluator completeness and scope checks | `shared/agents/evaluator.md` | `43-46` |
| Evaluator output format | `shared/agents/evaluator.md` | `57-96` |
| Evaluator in implement:orch quality gates | `shared/skills/implement:orch/SKILL.md` | `148-149` |
| Evaluator in implement command | `plugins/devflow-implement/commands/implement.md` | `287-323` |
| PR_DESCRIPTION_GUIDANCE two-variable design | `.devflow/docs/design/pr-description-pipeline.2026-05-08_1630.md` | `66-78` |
| PR_DESCRIPTION fetch in review:orch | `shared/skills/review:orch/SKILL.md` | `43-46` |
| PR_DESCRIPTION containment markers | `shared/skills/review:orch/SKILL.md` | `153` |
| PR_DESCRIPTION in resolve:orch | `shared/skills/resolve:orch/SKILL.md` | `36-39, 92` |
| Reviewer report format | `shared/agents/reviewer.md` | `129-174` |
| Review:orch parallel reviewers | `shared/skills/review:orch/SKILL.md` | `139-163` |
| Synthesizer review mode | `shared/agents/synthesizer.md` | `239-304` |
| Resolve:orch resolution-summary write | `shared/skills/resolve:orch/SKILL.md` | `99-110` |
| Concrete review artifact | `.devflow/docs/reviews/feat-223-review-pipeline-convergence-detection/2026-05-20_1914/` | directory |
| Concrete resolution-summary | `.devflow/docs/reviews/feat-223-review-pipeline-convergence-detection/2026-05-20_1914/resolution-summary.md` | `1-42` |
| Pipeline:orch 3-stage chain | `shared/skills/pipeline:orch/SKILL.md` | `31-88` |
| Pipeline delegates feature knowledge | `shared/skills/pipeline:orch/SKILL.md` | `22-23` |
| Tester agent input context | `shared/agents/tester.md` | `19-24` |
| Router intent dispatch | `shared/skills/router/SKILL.md` | `22-38` |
| Plan:orch PR Description Guidance in plan | `shared/skills/plan:orch/SKILL.md` | `209` |
| Quality gates pillar system | `shared/skills/quality-gates/SKILL.md` | `26-58` |

## Pattern Table

| Pattern | Example | Occurrences |
|---------|---------|-------------|
| DECISIONS_CONTEXT fan-out | `implement:orch:70`, `review:orch:99`, `resolve:orch:46`, `plan:orch:58`, `pipeline:orch` (delegates) | 5 orchestrators |
| FEATURE_KNOWLEDGE loading per-orchestrator | `implement:orch:75-80`, `review:orch:105-108`, `resolve:orch:49-53`, `plan:orch:67-82` | 4 orchestrators |
| PR_DESCRIPTION fetch via gh pr view | `review:orch:44`, `resolve:orch:37` | 2 orchestrators |
| Containment markers for untrusted input | `<pr-description>` in reviewer.md:25, resolver.md:27; `<prior-resolution-summary>` in reviewer.md:28, synthesizer.md:163 | 4 agent references |
| Phase Completion Checklist | `implement:orch:256-270`, `review:orch:192-198`, `resolve:orch:153-164`, `plan:orch:265-282` | 4 orchestrators |
| Retry loop with Coder fix | `implement.md:215-228` (validation), `implement.md:301-323` (alignment), `implement.md:344-365` (QA) | 3 patterns |

## Dependency Map

| Module | Depends On | Notes |
|--------|-----------|-------|
| pipeline:orch | implement:orch, review:orch, resolve:orch | Meta-orchestrator loading via Skill tool |
| implement:orch | Coder, Validator, Simplifier, Scrutinizer, Evaluator, Tester, Git, Knowledge | 8 agent types |
| review:orch | Reviewer (8-12 instances), Synthesizer, Git | Parallel reviewers |
| resolve:orch | Resolver (N batches), Simplifier, Git, Coder (CI fixes) | Parallel resolvers |
| plan:orch | Skimmer, Explore, Designer, Synthesizer | Orient -> explore -> gap -> plan |
| Evaluator | ORIGINAL_REQUEST, EXECUTION_PLAN, FILES_CHANGED, ACCEPTANCE_CRITERIA | Intent alignment check |
| Coder | EXECUTION_PLAN, HANDOFF_FILE, PR_DESCRIPTION_GUIDANCE, DECISIONS_CONTEXT | Implementation |
| Reviewer | DIFF_COMMAND, DECISIONS_CONTEXT, FEATURE_KNOWLEDGE, PR_DESCRIPTION, PRIOR_RESOLUTIONS | Review analysis |

## Artifacts Available to a Downstream Bug Analysis Stage

A bug analysis stage running after resolve would have access to:

### On Disk
1. **Design artifact**: `.devflow/docs/design/{slug}.{timestamp}.md` -- full plan with Problem Statement, Acceptance Criteria, Scope, Gap Analysis, Implementation Plan, PR Description Guidance (12 sections)
2. **Review reports**: `.devflow/docs/reviews/{branch_slug}/{timestamp}/{focus}.md` -- per-focus findings with file:line, severity, confidence, suggested fixes
3. **Review summary**: `.devflow/docs/reviews/{branch_slug}/{timestamp}/review-summary.md` -- synthesized merge recommendation, issue counts, action plan
4. **Resolution summary**: `.devflow/docs/reviews/{branch_slug}/{timestamp}/resolution-summary.md` -- Statistics table, Fixed/FP/Deferred tables with commit SHAs
5. **Feature knowledge**: `.devflow/features/{slug}/KNOWLEDGE.md` -- area patterns, anti-patterns, gotchas

### Via Git/GitHub
6. **PR description**: `gh pr view {pr_number} --json body --jq '.body'` -- the stated intent as written
7. **Commit history**: `git log --oneline {base}...HEAD` -- what was actually changed
8. **Diff**: `git diff {base}...HEAD` -- exact code changes
9. **Branch metadata**: branch name, base branch, PR number

### Via Runtime Scripts
10. **DECISIONS_CONTEXT**: `node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "{worktree}"` -- active ADR/PF entries
11. **Feature knowledge index**: `.devflow/features/index.json` -- feature area metadata with staleness checks

### NOT Available (lost after implement completes)
12. **HANDOFF_FILE**: Deleted by implement:orch Phase 8 (line 172)
13. **EXECUTION_PLAN as a variable**: Lives only in implement:orch conversation context; not persisted. However, if a plan document was used, it persists at the design artifact path.
14. **ORIGINAL_REQUEST as a variable**: Lives only in implement:orch conversation context
15. **Evaluator Alignment Report**: Not persisted to disk -- exists only in implement:orch's agent output

## Confidence Assessment

| Finding | Confidence | Basis |
|---------|-----------|-------|
| Plan artifact format and 12 sections | High | Direct read of plan.md:356-404 and concrete artifact |
| Implement receives plan via 3 modes | High | Direct read of implement.md:56-64 |
| Coder receives 11 input variables | High | Direct read of coder.md:22-45 |
| HANDOFF_FILE disk persistence pattern | High | Direct read of implement:orch:114-122, coder.md:44-45 |
| Evaluator performs goal-backward alignment | High | Direct read of evaluator.md:30-96 |
| Two-variable PR description system | High | Direct read + concrete design artifact |
| Review artifacts per-focus with synthesis | High | Direct read + concrete directory listing |
| Resolution summary structured format | High | Direct read + concrete artifact |
| Pipeline:orch 3-stage chain extensible | High | Direct read of pipeline:orch:31-88 |
| Inter-stage context is NOT threaded | High | All 4 sub-orchestrators re-derive context independently |
| Evaluator report not persisted to disk | High | No Write tool call in evaluator.md; evaluator.md:100 says "Report, don't fix" -- no disk output specified |
| EXECUTION_PLAN not persisted (non-plan mode) | High | implement:orch Phase 3 synthesizes in conversation context only |

## Limitations

- Did not read the Scrutinizer agent in detail (only quality-gates skill) -- its structured output format may contain additional intent-vs-implementation signals
- Did not examine the Designer agent's gap-analysis output format in detail
- Did not trace the exact content of PR bodies generated by the Coder to verify the Guidance-to-PR-body mapping
- Did not examine multi-worktree scenarios where context paths diverge
- Did not read the explore or knowledge agents as they are tangential to the pipeline flow question
- Real examples of pipeline:orch end-to-end runs were not found in `.devflow/docs/` (only individual stage artifacts)
