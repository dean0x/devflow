# Testing Review Report

**Branch**: feat/108-unified-plan-command -> main
**Date**: 2026-04-07_2319

## Issues in Your Changes (BLOCKING)

### HIGH

**No tests for `devflow-plan` plugin registration or its unique properties** - `tests/plugins.test.ts`
**Confidence**: 92%
- Problem: The PR introduces the new `devflow-plan` plugin with a `designer` agent, new skills (`gap-analysis`, `design-review`), and the `/plan` command. The only test change is updating the `buildAssetMaps` assertion from `devflow-implement` to `devflow-plan` for the `git` agent's first-plugin ownership. There are no tests verifying:
  1. `devflow-plan` exists in the registry and has expected agents (`git`, `skimmer`, `synthesizer`, `designer`)
  2. `devflow-plan` declares expected skills (`agent-teams`, `gap-analysis`, `design-review`, `patterns`, `knowledge-persistence`)
  3. `devflow-plan` is not marked `optional` (it is a core plugin per CLAUDE.md)
  4. `devflow-ambient` declares the `designer` agent and new skills (`gap-analysis`, `design-review`) it now depends on
- Impact: The existing test pattern for `/implement` (`devflow-implement declares evaluator and tester agents and qa skill`) and ambient (`devflow-ambient declares evaluator, tester agents and qa skill`) establishes a convention of testing cross-plugin dependency declarations. The new `devflow-plan` plugin and ambient's new dependencies on `designer`/`gap-analysis`/`design-review` have no equivalent tests. Regressions in the plugin manifest (e.g., accidentally removing `designer` from ambient) would go undetected.
- Fix: Add tests following the established pattern:
  ```typescript
  it('devflow-plan declares designer agent and gap-analysis/design-review skills', () => {
    const plan = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-plan');
    expect(plan).toBeDefined();
    expect(plan!.agents).toContain('designer');
    expect(plan!.agents).toContain('git');
    expect(plan!.agents).toContain('skimmer');
    expect(plan!.agents).toContain('synthesizer');
    expect(plan!.skills).toContain('gap-analysis');
    expect(plan!.skills).toContain('design-review');
    expect(plan!.skills).toContain('patterns');
    expect(plan!.skills).toContain('knowledge-persistence');
  });

  it('devflow-ambient declares designer agent and plan-related skill dependencies', () => {
    const ambient = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-ambient');
    expect(ambient).toBeDefined();
    expect(ambient!.agents).toContain('designer');
    expect(ambient!.skills).toContain('gap-analysis');
    expect(ambient!.skills).toContain('design-review');
  });
  ```

---

**Ambient activation test does not verify `design-review` skill in PLAN/GUIDED** - `tests/integration/ambient-activation.test.ts:101-112`
**Confidence**: 85%
- Problem: The router SKILL.md was updated to add `devflow:design-review` to the PLAN/GUIDED skill list. However, the integration test at line 102 still expects only `['test-driven-development', 'patterns', 'software-design', 'security']` and does not include `'design-review'`. The test uses a soft-check pattern (logging a warning rather than failing on missing expected skills), so this will not fail the suite. But the `expected` array should be updated to document the new contract.
- Impact: The test's `expected` array is the canonical documentation of what skills PLAN/GUIDED loads. It no longer matches reality. If someone regresses the router by removing `design-review` from PLAN/GUIDED, the test would not catch it.
- Fix: Update the expected skills array at line 102:
  ```typescript
  const expected = ['test-driven-development', 'patterns', 'software-design', 'security', 'design-review'];
  ```

---

**Ambient activation test does not verify new skills in PLAN/ORCHESTRATED** - `tests/integration/ambient-activation.test.ts:194-204`
**Confidence**: 83%
- Problem: The PLAN/ORCHESTRATED test checks only for `['plan:orch', 'patterns']` as required skills. The router now loads `devflow:design-review` for ORCHESTRATED PLAN as well, and the `plan:orch` skill now spawns `Designer` agents. The `required` array does not reflect the expanded skill contract.
- Impact: Same as above -- the test does not document or verify the expanded skill loading contract for PLAN/ORCHESTRATED.
- Fix: Consider updating the required array:
  ```typescript
  const required = ['plan:orch', 'patterns', 'design-review'];
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**No test verifying new `designer` agent exists in `shared/agents/` or `plugins/devflow-plan/agents/`** - `shared/agents/designer.md`
**Confidence**: 82%
- Problem: The PR adds `designer.md` to both `shared/agents/` and `plugins/devflow-plan/agents/`. The build test (`tests/build.test.ts`) may validate that shared agents are distributed, but there is no explicit test for the `designer` agent's existence as a shared agent. Existing tests in `plugins.test.ts` verify agent names appear in the registry, but the `getAllAgentNames` tests only check that `git` and `synthesizer` exist -- not `designer`.
- Impact: LOW -- the `buildAssetMaps` test indirectly validates `designer` through plugin registry declarations, and the build system handles distribution. However, an explicit inclusion check (like the existing checks for `git` and `synthesizer`) would be consistent.
- Fix: Add to the `getAllAgentNames` test:
  ```typescript
  expect(agents).toContain('designer');
  ```

---

**New skill files (`gap-analysis`, `design-review`) not verified in skill-references tests** - `tests/skill-references.test.ts`
**Confidence**: 80%
- Problem: The `skill-references.test.ts` test file validates that all skills referenced across the codebase exist in the canonical skill set, and vice versa. The new `gap-analysis` and `design-review` skills are registered in `plugins.ts` and should be picked up automatically by the existing test infrastructure. However, the COMMAND_REFS set at line 129-140 lists `plan` as a command reference -- this is correct, but worth verifying no false positive would occur if `plan` is mistakenly treated as a skill reference elsewhere.
- Impact: LOW -- the existing test infrastructure should auto-discover the new skills. No action strictly needed, but explicit verification is good hygiene.
- Fix: Run `npm test -- tests/skill-references.test.ts` to confirm all 7 tests pass. (Verified: they do.)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Integration test uses soft-assertion pattern for expected skills** - `tests/integration/ambient-activation.test.ts`
**Confidence**: 85%
- Problem: The ambient activation integration tests use a pattern where `expected` skill arrays are checked with a soft log+warn but the test only asserts that `hasRequiredSkills(result, ['router'])` passes (line 92, 105). The `expected` array at lines 96-97 is checked for logging only, not assertion. This means the `expected` array is documentation, not a test. Any skill regression in the router would go undetected unless `router` itself stops loading.
- Impact: MEDIUM -- skill loading regressions for specific intents would not cause test failures. This pattern weakens the value of the expected arrays as regression guards.

## Suggestions (Lower Confidence)

- **No test for `fetch-issues-batch` Git operation** - `shared/agents/git.md` (Confidence: 70%) -- The new `fetch-issues-batch` operation is added to the Git agent for multi-issue planning. While agent markdown files are not typically unit-tested (they are prompt instructions, not executable code), a build test verifying the agent's mode table or operation list could catch regressions.

- **No test for plan command `.md` path detection logic** - `plugins/devflow-plan/commands/plan.md` (Confidence: 65%) -- The plan and implement commands define input parsing rules (`.md` path detection, `#N` issue parsing, multi-issue mode). These rules are natural language instructions, not code, so they cannot be directly tested. However, the rules are subtle (e.g., `.md` path to `/plan` is an error, but `.md` path to `/implement` is accepted). Consider documenting this asymmetry in the command files themselves.

- **`devflow-implement` lost exploration/planning agents but no test verifies the slimmer agent list** - `plugins/devflow-implement/commands/implement.md` (Confidence: 62%) -- The implement command was slimmed from 16 phases to 10 by removing exploration and planning phases. The `skimmer` agent remains in the plugin's agent list (`src/cli/plugins.ts`) even though the implement command no longer spawns it directly. This may be intentional (Skimmer could still be useful for plan document parsing context) but no test verifies the expected agent list.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 0 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Testing Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The PR introduces a substantial new plugin (`devflow-plan`) with a new agent (`designer`), two new skills (`gap-analysis`, `design-review`), modifications to the router, synthesizer, plan:orch, ambient plugin, and implement commands. The test changes are minimal -- only a single assertion update in `plugins.test.ts`. The existing test infrastructure validates some properties automatically (e.g., skill-references, plugin integrity), but explicit tests for the new plugin's dependency declarations and the updated ambient skill contracts are missing. The codebase has a clear pattern of testing cross-plugin dependencies (see `devflow-implement` and `devflow-ambient` tests), and the new `devflow-plan` plugin should follow this convention.
