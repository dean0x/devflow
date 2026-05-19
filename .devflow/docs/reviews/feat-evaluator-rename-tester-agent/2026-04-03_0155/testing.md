# Testing Review Report

**Branch**: feat/evaluator-rename-tester-agent -> main
**Date**: 2026-04-03_0155

## Issues in Your Changes (BLOCKING)

### HIGH

**Duplicate step number in implement README workflow** - `plugins/devflow-implement/README.md:33`
**Confidence**: 95%
- Problem: The workflow section has two steps numbered `8.` — line 32 ("Simplification") and line 33 ("PR Creation"). This was introduced when steps 7 and 8 were inserted for QA Testing and Simplification, but the original step 8 ("PR Creation") was not renumbered to 9.
- Fix: Change line 33 from `8. **PR Creation**` to `9. **PR Creation**`:
```markdown
7. **QA Testing** - Tester executes scenario-based acceptance tests
8. **Simplification** - Simplifier refines code clarity
9. **PR Creation** - Git agent creates pull request
```

### MEDIUM

**No tests verify new Tester/Evaluator agent declarations in plugin registries** - `src/cli/plugins.ts:296-297`, `src/cli/plugins.ts:332`
**Confidence**: 85%
- Problem: The `devflow-implement` and `devflow-ambient` plugins now declare `evaluator` and `tester` in their `agents` arrays, and `qa` in the `skills` array. However, no test verifies these agent dependencies are declared, even though the existing test `devflow-ambient declares review/resolve skill dependencies` (plugins.test.ts:202) verifies other agent/skill dependencies for the ambient plugin. This creates an asymmetry: the review pipeline is tested for dependency integrity, but the implement pipeline (which now depends on evaluator and tester) is not.
- Fix: Add tests to `tests/plugins.test.ts` that verify the new agent and skill dependencies:
```typescript
it('devflow-implement declares evaluator and tester agent dependencies', () => {
  const implement = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-implement');
  expect(implement).toBeDefined();
  expect(implement!.agents).toContain('evaluator');
  expect(implement!.agents).toContain('tester');
  expect(implement!.skills).toContain('qa');
});

it('devflow-ambient declares evaluator and tester agent dependencies', () => {
  const ambient = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-ambient');
  expect(ambient).toBeDefined();
  expect(ambient!.agents).toContain('evaluator');
  expect(ambient!.agents).toContain('tester');
});
```

**No test for LEGACY_AGENT_NAMES cleanup path** - `src/cli/utils/installer.ts:721-727`
**Confidence**: 82%
- Problem: The installer now cleans up legacy agent files (the `shepherd.md` -> `evaluator.md` rename) via a new code path that iterates `LEGACY_AGENT_NAMES` and deletes stale files. This behavior is not tested. The existing `SHADOW_RENAMES` consistency test (plugins.test.ts:231-254) verifies that renamed skills are tracked, but there is no analogous test for renamed agents.
- Fix: Add a test in `tests/plugins.test.ts` that verifies `LEGACY_AGENT_NAMES` entries are not in any current plugin's agents array:
```typescript
import { LEGACY_AGENT_NAMES } from '../src/cli/plugins.js';

it('LEGACY_AGENT_NAMES do not overlap with current agent names', () => {
  const currentAgents = getAllAgentNames();
  for (const legacy of LEGACY_AGENT_NAMES) {
    expect(currentAgents, `Legacy agent '${legacy}' should not be a current agent`).not.toContain(legacy);
  }
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Implement README Skills count is stale at "(9)" after adding `qa` skill** - `plugins/devflow-implement/README.md:51`
**Confidence**: 82%
- Problem: The Skills section header says "Skills (9)" but the plugin.json now declares 6 skills (`agent-teams`, `implementation-patterns`, `knowledge-persistence`, `qa`, `self-review`, `worktree-support`) and the README lists 9 skill names sourced from core-skills and other shared dependencies. With the addition of `qa`, the count may need updating depending on the counting methodology (direct plugin skills vs. all transitive skills). The README lists skills that are not in the plugin.json skills array (e.g., `software-design`, `git`, `boundary-validation`, `typescript`, `react`, `accessibility` come from core-skills or other plugins). The `qa` skill is now declared in plugin.json but not listed in the README body.
- Fix: Either add `qa` to the README skill list and update the count to "(10)", or clarify that the count refers to direct plugin skills (6) and list them accurately.

## Pre-existing Issues (Not Blocking)

_No critical pre-existing issues detected in reviewed files._

## Suggestions (Lower Confidence)

- **Missing `qa` skill in ambient plugin's skills array** - `src/cli/plugins.ts:333-355` (Confidence: 68%) -- The `devflow-ambient` plugin declares `evaluator` and `tester` agents but does not add `qa` to its skills array. Since universal skill installation ensures `qa` is always available and the Tester agent references it via frontmatter, this is not a functional issue. However, `devflow-implement` explicitly declares `qa`, creating an inconsistency in how plugin manifests document their skill dependencies.

- **Tester agent at 195 lines exceeds target range** - `shared/agents/tester.md` (Confidence: 65%) -- CLAUDE.md specifies agents should target 50-150 lines ("Worker 80-120"). The Tester agent at 195 lines exceeds this by 33%. The Browser Execution and Dev Server Lifecycle sections are detailed and thorough, but some of this content could potentially move to the `qa` skill's references to stay within agent sizing conventions.

- **No test for `LEGACY_PLUGIN_NAMES` mapping completeness** - `src/cli/plugins.ts:437-439` (Confidence: 60%) -- While `parsePluginSelection` legacy remapping is tested (init-logic.test.ts) and `resolvePluginList` remapping is tested (manifest.test.ts), there is no test verifying that `LEGACY_PLUGIN_NAMES` keys do not appear in the current `DEVFLOW_PLUGINS` list (analogous to the `LEGACY_AGENT_NAMES` suggestion above).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

**Rationale**: The test suite passes (581/581) and the new tests for legacy plugin name remapping are well-structured. The two new tests in init-logic.test.ts and one in manifest.test.ts correctly validate the `frontend-design -> ui-design` migration path. However, the significant new functionality (Tester agent, Evaluator rename, QA skill, `LEGACY_AGENT_NAMES` cleanup) lacks corresponding test coverage for plugin registry integrity. The duplicate step number in the implement README is a documentation correctness issue that should be fixed. The existing test pattern for verifying ambient plugin dependencies should be extended to cover the new agent/skill additions.
