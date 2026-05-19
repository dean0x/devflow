# Complexity Review Report

**Branch**: track3/ambient-refinements -> main
**Date**: 2026-04-05

## Issues in Your Changes (BLOCKING)

### CRITICAL

_None_

### HIGH

_None_

### MEDIUM

**Code duplication between `removeLegacyAmbientHook` and `removeAmbientHook`** - `src/cli/commands/ambient.ts:16-41` and `src/cli/commands/ambient.ts:91-118`
**Confidence**: 85%
- Problem: `removeLegacyAmbientHook` and `removeAmbientHook` share nearly identical structure: parse JSON, check for `UserPromptSubmit`, filter by command marker, check if length changed, clean empty arrays/objects, return serialized JSON. The only difference is the filter predicate (one checks `LEGACY_HOOK_MARKER` only, the other checks both `PREAMBLE_HOOK_MARKER` and `LEGACY_HOOK_MARKER`). This 25-line pattern is repeated verbatim.
- Fix: Extract a shared `filterHooksByPredicate` helper that accepts the filter function, then both functions become one-liners delegating to it:
```typescript
function filterHookEntries(
  settingsJson: string,
  shouldRemove: (command: string) => boolean,
): string {
  const settings: Settings = JSON.parse(settingsJson);
  if (!settings.hooks?.UserPromptSubmit) return settingsJson;

  const before = settings.hooks.UserPromptSubmit.length;
  settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
    (matcher) => !matcher.hooks.some((h) => shouldRemove(h.command)),
  );

  if (settings.hooks.UserPromptSubmit.length === before) return settingsJson;
  if (settings.hooks.UserPromptSubmit.length === 0) delete settings.hooks.UserPromptSubmit;
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;

  return JSON.stringify(settings, null, 2) + '\n';
}

export function removeLegacyAmbientHook(settingsJson: string): string {
  return filterHookEntries(settingsJson, (cmd) => cmd.includes(LEGACY_HOOK_MARKER));
}

export function removeAmbientHook(settingsJson: string): string {
  return filterHookEntries(settingsJson, (cmd) =>
    cmd.includes(PREAMBLE_HOOK_MARKER) || cmd.includes(LEGACY_HOOK_MARKER),
  );
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`LEGACY_SKILL_NAMES` array is now 100+ entries with no structural organization** - `src/cli/plugins.ts:227-364`
**Confidence**: 82%
- Problem: This branch adds 19 more entries (lines 343-363), bringing the array to ~100 entries across 7 comment-delimited sections. The array is append-only across version bumps and has no programmatic structure -- it's a flat list of strings organized only by comments. The comment sections (`v1.0.0 consolidation`, `v2.0.0 namespace migration`, `v2.0.0 skill renames`, `v2.0.0 ambient refinements`) indicate a pattern that could be codified. While each individual addition is simple, the aggregate list is becoming a maintainability burden.
- Fix: Group by version/category using helper arrays or objects, then flatten:
```typescript
const LEGACY_V1_PREFIXED = ['devflow-core-patterns', 'devflow-review-methodology', ...];
const LEGACY_V1_BARE = ['codebase-navigation', 'test-design', ...];
const LEGACY_V2_NAMESPACE = ['core-patterns', 'docs-framework', ...];
const LEGACY_V2_RENAMES = ['devflow:security-patterns', ...];
const LEGACY_V2_AMBIENT = ['devflow:ambient-router', ...];

export const LEGACY_SKILL_NAMES: string[] = [
  ...LEGACY_V1_PREFIXED,
  ...LEGACY_V1_BARE,
  ...LEGACY_V2_NAMESPACE,
  ...LEGACY_V2_RENAMES,
  ...LEGACY_V2_AMBIENT,
];
```

**`SHADOW_RENAMES` grows with every skill rename but has no validation** - `src/cli/plugins.ts:372-398`
**Confidence**: 80%
- Problem: This branch adds 9 more entries to `SHADOW_RENAMES` (lines 389-397). The array now has 25 entries mapping old to new names. There is no compile-time or test-time validation that the "new name" side of each pair actually exists in the current `DEVFLOW_PLUGINS` skills arrays. A typo in a new-name entry would silently fail shadow migration.
- Fix: Add a test that validates every `SHADOW_RENAMES[1]` value exists in `getAllSkillNames()`.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`runClaudeStreaming` function uses nested callbacks with multi-level event parsing** - `tests/integration/helpers.ts:46-140`
**Confidence**: 82%
- Problem: This new function (94 lines) contains 4 levels of nesting: Promise constructor -> stdout data handler -> for-loop over lines -> JSON event inspection with nested content block iteration. The `finish` closure, `settled` guard, dual timeout management (safety timer + grace timer after first skill detection), and three event handlers (`data`, `close`, `error`) create moderate cognitive complexity. Cyclomatic complexity is approximately 12 due to the branching within the streaming event parser.
- Fix: Consider extracting the event-line parser into a separate function (e.g., `parseStreamEvent(line): { skills: string[], texts: string[] }`) to reduce nesting depth. The dual-timeout pattern could also be extracted into a `StreamTimeout` helper class.

**`addAmbientHook` performs double JSON parse** - `src/cli/commands/ambient.ts:48-82`
**Confidence**: 80%
- Problem: `addAmbientHook` calls `removeLegacyAmbientHook(settingsJson)` which parses JSON, serializes back to string, then `addAmbientHook` immediately parses that string again on line 51. This is a minor inefficiency but also a readability concern -- the function operates on strings when it could operate on objects.
- Fix: If `filterHookEntries` (from the duplication fix above) is introduced, have it accept/return parsed objects internally, with thin string-based wrappers for the public API. Alternatively, accept this as a minor cost of clean function composition at the string level.

## Suggestions (Lower Confidence)

- **Integration test repetition** - `tests/integration/ambient-activation.test.ts` (Confidence: 70%) -- The GUIDED and ORCHESTRATED test cases follow a highly uniform structure (declare expected skills, call `runClaudeStreamingWithRetry`, destructure, log, assert). A parameterized test pattern (`it.each` or a test factory) could reduce the 11 near-identical test bodies to a single template.

- **Router SKILL.md has high information density** - `shared/skills/router/SKILL.md` (Confidence: 65%) -- At 146 lines with 8 tables, this skill file carries substantial decision logic (2-dimensional intent x depth matrix, edge case table with 16 rows). The cognitive load is offset by the clear tabular format, but the edge case table alone has more entries than most skill files have total lines.

- **Preamble content duplicated across shell script and test helper** - `scripts/hooks/preamble:37-41` and `tests/integration/helpers.ts:18-23` (Confidence: 75%) -- The `DEVFLOW_PREAMBLE` constant in the test helpers is a manual sync of the shell script's `PREAMBLE` variable. The `SYNC:` comment acknowledges this, and the preamble drift detection test in `ambient.test.ts` provides a structural validation guard. Still, this is a code smell -- the preamble content exists in two places with a test to keep them aligned rather than a single source of truth.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Complexity Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR is a net complexity *reduction* -- it deletes 3,960 lines vs. adding 881, removes the `implementation-patterns` skill duplication (1,708 lines across two locations), simplifies skill names from verbose compound forms (e.g., `implementation-orchestration`) to short names (e.g., `implement`), and replaces the session-start ambient skill injection (file I/O on every session start) with a static detection-only preamble. The new `removeLegacyAmbientHook`/`removeAmbientHook` duplication and the continued growth of `LEGACY_SKILL_NAMES` are the only notable complexity additions. The blocking duplication issue is straightforward to fix -- extract a shared predicate-based filter function.
