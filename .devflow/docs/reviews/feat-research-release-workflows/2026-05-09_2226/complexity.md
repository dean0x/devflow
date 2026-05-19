# Complexity Review Report

**Branch**: feat/research-release-workflows -> main
**Date**: 2026-05-09

## Issues in Your Changes (BLOCKING)

### HIGH

**research-teams.md: 12-phase pipeline is borderline unmanageable** - `plugins/devflow-research/commands/research-teams.md`
**Confidence**: 85%
- Problem: The teams variant of `/research` has 12 sequential phases (Load Decisions, Requirements, Orient, Spawn Team, Investigation, Cross-Validation, Convergence, Cleanup, Write Findings, Synthesize, Present, Feature Knowledge Creation). This exceeds the cognitive threshold where an LLM orchestrator can reliably track phase state across context compaction events. The base variant has 7 phases and the orch skill has 7 phases — the teams variant nearly doubles the phase count by interleaving team lifecycle phases (spawn, cross-validate, converge, cleanup) between each functional phase.
- Fix: Consider consolidating adjacent mechanical phases. For example, Phases 5-7 (Investigation, Cross-Validation, Convergence) could be a single "Team Research" phase with sub-steps documented internally. Similarly, Phases 9-10 (Write Findings, Synthesize) are a natural pairing. Target 7-8 top-level phases with sub-steps, matching the base variant's cognitive load.

**release-teams.md: 10-phase pipeline with nested sub-phases** - `plugins/devflow-release/commands/release-teams.md`
**Confidence**: 82%
- Problem: The release teams variant has 10 phases, and Phase 1 contains two sub-phases (1a: Detect, 1b: Build Config). The sub-phase pattern creates an inconsistency with all other orchestration commands that use flat phase numbering. When combined with the conditional skip logic (CONFIG_STATE = learned skips Phases 1a/1b), the control flow has 3+ nesting levels conceptually: Phase 1 > CONFIG_STATE check > Phase 1a/1b.
- Fix: Promote sub-phases to top-level phases and renumber. This aligns with the flat phase convention used by every other orch skill (research:orch, implement:orch, etc.) and eliminates the mixed numbering scheme.

### MEDIUM

**Near-duplication between research.md and research:orch/SKILL.md Phase 1** - `plugins/devflow-research/commands/research.md:27-43`, `shared/skills/research:orch/SKILL.md:36-53`
**Confidence**: 85%
- Problem: Phase 1 (Load Decisions + Feature Knowledge) is copied with minor wording differences between the command file and the orch skill. Phase 2 (Requirements), Phase 3 (Orient), Phase 4 (Parallel Researchers), Phase 5 (Synthesize), Phase 6 (Present), and Phase 7 (Feature Knowledge Creation) are similarly duplicated with trivial reformatting. The research command file (169 lines) and orch skill (205 lines) share approximately 70% of their content. The same pattern applies to release.md (181 lines) vs release:orch/SKILL.md (278 lines).
- Fix: This is consistent with the existing pattern in the codebase where command files and orch skills both describe the same pipeline (review.md vs review:orch, implement.md vs implement:orch). The command is the entry point for `/research` and the orch skill is for ambient ORCHESTRATED routing. As long as both stay in sync, the duplication is the established convention. Flag as known maintenance cost — changes to the pipeline require updates in two places per workflow (four total for base + teams variants).

**LEGACY_SKILL_NAMES list is 163 entries and growing** - `src/cli/plugins.ts:259-444`
**Confidence**: 80%
- Problem: The LEGACY_SKILL_NAMES array has grown to 163 entries (186 lines including comments). This PR adds 7 new entries for the research/release skills. The list grows monotonically with each rename or restructure. At current rate it will pass 200 entries within a few releases. While the array is flat (no branching complexity), its size makes it a maintenance burden to verify that new entries are correct and not duplicated.
- Fix: The codebase convention (per CLAUDE.md) says "entries can be removed after 2 major versions." Consider a periodic prune pass to remove entries from v1.x era. Alternatively, extract into a separate data file (e.g., `legacy-skills.json`) to isolate the list from the functional plugin registry code. Neither is blocking — the current approach works, it is just accumulating weight.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Synthesizer agent now has 5 modes with distinct output formats (316 lines total)** - `shared/agents/synthesizer.md`
**Confidence**: 80%
- Problem: The synthesizer agent started at 4 modes (exploration, planning, review, design) and this PR adds a 5th (research). Each mode has its own Process and Output sections. The file is now 316 lines, which exceeds the target of 50-150 lines stated in CLAUDE.md for agents. The agent is essentially a multi-strategy file — each mode is independent of the others. This increases the context cost when any agent loads it, since all 5 mode descriptions are loaded even though only 1 is used per invocation.
- Fix: The multi-mode pattern is established and all existing orchestration skills reference `Agent(subagent_type="Synthesizer")` with a mode parameter. Splitting into separate agents would be a larger refactor that touches every orch skill. However, this is worth tracking: the next mode addition should trigger extraction of individual mode specs into referenced files (similar to how skills use `references/` directories), keeping the agent file as a dispatcher with mode selection logic only.

## Pre-existing Issues (Not Blocking)

No critical pre-existing issues found.

## Suggestions (Lower Confidence)

- **5 research-type skills follow an identical 6-step methodology structure** - `shared/skills/research-codebase/SKILL.md`, `shared/skills/research-external/SKILL.md`, `shared/skills/research-market/SKILL.md`, `shared/skills/research-competitor/SKILL.md`, `shared/skills/research-technology/SKILL.md` (Confidence: 70%) — All five skills use the same 6-step methodology framework (Steps 1-6), same Output Format template structure, same Anti-Patterns table format. The shared skeleton could be extracted to a reference file with each skill providing only its unique content (trust tier, specific methodology steps, specific output fields). This would reduce cross-skill maintenance burden. However, each skill is individually loaded by the Researcher agent at runtime, so self-contained files avoid cross-file reads. The current approach prioritizes agent simplicity over DRY.

- **research:orch and release:orch introduce different Feature Knowledge loading patterns** - `shared/skills/research:orch/SKILL.md:46-53`, `shared/skills/release:orch/SKILL.md` (Confidence: 65%) — research:orch loads feature knowledge in Phase 1 and passes it to researchers; release:orch does not load feature knowledge at all. This is probably intentional (release is about process, not code patterns), but the divergence from the FEATURE_KNOWLEDGE pass-through pattern used by other orch skills (implement, review, resolve, plan) is worth noting for documentation.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Complexity Score**: 6/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The new research and release workflows are well-structured individually — each skill, agent, and command follows established project conventions. The primary complexity concerns are: (1) the teams variants introduce high phase counts (12 and 10 respectively) that push against the cognitive limits of LLM orchestration, and (2) the command/orch skill duplication is a known maintenance multiplier (4 files to update for each pipeline change). Neither concern is blocking. The 5 research-type skills are cleanly factored with consistent structure. The researcher agent is lean (128 lines). The synthesizer is growing but manageable. The LEGACY_SKILL_NAMES list is a slow-growing maintenance concern but follows the established pattern.
