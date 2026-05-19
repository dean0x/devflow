# Documentation Review Report

**Branch**: refactor-rename-kb-to-knowledge -> main
**Date**: 2026-05-04

## Issues in Your Changes (BLOCKING)

### HIGH

**Incomplete rename: CLAUDE.md table and command roster still say "KB"** - `CLAUDE.md:24`, `CLAUDE.md:153`
**Confidence**: 90%
- Problem: The main Feature Knowledge Bases paragraph (line 49) was thoroughly updated to use "knowledge bases" instead of "KB", but two other locations in the same file were not updated:
  - Line 24: `| devflow-explore | Codebase exploration with KB creation | Optional |`
  - Line 153: `/explore -- Skimmer + Explore + Synthesizer + Knowledge (optional KB creation)`
  This creates an internal inconsistency within CLAUDE.md itself — the primary documentation paragraph says "knowledge bases" while the plugin table and command roster still say "KB".
- Fix: Update line 24 to `Codebase exploration with knowledge base creation` and line 153 to `(optional knowledge base creation)`.

**Incomplete rename: file-organization.md still uses "KB hooks" in two places** - `docs/reference/file-organization.md:45`, `docs/reference/file-organization.md:157`
**Confidence**: 92%
- Problem: Two lines in file-organization.md still use the old "KB" abbreviation, despite the file being touched by this PR to rename the hook and script entries:
  - Line 45: `# Working Memory + ambient + learning + KB hooks`
  - Line 157: `+ Learning SessionEnd hook + KB SessionEnd hook`
  These were updated in other places (hook names, file names) but the inline comments were missed.
- Fix: Replace `KB hooks` with `knowledge base hooks` and `KB SessionEnd hook` with `knowledge base SessionEnd hook`.

**Incomplete rename: explore plugin.json description still says "KB creation"** - `plugins/devflow-explore/.claude-plugin/plugin.json:3`
**Confidence**: 90%
- Problem: The plugin.json `description` field still reads `"Codebase exploration with structured analysis and optional KB creation"`. This is a user-visible string (shown during `devflow list` and in the marketplace). The same string in `src/cli/plugins.ts:89` is also unchanged.
- Fix: Update both to `"Codebase exploration with structured analysis and optional knowledge base creation"`.

**Incomplete rename: explore plugin README retains "KB" in 3 locations** - `plugins/devflow-explore/README.md:3`, `plugins/devflow-explore/README.md:35`, `plugins/devflow-explore/README.md:70`
**Confidence**: 90%
- Problem: The README was partially updated (skills list on lines 52-53 now says `feature-knowledge`), but the prose descriptions were not:
  - Line 3: `...with optional feature KB creation.`
  - Line 35: `5. **KB Creation** - Optionally create a feature KB to capture discovered patterns`
  - Line 70: `- Building feature KBs for areas you've explored`
- Fix: Replace "KB creation" with "knowledge base creation", "feature KB" with "feature knowledge base", and "feature KBs" with "feature knowledge bases".

**Incomplete rename: init.ts summary display says "Feature KBs"** - `src/cli/commands/init.ts:434`
**Confidence**: 85%
- Problem: The recommended-mode summary output still displays `Feature KBs:     enabled/disabled`. While this is user-facing terminal output (not documentation per se), it is part of the documentation surface the user sees during installation.
- Fix: Update to `Feature KBs:` to `Knowledge:` or `Feature knowledge:` for consistency with the CLI flag name `--knowledge`.

### MEDIUM

**Inconsistent abbreviation "KB" retained in prose across ~53 locations in command files, skills, and agents** (consolidated)
**Confidence**: 82%
- Locations (representative sample):
  - `plugins/devflow-implement/commands/implement.md`: 10 occurrences (e.g., "Feature KB Generation", "New KB creation", "matching KB")
  - `plugins/devflow-implement/commands/implement-teams.md`: 10 occurrences
  - `plugins/devflow-explore/commands/explore.md`: 9 occurrences
  - `plugins/devflow-explore/commands/explore-teams.md`: 7 occurrences
  - `shared/skills/implement:orch/SKILL.md`: 9 occurrences (e.g., line 165 "Phase 8: Feature KB Generation")
  - `shared/skills/feature-knowledge/SKILL.md`: 9 occurrences
  - `shared/skills/apply-feature-knowledge/SKILL.md`: 9 occurrences
  - `shared/agents/knowledge.md`: 4 occurrences
  - All other command and skill files: ~20+ additional occurrences
- Problem: The PR updated all code identifiers (file names, CLI flags, skill names, script paths) but left the "KB" abbreviation intact in prose/comments throughout commands, skills, and agents. This is arguably intentional since "KB" is a well-understood abbreviation for "knowledge base" and acceptable in prose. However, the CLAUDE.md paragraph was explicitly expanded from "KB" to "knowledge base" in prose, creating a mixed standard. The project should decide on one convention: either "KB" is acceptable as a prose abbreviation everywhere, or it should be "knowledge base" everywhere.
- Fix: Either (a) accept "KB" as valid prose shorthand and revert the CLAUDE.md paragraph expansions to match, or (b) do a second pass replacing "KB"/"KBs" with "knowledge base"/"knowledge bases" in all prose. Option (b) is more consistent with the PR's stated intent.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **CLAUDE.md Two-Mode Init paragraph still references `--kb/--no-kb`** - `CLAUDE.md` (Confidence: 65%) — The Two-Mode Init paragraph at line 51 lists recommended defaults but the `--kb/--no-kb` flags were renamed to `--knowledge/--no-knowledge`. The paragraph itself was not changed in this PR, but if CLAUDE.md is the source of truth, it may be stale. Needs verification against the actual init.ts flag definitions (which were changed).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 5 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Documentation Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The core identifier rename (file paths, skill names, CLI commands, frontmatter) is thorough and well-executed with proper backward compatibility (manifest fallback, migration, legacy skill cleanup). However, the documentation update is incomplete: CLAUDE.md, file-organization.md, the explore plugin README, and the explore plugin.json retain stale "KB" references that create inconsistency with the updated prose in the main CLAUDE.md paragraph. The 5 HIGH-severity blocking issues are straightforward find-and-replace fixes. The MEDIUM-severity consolidated issue (53+ remaining "KB" in prose) requires a project-level decision on whether "KB" remains an acceptable abbreviation in prose contexts.
