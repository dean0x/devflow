# Regression Review Report

**Branch**: refactor/rename-knowledge-to-decisions -> main
**Date**: 2026-05-03

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Missing `.gitignore` entry for shared `knowledge.md` agent** - `.gitignore` (root)
**Confidence**: 85%
- Problem: The new file `plugins/devflow-explore/agents/knowledge.md` was committed to git, but the root `.gitignore` does not include `plugins/*/agents/knowledge.md`. All other shared agents (`git.md`, `synthesizer.md`, `skimmer.md`, `simplifier.md`, `coder.md`, `reviewer.md`, `resolver.md`, `evaluator.md`, `tester.md`, `scrutinizer.md`, `validator.md`, `designer.md`) have explicit gitignore entries. The `knowledge.md` agent lives in `shared/agents/` (single source of truth) and should be distributed by the build system, not committed per-plugin.
- Fix: Add `plugins/*/agents/knowledge.md` to the root `.gitignore` alongside the other shared agent entries, then `git rm --cached plugins/devflow-explore/agents/knowledge.md` (and any other plugins that have it committed). The ambient and plan plugin copies are also tracked but pre-exist this PR.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### LOW

**`knowledge.md` agent tracked in ambient and plan plugins** - `plugins/devflow-ambient/agents/knowledge.md`, `plugins/devflow-plan/agents/knowledge.md`
**Confidence**: 80%
- Problem: These files pre-date this PR but are also not gitignored. Same root cause as the blocking issue above -- the `knowledge.md` shared agent was never added to `.gitignore` when it was first introduced. This PR modifies them (updating `apply-knowledge` to `apply-decisions` in frontmatter), which makes it visible but not blocking.
- Fix: Addressed by the same `.gitignore` addition recommended above.

## Suggestions (Lower Confidence)

- **Remaining "Knowledge Citations" section heading in resolve output** - `plugins/devflow-resolve/commands/resolve.md:325`, `CLAUDE.md:152` (Confidence: 60%) -- The `## Knowledge Citations` section name in resolution summaries was intentionally left unchanged (it refers to the concept of citing knowledge/decisions, not the filesystem path). However, for full naming consistency, renaming to "Decisions Citations" could be considered in a follow-up.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 1 |

**Regression Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Detailed Assessment

This is an exceptionally thorough rename refactoring across 84 files. The migration is comprehensive and well-tested:

**Completeness of Rename (verified exhaustively)**:
- All `KNOWLEDGE_CONTEXT` variable references in source files renamed to `DECISIONS_CONTEXT` -- zero remaining
- All `knowledge-context.cjs` references renamed to `decisions-index.cjs` -- zero remaining
- All `knowledge-usage-scan.cjs` references renamed to `decisions-usage-scan.cjs` -- zero remaining
- All `apply-knowledge` skill references in agent frontmatter renamed to `apply-decisions` -- zero remaining
- All `knowledge-persistence` skill references renamed to `decisions-format` -- zero remaining
- All `.memory/knowledge/` directory paths in source renamed to `.memory/decisions/` -- only the migration itself references the old path (correct)
- All `.knowledge.lock` / `.knowledge-usage.json` / `.knowledge-usage.lock` paths renamed -- zero remaining
- All internal function names (`initKnowledgeContent`, `nextKnowledgeId`, `sliceKnowledgeSection`, `acquireKnowledgeUsageLock`, etc.) renamed to `Decisions` variants -- zero remaining
- CLI subcommand `knowledge-append` renamed to `decisions-append` -- zero remaining callers of old name
- `updateKnowledgeStatus` function renamed to `updateDecisionsStatus` -- all callers updated

**Migration Safety**:
- `MIGRATION_RENAME_KNOWLEDGE_TO_DECISIONS` handles: directory rename, lock file renames, manifest path rewriting, learning log path rewriting
- Idempotent (tested), handles partial state, handles empty manifest
- 11 dedicated migration tests all pass
- 83 decisions-related tests all pass
- Old skill names correctly added to `LEGACY_SKILL_NAMES` for cleanup on `devflow init`

**Non-regression Areas**:
- The `knowledge` agent (for feature KBs) was correctly left as-is -- it refers to the agent type, not the decisions system
- Feature KB terminology (`FEATURE_KNOWLEDGE`, `feature-kb`, `KNOWLEDGE.md`) correctly left unchanged -- different feature
- `## Knowledge Citations` section heading intentionally preserved -- output format stability
- No exports removed, no return types changed, no CLI options dropped
