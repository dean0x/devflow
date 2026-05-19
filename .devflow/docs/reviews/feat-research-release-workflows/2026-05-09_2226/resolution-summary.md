# Resolution Summary

**Branch**: feat-research-release-workflows
**Review**: 2026-05-09_2226
**Date**: 2026-05-09

## Decisions Citations

- `applies ADR-001` — Clean break philosophy guided SHADOW_RENAMES removal and LEGACY_SKILL_NAMES approach (no backward-compat shims)
- `avoids PF-001` — No migration code added for research skill deletion

## Statistics

| Metric | Count |
|--------|-------|
| Issues resolved | 9 |
| False positives | 0 |
| Deferred (pending discussion) | 2 |
| Files modified | 12 |
| Commits created | 7 (6 resolver + 1 simplifier) |
| Tests | 1361 passing |

## Resolved Issues

### B1: Plugin Manifests
- **Version mismatch** — Changed `devflow-research` and `devflow-release` plugin.json from `2.0.0` to `1.8.3` to match all 18 existing plugins
- **Missing orch skills** — Added `research:orch` to devflow-research and `release:orch` to devflow-release plugin.json skills arrays

### B2: Router GUIDED Fix
- **RESEARCH GUIDED routing** — Changed GUIDED table from `devflow:research:orch` to `devflow:research-codebase` (domain skill, not orch); ORCHESTRATED retains `devflow:research:orch`
- **Skill catalog update** — Updated RESEARCH Intent table to reflect GUIDED=research-codebase, ORCHESTRATED=research:orch with explanatory note

### B3: release:orch Consistency
- **Phase 1b Decisions loading** — Added standard decisions/feature-knowledge loading step between Phase 1 and Phase 2, with checklist entry
- **Build & Test wording** — Replaced ambiguous shell-like examples with `build_tool`/`test_tool` intent identifiers; changed "command" to "intent" in Phase 4 Validator references

### B4: Test Coverage
- **Intent count** — Updated preamble drift test from "8 intents" to "10 intents" with RESEARCH/RELEASE assertions
- **Regex expansion** — Added RESEARCH|RELEASE to integration test alignment regex
- **Integration tests** — Added 4 new tests: RESEARCH/GUIDED, RELEASE/GUIDED, RESEARCH/ORCHESTRATED, RELEASE/ORCHESTRATED
- **Preload test** — Added Researcher agent skill preload test (worktree-support, apply-decisions, apply-feature-knowledge)

### B5: Documentation
- **docs-framework persistence table** — Added Researcher and Synthesizer (research) rows
- **File naming patterns** — Added research output and research summary patterns
- **CLAUDE.md persisting agents** — Added Researcher and Synthesizer (research mode) to summary line
- **skills-architecture tier catalog** — Added Research Skills subsection under Tier 2, new Orchestration Skills section, updated agent-teams Used By column

### B6: Researcher Validation
- **RESEARCH_TYPE guard** — Added explicit validation step requiring RESEARCH_TYPE to be one of 5 allowed values before skill name construction

## Simplifier Fixes
- **release:orch checklist** — Updated Phase 1b checklist to list both DECISIONS_CONTEXT and FEATURE_KNOWLEDGE (was missing FEATURE_KNOWLEDGE)
- **Integration test conditions** — Aligned RESEARCH/RELEASE GUIDED retry conditions with established `hasRequiredSkills(r, ['router'])` pattern
- **plugins.ts sync** — Added `research:orch` and `release:orch` to plugins.ts skill arrays to match plugin.json changes (fixes bidirectional consistency test)

## Deferred (Pending Discussion)

1. **Restore devflow:research (research-before-building)** — Old skill served different purpose from new research-type skills. Deletion removes Coder's "check for existing packages" enforcement. Awaiting design decision.
2. **LEGACY_SKILL_NAMES for `'research'`** — Depends on outcome of #1. If skill is restored, remove from legacy; if confirmed deleted, add `'devflow:research'` for prefixed cleanup.
