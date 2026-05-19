# Architecture Review Report

**Branch**: feat/ambient-orchestration -> main
**Date**: 2026-03-19
**Commits**: 2 (595cd05, 15849ce)
**Files Changed**: 18 (3 added, 15 modified)

---

## Issues in Your Changes (BLOCKING)

### HIGH

**H1 -- Orchestration skills duplicate pipeline logic already defined in explicit commands** - `shared/skills/implementation-orchestration/SKILL.md`, `shared/skills/debug-orchestration/SKILL.md`

- Problem: The `implementation-orchestration` skill defines a 6-phase pipeline (pre-flight, plan synthesis, Coder, FILES_CHANGED detection, quality gates, completion) that substantially overlaps with the `/implement` command's 15-phase pipeline (`plugins/devflow-implement/commands/implement.md`). Similarly, `debug-orchestration` defines a 5-phase pipeline that overlaps with `/debug` (`plugins/devflow-debug/commands/debug.md`). Both pipelines use the same agents (Coder, Validator, Simplifier, Scrutinizer, Shepherd for implement; Explore agents for debug) but define different orchestration logic for the same conceptual workflow. This creates two sources of truth for the same pipeline.
- Impact: When a pipeline improvement is made (e.g., changing retry limits, adding a phase, adjusting agent budgets), the developer must update both the explicit command and the orchestration skill. Drift between the two is inevitable and will create user-facing inconsistencies. This is a DRY violation at the architecture level.
- Fix: Two options:
  1. **Document the delta explicitly**: Add a note at the top of each orchestration skill clarifying it is an intentional lightweight subset of the full command, and list what is excluded and why. For example, at the top of `implementation-orchestration/SKILL.md`: "This is the lightweight ambient variant of the `/implement` pipeline. Excluded: Git agent branch setup, Skimmer/Explore codebase orientation, parallel Plan agents, sequential/parallel Coder strategies, PR creation, knowledge persistence. For full lifecycle, use `/implement` directly."
  2. **Extract shared pipeline steps**: Factor the quality gate sequence (Validator -> Simplifier -> Scrutinizer -> re-Validate -> Shepherd) into a shared skill reference that both the explicit commands and orchestration skills consume, so at minimum the shared portion has one source of truth.

**H2 -- `devflow-ambient` plugin agent list is missing the Explore agent** - `plugins/devflow-ambient/.claude-plugin/plugin.json:18-26`, `src/cli/plugins.ts:75`

- Problem: The `plugin.json` and `plugins.ts` agent lists include `coder`, `validator`, `simplifier`, `scrutinizer`, `shepherd`, `skimmer`, `reviewer` but omit the **Explore** agent. Both `debug-orchestration/SKILL.md` (Phase 2: "Spawn one Explore agent per hypothesis") and `plan-orchestration/SKILL.md` (Phase 2: "spawn 2-3 Explore agents") explicitly require spawning Explore agents. The `/debug` command uses Explore agents extensively and the `/implement` command spawns 4 Explore agents in Phase 3. In those commands, Explore is spawned as an ephemeral `Task(subagent_type="Explore")` without a corresponding `shared/agents/explore.md` definition. If the ambient plugin follows the same pattern (ephemeral Task sub-agents), this is consistent but undocumented. If there is an expectation that an `explore.md` agent definition should exist, then it is missing from both the shared agents directory and the plugin manifest.
- Impact: At minimum, the contract between the orchestration skills and the agent runtime is unclear. Contributors reading `debug-orchestration` will look for an Explore agent definition and not find one. At runtime, Claude Code creates ephemeral sub-agents via Task, which works without a declared agent definition, so this is likely functional. But the architectural clarity is poor.
- Fix: Either (a) add a lightweight `shared/agents/explore.md` and include `explore` in the ambient plugin manifest agents array, or (b) add a note in each orchestration skill clarifying that "Explore agent" means an ephemeral Task sub-agent spawned via `Task(subagent_type="Explore")`, not a declared agent definition. Option (a) is the stronger fix since it creates a single source of truth for Explore agent behavior across all commands.

### MEDIUM

**M1 -- `debug-orchestration` Phase 5 creates cross-skill coupling to `implementation-orchestration`** - `shared/skills/debug-orchestration/SKILL.md:73`

- Problem: Line 73 states: "YES -> Run the implementation-orchestration pipeline (load it via Skill tool): pre-flight -> Coder -> quality gates." This creates a runtime dependency where one orchestration skill dynamically loads and invokes another orchestration skill. This is an implicit coupling between peer-level skills that the skill system does not formally declare.
- Impact: The skill system's `allowed-tools` declarations and plugin manifests do not model inter-skill dependencies. If `implementation-orchestration` is ever renamed, restructured, or has its tool permissions changed, `debug-orchestration` will silently break. This violates the Dependency Inversion Principle at the skill layer.
- Fix: Two options:
  1. **Inline the fix pipeline**: When the user accepts the fix, describe the pipeline inline (spawn Coder with fix as EXECUTION_PLAN, run quality gates) rather than delegating to another skill. This removes the coupling entirely.
  2. **Declare the dependency**: Add a note in the debug-orchestration frontmatter or top-level documentation: "Phase 5 depends on implementation-orchestration skill for fix execution." This at least makes the coupling visible and auditable.

**M2 -- `plan-orchestration` references a "Plan agent" that does not exist in the agent roster** - `shared/skills/plan-orchestration/SKILL.md:43`

- Problem: Phase 3 says "Spawn Plan agent with combined Skimmer + Explore findings." The shared agents roster (per CLAUDE.md) lists 10 agents: git, synthesizer, skimmer, simplifier, coder, reviewer, resolver, shepherd, scrutinizer, validator. There is no "Plan agent." The `/implement` command also references "Plan agents" in Phase 5, where they are spawned as ephemeral `Task(subagent_type="Plan")` sub-agents without a formal definition, but the terminology is clearer in `/implement` because it says "Spawn 3 Plan agents" in a context where the reader can see the Task invocation syntax.
- Impact: The Plan agent reference in `plan-orchestration` is ambiguous. A contributor reading Phase 3 will look for a `plan.md` agent definition and not find one. The same contributor reading the Skimmer spawn in Phase 1 will find a `skimmer.md` agent, creating an inconsistency between phase references.
- Fix: Clarify which concrete mechanism performs the "Plan" role:
  ```markdown
  ## Phase 3: Design

  Spawn a Plan sub-agent (ephemeral Task) with combined Skimmer + Explore findings:
  ```
  Or alternatively, use the Synthesizer agent (which exists in the roster) for plan synthesis, which is what `/implement` does in Phase 6.

**M3 -- Test assertion relaxation weakens scope-based split validation** - `tests/integration/ambient-activation.test.ts:40`

- Problem: The test for "add a login form" changed from asserting `extractDepth(output) === 'GUIDED'` to `expect(['GUIDED', 'ORCHESTRATED']).toContain(extractDepth(output))`. This means the test accepts either depth classification for a prompt that should clearly be GUIDED scope (a login form is 1-2 files, single module). The test no longer validates the scope-based split logic that is the core architectural contribution of this PR.
- Impact: If the classification model drifts toward over-classifying prompts as ORCHESTRATED (which the Iron Law warns against: "false-positive ORCHESTRATED is expensive — 5-6 agent spawns"), this test will not catch it. The entire value proposition of the three-tier model depends on correct scope-based splitting.
- Fix: Keep the strict assertion for the expected depth, and add a separate test for ORCHESTRATED classification:
  ```typescript
  it('classifies "add a login form" as IMPLEMENT/GUIDED', () => {
    const output = runClaude('add a login form with email and password fields');
    if (hasClassification(output)) {
      expect(extractIntent(output)).toBe('IMPLEMENT');
      expect(extractDepth(output)).toBe('GUIDED');
    }
  });

  it('classifies "refactor the auth system" as IMPLEMENT/ORCHESTRATED', () => {
    const output = runClaude('refactor the entire authentication system across all modules');
    if (hasClassification(output)) {
      expect(extractIntent(output)).toBe('IMPLEMENT');
      expect(extractDepth(output)).toBe('ORCHESTRATED');
    }
  });
  ```

**M4 -- Removed escalation path from ambient to explicit commands** - `shared/skills/ambient-router/SKILL.md`, `plugins/devflow-ambient/commands/ambient.md`

- Problem: The previous architecture had ELEVATE as a safety valve: "This task spans multiple files/systems. Consider `/implement` for full lifecycle management." The new architecture collapses this into ORCHESTRATED, which runs an agent pipeline but lacks key capabilities available in `/implement`: Git agent branch setup, Skimmer + 4 Explore codebase orientation, 3 parallel Plan agents + Synthesizer, sequential/parallel Coder strategies, PR creation, and knowledge persistence. There is no mechanism to detect "this task is too large for ambient orchestration."
- Impact: Users may trigger expensive ORCHESTRATED pipelines for tasks better served by `/implement`. The ambient IMPLEMENT/ORCHESTRATED pipeline is a significant subset of `/implement`'s 15-phase pipeline.
- Fix: Add a post-pipeline note for ORCHESTRATED/IMPLEMENT: "For full lifecycle management (branch setup, deep codebase exploration, multi-strategy implementation, PR creation), consider `/implement`." This preserves the safety valve without a third tier.

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**S1 -- Coder agent skill list growing without documented budget** - `shared/agents/coder.md:5`

- Problem: The Coder agent's `skills` frontmatter grew from 6 to 8 entries: `core-patterns, git-safety, implementation-patterns, git-workflow, test-patterns, test-driven-development, search-first, input-validation`. Each skill adds token overhead at agent spawn time. The Coder is the most frequently spawned agent (used by `/implement`, `/resolve`, and now ambient ORCHESTRATED). There is no documented cap on how many skills an agent should declare, nor a formal boundary between "permanent" and "dynamic" skills.
- Impact: As more skills are added, spawn cost increases linearly. With 8 skills the overhead is manageable but the pattern of "add every relevant skill to frontmatter" does not scale. The Coder already has a dynamic skill loading mechanism (Responsibility #2 loads domain skills based on DOMAIN hint), so the boundary between permanent and dynamic should be explicit.
- Fix: Document a skill budget guideline in `docs/reference/agent-design.md` or CLAUDE.md. For example: "Agents should declare at most 6-8 permanent skills in frontmatter. Additional skills should be loaded dynamically based on DOMAIN hint or file context."

**S2 -- Ambient hook preamble growing in per-prompt token cost** - `scripts/hooks/ambient-prompt:34-51`

- Problem: The hook preamble grew from approximately 100 tokens to approximately 200 tokens. This preamble is injected on every single user prompt when ambient mode is enabled, including prompts that will be classified as QUICK (the majority case). The QUICK path's promise is "zero overhead," but the classification preamble itself is non-zero overhead.
- Impact: At 200 tokens per prompt, a session with 50 prompts burns approximately 10,000 tokens on ambient preamble injection. Most of the growth comes from ORCHESTRATED-path instructions that are irrelevant to QUICK-classified prompts.
- Fix: Consider deferring the ORCHESTRATED instructions to the ambient-router skill (which is loaded only for GUIDED/ORCHESTRATED). The preamble could be reduced to the minimum needed for classification:
  ```
  Intent: IMPLEMENT | DEBUG | REVIEW | PLAN | EXPLORE | CHAT
  Depth: QUICK | GUIDED | ORCHESTRATED
  Default: QUICK. See ambient-router skill for GUIDED/ORCHESTRATED behavior.
  If QUICK: Respond normally without stating classification.
  ```

---

## Pre-existing Issues (Not Blocking)

### MEDIUM

**P1 -- No formal interface between ambient command and orchestration skills**

- Problem: The ambient.md command, ambient-router skill, and three orchestration skills communicate through implicit conventions (skill names, pipeline phase descriptions) rather than formal contracts. There is no schema for what the ambient-router outputs or what the orchestration skills expect as input. This is a structural limitation of the markdown-based skill system.
- Impact: As the ambient system grows in complexity, implicit contracts become harder to maintain. Mismatched assumptions between router and orchestration skills will surface only at runtime.

**P2 -- No shared Explore or Plan agent definitions despite usage across 4+ commands**

- Problem: `/implement`, `/debug`, `/specify`, and now ambient orchestration all reference "Explore agents" and/or "Plan agents." These are spawned as ephemeral Task sub-agents with behavior defined inline in each command/skill. There is no single source of truth for what an Explore or Plan agent should do.
- Impact: Inconsistent Explore/Plan agent behavior across commands. Difficult to evolve patterns uniformly.

### LOW

**P3 -- CHANGELOG entry lacks version number**

- Problem: Changes are under `[Unreleased]`, which is correct for pre-release. The scope (new orchestration tier, 3 new skills, agent pipeline redesign) suggests this warrants a minor version bump (1.6.0), but no version bump was made.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 4 | 0 |
| Should Fix | - | 0 | 2 | 0 |
| Pre-existing | - | - | 2 | 1 |

### Blocking Issues Detail

| ID | Severity | File | Summary |
|----|----------|------|---------|
| H1 | HIGH | `shared/skills/implementation-orchestration/SKILL.md`, `shared/skills/debug-orchestration/SKILL.md` | Pipeline duplication with explicit commands -- DRY violation, maintenance drift risk |
| H2 | HIGH | `plugins/devflow-ambient/.claude-plugin/plugin.json`, `src/cli/plugins.ts` | Missing Explore agent in manifest -- unclear contract for DEBUG/PLAN ORCHESTRATED |
| M1 | MEDIUM | `shared/skills/debug-orchestration/SKILL.md:73` | Cross-skill coupling: debug-orchestration dynamically loads implementation-orchestration |
| M2 | MEDIUM | `shared/skills/plan-orchestration/SKILL.md:43` | References non-existent "Plan agent" -- ambiguous agent identity |
| M3 | MEDIUM | `tests/integration/ambient-activation.test.ts:40` | Test assertion relaxation weakens scope-based split validation |
| M4 | MEDIUM | `shared/skills/ambient-router/SKILL.md`, `plugins/devflow-ambient/commands/ambient.md` | Removed escalation path from ambient to explicit commands |

**Architecture Score**: 6/10

The three-tier model (QUICK/GUIDED/ORCHESTRATED) is a well-reasoned evolution from QUICK/GUIDED/ELEVATE. The scope-based split criteria for GUIDED vs ORCHESTRATED are clear and practical. The orchestration skills follow established conventions with Iron Laws, phased pipelines, and error handling. The overall layering (ambient-router classifies, orchestration skills execute) is architecturally sound.

The main concerns are:

1. **Pipeline duplication** (H1): The orchestration skills duplicate pipeline logic from `/implement` and `/debug` without documenting the relationship or sharing common components. This will cause maintenance drift as the explicit commands evolve independently.

2. **Unclear agent contracts** (H2, M2): Orchestration skills reference agents (Explore, Plan) that do not have formal definitions. This is consistent with existing command patterns but leaves the architectural contract unclear for contributors.

3. **Cross-skill coupling** (M1): The debug-orchestration skill dynamically loads implementation-orchestration, creating an implicit peer dependency that violates separation of concerns at the skill layer.

4. **Weakened testing** (M3): The relaxed test assertions no longer validate the scope-based GUIDED vs ORCHESTRATED split, which is the core contribution of this PR.

5. **Missing safety valve** (M4): The ELEVATE escalation path to explicit commands was removed without replacement, leaving users without guidance when tasks exceed ambient orchestration capacity.

**Recommendation**: CHANGES_REQUESTED

Priority fixes: (1) Document the delta between orchestration skills and explicit commands (H1), (2) clarify the Explore/Plan agent contract (H2, M2), (3) restore strict depth assertions in tests (M3). The remaining MEDIUM issues (M1, M4) can be addressed in this PR or deferred with documentation.
