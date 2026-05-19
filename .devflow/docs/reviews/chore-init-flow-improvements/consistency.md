# Consistency Review Report

**Branch**: chore/init-flow-improvements -> main
**Date**: 2026-03-22

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent "(Recommended)" signaling across prompt types** - `src/cli/commands/init.ts:276,304,333,356`
**Confidence**: 85%
- Problem: The `p.confirm` prompts for memory (line 333) and HUD (line 356) include "(Recommended)" in the message text, while the `p.select` prompts for Agent Teams (line 276) and Ambient (line 304) instead put "Recommended" in the hint of the recommended option. This is a mixed signaling approach within the same prompt flow. Additionally, the safe-delete prompt (line 513) has no "(Recommended)" even though `initialValue: true` suggests it is.
- Fix: Choose one pattern and apply it consistently. Since `p.confirm` does not have per-option hints, the `(Recommended)` in the message is the right approach there. For `p.select`, moving the recommendation to the hint is also fine. But the safe-delete `p.confirm` at line 513 should include "(Recommended)" if it follows the confirm pattern used by memory and HUD:
```typescript
// Line 513 — match the pattern from lines 333 and 356:
message: `Install safe-delete to ${profilePath}? (Recommended, uses ${trashCmd ?? 'recycle bin'})`,
```

### MEDIUM

**Inconsistent `p.note` usage before prompts** - `src/cli/commands/init.ts:429,465`
**Confidence**: 82%
- Problem: For user-scope claudeignore with discovered projects, two `p.note` calls appear before the prompt (lines 429 and 441) -- one for the feature description and one listing the projects. For user-scope with no discovered projects (line 451), only the feature-description `p.note` from line 429 appears. For local scope (line 465), there is a separate `p.note`. All other features (Teams, Ambient, Memory, HUD, Security) follow a single `p.note` + prompt pattern. The claudeignore section breaks this one-note-per-prompt convention.
- Fix: This is understandable given the project discovery UI, but consider combining the feature description and project list into a single `p.note` call to reduce visual noise and match the rest of the flow.

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

_No issues found._

## Suggestions (Lower Confidence)

- **Removed `buildExtrasOptions` and `ExtraId` type exports without deprecation** - `src/cli/commands/init.ts` (Confidence: 65%) -- These were exported public types/functions. If any external consumers relied on them, removal is a breaking change. Since this is an internal CLI tool, impact is likely zero, but the pattern of removing exported symbols without deprecation is worth noting for future reference.

- **Hardcoded `pluginHints` map duplicates plugin knowledge** - `src/cli/commands/init.ts:218-233` (Confidence: 70%) -- The `pluginHints` map introduces a second source of hint text alongside `PluginDefinition.description`. If a new plugin is added to `DEVFLOW_PLUGINS` but not to `pluginHints`, it silently falls back to `pl.description` via the `??` operator. This is handled gracefully but could lead to inconsistent display if forgotten.

- **Test removal of re-export smoke tests** - `tests/init-logic.test.ts` (Confidence: 60%) -- The removed `ambient hook re-exports from init` and `memory hook re-exports from init` describe blocks tested that re-exports were wired correctly. Since the re-exports still exist at lines 34-36 of init.ts, removing the tests reduces coverage of the re-export wiring. Low risk since TypeScript compilation would catch broken re-exports.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The refactoring significantly improves consistency by moving from a multi-select "extras" approach to individual per-feature prompts, each following a `p.note` + `p.select/confirm` pattern. The new "prompts first, actions second" architecture is a clear improvement. The only blocking concern is minor inconsistency in how "Recommended" is communicated across the different prompt types -- easily fixed in a follow-up pass.
