# Consistency Review Report

**Branch**: track3/ambient-refinements -> main
**Date**: 2026-04-05_1702

## Issues in Your Changes (BLOCKING)

### CRITICAL

None.

### HIGH

None.

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

None.

## Suggestions (Lower Confidence)

- **Skill description style inconsistency** - `shared/skills/implement/SKILL.md`, `shared/skills/debug/SKILL.md`, `shared/skills/plan/SKILL.md`, `shared/skills/explore/SKILL.md`, `shared/skills/review/SKILL.md`, `shared/skills/resolve/SKILL.md`, `shared/skills/pipeline/SKILL.md` (Confidence: 65%) -- The orchestration skills use bare descriptions like "Agent orchestration for IMPLEMENT intent..." rather than the project convention of "This skill should be used when..." established by `docs/reference/skills-architecture.md` and followed by `router`, `patterns`, and `research`. Since these skills have `user-invocable: false` and are loaded by the router (not by Claude's auto-invocation from descriptions), the impact is low. However, if Claude Code ever starts matching descriptions more aggressively, the inconsistent phrasing could affect activation. The established pattern (`patterns`, `research`, `router` all use "This skill should be used when...") is more future-proof.

- **`removeLegacyAmbientHook` function name diverges from `removeAmbientHook` pattern** - `src/cli/commands/ambient.ts:16` (Confidence: 60%) -- Other hook modules use a single `remove*Hook` function that cleans up all variants (current + legacy). The ambient module now has two removal functions (`removeLegacyAmbientHook` and `removeAmbientHook`) while memory/learn/hud each have one. This is architecturally justified (addAmbientHook calls removeLegacyAmbientHook internally for migration), but the exported API surface is asymmetric. Minor concern since `removeLegacyAmbientHook` is only exported for testing.

- **`hasDevFlowBranding` helper used in tests but not documented in helpers module** - `tests/ambient.test.ts:350` (Confidence: 62%) -- The new `hasDevFlowBranding` test helper validates the `DevFlow:` prefix branding change, which is good. However, the `hasClassification` helper already checks for `DevFlow:` pattern presence. If `hasClassification` is sufficient, `hasDevFlowBranding` may be redundant. Low impact since test helpers are internal.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Consistency Score**: 9/10
**Recommendation**: APPROVED

## Detailed Analysis

### Rename Consistency: Thorough and Complete

The branch performs a large-scale rename of 9 skills and the hook script. The rename is applied consistently across all touchpoints:

| Old Name | New Name | Status |
|----------|----------|--------|
| `ambient-router` | `router` | Complete |
| `implementation-orchestration` | `implement` | Complete |
| `debug-orchestration` | `debug` | Complete |
| `plan-orchestration` | `plan` | Complete |
| `review-orchestration` | `review` | Complete |
| `resolve-orchestration` | `resolve` | Complete |
| `pipeline-orchestration` | `pipeline` | Complete |
| `implementation-patterns` | `patterns` | Complete |
| `search-first` | `research` | Complete |
| `ambient-prompt` (hook) | `preamble` (hook) | Complete |

Verified in: plugin.json manifests (3 plugins), plugins.ts DEVFLOW_PLUGINS array, SHADOW_RENAMES, LEGACY_SKILL_NAMES, agent frontmatter (coder.md, resolver.md), skill cross-references (router SKILL.md, TDD SKILL.md, pipeline SKILL.md, etc.), CLAUDE.md, README.md, reference docs (skills-architecture.md, file-organization.md), all test files (8 files), hook scripts, and command files (implement-teams.md, resolve-teams.md).

### Legacy Handling: Correct

All old names are properly added to `LEGACY_SKILL_NAMES` for cleanup of existing installs. `SHADOW_RENAMES` correctly maps old-to-new for user shadow overrides. Both bare and `devflow:`-prefixed variants are covered. The `CHANGELOG.md` references to old names are intentionally preserved (historical record).

### Hook Migration: Well-Designed

The `ambient-prompt` to `preamble` rename includes a clean migration path:
- `addAmbientHook` auto-removes legacy hook before adding new one
- `removeAmbientHook` cleans both legacy and current variants
- `hasAmbientHook` detects either variant
- Dedicated `removeLegacyAmbientHook` for targeted cleanup
- Init command has explicit legacy script cleanup (`LEGACY_HOOK_SCRIPTS = ['ambient-prompt']`)

### Branding: Consistent

The transition from `Ambient: INTENT/DEPTH` to `DevFlow: INTENT/DEPTH` is complete. Zero stale `Ambient:` classification strings remain in the codebase. All test assertions, preamble text, router SKILL.md examples, and README use the new `DevFlow:` prefix.

### Session-Start Hook: Clean Simplification

Removed the ambient skill injection from `session-start-memory` (Section 2). The router SKILL.md is now loaded via the Skill tool instead of being injected as additionalContext. This is a cleaner architecture -- the hook becomes single-purpose (memory only) and the skill loading follows the standard Skill tool path.

### Preamble: Appropriate Slimming

The preamble hook was reduced from a full skill mapping (with all intent-to-skill references inline) to a detection-only preamble that references `devflow:router` for the full mapping. This follows the separation of concerns principle and reduces the injected token count on every prompt.

### New Skills: Consistent with Existing Patterns

The new `explore` skill follows the same structure as other orchestration skills (Iron Law, phases, error handling, worktree support). The `patterns` and `research` skills are straight renames with the description updated to follow the "This skill should be used when..." convention.

### Test Updates: Complete

All 8 test files updated consistently. New tests added for legacy hook migration (6 tests in ambient.test.ts). Integration helpers refactored with `StreamResult` type and updated classification helpers. No stale assertions referencing old names remain.
