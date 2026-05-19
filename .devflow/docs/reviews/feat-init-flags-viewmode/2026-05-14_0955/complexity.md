# Complexity Review Report

**Branch**: feat/init-flags-viewmode -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

### HIGH

**Inline settings.json parsing adds a 4th JSON parse/serialize path in the recommended flow** - `src/cli/commands/init.ts:440-450`
**Confidence**: 82%
- Problem: The recommended path now reads and parses `settings.json` inline (lines 440-450) to detect the existing `viewMode`, using a separate try/catch block with its own `JSON.parse`. Later (lines 1103-1108), the same file is parsed again by `stripViewMode` and `applyViewMode`, which each do their own `JSON.parse`/`JSON.stringify` round-trip. This means the viewMode preservation logic adds a redundant I/O + parse step that is disconnected from the main settings mutation block at lines 1073-1118. Within that main block, the settings JSON is already loaded into `content` -- the viewMode could be extracted from that string without a separate read.
- Fix: Instead of reading settings.json early in the recommended path, detect the existing viewMode from the `content` variable inside the settings mutation block (lines 1073-1118) before `stripViewMode` is called:
```typescript
// Inside the settings mutation block, before stripViewMode:
try {
  const currentParsed = JSON.parse(content) as Record<string, unknown>;
  if (currentParsed.viewMode === 'verbose' || currentParsed.viewMode === 'focus') {
    viewMode = currentParsed.viewMode;
  }
} catch { /* ignore */ }

content = stripViewMode(content);
content = applyViewMode(content, viewMode);
```
This eliminates a separate `fs.readFile` and consolidates all settings.json mutations into one block.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**init action handler is 1134 lines with ~188 control flow statements** - `src/cli/commands/init.ts:165-1298`
**Confidence**: 85%
- Problem: The single `.action(async ...)` handler in `init.ts` is 1134 lines long with approximately 188 control flow statements (if/else/for/while/catch). This is CRITICAL by the complexity skill's severity guidelines (>200 lines, complexity well above 20). This PR adds ~35 more lines (viewMode preservation block, viewMode selector prompt, viewMode summary line, viewMode manifest field, and viewMode strip/apply calls), continuing the pattern of feature accretion inside a monolithic function. Each new feature (teams, ambient, memory, learn, hud, knowledge, decisions, rules, flags, and now viewMode) follows the same if-recommended-then-default / else-if-advanced-then-prompt pattern, but they are not factored into extractable units.
- Fix: This is not blocking for this PR -- the function was already well past critical thresholds before this change. However, the repeated pattern (feature default in recommended path + prompt in advanced path + hook toggle + manifest field) is a clear candidate for extraction. A registry-driven approach (similar to `FLAG_REGISTRY`) for boolean features would collapse ~500 lines of repetitive prompt/default logic into a data-driven loop. Consider as follow-up work.

## Pre-existing Issues (Not Blocking)

### HIGH

**Repeated JSON parse/serialize round-trips in the settings mutation block** - `src/cli/commands/init.ts:1073-1118`
**Confidence**: 88%
- Problem: The settings mutation block at lines 1073-1118 chains multiple operations that each potentially parse and serialize JSON internally (`stripFlags`, `applyFlags`, `stripViewMode`, `applyViewMode`). The `applyFlags` and `stripFlags` functions in `flags.ts` each call `JSON.parse(settingsJson)` and `JSON.stringify(settings)`. With the new `stripViewMode` + `applyViewMode` calls, there are now at least 4 JSON parse/serialize round-trips in this block (stripFlags, applyFlags, stripViewMode, applyViewMode), on top of whatever the hook toggle functions do. This is not a performance bottleneck (it runs once during init), but it is a maintainability concern -- each function operates on a serialized string instead of a shared parsed object.
- Fix: Long-term, refactor the settings mutation functions to accept/return a parsed object (`Record<string, unknown>`) and do a single `JSON.stringify` at the end. This would eliminate all intermediate serialization.

## Suggestions (Lower Confidence)

- **`viewMode` type is `string` in ManifestData but constrained to 3 values in init.ts** - `src/cli/utils/manifest.ts:22` (Confidence: 72%) -- The `viewMode?: string` type in `ManifestData` accepts any string, but the init flow constrains it to `'default' | 'verbose' | 'focus'`. A union type would provide compile-time safety against typos. Similarly, `applyViewMode` in `flags.ts:222` accepts `mode: string` rather than the constrained union.

- **View mode values repeated in 3 locations without a shared constant** - `src/cli/commands/init.ts:385,447,709`, `src/cli/utils/flags.ts:224` (Confidence: 65%) -- The valid view mode values (`'default'`, `'verbose'`, `'focus'`) appear as string literals in the init recommended path, the init advanced path, and in `applyViewMode`. A shared `VIEW_MODES` constant or type would reduce drift risk.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | - | 1 | - | - |
| Should Fix | - | - | 1 | - |
| Pre-existing | - | 1 | - | - |

**Complexity Score**: 5/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The new code follows the established patterns in the file and adds modest complexity (3 new flag entries in the registry, ~35 lines of viewMode integration). The individual additions are clean and well-structured. The blocking HIGH issue (redundant settings.json read in recommended path) should be consolidated before merge. The monolithic init handler and repeated JSON round-trips are pre-existing concerns that predate this PR -- they should not block merge but warrant follow-up extraction. applies ADR-001 -- no migration/compat code was added for the new viewMode field, consistent with the clean-break philosophy.
