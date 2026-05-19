# Architecture Review Report

**Branch**: feat/108-unified-plan-command -> main
**Date**: 2026-04-07_2319

## Issues in Your Changes (BLOCKING)

### HIGH

**`devflow-implement` retains `skimmer` and `synthesizer` agents no longer referenced by the command** - `src/cli/plugins.ts:30`
**Confidence**: 85%
- Problem: The `/implement` command was refactored to remove its Orient (Skimmer), Explore (parallel), and Synthesize phases (Phases 2-6 in the old command). The command now starts directly with Git setup and jumps to the Implement phase. However, the `devflow-implement` plugin definition in `plugins.ts` still declares `skimmer` and `synthesizer` in its agents array. Neither agent is spawned anywhere in the updated `implement.md` or `implement-teams.md` commands.
- Impact: These unused agent declarations cause the build system to copy agent files into the plugin directory unnecessarily. While not a runtime failure (unused agents are simply ignored), it is dead weight that will confuse maintainers and violates the project's clean separation principle. The `synthesizer` agent was previously used to combine explore/plan outputs; the `skimmer` was used for orient. Both responsibilities now live in `/plan`.
- Fix: Remove `'skimmer'` and `'synthesizer'` from the `devflow-implement` agents array in `src/cli/plugins.ts`:
  ```typescript
  {
    name: 'devflow-implement',
    description: 'Complete task implementation workflow - accepts plan documents, issues, or task descriptions',
    commands: ['/implement'],
    agents: ['git', 'coder', 'simplifier', 'scrutinizer', 'evaluator', 'tester', 'validator'],
    skills: ['agent-teams', 'patterns', 'knowledge-persistence', 'qa', 'quality-gates', 'worktree-support'],
  },
  ```

---

**`devflow-plan` plugin missing `worktree-support` skill despite Designer agent requiring it** - `plugins/devflow-plan/.claude-plugin/plugin.json:24-30`
**Confidence**: 90%
- Problem: The Designer agent (both `shared/agents/designer.md` and `plugins/devflow-plan/agents/designer.md`) declares `skills: devflow:worktree-support` in its frontmatter and has an explicit "Worktree Support" section. The `plan:orch` SKILL.md also has a "Worktree Support" section that references WORKTREE_PATH handling. However, the `devflow-plan` plugin's `plugin.json` skills array does not include `worktree-support`. Per the project convention (CLAUDE.md: "Plugin manifests (`plugin.json`) declare `skills` and `agents` arrays"), this means the build system will not distribute the worktree-support skill into the plan plugin directory.
- Impact: In the current architecture, all skills are universally installed regardless of plugin selection (per CLAUDE.md: "Universal Skill Installation"). So the skill will still be available at runtime. However, the missing declaration breaks the contract that plugin.json accurately represents its dependencies. Other plugins that use worktree-support (implement, code-review, resolve, debug, self-review, ambient) all declare it in their plugin.json.
- Fix: Add `'worktree-support'` to the skills array in `plugins/devflow-plan/.claude-plugin/plugin.json`:
  ```json
  "skills": [
    "agent-teams",
    "gap-analysis",
    "design-review",
    "patterns",
    "knowledge-persistence",
    "worktree-support"
  ]
  ```
  And mirror in `src/cli/plugins.ts` for the devflow-plan entry:
  ```typescript
  skills: ['agent-teams', 'gap-analysis', 'design-review', 'patterns', 'knowledge-persistence', 'worktree-support'],
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`/implement` no longer has exploration/planning capability when no plan document is provided** - `plugins/devflow-implement/commands/implement.md:50-58`
**Confidence**: 82%
- Problem: The previous `/implement` was a self-contained lifecycle command (explore -> plan -> implement -> validate). The refactored version removes all exploration and planning phases, relying on either a plan document from `/plan` or falling back to "conversation context" and "task description". When invoked with just a task description (e.g., `/implement add rate limiting`) and no prior plan document, the Coder agent receives an empty `PATTERNS` field and no exploration context. The command's strategy selection states: "Otherwise: default to SINGLE_CODER unless task description signals high complexity" -- but there is no mechanism to assess complexity without exploration.
- Impact: The `/implement` command loses its standalone capability. Users who previously ran `/implement #42` and got a full explore-plan-implement pipeline now get only the implement phase with no codebase analysis. This is a significant behavior change that should be clearly communicated. The CLAUDE.md and README updates describe the change, but the fallback behavior (task description without plan) may produce lower quality implementations because the Coder operates without exploration context.
- Fix: Consider adding a lightweight orient step when no plan document is provided -- for example, a single Skimmer spawn to give the Coder basic codebase context. Alternatively, document this as a deliberate design decision: `/implement` without a plan document is intended for small, well-understood tasks only, and users should use `/plan` + `/implement {path}` for anything non-trivial.

---

**Synthesizer `design` mode has no output path/persistence** - `shared/agents/synthesizer.md` (new Mode: Design section)
**Confidence**: 80%
- Problem: The new `design` mode for the Synthesizer outputs structured markdown (Blocking Gaps, Should-Address, Informational) but unlike the `review` mode, it has no persistence section. The review mode has explicit instructions to write output to disk via the Write tool. The design mode's output is returned to the orchestrator and consumed inline, which is the correct pattern for intermediate synthesis (exploration and planning modes also don't persist). However, the gap analysis synthesis is a valuable artifact that users might want to reference later -- unlike exploration/planning synthesis which feeds directly into the next phase, gap analysis results are presented to the user at Gate 1.
- Impact: Gap analysis synthesis is ephemeral. If the user accepts at Gate 1 and later wants to review what gaps were identified, the information only exists in conversation history (which may be compacted). The design artifact in Phase 15 does include a "Gap Analysis Results" section, so the final artifact captures a summary. This is adequate but means the detailed synthesis (with confidence percentages and cross-agent deduplication) is lost.
- Fix: No immediate fix required. The current approach (final design artifact captures gap results) is architecturally sound. If granular gap analysis persistence becomes valuable, it can be added in a future iteration by having the Synthesizer write to `.docs/design/{slug}.gaps.md`.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`/specify` is deprecated but not scheduled for removal** - `plugins/devflow-specify/commands/specify.md:3-5`, `plugins/devflow-specify/commands/specify-teams.md:3-5`
**Confidence**: 85%
- Problem: Both specify command variants now carry a deprecation notice pointing users to `/plan`. However, the `devflow-specify` plugin remains in the plugin registry, the CLAUDE.md plugin table, and the README commands table (moved to last position with deprecation note). There is no version target for removal and no migration mechanism. The DEVFLOW_PLUGINS array in plugins.ts still lists devflow-specify as a non-optional plugin, meaning `devflow init` will still offer it during plugin selection.
- Impact: Users may install both `/specify` and `/plan`, creating confusion about which to use. The deprecation notice in the command file only appears after the user has already invoked `/specify`.
- Fix: Mark `devflow-specify` as `optional: true` in plugins.ts (like the language plugins) so it is not selected by default. Add a version target for removal (e.g., "Will be removed in v3.0").

---

**PF-002 (init handler monolith) exacerbated by new plugin** - `src/cli/plugins.ts`
**Confidence**: 80%
- Problem: Known pitfall PF-002 documents that the init command handler is a monolith. Adding `devflow-plan` as a new plugin increases the number of plugins the init handler must process, further growing the monolith. The resolution in PF-002 (extract into focused functions) has not been applied.
- Impact: Each new plugin adds complexity to the init flow. This is not caused by this PR but is worsened by it.
- Fix: This is a pre-existing architectural issue (PF-002). No action required in this PR.

## Suggestions (Lower Confidence)

- **plan:orch Phase 5 uses `Agent(subagent_type="Plan")` which is not a standard agent type** - `shared/skills/plan:orch/SKILL.md:93` (Confidence: 70%) -- The "Plan" subagent type appears only in plan:orch. Other orchestration skills use standard agent types (Explore, Skimmer, Designer, Synthesizer, Coder). This may be an existing generic agent type used for planning, but it is not listed in the shared agents roster (CLAUDE.md lists 12 shared agents, none named "Plan").

- **Design artifact naming uses dot separator while review artifacts use slash separator** - `shared/skills/docs-framework/SKILL.md` (Confidence: 65%) -- Design artifacts use `{issue}-{topic-slug}.{timestamp}.md` (dot before timestamp) while review artifacts use `{timestamp}/{focus}.md` (directory separator). The dot convention is technically valid but creates a different structural pattern than the established timestamped-directory approach used by reviews. This may be intentional (design artifacts are standalone files, not collections).

- **`/plan` command does not reference `docs-framework` skill in its plugin.json** - `plugins/devflow-plan/.claude-plugin/plugin.json` (Confidence: 62%) -- The plan command writes design artifacts with specific naming conventions that come from the docs-framework skill (timestamps, slugs, directory structure). The skill is declared as a dependency of the Synthesizer agent (via its frontmatter), but not in the plugin's skill manifest. Since the plan command itself writes the artifact (Phase 15), the docs-framework patterns are referenced but not formally declared as a plugin dependency.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 2 | 0 |

**Architecture Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The architectural design of the unified `/plan` command is well-structured. The 7-block, 17-phase pipeline follows established patterns (parallel subagents for independent analysis, Agent Teams for debate-worthy phases, mandatory user gates, synthesizer for combining outputs). The new Designer agent follows the mode-driven pattern with clear separation between gap-analysis and design-review modes. The `/implement` refactoring to accept plan documents creates a clean separation of concerns between planning and execution.

The two blocking issues are straightforward: stale agent declarations in the implement plugin and a missing skill dependency in the plan plugin manifest. Both are quick fixes that bring the manifest declarations into alignment with the actual command behavior.
