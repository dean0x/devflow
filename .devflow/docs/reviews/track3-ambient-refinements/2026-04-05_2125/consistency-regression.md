# Consistency & Regression Review Report

**Branch**: track3/ambient-refinements -> main
**Date**: 2026-04-05
**Scope**: All uncommitted changes (75 files, 8 renamed skill directories, 1 renamed skill)

## Issues in Your Changes (BLOCKING)

### CRITICAL

_None found._

### HIGH

_None found._

### MEDIUM

_None found._

## Issues in Code You Touched (Should Fix)

_None found._

## Pre-existing Issues (Not Blocking)

_None found._

## Suggestions (Lower Confidence)

_None. All checks passed with high confidence._

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

## Detailed Verification Results

### 1. Naming Consistency (8 renamed skills)

All 8 renames have been applied consistently across every file type:

| Old Name | New Name | Status |
|----------|----------|--------|
| `implement` (skill) | `implement:orch` | CLEAN |
| `debug` (skill) | `debug:orch` | CLEAN |
| `explore` (skill) | `explore:orch` | CLEAN |
| `plan` (skill) | `plan:orch` | CLEAN |
| `review` (skill) | `review:orch` | CLEAN |
| `resolve` (skill) | `resolve:orch` | CLEAN |
| `pipeline` (skill) | `pipeline:orch` | CLEAN |
| `self-review` (skill) | `quality-gates` | CLEAN |

**Files verified**: All 75 modified files, plus deep scans of:
- `shared/skills/*/SKILL.md` and `shared/skills/*/references/*.md` -- zero stale `devflow:implement`, `devflow:debug`, `devflow:plan`, `devflow:review`, `devflow:resolve`, `devflow:pipeline`, `devflow:explore`, or `devflow:self-review` as skill references
- `shared/agents/*.md` -- scrutinizer.md correctly uses `devflow:quality-gates`
- `src/cli/plugins.ts` -- all plugin `skills` arrays use new names
- `plugins/*/plugin.json` -- all manifests use new names
- `plugins/*/README.md` -- all updated
- `shared/skills/router/SKILL.md` -- all 14 skill table rows use `:orch` suffix
- `shared/skills/router/references/skill-catalog.md` -- all 12 table entries use `:orch` suffix, selection limits paragraph updated
- `scripts/hooks/preamble` -- uses `Devflow:` branding, references `devflow:router`
- `tests/*.ts` -- all assertions updated

**Note on `self-review` in COMMAND_REFS**: `tests/skill-references.test.ts:135` lists `'self-review'` in `COMMAND_REFS` -- this is correct because `/self-review` is still a valid command name (the plugin `devflow-self-review` exists). It is not being used as a skill reference.

**Note on `devflow:self-review` in LEGACY_SKILL_NAMES**: `src/cli/plugins.ts:373` lists `'devflow:self-review'` -- this is correct migration/cleanup data for removing the old installed skill during `devflow init`.

### 2. Array/List Consistency (plugin.json vs plugins.ts)

Every plugin's `plugin.json` skills array exactly matches the corresponding entry in `src/cli/plugins.ts`:

| Plugin | plugin.json | plugins.ts | Match |
|--------|------------|------------|-------|
| devflow-core-skills | 7 skills | 7 skills | EXACT |
| devflow-implement | 6 skills (incl. quality-gates) | 6 skills | EXACT |
| devflow-self-review | 3 skills (incl. quality-gates) | 3 skills | EXACT |
| devflow-ambient | 23 skills (incl. 7 :orch) | 23 skills | EXACT |
| devflow-code-review | 14 skills | 14 skills | EXACT |
| devflow-specify | 1 skill | 1 skill | EXACT |
| devflow-resolve | 5 skills | 5 skills | EXACT |
| devflow-debug | 4 skills | 4 skills | EXACT |

**Validated by**: `npm test` -- tests `skill-references.test.ts` Format 1 explicitly checks bidirectional match.

### 3. Count Consistency

| Count | Expected | CLAUDE.md | README.md | CONTRIBUTING.md | file-organization.md | Status |
|-------|----------|-----------|-----------|-----------------|---------------------|--------|
| Skills | 39 | 39 | 39 (x2) | 39 | 39 | CLEAN |
| Agents | 11 | 11 | - | 11 | 11 | CLEAN |
| Plugins | 17 | 17 | 17 | 17 | 17 | CLEAN |

**Verified by**: `ls shared/skills/ | wc -l` = 39; `getAllSkillNames().length` = 39.

### 4. Regex Consistency (colon handling)

All regex patterns that extract skill names properly handle colons:

| File | Line | Pattern | Handles `:` |
|------|------|---------|-------------|
| `tests/skill-references.test.ts` | 25 | `([\w:-]+)` | YES |
| `tests/skill-references.test.ts` | 31 | `([\w:-]+)` | YES |
| `tests/skill-references.test.ts` | 37 | `([\w:-]+)` | YES |
| `tests/skill-references.test.ts` | 60 | `([\w:-]+)` | YES |
| `tests/skill-references.test.ts` | 68 | `([\w:-]+)` | YES |
| `tests/skill-references.test.ts` | 80 | `([\w:-]+)` | YES |
| `tests/skill-references.test.ts` | 300 | `([\w:-]+)` | YES |
| `tests/integration/helpers.ts` | 3 | Classification pattern | N/A (intent names) |

**Two patterns use `[\w-]+` (no colon)**: Lines 823 and 835 in `skill-references.test.ts` parse reviewer Focus Areas and code-review command focus tables. These parse pattern skill names (`security`, `architecture`, etc.) which never contain colons. No issue.

### 5. Cross-Reference Consistency (router vs skill-catalog)

Every `devflow:X` reference in `shared/skills/router/SKILL.md` appears in `shared/skills/router/references/skill-catalog.md` and vice versa. Both files reference the same 7 orchestration skills with `:orch` suffix, the same 15 knowledge skills, and the same 11 excluded skills.

**Validated by**: `npm test` -- tests Format 8 (`Skill cross-references within shared/skills/`) passes for all skill directories including `router`.

### 6. Test Data Consistency

All test assertions use the correct new skill names:

| Test File | What's Tested | Status |
|-----------|--------------|--------|
| `tests/ambient.test.ts` | Classification markers use `Devflow:`, `devflow:quality-gates`, `devflow:debug:orch` | CLEAN |
| `tests/plugins.test.ts` | `review:orch`, `resolve:orch`, `pipeline:orch`, `quality-gates` assertions | CLEAN |
| `tests/skill-references.test.ts` | Dynamically derives valid names from `getAllSkillNames()` | CLEAN |
| `tests/integration/helpers.ts` | Preamble synced with `Devflow:` branding | CLEAN |
| `tests/integration/ambient-activation.test.ts` | `explore:orch`, `implement:orch`, `quality-gates`, `resolve:orch`, `pipeline:orch` | CLEAN |
| `tests/hud.test.ts` | `Devflow` branding | CLEAN |
| `tests/safe-delete-install.test.ts` | `Devflow safe-delete` markers | CLEAN |

### 7. Branding Consistency (DevFlow -> Devflow)

Comprehensive grep for `DevFlow` (capital F) finds zero matches across all `.md`, `.ts`, `.json`, and `.sh` files. All 75 files have been updated to use `Devflow`.

### 8. Legacy Migration Data

`LEGACY_SKILL_NAMES` and `SHADOW_RENAMES` arrays in `src/cli/plugins.ts` correctly include:
- Old bare names (`implement`, `debug`, `plan`, `review`, `resolve`, `pipeline`, `self-review`)
- Old prefixed names (`devflow:implement`, `devflow:debug`, etc., `devflow:self-review`)
- New bare `:orch` names for pre-namespace installs (`implement:orch`, etc., `quality-gates`)
- All prior rename chains (implementation-orchestration -> implement:orch, etc.)

**Validated by**: `npm test` -- SHADOW_RENAMES consistency tests verify every old name exists in LEGACY_SKILL_NAMES and every new name exists in `getAllSkillNames()`.

### 9. Filesystem Verification

- `shared/skills/self-review/` -- DELETED (confirmed not found)
- `shared/skills/quality-gates/` -- EXISTS with SKILL.md + references/ (4 files)
- 7 renamed directories (`implement:orch`, `debug:orch`, `explore:orch`, `plan:orch`, `review:orch`, `resolve:orch`, `pipeline:orch`) -- all exist
- Total skill directories: 39 (matches all documentation)

### 10. Test Suite

All 590 tests pass across 23 test files. No regressions detected.

**Consistency Score**: 10/10
**Regression Score**: 10/10
**Recommendation**: APPROVED

This is an exceptionally thorough rename. Every reference across 75 files has been updated consistently. The migration/cleanup data in LEGACY_SKILL_NAMES and SHADOW_RENAMES correctly covers all prior name chains. The test suite validates cross-file consistency dynamically using `getAllSkillNames()` rather than hardcoded values, making it rename-proof. No stale references, no broken regex patterns, no count mismatches detected.
