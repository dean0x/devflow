# Consistency Review Report

**Branch**: feat/rules-system-for-devflow-always-on-engin -> main
**Date**: 2026-05-11

## Issues in Your Changes (BLOCKING)

### HIGH

**`formatFeatures` includes `rules` but omits `learn`, `decisions`, `knowledge` -- inconsistency introduced by this PR** - `src/cli/commands/list.ts:20`
**Confidence**: 85%
- Problem: The new code adds `features.rules ? 'rules' : null` to `formatFeatures()` at line 20, but the function already omits `learn`, `decisions`, and `knowledge` from display. While those omissions are pre-existing, by adding `rules` the PR authors a new inconsistency: the _newest_ feature is displayed while three older features are not. Either all toggle features should be shown or the function should remain selective with a clear rationale. As it stands, a user running `devflow list` sees `rules` in Features but not `learn` or `decisions`, which is confusing because those are enabled by default too.
- Fix: Either add all missing features (recommended for completeness):
```typescript
const parts = [
  features.teams ? 'teams' : null,
  features.ambient ? 'ambient' : null,
  features.memory ? 'memory' : null,
  features.learn ? 'learn' : null,
  features.hud ? 'hud' : null,
  features.knowledge ? 'knowledge' : null,
  features.decisions ? 'decisions' : null,
  features.rules ? 'rules' : null,
  features.flags?.length ? `flags: ${features.flags.length}` : null,
].filter(Boolean);
```
Or, if the intent is to show only a subset, document the rationale as a JSDoc comment.

### MEDIUM

**Test fixtures for `ManifestData` in `list-logic.test.ts` lack `rules` field** - `tests/list-logic.test.ts:12,17,22,27,32,37,44,53,61,72`
**Confidence**: 85%
- Problem: After adding `rules: boolean` to `ManifestData.features` (in `manifest.ts`), the test fixtures in `list-logic.test.ts` still construct features objects without the `rules` field. TypeScript coercion via `as ManifestData['features']` hides the error. All other test files (`manifest.test.ts`, `init-logic.test.ts`) were updated but `list-logic.test.ts` was not. This creates an inconsistency across test fixtures within the same PR.
- Fix: Add `rules: false` (or `true` where appropriate) to each test fixture in `list-logic.test.ts` to match the updated `ManifestData` interface.

**`uninstall-logic.test.ts` not updated to verify `rules` in `computeAssetsToRemove`** - `tests/uninstall-logic.test.ts`
**Confidence**: 82%
- Problem: The `computeAssetsToRemove` function return type was extended to include `rules: string[]`, and the `formatDryRunPlan` function now handles `rules`. However, the `uninstall-logic.test.ts` test file was not updated with any test cases that verify rules are correctly retained/removed during selective uninstall, nor that `formatDryRunPlan` renders rules. Other asset types (skills, agents, commands) each have dedicated test cases. This leaves the new asset type untested at the unit level.
- Fix: Add test cases to `uninstall-logic.test.ts` covering:
  1. `computeAssetsToRemove` removes rules unique to uninstalled plugins
  2. `computeAssetsToRemove` retains rules shared with remaining plugins
  3. `formatDryRunPlan` includes rules in the plan output

**Module-level side effect in `rules.ts`** - `src/cli/commands/rules.ts:33`
**Confidence**: 82%
- Problem: Line 33 executes `const allRulesMap = buildRulesMap(DEVFLOW_PLUGINS);` at module load time (outside any function or class). This is inconsistent with the `flags.ts` command pattern, which computes its equivalent state lazily inside the action handler. Module-level side effects make testing harder and cause unnecessary computation when the module is imported for type-checking or by other modules.
- Fix: Move the computation inside the `formatRuleRow` function or create a lazy initializer:
```typescript
let _allRulesMap: Map<string, string> | null = null;
function getAllRulesMapCached(): Map<string, string> {
  if (!_allRulesMap) _allRulesMap = buildRulesMap(DEVFLOW_PLUGINS);
  return _allRulesMap;
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`formatFeatures` test file uses partial types via `as` casts, masking missing fields** - `tests/list-logic.test.ts:12`
**Confidence**: 80%
- Problem: Test fixtures construct partial features objects and rely on TypeScript's `as` cast to satisfy the type checker. With the addition of `rules` to `ManifestData.features`, these fixtures now have an additional missing field. The `as` cast pattern diverges from other test files in this PR (e.g., `manifest.test.ts`) which fully specify all fields. This is a pre-existing pattern but the PR widened the gap by adding another required field.
- Fix: Provide complete feature objects in test fixtures to match the pattern established in `manifest.test.ts` and `init-logic.test.ts`.

## Pre-existing Issues (Not Blocking)

No critical pre-existing issues found.

## Suggestions (Lower Confidence)

- **Plugins without rules do not declare empty `rules: []`** - `src/cli/plugins.ts` (multiple plugins) (Confidence: 65%) -- Several plugins in `DEVFLOW_PLUGINS` (devflow-plan, devflow-implement, devflow-code-review, devflow-resolve, devflow-debug, devflow-explore, devflow-research, devflow-release, devflow-self-review, devflow-ambient, devflow-audit-claude) omit `rules` entirely, relying on the `?? []` fallback. While the `rules?: string[]` optional type makes this valid, other array fields (`commands`, `agents`, `skills`) are always explicitly declared. This is a minor consistency gap. The feature knowledge notes this pattern is intentional, so the optional approach may be deliberate to avoid noise.

- **`--enable` path in `rules.ts` does not log which rules were shadowed** - `src/cli/commands/rules.ts:73-86` (Confidence: 65%) -- When `--enable` installs rules, it copies shadow files silently. The `--status` subcommand shows shadow status, but the `--enable` output does not mention how many rules were shadowed. The skill install flow in `installer.ts` similarly does not log this, so this is consistent with existing behavior, but could be improved for user clarity.

- **`list-logic.test.ts` test "returns all enabled features" does not verify `rules`** - `tests/list-logic.test.ts:11-13` (Confidence: 70%) -- The test asserts `'teams, ambient, memory'` but does not include `rules: true` in its fixture. If `rules` were added to the fixture, the expected output would need to change. This would catch any regression in the feature display order.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The rules system is well-integrated with existing patterns overall -- the build pipeline, install flow, shadow resolution, manifest tracking, uninstall cleanup, and CLI flag/prompt patterns all closely mirror the established skill/flags architecture (applies ADR-001 -- `LEGACY_RULE_NAMES` starts empty with no migration code, consistent with the clean break philosophy). The main consistency gap is `formatFeatures` selectively showing `rules` while omitting `learn`/`decisions`/`knowledge`, and the incomplete test fixture updates in `list-logic.test.ts` and missing `uninstall-logic.test.ts` coverage. The module-level side effect in `rules.ts` deviates from the lazy pattern used by `flags.ts`.
