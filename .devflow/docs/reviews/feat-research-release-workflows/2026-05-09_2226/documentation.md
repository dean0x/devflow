# Documentation Review Report

**Branch**: feat/research-release-workflows -> main
**Date**: 2026-05-09

## Issues in Your Changes (BLOCKING)

### MEDIUM

**docs-framework SKILL.md: Agent Persistence Rules table missing Researcher and Synthesizer (research mode) entries** - `shared/skills/docs-framework/SKILL.md:114-123`
**Confidence**: 90%
- Problem: The Agent Persistence Rules table in docs-framework was not updated to include the new Researcher agent (writes to `.docs/research/{topic-slug}/{timestamp}/{type}.md`) and Synthesizer in research mode (writes to `.docs/research/{topic-slug}/{timestamp}/research-summary.md`). The directory structure section (line 39-42) was correctly updated, but the persistence table that agents reference to know WHERE to write is incomplete. This table is the canonical reference for agent output contracts.
- Fix: Add two rows to the Agent Persistence Rules table:
```markdown
| Researcher | `.docs/research/{topic-slug}/{timestamp}/{type}.md` | Creates new in timestamped dir |
| Synthesizer (research) | `.docs/research/{topic-slug}/{timestamp}/research-summary.md` | Creates new in timestamped dir |
```

**docs-framework SKILL.md: File Naming Patterns table missing research artifact types** - `shared/skills/docs-framework/SKILL.md:83-91`
**Confidence**: 88%
- Problem: The File Naming Patterns table does not include entries for research output files (`{type}.md` in timestamped research dir, `research-summary.md`). This table is used by agents to determine correct file naming, and its incompleteness could cause inconsistent naming in research outputs.
- Fix: Add rows to the File Naming Patterns table:
```markdown
| Research outputs | `{type}.md` in timestamped dir | `2025-12-26_1430/codebase.md` |
| Research summary | `research-summary.md` in timestamped dir | `2025-12-26_1430/research-summary.md` |
```

**skills-architecture.md: 5 new research-type skills missing from tier catalog** - `docs/reference/skills-architecture.md:42-67`
**Confidence**: 92%
- Problem: The tier catalog in `skills-architecture.md` does not list the 5 new research-type skills (`research-codebase`, `research-external`, `research-market`, `research-competitor`, `research-technology`) or the 2 new orch skills (`research:orch`, `release:orch`). The old `research` skill was correctly removed from Tier 2, but its replacements were not categorized. These skills don't fit neatly into existing tiers — they are loaded dynamically by the Researcher agent, similar to how Pattern Skills are loaded by the Reviewer agent.
- Fix: Add a new Tier 1c subsection (or extend Tier 1b naming to cover "Agent-Loaded Skills"):
```markdown
### Tier 1c: Research Skills

Domain expertise for Researcher agent focus areas. Loaded dynamically based on research type parameter.

| Skill | Purpose | Research Type |
|-------|---------|---------------|
| `research-codebase` | Local code patterns, flows, dependencies | `codebase` |
| `research-external` | Web docs, articles, community knowledge | `external` |
| `research-market` | Market landscape, trends, positioning | `market` |
| `research-competitor` | Feature comparison, gap analysis | `competitor` |
| `research-technology` | Library/framework evaluation | `technology` |
```
Also add `research:orch` and `release:orch` to the existing orchestration skill listings (if any exist in that doc).

**CLAUDE.md: Persisting agents line missing Researcher and Synthesizer (research mode)** - `CLAUDE.md:165`
**Confidence**: 85%
- Problem: The "Persisting agents" single-line summary in CLAUDE.md lists Reviewer, Synthesizer (review mode), Resolver, and Working Memory — but does not mention the Researcher agent or Synthesizer in research mode. These agents now write artifacts to `.docs/research/` but are not documented in this canonical persistence summary.
- Fix: Update the line to include:
```
**Persisting agents**: Reviewer → `.docs/reviews/{branch-slug}/{timestamp}/{focus}.md`, Synthesizer → `.docs/reviews/{branch-slug}/{timestamp}/review-summary.md` (review mode), Researcher → `.docs/research/{topic-slug}/{timestamp}/{type}.md`, Synthesizer → `.docs/research/{topic-slug}/{timestamp}/research-summary.md` (research mode), Resolver → `.docs/reviews/{branch-slug}/{timestamp}/resolution-summary.md`, Working Memory → `.memory/WORKING-MEMORY.md` (automatic)
```

### LOW

**docs-framework Integration section not updated** - `shared/skills/docs-framework/SKILL.md:147-153`
**Confidence**: 82%
- Problem: The Integration section at the bottom of docs-framework lists which systems use the framework: "Review agents", "Working Memory hooks", and "Background extractor". It does not mention Research agents, even though the Researcher and Synthesizer (research mode) now persist artifacts using docs-framework conventions. This is a minor completeness gap — agents reference the persistence table, not the Integration section.
- Fix: Add a bullet: `- **Research agents**: Creates research outputs in `.docs/research/`

**skills-architecture.md: agent-teams Used By column missing /research and /release** - `docs/reference/skills-architecture.md:21`
**Confidence**: 80%
- Problem: The `agent-teams` skill row in Tier 1 lists "Used By: /code-review, /implement, /debug, /plan" but does not include `/research` and `/release`, which are both documented as having Agent Teams variants (CLAUDE.md confirms 8 commands use Agent Teams).
- Fix: Update the Used By column to: `/code-review, /implement, /debug, /plan, /explore, /resolve, /research, /release` (note: `/explore` and `/resolve` were also missing from this column, though that predates this PR).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**docs-framework SKILL.md: Synthesizer not listed as docs-framework consumer** - `shared/skills/docs-framework/SKILL.md:6`
**Confidence**: 82%
- Problem: The Synthesizer agent's frontmatter lists `devflow:docs-framework` as a skill dependency, and the docs-framework Integration section mentions it in the Reviewer row, but the Synthesizer (research mode) is a new persisting agent writing to `.docs/research/`. The docs-framework SKILL.md `skills` frontmatter is listed in the synthesizer agent's skills array, but the Integration section (line 147-153) does not explicitly name the Synthesizer. This was pre-existing but is now more important because the Synthesizer has a second output mode.
- Fix: Update the Integration section to explicitly list "Synthesizer" as a consumer.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**docs-framework File Naming Patterns table missing design document pattern added in prior PR** - `shared/skills/docs-framework/SKILL.md:91`
**Confidence**: 80%
- Problem: The design document naming pattern (`{issue}-{topic-slug}.{timestamp}.md`) was added to the table in a prior PR and is present, but there is no entry for the Coder handoff artifact (`.docs/handoff-{branch_slug}.md`) which is documented in CLAUDE.md but missing from docs-framework. Pre-existing and not introduced by this PR.
- Fix: Would be a separate cleanup PR.

## Suggestions (Lower Confidence)

- **research:orch SKILL.md GUIDED section: inconsistency with router table** - `shared/skills/research:orch/SKILL.md:24-31` (Confidence: 72%) — The GUIDED section in research:orch says "Spawn 1-2 Researcher agents" but GUIDED mode typically works directly in the main session without spawning agents. The router table shows GUIDED RESEARCH loads `devflow:research:orch` which then tells it to spawn agents, which is unusual for GUIDED depth. Other GUIDED behaviors (IMPLEMENT, DEBUG) work directly. This may be intentional given research's nature but is worth confirming.

- **release-teams.md and release.md have partially overlapping Phase 1 descriptions** - `plugins/devflow-release/commands/release-teams.md:33-57` vs `plugins/devflow-release/commands/release.md:33-43` (Confidence: 65%) — The release-teams.md Phase 1 contains sub-phases 1a and 1b that closely mirror the base release.md Phases 2 and 3. This is expected since teams variant adds debate, but the numbering shift (teams: Phases 1a/1b → base: Phases 2/3) could cause confusion when cross-referencing.

- **research-codebase SKILL.md: Glob tool not in researcher agent frontmatter** - `shared/skills/research-codebase/SKILL.md:5` (Confidence: 68%) — The research-codebase skill declares `allowed-tools: Read, Grep, Glob` but the Researcher agent frontmatter does not list `allowed-tools` at all. Agent-level tool access is controlled by the `tools` frontmatter field, not `allowed-tools` in skills. Skills' `allowed-tools` are metadata hints, so this is not a functional issue, but worth verifying the Researcher agent has Glob access at runtime.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 4 | 2 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Documentation Score**: 6/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The new documentation (commands, skills, agents, orchestration) is individually well-structured and internally consistent. Each research skill follows the Iron Law + Methodology + Output Format + Anti-Patterns template faithfully. The CLAUDE.md updates correctly reflect the new counts (20 plugins, 14 agents, 49 skills, 9 orch skills, 8 Agent Teams commands). However, the cross-referencing documentation (docs-framework persistence tables, skills-architecture tier catalog, CLAUDE.md persisting agents summary) was not updated to include the new research artifacts and agents. These are the canonical reference points that other agents and workflows use to determine where and how to persist output — they should be updated before merge. Applies ADR-001: the old `research` skill was cleanly deleted with no migration shims, and legacy names were properly added to `LEGACY_SKILL_NAMES` for cleanup. Avoids PF-001: no backward-compatibility layers were introduced for the research→research-{type} refactor.
