<!-- trust: trusted -->
# Codebase Research: Devflow Workflow Internals for Bug Analysis Workflow Design

**Date**: 2026-05-20
**Trust**: trusted
**Files Examined**: 22

## Key Findings

### 1. review:orch Orchestrates Parallel Reviewers with Parameterized Focus and 80% Confidence Threshold

The review:orch skill (`shared/skills/review:orch/SKILL.md`) has 7 phases. Phase 4 (File Analysis) detects which conditional reviewers to spawn by matching changed file extensions against a pattern table (lines 86-101). Phase 5 spawns all reviewers in a single message for parallel execution — 8 core (always: security, architecture, performance, complexity, consistency, testing, regression, reliability) plus conditional (typescript, react, database, dependencies, documentation, go, java, python, rust, accessibility, ui-design) based on Phase 4 results (lines 108-123).

Each Reviewer agent (`shared/agents/reviewer.md`) is a universal agent parameterized by focus. It receives: Focus, Branch context, Output path, DIFF_COMMAND, DECISIONS_CONTEXT, FEATURE_KNOWLEDGE, and PR_DESCRIPTION. The reviewer dynamically loads a pattern skill via `Skill(skill="devflow:{FOCUS}")` at line 65. Its confidence system (lines 86-92) uses a hard threshold: findings >=80% confidence go into main sections (Blocking/Should-Fix/Pre-existing), 60-79% go to Suggestions (max 3), <60% are dropped. Self-verification at line 73-76 requires reading the actual code at flagged file:line (30 lines context) to prevent false positives.

Key design pattern: the orchestrator determines WHAT reviewers to spawn; the reviewer agent is generic and parameterized. One agent definition serves 19 different focus areas.

### 2. debug:orch Implements Competing Hypotheses with Convergence Validation

The debug:orch skill (`shared/skills/debug:orch/SKILL.md`) has 6 phases. Its Iron Law is "COMPETING HYPOTHESES BEFORE CONCLUSIONS" (line 17). Phase 2 (Hypothesize, lines 49-59) generates 3-5 hypotheses that must be Specific, Testable, and Distinct. Phase 3 (Investigate, lines 63-70) spawns one Explore agent per hypothesis in a single message (parallel execution). Each investigator searches for evidence FOR and AGAINST its hypothesis and returns a verdict: CONFIRMED | DISPROVED | PARTIAL.

Phase 4 (Converge, lines 74-81) has a critical anti-confirmation-bias pattern:
- One CONFIRMED: spawn 1-2 additional Explore agents to validate from different angles
- Multiple PARTIAL: look for a unifying root cause
- All DISPROVED: report honestly, optionally generate 2nd-round hypotheses

Phase 5 reports with confidence levels: HIGH (confirmed + validated), MEDIUM (partial convergence), LOW (best guess). Phase 6 offers the user a fix option — if accepted, the fix happens in guided mode with TDD and Simplifier cleanup.

Key asymmetric pattern: DECISIONS_CONTEXT and FEATURE_KNOWLEDGE are orchestrator-local only (lines 37-46) — they are NOT passed to Explore sub-agents. This keeps investigation workers focused on what they find in code, not what prior decisions suggest.

### 3. resolve:orch Batches Issues by File with 3-Tier Risk Assessment

The resolve:orch skill (`shared/skills/resolve:orch/SKILL.md`) has 8 phases. Phase 3 (Parse Issues, lines 57-65) extracts ALL issues from all review reports. Phase 4 (Analyze & Batch, lines 69-76) groups by file/function for efficiency — issues in the same file go in the same batch, cross-file dependencies go together, max 5 issues per batch. Batches with no shared files run in parallel.

Phase 5 spawns Resolver agents one per batch (parallel where possible). The Resolver agent (`shared/agents/resolver.md`) implements a 3-tier risk system (lines 55-86):
- **Standard fixes** (direct): null checks, validation, docs, error handling, type annotations, tests
- **Careful fixes** (test-first 6-step protocol): public API changes, shared state, >3 files, core logic — requires Understand/Plan/Test/Implement/Verify/Commit
- **Architectural overhaul** (defer — LAST RESORT): requires complete system redesign

The Resolver's decision flow (lines 94-111) validates each issue before fixing: read 30 lines context, check if issue still exists, check if reviewer understood context, check if code is intentional. FALSE_POSITIVE classification for issues no longer present, misunderstood, or intentional.

Phase 6 immediately writes `resolution-summary.md` BEFORE spawning Simplifier (line 109) — this is a deliberate persistence-before-compaction pattern. Phase 7 has a CI Status Gate with polling budget (max 10 polls, max 2 fix attempts).

### 4. Phase Protocol is Defined in Router Skill and Enforced by All Orch Skills

The Phase Protocol (`shared/skills/router/SKILL.md`, lines 12-21) has 5 rules:
1. **Announce** — Before executing each phase, output `Phase N: {name}`. No silent execution.
2. **Produce** — Each phase declares `Produces:`. Capture output by name.
3. **No silent skips** — If preconditions not met, announce phase + state why it is being skipped.
4. **Verify** — Before presenting final output, check the skill's Phase Completion Checklist.
5. **Scoped nesting** — When delegating to inner orch skills, use prefix: `{Outer} > Phase N: {name}`.

Every orch skill ends with a Phase Completion Checklist (e.g., review:orch lines 153-164, debug:orch lines 111-121, resolve:orch lines 153-163, implement:orch lines 255-270, explore:orch lines 148-157). Each phase has `**Produces:**` and `**Requires:**` annotations creating a data flow DAG.

### 5. Agent Design Patterns: Frontmatter, Model Strategy, Input/Output Contracts

Agent frontmatter (`shared/agents/*.md`) uses YAML with 5 fields:
- `name`: Agent display name
- `description`: One-line purpose
- `model`: Model assignment (opus | sonnet | haiku)
- `skills`: Array of skill references (e.g., `devflow:software-design`)
- `tools` (optional): Array restricting tool access (e.g., Tester has specific browser tools)

**Model strategy** (14 agents observed):
- **Opus** (analysis agents): Reviewer, Scrutinizer, Evaluator, Researcher, Designer
- **Sonnet** (execution agents): Coder, Simplifier, Resolver, Skimmer, Tester
- **Haiku** (I/O agents): Git, Synthesizer, Validator

**Input contract pattern**: Every agent has an "Input Context" section listing variables from the orchestrator. Common variables: FILES_CHANGED, DECISIONS_CONTEXT, FEATURE_KNOWLEDGE, WORKTREE_PATH. Optional inputs use "(optional)" suffix and document the `(none)` sentinel.

**Output contract pattern**: Every agent has an "Output" section with a markdown template showing structured fields. Status is always first: `PASS|FAIL|BLOCKED`, `COMPLETE|PARTIAL|BLOCKED`, `ALIGNED|MISALIGNED`, etc.

**Boundary pattern**: Every agent has a "Boundaries" section split into "Handle autonomously" and "Escalate to orchestrator" (or "Never"). This makes the autonomy envelope explicit.

**Worktree support**: Nearly every agent includes `If WORKTREE_PATH is provided, follow the devflow:worktree-support skill for path resolution. If omitted, use cwd.`

### 6. Router/Triage System: Intent Classification -> Triage -> Guided|Orch

The routing chain has 3 layers:

**Layer 1: Classification** (`scripts/hooks/preamble` + `classification-rules.md`). A UserPromptSubmit hook injects a one-sentence preamble. Classification rules define 10 intents: CHAT, EXPLORE, PLAN, IMPLEMENT, REVIEW, RESOLVE, DEBUG, PIPELINE, RESEARCH, RELEASE. QUICK criteria bypass the router entirely for trivial operations.

**Layer 2: Router** (`shared/skills/router/SKILL.md`). Maps intent to a skill. Most intents go to a triage skill (e.g., IMPLEMENT -> `devflow:implement:triage`). RESOLVE and PIPELINE go directly to orch (no guided variant).

**Layer 3: Triage** (e.g., `implement:triage`, `review:triage`, `debug:triage`). Each triage skill:
- Defaults to GUIDED
- Has an "Orchestration Hint Override" (keywords: "orchestrate", "full pipeline", "deep", "thorough")
- Has intent-specific ORCHESTRATED signals (e.g., debug:triage checks for "intermittent", "flaky", "race condition"; review:triage checks commit count >5; implement:triage checks for plan artifacts)
- Emits `Scope: GUIDED` or `Scope: ORCHESTRATED` then loads the target skill

Triage skills are ~30-40 lines, have `allowed-tools: Read, Bash, Skill`, and their scope checks use actual codebase queries (git commands, file existence checks).

### 7. Decisions and Feature Knowledge Integration Patterns

Two distinct patterns for context propagation:

**Fan-out pattern** (review:orch, resolve:orch, implement:orch): Orchestrator loads DECISIONS_CONTEXT and passes it to all spawned agents. Agents use `devflow:apply-decisions` to Read full bodies on demand from disk.

**Orchestrator-local pattern** (debug:orch, explore:orch): Orchestrator loads DECISIONS_CONTEXT and FEATURE_KNOWLEDGE but does NOT pass them to investigation workers. This prevents investigation bias — workers examine code with fresh eyes.

### 8. Iron Law Pattern: Every Skill Has One Non-Negotiable Rule

Every orch skill and every foundation skill has exactly one Iron Law in a blockquote at the top:
- review:orch: "EVERY REVIEWER WRITES TO DISK" (persistence)
- debug:orch: "COMPETING HYPOTHESES BEFORE CONCLUSIONS" (anti-bias)
- resolve:orch: "VALIDATE FIRST, FIX EVERYTHING POSSIBLE" (correctness)
- implement:orch: "QUALITY GATES ARE NON-NEGOTIABLE" (quality)
- explore:orch: "EXPLORATION WITHOUT STRUCTURE IS JUST BROWSING" (evidence)
- pipeline:orch: "FULL PIPELINE, NO INTERRUPTIONS" (completeness)
- quality-gates: "FIX BEFORE RETURNING" (action)
- review-methodology: "NEVER BLOCK FOR PRE-EXISTING ISSUES" (fairness)
- research-codebase: "CITE CODE, NOT ASSUMPTIONS" (evidence)

### 9. Companion Skill Loading Pattern

All orch skills begin with a "Load Companion Skills" section that loads additional skills via Skill tool with explicit failure tolerance: "If a skill fails to load, continue without it." Examples:
- review:orch: `devflow:quality-gates`, `devflow:software-design`
- debug:orch: `devflow:test-driven-development`, `devflow:software-design`, `devflow:testing`
- implement:orch: `devflow:test-driven-development`, `devflow:patterns`, `devflow:dependency-research`

### 10. Synthesizer Is a Shared Multi-Mode Agent

The Synthesizer agent (`shared/agents/synthesizer.md`) operates in 5 modes: exploration, planning, review, design, research. Each mode has a distinct process and output template. In review mode (lines 232-292), it applies confidence-aware aggregation — when multiple reviewers flag the same file:line, confidence boosts by 10% per additional reviewer (cap 100%). It also enforces merge rules: any CRITICAL in blocking = BLOCK MERGE.

The Synthesizer is Haiku model — fast and cheap — because it combines existing agent outputs without new analysis.

## Evidence

| Claim | File | Lines |
|-------|------|-------|
| review:orch 7 phases with parallel reviewers | `shared/skills/review:orch/SKILL.md` | 1-167 |
| 8 core + conditional reviewers | `shared/skills/review:orch/SKILL.md` | 110-115 |
| File pattern to reviewer mapping | `shared/skills/review:orch/SKILL.md` | 86-101 |
| Reviewer confidence threshold >=80% | `shared/agents/reviewer.md` | 86-92 |
| Reviewer self-verification step | `shared/agents/reviewer.md` | 73-76 |
| Reviewer loads focus skill dynamically | `shared/agents/reviewer.md` | 65 |
| debug:orch competing hypotheses (3-5) | `shared/skills/debug:orch/SKILL.md` | 49-59 |
| debug:orch convergence validation | `shared/skills/debug:orch/SKILL.md` | 74-81 |
| debug:orch DECISIONS_CONTEXT orchestrator-local | `shared/skills/debug:orch/SKILL.md` | 37-46 |
| resolve:orch 3-tier risk in Resolver | `shared/agents/resolver.md` | 55-86 |
| resolve:orch batching by file, max 5 | `shared/skills/resolve:orch/SKILL.md` | 69-76 |
| resolve:orch writes summary before Simplifier | `shared/skills/resolve:orch/SKILL.md` | 109 |
| Phase Protocol 5 rules | `shared/skills/router/SKILL.md` | 12-21 |
| Phase Completion Checklist (review:orch) | `shared/skills/review:orch/SKILL.md` | 153-164 |
| Phase Completion Checklist (debug:orch) | `shared/skills/debug:orch/SKILL.md` | 111-121 |
| Phase Completion Checklist (resolve:orch) | `shared/skills/resolve:orch/SKILL.md` | 153-163 |
| Agent frontmatter: Reviewer (opus) | `shared/agents/reviewer.md` | 1-10 |
| Agent frontmatter: Coder (sonnet) | `shared/agents/coder.md` | 1-16 |
| Agent frontmatter: Synthesizer (haiku) | `shared/agents/synthesizer.md` | 1-9 |
| Agent frontmatter: Validator (haiku) | `shared/agents/validator.md` | 1-8 |
| Agent frontmatter: Tester with tools restriction | `shared/agents/tester.md` | 1-10 |
| Boundary pattern in Resolver | `shared/agents/resolver.md` | 155-163 |
| Boundary pattern in Evaluator | `shared/agents/evaluator.md` | 99-117 |
| Preamble hook injection | `scripts/hooks/preamble` | 1-36 |
| Classification rules (10 intents) | `shared/skills/router/classification-rules.md` | 1-43 |
| Router maps intent to skill | `shared/skills/router/SKILL.md` | 26-38 |
| implement:triage scope signals | `shared/skills/implement:triage/SKILL.md` | 19-25 |
| debug:triage scope signals | `shared/skills/debug:triage/SKILL.md` | 19-26 |
| review:triage scope signals | `shared/skills/review:triage/SKILL.md` | 19-28 |
| Synthesizer 5 modes | `shared/agents/synthesizer.md` | 18-20 |
| Synthesizer confidence boost in review mode | `shared/agents/synthesizer.md` | 239 |
| Iron Law pattern in 9 skills | multiple files | see Finding 8 |
| Companion skill loading pattern | `shared/skills/review:orch/SKILL.md` | 24 |
| implement:orch 9 phases | `shared/skills/implement:orch/SKILL.md` | 1-271 |
| implement:orch quality gate sequence | `shared/skills/implement:orch/SKILL.md` | 141-151 |
| pipeline:orch meta-orchestrator | `shared/skills/pipeline:orch/SKILL.md` | 1-109 |
| Scoped nesting for inner orch skills | `shared/skills/router/SKILL.md` | 20 |

## Pattern Table

| Pattern | Example | Occurrences |
|---------|---------|-------------|
| Phase Completion Checklist | `shared/skills/review:orch/SKILL.md:153-164` | 7 orch skills |
| Produces/Requires annotations | `shared/skills/review:orch/SKILL.md:28-29` | All orch skill phases |
| Iron Law blockquote | `shared/skills/debug:orch/SKILL.md:15-19` | 9+ skills |
| Agent Boundary section | `shared/agents/resolver.md:155-163` | 14 agents |
| DECISIONS_CONTEXT fan-out | `shared/skills/review:orch/SKILL.md:62-78` | 3 orch skills |
| DECISIONS_CONTEXT orchestrator-local | `shared/skills/debug:orch/SKILL.md:37-39` | 2 orch skills |
| Companion skill loading with fallback | `shared/skills/review:orch/SKILL.md:24` | 3 orch skills |
| Triage default-to-GUIDED | `shared/skills/implement:triage/SKILL.md:10` | 7 triage skills |
| Triage hint override keywords | `shared/skills/implement:triage/SKILL.md:14` | 7 triage skills |
| Status enum in output (PASS/FAIL/BLOCKED) | `shared/agents/scrutinizer.md:62` | 14 agents |
| Model assignment by tier | `shared/agents/reviewer.md:4` | 14 agents |
| Worktree support boilerplate | `shared/agents/reviewer.md:33` | 13 agents |
| Parallel spawn "in a single message" | `shared/skills/review:orch/SKILL.md:108` | 4 orch skills |
| CI Status Gate pattern (shared block) | `shared/skills/implement:orch/SKILL.md:157-165` | 2 orch skills |

## Dependency Map

| Module | Depends On | Notes |
|--------|-----------|-------|
| review:orch | Reviewer, Git, Synthesizer agents | 8+ core + conditional reviewers |
| debug:orch | Explore agent (reused from explore:orch) | 3-5 hypothesis investigators |
| resolve:orch | Resolver, Simplifier, Git, Coder agents | Batched per-file resolution |
| implement:orch | Git, Coder, Validator, Simplifier, Scrutinizer, Evaluator, Tester, Knowledge agents | 6 sequential quality gates |
| pipeline:orch | implement:orch, review:orch, resolve:orch | Meta-orchestrator chaining |
| Reviewer agent | review-methodology, apply-decisions, apply-feature-knowledge skills | Universal parameterized |
| Resolver agent | software-design, git, patterns, TDD, apply-decisions, apply-feature-knowledge skills | 3-tier risk assessment |
| Router | Classification rules + all triage skills | Intent dispatch |
| Triage skills | Guided and Orch skill variants | Scope assessment |

## Confidence Assessment

| Finding | Confidence | Basis |
|---------|-----------|-------|
| review:orch parallel reviewer orchestration with confidence threshold | High | Direct reading of skill + agent files, 19 focus areas enumerated |
| debug:orch competing hypotheses with convergence | High | Direct reading, 3-verdict system explicit in Phase 3-4 |
| resolve:orch 3-tier risk batching | High | Direct reading of both skill and Resolver agent |
| Phase Protocol structure | High | Explicit 5-rule definition in router + 7 completion checklists |
| Agent frontmatter conventions | High | 14/14 agents examined, consistent pattern |
| Model strategy (opus/sonnet/haiku) | High | 14/14 agents confirmed against stated strategy |
| Router/triage dispatch system | High | All 3 layers read (preamble, router, 3 triage skills) |
| Iron Law pattern | High | 9 distinct Iron Laws observed with consistent formatting |
| DECISIONS_CONTEXT dual pattern (fan-out vs local) | High | Explicit in 5 orch skills, 2 patterns documented |
| Companion skill loading with fallback | High | 3 orch skills use identical pattern |

## Implications for a Bug Analysis Workflow

Based on the patterns above, a new "bug analysis" workflow would need:

1. **Orch skill** (`shared/skills/bug-analysis:orch/SKILL.md`) following Phase Protocol with Produces/Requires annotations and Phase Completion Checklist. One Iron Law at the top.

2. **Triage skill** (`shared/skills/bug-analysis:triage/SKILL.md`) ~30-40 lines, default-to-GUIDED, with intent-specific ORCHESTRATED signals. `allowed-tools: Read, Bash, Skill`.

3. **Guided skill** (`shared/skills/bug-analysis:guided/SKILL.md`) for lightweight mode — load companion skills, execute directly in main session.

4. **Agent(s)** — could reuse Reviewer (already parameterized by focus) or create a new Bug Analyzer agent. If new, needs: frontmatter (name, description, model, skills, optional tools), Input Context section, Responsibilities, Principles, Output template with status enum, Boundaries section, Worktree support boilerplate.

5. **Router integration** — add BUG_ANALYSIS intent to `classification-rules.md` and router dispatch table.

6. **Decisions integration** — choose fan-out (pass DECISIONS_CONTEXT to workers) or orchestrator-local (keep in orchestrator only) based on whether workers need decision context.

7. **Synthesizer mode** — if multiple parallel agents produce outputs, add a new Synthesizer mode or reuse `review` mode.

8. **Disk persistence** — review:orch's Iron Law applies: write outputs to `.devflow/docs/` early, before any agent that might trigger compaction.

## Limitations

- Did not examine Agent Teams debate variants (`*-teams.md` commands) — these add peer-to-peer consensus on top of the same orch skills
- Did not examine the self-learning system integration points (learning agent, decisions agent) for how new workflow outputs feed into observation detection
- Did not examine the sidecar/hook system for how a new workflow would integrate with session lifecycle hooks
- Did not read all 58 skills — focused on workflow-relevant orch/agent/triage/foundation skills only
- Did not examine test files for the existing workflows
