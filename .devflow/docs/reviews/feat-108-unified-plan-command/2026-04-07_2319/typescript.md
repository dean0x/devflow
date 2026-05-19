# TypeScript Review Report

**Branch**: feat/108-unified-plan-command -> main
**Date**: 2026-04-07_2319

## Issues in Your Changes (BLOCKING)

No blocking TypeScript issues found.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Missing test assertions for devflow-plan skill/agent dependencies** - `tests/plugins.test.ts`
**Confidence**: 85%
- Problem: The existing test suite has explicit dependency assertion tests for `devflow-ambient` (lines 203-220, 232-240) and `devflow-implement` (lines 222-230), verifying they declare required agents and skills. The new `devflow-plan` plugin introduces four agents (`git`, `skimmer`, `synthesizer`, `designer`) and five skills (`agent-teams`, `gap-analysis`, `design-review`, `patterns`, `knowledge-persistence`), but no corresponding test asserts these declarations. The test for `buildAssetMaps` was updated (line 52-53) to reflect the new first-owner for the `git` agent, and `devflow-ambient` was updated with `designer` agent and `gap-analysis`/`design-review` skills -- but neither update is covered by a dependency assertion test.
- Fix: Add test cases mirroring the existing pattern:
```typescript
it('devflow-plan declares required agents and skills', () => {
  const plan = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-plan');
  expect(plan).toBeDefined();
  expect(plan!.agents).toContain('git');
  expect(plan!.agents).toContain('skimmer');
  expect(plan!.agents).toContain('synthesizer');
  expect(plan!.agents).toContain('designer');
  expect(plan!.skills).toContain('gap-analysis');
  expect(plan!.skills).toContain('design-review');
  expect(plan!.skills).toContain('knowledge-persistence');
});

it('devflow-ambient declares plan-related dependencies', () => {
  const ambient = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-ambient');
  expect(ambient).toBeDefined();
  expect(ambient!.agents).toContain('designer');
  expect(ambient!.skills).toContain('gap-analysis');
  expect(ambient!.skills).toContain('design-review');
});
```

## Pre-existing Issues (Not Blocking)

### LOW

**Non-null assertions on `find()` results** - `tests/plugins.test.ts:172-248`
**Confidence**: 82%
- Problem: Multiple test cases use `plugin!.` after `find()` which returns `T | undefined`. While each is preceded by `expect(plugin).toBeDefined()`, TypeScript does not narrow the type after `expect` -- the non-null assertion (`!`) is a type-safety escape hatch. This is a pre-existing pattern across all existing tests (lines 172, 207, 208, 211, 213, 214, 217, 218, 219, 226, 227, 229, 235, 236, 239, 246, 247).
- Fix: Use a guard pattern that narrows properly:
```typescript
const plan = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-plan');
if (!plan) { throw new Error('devflow-plan not found'); }
// plan is now narrowed to PluginDefinition, no ! needed
expect(plan.agents).toContain('designer');
```

## Suggestions (Lower Confidence)

- **`LEGACY_SKILL_NAMES` growing without bounds** - `src/cli/plugins.ts:236-396` (Confidence: 65%) -- The legacy names array is now 150+ entries and only grows. Consider whether old entries from v1.0.0 consolidation can be pruned in a future major version, or whether a migration version cutoff would reduce maintenance burden.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 1 |

**TypeScript Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The TypeScript changes are clean and well-structured:
- No `any` types anywhere in changed code
- No type assertions or non-null assertions in new code
- `PluginDefinition` interface used correctly with all required fields
- `plugin.json` manifest matches TypeScript registry exactly
- All 26 tests pass, TypeScript compilation succeeds with zero errors
- New skills (`gap-analysis`, `design-review`) properly added to both the plugin declaration and `LEGACY_SKILL_NAMES` for migration coverage
- `SHADOW_RENAMES` consistency tests continue to pass

The one condition: add test assertions for the new `devflow-plan` plugin's declared dependencies, following the established pattern used for `devflow-ambient` and `devflow-implement`.
