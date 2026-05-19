# Consistency Review Report

**Branch**: feat/research-release-workflows -> main
**Date**: 2026-05-09

## Issues in Your Changes (BLOCKING)

### HIGH

**Plugin version mismatch: new plugins use "2.0.0" while all existing plugins use "1.8.3"** - `plugins/devflow-research/.claude-plugin/plugin.json:8`, `plugins/devflow-release/.claude-plugin/plugin.json:8`
**Confidence**: 95%
- Problem: All 18 existing plugin.json files consistently use `"version": "1.8.3"`. The two new plugins (`devflow-research`, `devflow-release`) use `"version": "2.0.0"`. This breaks the convention that all plugins share a single synchronized version number.
- Fix: Change both new plugins to match the existing version `"1.8.3"`, or bump all plugins together if a major version bump is intended for the entire project.

### MEDIUM

**docs-framework Agent Persistence table not updated for new persisting agents** - `shared/skills/docs-framework/SKILL.md:114-123`
**Confidence**: 90%
- Problem: The docs-framework directory structure section (lines 39-42) correctly adds the research directory, but the Agent Persistence Rules table (lines 114-123) does not include entries for:
  - Researcher agent writing to `.docs/research/{topic-slug}/{timestamp}/{type}.md`
  - Synthesizer (research mode) writing to `.docs/research/{topic-slug}/{timestamp}/research-summary.md`
  
  All other persisting agents (Reviewer, Synthesizer review mode, Resolver, Designer) are documented in this table. The new agents follow the same disk-write pattern but are missing from the table.
- Fix: Add two rows to the Agent Persistence table:
  ```
  | Researcher | `.docs/research/{topic-slug}/{timestamp}/{type}.md` | Creates new in timestamped dir |
  | Synthesizer (research) | `.docs/research/{topic-slug}/{timestamp}/research-summary.md` | Creates new in timestamped dir |
  ```

**CLAUDE.md Persisting agents line not updated for research outputs** - `CLAUDE.md:165`
**Confidence**: 90%
- Problem: The "Persisting agents" line documents Reviewer, Synthesizer (review mode), Resolver, and Working Memory — but does not mention Researcher or Synthesizer (research mode) as persisting agents, even though they write to disk at `.docs/research/`. This line mirrors the docs-framework persistence table and should stay in sync.
- Fix: Append to the existing Persisting agents line:
  ```
  , Researcher → `.docs/research/{topic-slug}/{timestamp}/{type}.md`, Synthesizer (research) → `.docs/research/{topic-slug}/{timestamp}/research-summary.md`
  ```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **research-technology skill at 180 lines exceeds the ~120-150 line target** - `shared/skills/research-technology/SKILL.md` (Confidence: 65%) -- At 180 lines, this skill exceeds the documented target of ~120-150 lines per SKILL.md. The other four research-type skills stay within range (135-145 lines). Consider whether any content could move to a `references/` subdirectory.

- **No SHADOW_RENAMES entry for old 'research' to any new skill** - `src/cli/plugins.ts:452-485` (Confidence: 70%) -- The old `['search-first', 'research']` SHADOW_RENAMES entry was removed because the monolithic `research` skill was deleted. Users who had shadow overrides at `~/.devflow/skills/research/` will have their override silently ignored since no new skill uses that exact name. This may be intentional per the clean-break philosophy (applies ADR-001, avoids PF-001), but worth noting that the old `research` skill has no direct successor in the shadow rename system.

- **release:orch at 278 lines is the longest orchestration skill** - `shared/skills/release:orch/SKILL.md` (Confidence: 60%) -- At 278 lines, release:orch is longer than plan:orch (288) — wait, plan:orch is actually 288 lines so this is within the existing range. No action needed on second look.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The new research and release workflows demonstrate strong consistency with existing patterns across most dimensions: command structure (Usage/Input/Phases/Worktree Support/Output/Architecture/Principles/Error Handling sections), agent frontmatter conventions, skill Iron Law format, router integration, classification rules, plugin.json schema, LEGACY_SKILL_NAMES registration, tests updated, and CLAUDE.md counts/rosters. The Phase Protocol with Produces/Requires annotations is followed throughout all new orchestration skills. The version mismatch and missing persistence documentation are the two areas needing attention before merge.
