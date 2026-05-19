# Tests Review Report

**Branch**: feat/polyglot-skills -> main
**Date**: 2026-03-04
**PR**: #76

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing test coverage for `optional` field on new plugins** - `/Users/dean/Sandbox/devflow/src/cli/plugins.ts:86-148`
- Problem: 8 new plugin definitions all set `optional: true`, but no test validates that the `optional` field exists or is correct on these plugins. The existing `DEVFLOW_PLUGINS integrity` test suite (`tests/plugins.test.ts`) validates `name`, `description`, `commands`, `agents`, and `skills` on every plugin -- but never checks `optional`. This means a regression where `optional` is accidentally removed or changed to `false` on a language plugin would go undetected, silently changing install behavior (all 8 language plugins would install by default instead of opt-in).
- Impact: The `optional` flag drives core install behavior -- `parsePluginSelection` and `installViaFileCopy` use it to skip optional plugins during default `init`. A regression here changes what gets installed for every user.
- Fix: Add a test to the `DEVFLOW_PLUGINS integrity` describe block:
```typescript
it('language/ecosystem plugins are marked optional', () => {
  const optionalPlugins = [
    'devflow-typescript', 'devflow-react', 'devflow-accessibility',
    'devflow-frontend-design', 'devflow-go', 'devflow-python',
    'devflow-java', 'devflow-rust',
  ];
  for (const name of optionalPlugins) {
    const plugin = DEVFLOW_PLUGINS.find(p => p.name === name);
    expect(plugin, `${name} should exist in DEVFLOW_PLUGINS`).toBeTruthy();
    expect(plugin!.optional, `${name} should be marked optional`).toBe(true);
  }
});
```

**Missing test for new skills appearing in `getAllSkillNames`** - `/Users/dean/Sandbox/devflow/tests/plugins.test.ts:17-23`
- Problem: The existing `includes skills from multiple plugins` test only checks for `accessibility` and `agent-teams`. The PR adds 4 brand-new skills (`go`, `python`, `java`, `rust`) to the registry, but no test verifies they appear in the deduplicated skill list. The existing tests would pass even if these new skills were accidentally omitted from the plugin definitions.
- Impact: If a new language skill is accidentally dropped from its plugin definition in a future refactor, no test would catch the missing skill.
- Fix: Extend the existing test or add a new one:
```typescript
it('includes new polyglot skills', () => {
  const skills = getAllSkillNames();
  expect(skills).toContain('go');
  expect(skills).toContain('python');
  expect(skills).toContain('java');
  expect(skills).toContain('rust');
});
```

### MEDIUM

**No test for skills removed from core-skills plugin** - `/Users/dean/Sandbox/devflow/src/cli/plugins.ts:27`
- Problem: The PR removes `accessibility`, `frontend-design`, `react`, and `typescript` from `devflow-core-skills` and moves them to their own optional plugins. This is a significant behavioral change (these skills no longer auto-install). No test validates that `devflow-core-skills` specifically does NOT contain these skills. The existing `buildAssetMaps` test was updated for `accessibility` moving, which is good, but there is no assertion that core-skills no longer owns the removed skills.
- Impact: If someone accidentally re-adds a language skill to `devflow-core-skills` in the future, it would silently become a non-optional, always-installed skill again, defeating the purpose of this refactor.
- Fix:
```typescript
it('core-skills plugin does not contain language/ecosystem skills', () => {
  const coreSkills = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-core-skills');
  const movedSkills = ['accessibility', 'frontend-design', 'react', 'typescript'];
  for (const skill of movedSkills) {
    expect(coreSkills!.skills).not.toContain(skill);
  }
});
```

**No test for `buildAssetMaps` ownership of new language skills** - `/Users/dean/Sandbox/devflow/tests/plugins.test.ts:42-53`
- Problem: The `buildAssetMaps` test was correctly updated to verify `accessibility` now maps to `devflow-accessibility`, but none of the 4 new language skills (`go`, `python`, `java`, `rust`) have ownership assertions. The first-plugin-wins behavior is the core invariant of `buildAssetMaps`, and each new skill should be verified.
- Impact: If a future change adds `go` to a non-optional plugin listed before `devflow-go`, it would silently change the ownership and install behavior.
- Fix:
```typescript
// Inside the 'assigns each asset to the first plugin that declares it' test:
expect(skillsMap.get('go')).toBe('devflow-go');
expect(skillsMap.get('python')).toBe('devflow-python');
expect(skillsMap.get('java')).toBe('devflow-java');
expect(skillsMap.get('rust')).toBe('devflow-rust');
```

**`has at least 8 plugins` threshold is too low** - `/Users/dean/Sandbox/devflow/tests/plugins.test.ts:108-110`
- Problem: The integrity test checks `DEVFLOW_PLUGINS.length >= 8` but the PR brings the count to 17 plugins (9 core + 8 optional). This threshold was not updated, meaning 9 plugins could be accidentally deleted and the test would still pass.
- Impact: The test provides a false sense of safety. A regression that drops half the plugins would go undetected.
- Fix: Update the threshold to match the new reality:
```typescript
it('has at least 17 plugins', () => {
  expect(DEVFLOW_PLUGINS.length).toBeGreaterThanOrEqual(17);
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`build.test.ts` validates skill directory existence but not new plugin directories** - `/Users/dean/Sandbox/devflow/tests/build.test.ts:9-15`
- Problem: The `build.test.ts` file has a test that every plugin in `DEVFLOW_PLUGINS` has a matching `plugins/` directory and `plugin.json`. This test is not modified in the PR but already covers the new plugins by virtue of iterating `DEVFLOW_PLUGINS`. This is good -- the existing test structure handles the expansion correctly. However, there is no validation that new plugin.json files match their `DEVFLOW_PLUGINS` definition (e.g., that the `skills` array in plugin.json matches the `skills` array in the TypeScript constant). A mismatch between these two sources of truth could cause the build system to distribute different skills than what the CLI expects.
- Impact: The plugin.json files are the source of truth for Claude's marketplace listing, while `DEVFLOW_PLUGINS` drives the CLI installer. A drift between them would cause confusing behavior.
- Fix: Add a cross-validation test:
```typescript
it('plugin.json skills/agents match DEVFLOW_PLUGINS', async () => {
  for (const plugin of DEVFLOW_PLUGINS) {
    const manifestPath = path.join(ROOT, 'plugins', plugin.name, '.claude-plugin', 'plugin.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
    expect(
      [...manifest.skills].sort(),
      `${plugin.name}: plugin.json skills should match DEVFLOW_PLUGINS`
    ).toEqual([...plugin.skills].sort());
    expect(
      [...manifest.agents].sort(),
      `${plugin.name}: plugin.json agents should match DEVFLOW_PLUGINS`
    ).toEqual([...plugin.agents].sort());
  }
});
```

### LOW

**Test comment update is correct but could be more descriptive** - `/Users/dean/Sandbox/devflow/tests/plugins.test.ts:19`
- Problem: The comment was updated from `'accessibility' appears in core-skills, implement, and code-review` to `'accessibility' appears in devflow-accessibility (optional plugin)`. The new comment is accurate, but the test itself only asserts `expect(skills).toContain('accessibility')` without verifying it is from an optional plugin, making the comment's detail slightly misleading -- the test does not actually verify the "optional plugin" part.
- Impact: Minor readability concern. No functional impact.
- Fix: Either simplify the comment to `// 'accessibility' skill is available` or add the optional assertion alongside it.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**No test for `parsePluginSelection` with optional plugins** - `/Users/dean/Sandbox/devflow/tests/init-logic.test.ts:24-65`
- Problem: The `parsePluginSelection` tests validate parsing comma-separated names and shorthand resolution, but never test the interaction between `parsePluginSelection` and the `optional` field. The function resolves plugin names but does not appear to differentiate between optional and non-optional plugins during selection -- that behavior should still be verified to ensure optional plugins can be correctly selected via `--plugin=go` shorthand.
- Impact: This is pre-existing -- `optional` was introduced with `devflow-audit-claude` before this PR. But the expanded use across 8 new plugins increases the surface area.

**No integration test for selective plugin install with optional plugins** - `/Users/dean/Sandbox/devflow/tests/init-logic.test.ts:356-423`
- Problem: The `installViaFileCopy` tests cover full vs partial install, but neither test exercises the scenario where optional plugins are explicitly selected and installed alongside core plugins. There is no test that verifies optional plugins are correctly skipped during default install and included when selected.
- Impact: Pre-existing gap amplified by the PR adding 8 more optional plugins.

### LOW

**Test count assertion is fragile** - `/Users/dean/Sandbox/devflow/tests/plugins.test.ts:12`
- Problem: `expect(skills.length).toBeGreaterThan(0)` does not actually validate the expected count of skills. With 30 skills now in the registry, a more meaningful lower bound (e.g., `>= 25`) would catch accidental mass removals.
- Impact: Minor -- the orphan detection tests in `build.test.ts` provide a stronger safety net.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 3 | 0 |
| Should Fix | 0 | 0 | 1 | 1 |
| Pre-existing | 0 | 0 | 2 | 1 |

**Tests Score**: 5/10

The existing test infrastructure (`build.test.ts` skill/agent reference validation, `plugins.test.ts` integrity checks) provides a solid foundation and automatically covers the new plugins through iteration. However, the PR introduces significant structural changes -- moving 4 skills from core to optional, adding 4 new skills, and adding 8 new plugin definitions with the `optional: true` flag -- without adding corresponding test coverage for these specific changes. The test modifications are limited to updating 2 assertions and 2 comments to reflect the `accessibility` skill moving to its own plugin.

The core concern is that the `optional` flag, which determines whether a plugin installs by default, has zero test coverage. This was pre-existing for `devflow-audit-claude` but becomes a much larger risk now that 8 plugins rely on it.

**Recommendation**: CHANGES_REQUESTED

Two HIGH issues need addressing before merge:
1. Add test coverage for the `optional` field on language/ecosystem plugins
2. Add assertions that new skills (`go`, `python`, `java`, `rust`) appear in the registry

The MEDIUM items (core-skills exclusion test, `buildAssetMaps` ownership for new skills, plugin count threshold) are strongly recommended but not strictly blocking.
