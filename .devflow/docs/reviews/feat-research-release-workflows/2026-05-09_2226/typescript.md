# TypeScript Review Report

**Branch**: feat/research-release-workflows -> main
**Date**: 2026-05-09

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing `devflow:research` entry in LEGACY_SKILL_NAMES for namespaced cleanup** - `src/cli/plugins.ts:436`
**Confidence**: 85%
- Problem: The old monolithic `research` skill was removed from `devflow-core-skills` and replaced by 5 specialized research-type skills. The new LEGACY_SKILL_NAMES section (lines 436-443) adds bare names for the new skills (`research-codebase`, etc.) but does not add `'devflow:research'` to clean up the deleted skill's namespaced install path (`~/.claude/skills/devflow:research/`). The existing `'research'` entry at line 395 only cleans up the bare `~/.claude/skills/research/` path. The `init.ts` cleanup code (line 908) uses raw strings from LEGACY_SKILL_NAMES without calling `prefixSkillName()`, so the stale `devflow:research/` directory will persist after upgrade.
- Fix: Add `'devflow:research'` to the new legacy section:
```typescript
// v2.x research + release: new bare names for pre-namespace installs
'research-codebase',
'research-external',
'research-market',
'research-competitor',
'research-technology',
'research:orch',
'release:orch',
// v2.x research deletion: prefixed old name for cleanup
'devflow:research',
```

## Issues in Code You Touched (Should Fix)

No issues found.

## Pre-existing Issues (Not Blocking)

No issues found.

## Suggestions (Lower Confidence)

- **`SHADOW_RENAMES` removal leaves no migration path for `search-first` shadow overrides** - `src/cli/plugins.ts:484` (Confidence: 65%) -- The `['search-first', 'research']` entry was removed because the `research` target no longer exists. Users with a shadow override at `~/.devflow/skills/search-first/` will no longer have it migrated to anything. This is likely fine since shadow overrides are rare and `search-first` was renamed long ago, but a comment explaining why the entry was removed rather than retargeted could aid future maintainers.

- **No RESEARCH/RELEASE ambient-activation integration tests** - `tests/integration/ambient-activation.test.ts` (Confidence: 60%) -- The test file adds no test cases for the new RESEARCH or RELEASE intents at either GUIDED or ORCHESTRATED depth, despite adding `research:orch` and `release:orch` to the ambient plugin. Existing tests cover IMPLEMENT, REVIEW, RESOLVE, EXPLORE, DEBUG, PLAN, and PIPELINE. Missing coverage for the two new intents means ambient classification regressions for research/release prompts would go undetected.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: CHANGES_REQUESTED
