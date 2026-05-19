# Regression Review Report

**Branch**: feat/research-release-workflows -> main
**Date**: 2026-05-09

## Issues in Your Changes (BLOCKING)

### HIGH

**Old `devflow:research` skill removed but `devflow:research` description still referenced as Coder's "research-before-building" enforcement** - `shared/skills/research/SKILL.md` (deleted), `shared/agents/coder.md:11`
**Confidence**: 82%
- Problem: The old `devflow:research` skill (Tier 2, "research before building" enforcement for utility code) was deleted entirely and replaced by 5 specialized research-type skills (`research-codebase`, `research-external`, etc.) designed for a completely different purpose (multi-type research workflows). The old skill enforced that Coder agents research existing packages before writing custom utility code. No replacement for this Coder-facing enforcement was created. The Coder agent's `skills:` frontmatter correctly removed `devflow:research`, and the router GUIDED IMPLEMENT table dropped it, but the **behavioral capability** (research-before-building enforcement) is now lost.
- Impact: Coder agents will no longer be reminded to check for existing packages before implementing utility code (date parsing, HTTP wrappers, CLI argument parsing, etc.). This was a Tier 2 specialized skill that auto-activated for implementation tasks.
- Fix: Either (a) create a new lightweight skill (e.g., `research-before-building/SKILL.md`) that preserves the old "research before building" enforcement pattern for Coder agents, or (b) document this as an intentional removal if the new multi-type research workflow subsumes this use case. The new research skills (`research-codebase`, `research-external`, etc.) are designed for dedicated Researcher agents and do not serve the same purpose as the old skill.

### MEDIUM

**docs-framework Agent Persistence table not updated for new research-mode Synthesizer and Researcher** - `shared/skills/docs-framework/SKILL.md:112-123`
**Confidence**: 85%
- Problem: The docs-framework directory structure section (line 39-42) was updated to include `.docs/research/{topic-slug}/` paths, but the "Agents That Persist Artifacts" table (line 112-123) was not updated to include the Researcher agent (writes to `OUTPUT_PATH`) or the Synthesizer in research mode (writes to `${RESEARCH_BASE_DIR}/research-summary.md`). These are both disk-persisting agents that should be documented in the persistence table for consistency.
- Fix: Add two rows to the persistence table:
  ```markdown
  | Researcher | `.docs/research/{topic-slug}/{timestamp}/{type}.md` | Creates new in timestamped dir |
  | Synthesizer (research) | `.docs/research/{topic-slug}/{timestamp}/research-summary.md` | Creates new in timestamped dir |
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**SHADOW_RENAMES removal of `search-first -> research` leaves orphan shadow directories on existing installs** - `src/cli/plugins.ts:484`
**Confidence**: 80%
- Problem: The entry `['search-first', 'research']` was removed from SHADOW_RENAMES because `research` no longer exists as a skill. However, users who had previously shadowed `search-first` (with a custom override at `~/.devflow/skills/search-first/`) will now have an orphan shadow directory that no longer gets renamed to anything. The `search-first` name is in LEGACY_SKILL_NAMES, so the old install path will be cleaned up, but the user's shadow override will remain silently unused with no migration path. This is consistent with ADR-001 (clean break philosophy, `applies ADR-001`), so this may be intentional. However, it should be documented if any users have custom research-before-building overrides.
- Impact: Low practical impact given the small user base, but shadow overrides are a mechanism for user customization that should degrade gracefully.
- Fix: No code fix needed if this is intentional per `applies ADR-001`. Consider adding a note to the release notes that the `research` skill was replaced by dedicated research-type skills and custom overrides of `search-first`/`research` will no longer be applied.

## Pre-existing Issues (Not Blocking)

No pre-existing regression issues identified.

## Suggestions (Lower Confidence)

- **Missing integration tests for RESEARCH and RELEASE intents** - `tests/integration/ambient-activation.test.ts` (Confidence: 70%) -- The ambient activation integration tests cover IMPLEMENT, EXPLORE, DEBUG, PLAN, REVIEW, RESOLVE, and PIPELINE intents at both GUIDED and ORCHESTRATED depth, but no tests were added for the new RESEARCH or RELEASE intents. While the classification rules and router tables were updated, there is no test verifying that prompts like "research caching strategies" or "release v1.2.3" correctly classify and load the expected skills.

- **No subagent-skill-preload test for Researcher agent** - `tests/integration/subagent-skill-preload.test.ts` (Confidence: 65%) -- The subagent skill preload tests cover Simplifier, Scrutinizer, Reviewer, Coder, Designer, and Git agents but do not include the new Researcher agent. The Researcher agent declares `worktree-support`, `apply-decisions`, and `apply-feature-knowledge` in its frontmatter -- these preloads should be verified.

- **`devflow-release` plugin.json missing `release:orch` skill** - `plugins/devflow-release/.claude-plugin/plugin.json:23-27` (Confidence: 72%) -- The release plugin declares skills `agent-teams`, `git`, `worktree-support` but does not include `release:orch`. The ambient plugin does include it. Since the `/release` command needs the orchestration skill to function, and skills are universally installed anyway, this may be intentional (the orchestration skill is loaded by the command itself, not via plugin manifest). However, other command plugins (like `devflow-debug`) also don't include their orch skills in the plugin manifest, so this appears to follow the existing pattern.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The removal of the old `devflow:research` skill (research-before-building enforcement) without a replacement represents a lost capability for Coder agents. While the PR correctly introduces the new multi-type research workflow, it conflates a skill rename/replacement with a behavioral removal. The old skill served a different purpose (preventing Coder agents from reinventing utility code) than the new research skills (dedicated multi-type research workflows for Researcher agents). This should be either restored as a separate lightweight skill or explicitly documented as an intentional removal.
