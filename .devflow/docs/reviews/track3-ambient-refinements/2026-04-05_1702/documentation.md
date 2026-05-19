# Documentation Review Report

**Branch**: track3/ambient-refinements -> main
**Date**: 2026-04-05

## Issues in Your Changes (BLOCKING)

### HIGH

**Skill count "38" is now stale -- should be "39"** (4 occurrences) -- Confidence: 95%
- `CLAUDE.md:53`, `README.md:51`, `README.md:64`, `docs/reference/file-organization.md:12`
- Problem: The branch adds a new `explore` skill (`shared/skills/explore/SKILL.md`), bringing the total from 38 to 39. All four documentation locations still say "38 skills".
- Fix: Update "38 skills" to "39 skills" in:
  - `CLAUDE.md:53` -- `# 38 skills (single source of truth)` -> `# 39 skills (single source of truth)`
  - `README.md:51` -- `**38 skills grounded in expert material.**` -> `**39 skills grounded in expert material.**`
  - `README.md:64` -- `38 skills` -> `39 skills` (HUD example)
  - `docs/reference/file-organization.md:12` -- `# SINGLE SOURCE OF TRUTH (38 skills)` -> `# SINGLE SOURCE OF TRUTH (39 skills)`

**New `explore` skill missing from skills-architecture.md tier catalog** -- `docs/reference/skills-architecture.md`
**Confidence**: 92%
- Problem: The new `explore` orchestration skill is listed in CLAUDE.md's orchestration skills section (line 150: "implement, explore, debug, plan, review, resolve, pipeline") and exists on disk at `shared/skills/explore/SKILL.md`, but `docs/reference/skills-architecture.md` does not include it in the Tier 1 Foundation Skills table where all other orchestration skills are listed.
- Fix: Add a row to the Tier 1 Foundation Skills table in `docs/reference/skills-architecture.md`:
  ```
  | `explore` | Codebase analysis, flow tracing, architecture mapping | Ambient EXPLORE intent |
  ```

### MEDIUM

**Preamble still says "AMBIENT MODE ENABLED"** -- `scripts/hooks/preamble:37`
**Confidence**: 82%
- Problem: The branch renames "ambient" terminology to "DevFlow" throughout (README.md removes "Ambient:" prefix from the example output, router skill says "DevFlow mode", etc.), but the preamble hook still injects the text `"AMBIENT MODE ENABLED: Classify user intent and depth."` This is inconsistent with the rebranding direction of this PR.
- Fix: Consider updating to `"DEVFLOW MODE ENABLED: Classify user intent and depth."` to match the new branding. Requires updating corresponding test assertion in `tests/ambient.test.ts`.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**CLAUDE.md Orchestration skills count says "(7)" but lists 7 -- correct, but verify against previous "(6)"** -- `CLAUDE.md:150`
**Confidence**: 85%
- Problem: The previous text said "(6)" and listed 6 skills (without `explore`). The updated text says "(7)" and lists 7 skills (with `explore`). The count is correct, but the corresponding Tier 1 Foundation Skills table in `docs/reference/skills-architecture.md` (which this branch touches) was not updated with the new `explore` entry. This creates an inconsistency between the two reference locations.
- Fix: Already covered in the blocking issue above -- add `explore` to `docs/reference/skills-architecture.md`.

## Pre-existing Issues (Not Blocking)

### LOW

**CHANGELOG.md references old skill names** -- `CHANGELOG.md:113,124,134,217,279`
**Confidence**: 90%
- Problem: CHANGELOG.md contains historical references to `ambient-router`, `implementation-orchestration`, `debug-orchestration`, `plan-orchestration`, `search-first`. These are accurate historical records of what was released at the time.
- Note: CHANGELOG entries are historical records and should NOT be updated to reflect renames. This is informational only -- no action needed.

## Suggestions (Lower Confidence)

- **`router` skill description still says "DevFlow mode"** -- `shared/skills/router/SKILL.md:3` (Confidence: 65%) -- The skill description says "classifying user intent for DevFlow mode" but the old description said "ambient mode". While "DevFlow mode" is the new branding, the `devflow ambient --enable` CLI command still uses "ambient" terminology. Consistent naming across CLI and skills would reduce user confusion.

- **`plugins/devflow-ambient/README.md` GUIDED skills table references could add `explore` row** -- `plugins/devflow-ambient/README.md` (Confidence: 62%) -- The GUIDED Behavior table shows IMPLEMENT, DEBUG, PLAN, REVIEW rows but does not include an EXPLORE row, even though the router skill now supports EXPLORE as a first-class GUIDED intent. Minor completeness gap.

- **`session-start-memory` hook comment references may need updating** -- `scripts/hooks/session-start-memory` (Confidence: 60%) -- This file was changed in the diff but primarily for functional changes. Internal comments may still reference "ambient-prompt" patterns.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 1 |

**Documentation Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The skill renames and documentation updates are thorough and consistent across CLAUDE.md, README.md, plugin manifests, plugin READMEs, and reference docs. The main gap is the stale skill count ("38" should be "39" after adding the `explore` skill) appearing in four locations, and the missing `explore` entry in the skills-architecture.md tier catalog. Both are straightforward fixes. The preamble branding inconsistency ("AMBIENT MODE" vs "DevFlow") is a minor point worth considering but not blocking.
