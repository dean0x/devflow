# Architecture Review Report

**Branch**: feat/research-release-workflows -> main
**Date**: 2026-05-09

## Issues in Your Changes (BLOCKING)

### HIGH

**Research:orch loaded at GUIDED depth breaks router convention** - `shared/skills/router/SKILL.md:35`
**Confidence**: 85%
- Problem: The GUIDED table entry for RESEARCH loads `devflow:research:orch` -- an orchestration skill. Every other GUIDED entry loads domain/knowledge skills (e.g., `devflow:test-driven-development`, `devflow:patterns`, `devflow:git`). Even EXPLORE (which also has a `## GUIDED Behavior` section in its orch skill) shows `--` in the router GUIDED table and defers agent spawning to the GUIDED instructions in router lines 12-13. Loading an orch skill at GUIDED depth conflates the GUIDED and ORCHESTRATED tiers, making the classification decision less meaningful for RESEARCH.
- Fix: Either (a) extract the GUIDED behavior inline into the router like EXPLORE does (move the 4-step GUIDED behavior from `research:orch` lines 24-30 into the router as a GUIDED RESEARCH instruction, then set the GUIDED row to `--` or to research-type knowledge skills), or (b) explicitly document in the router that RESEARCH is a special case where the orch skill also serves GUIDED depth.

**release:orch missing Phase 1 Decisions loading** - `shared/skills/release:orch/SKILL.md`
**Confidence**: 82%
- Problem: All other ORCHESTRATED pipelines (implement:orch, debug:orch, plan:orch, review:orch, resolve:orch, research:orch, explore:orch) have a "Phase 1: Load Decisions" step that loads DECISIONS_CONTEXT. The release:orch skill starts at Phase 1 with "Load Config" and never loads DECISIONS_CONTEXT or FEATURE_KNOWLEDGE. This means the release pipeline cannot benefit from project-specific architectural decisions or pitfalls when making release decisions. Given that `applies ADR-001` (clean break philosophy -- no migration code) could directly inform a release workflow about how to handle version bumps or changelog entries, the omission is structurally unsound.
- Fix: Add a "Phase 0: Load Decisions" step (or prepend to Phase 1) that follows the standard pattern:
```bash
DECISIONS_CONTEXT=$(node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "{worktree}" 2>/dev/null || echo "(none)")
```
Then pass DECISIONS_CONTEXT to relevant sub-phases where decisions could inform release behavior.

### MEDIUM

**Deleted monolithic research skill loses Coder-level research enforcement** - `shared/skills/research/SKILL.md` (deleted), `shared/agents/coder.md:11`
**Confidence**: 85%
- Problem: The old `devflow:research` skill enforced "research before building" -- it activated when a Coder was about to write utility code (parsing, HTTP wrappers, CLI tooling, etc.), forcing a package search before implementation. This was a Tier 2 Specialized skill with clear triggers for implementation-time activation. The new 5 research-type skills (`research-codebase`, `research-external`, etc.) are designed for the Researcher agent's orchestrated research workflow. They do not activate during implementation to prevent reinventing wheels. The Coder agent lost this skill reference (line 11 removal), leaving no research-before-building enforcement during implementation.
- Fix: The old `research` skill's purpose (research-before-building for utility code) is orthogonal to the new research workflow (multi-type topic research). Consider preserving the old skill under a different name (e.g., `devflow:research-before-building`) for Coder-level enforcement, or incorporate its "research before building" philosophy into `devflow:patterns` or `devflow:software-design`.

**Base command and teams command share substantial duplicated phase definitions** - `plugins/devflow-research/commands/research.md`, `plugins/devflow-research/commands/research-teams.md`
**Confidence**: 80%
- Problem: The base `research.md` (169 lines) and `research-teams.md` (276 lines) commands share identical Phases 1-3 (Load Decisions, Requirements, Orient) and identical Feature Knowledge Creation logic (Phase 7 in base, Phase 12 in teams). The teams variant adds Agent Teams phases (4-8: Spawn Team, Investigation, Cross-Validation, Convergence, Cleanup) while the base uses simple parallel agents (Phase 4). The same pattern exists for `release.md` (181 lines) vs `release-teams.md` (272 lines). This duplicated phase definitions mean any change to shared logic (e.g., Decisions loading, feature knowledge creation) must be applied in 4 places.
- Fix: This appears to be an established pattern in the project (implement, plan, code-review, etc. all have base + teams variants). If the duplication is accepted by convention, document it as a known tradeoff. Otherwise, consider extracting shared phases into the orch skill and having both command variants reference it.

**release plugin.json missing `release:orch` skill** - `plugins/devflow-release/.claude-plugin/plugin.json`
**Confidence**: 82%
- Problem: The `devflow-release` plugin.json declares skills `["agent-teams", "git", "worktree-support"]` but does not include `release:orch`. The ambient plugin (`devflow-ambient`) correctly includes `release:orch` in its skills array. Since the CLAUDE.md states "Universal Skill Installation" (all skills are always installed regardless of plugin selection), this does not cause a runtime failure. However, it is an incomplete manifest declaration -- the plugin should list the skills it uses. The `devflow-research` plugin.json similarly omits `research:orch`, relying on ambient instead.
- Fix: Add `"release:orch"` to the `devflow-release` plugin.json skills array and `"research:orch"` to the `devflow-research` plugin.json skills array for manifest completeness.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**SHADOW_RENAMES missing entry for deleted `search-first` -> `research` rename** - `src/cli/plugins.ts:484`
**Confidence**: 82%
- Problem: The diff removes the line `['search-first', 'research']` from SHADOW_RENAMES. The `search-first` bare name still exists in LEGACY_SKILL_NAMES (line 306). However, with the old `research` skill deleted and replaced by 5 new research-type skills, there is no single target for the shadow rename. Users with shadow overrides at `~/.devflow/skills/search-first/` or `~/.devflow/skills/research/` will have orphaned files. This aligns with `applies ADR-001` (clean break philosophy) -- the removal is consistent with not accumulating backwards-compat code. But `search-first` should be added to LEGACY_SKILL_NAMES for cleanup if not already there, and `research` should also be in LEGACY_SKILL_NAMES (it is, at line 395).
- Fix: No action needed if ADR-001 clean-break philosophy applies. The existing LEGACY_SKILL_NAMES entries for `search-first` and `research` will clean up orphaned installs. `avoids PF-001` -- verified the clean-break philosophy before flagging a missing migration.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Inconsistency between router GUIDED table and skill-catalog for EXPLORE intent** - `shared/skills/router/SKILL.md:31`, `shared/skills/router/references/skill-catalog.md:68`
**Confidence**: 80%
- Problem: The router GUIDED table shows EXPLORE as `--` (no skills), but the skill-catalog shows `devflow:explore:orch` at `GUIDED + ORCHESTRATED` depth. The new RESEARCH intent follows the skill-catalog pattern (loading orch skill at GUIDED depth), not the router GUIDED table pattern. This pre-existing inconsistency now has a downstream effect on how RESEARCH was designed.
- Fix: Align the router GUIDED table and skill-catalog for EXPLORE intent -- either both show `--` or both show the orch skill. This is a separate PR concern.

## Suggestions (Lower Confidence)

- **Synthesizer research mode trusts HTML trust comments** - `shared/agents/synthesizer.md:177` (Confidence: 70%) -- The research mode parsing relies on `<!-- trust: {tier} -->` HTML comments in researcher output files. A misbehaving or compromised researcher agent could emit a wrong trust tier. Consider validating trust tier against the known RESEARCH_TYPE -> trust tier mapping rather than trusting the researcher's self-reported label.

- **research-competitor and research-market skills have significant methodology overlap** - `shared/skills/research-competitor/SKILL.md`, `shared/skills/research-market/SKILL.md` (Confidence: 65%) -- Both skills cover player identification, positioning analysis, and landscape mapping. The distinction (competitor = feature matrix, market = data points) is clear in their output formats but their methodologies (Steps 1-4) share substantial thematic overlap. If researchers of both types are spawned for the same question, they may produce redundant findings.

- **release:orch lacks DECISIONS_CONTEXT passthrough to sub-agents** - `shared/skills/release:orch/SKILL.md` (Confidence: 72%) -- Even if a Load Decisions phase were added, the release:orch skill currently spawns Validator and Git agents without passing DECISIONS_CONTEXT. Other orch skills (implement:orch, resolve:orch) pass DECISIONS_CONTEXT to their worker agents.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR introduces two well-structured new workflows that follow established project patterns (plugin registration, skill decomposition, agent frontmatter, orchestration phases with Produces/Requires annotations). The 5 research-type skills with their trust tiers and the researcher agent's dynamic skill loading are architecturally clean. The release:orch's Iron Law (never execute shell commands from config) is a strong security-first architectural choice.

The two HIGH issues are structural: (1) the GUIDED/ORCHESTRATED boundary violation for RESEARCH routing, and (2) the missing Decisions loading in release:orch which breaks consistency with every other orch skill. The loss of implementation-time research enforcement (the deleted `devflow:research` skill) creates a functional gap that should be addressed, even if the old skill's content is repurposed rather than preserved.
