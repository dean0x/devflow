# Tests Review Report

**Branch**: feat/wave-1 -> main
**Date**: 2026-03-13

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing edge case: `readManifest` accepts structurally invalid data beyond the 3-field check** - `tests/manifest.test.ts` / `src/cli/utils/manifest.ts:28`
**Confidence**: 85%
- Problem: `readManifest` validates only `version`, `plugins` (is array), and `scope`, then casts the rest via `as ManifestData`. A manifest with `{ version: "1.0", plugins: [], scope: "user" }` (missing `features`, `installedAt`, `updatedAt`) passes validation and returns as `ManifestData`, but consumers accessing `manifest.features.teams` will throw a runtime TypeError. There is no test covering this partial-valid shape.
- Impact: The `list.ts` code accesses `manifest.features.teams`, `manifest.features.ambient`, `manifest.features.memory` unconditionally when `manifest` is truthy. A corrupt or partially-written manifest would cause a crash.
- Fix: Either (a) add validation for `features`, `installedAt`, `updatedAt` in `readManifest`, or (b) add a test documenting that partial data is accepted and add null-safe access in consumers.

```typescript
// Option A: Strengthen validation in manifest.ts:28
if (!data.version || !Array.isArray(data.plugins) || !data.scope
    || typeof data.features !== 'object' || !data.installedAt || !data.updatedAt) {
  return null;
}

// Option A: Add corresponding test
it('returns null for partial manifest (missing features)', async () => {
  await fs.writeFile(
    path.join(tmpDir, 'manifest.json'),
    JSON.stringify({ version: '1.0.0', plugins: [], scope: 'user' }),
    'utf-8',
  );
  const result = await readManifest(tmpDir);
  expect(result).toBeNull();
});
```

**Missing test coverage for `compareSemver` with v-prefixed versions** - `tests/manifest.test.ts`
**Confidence**: 82%
- Problem: The `compareSemver` function explicitly handles `v`-prefixed versions via `v?` in the regex (`/^v?(\d+)\.(\d+)\.(\d+)/`), but no test exercises this path. The `detectUpgrade` tests only use bare `x.y.z` strings.
- Impact: If the regex is accidentally changed, this behavior silently breaks with no test catching it.
- Fix: Add a test case for v-prefixed input.

```typescript
it('handles v-prefixed versions', () => {
  const result = detectUpgrade('v2.0.0', 'v1.4.0');
  expect(result.isUpgrade).toBe(true);
  expect(result.previousVersion).toBe('v1.4.0');
});
```

### MEDIUM

**No test for `detectUpgrade` when current version is unparseable but installed is valid** - `tests/manifest.test.ts:179`
**Confidence**: 83%
- Problem: The test `handles unparseable versions gracefully` only tests `detectUpgrade('not-a-version', '1.4.0')`. It does not test the reverse case `detectUpgrade('1.4.0', 'not-a-version')` where the installed version is corrupt. Since `compareSemver` returns `null` when either side is unparseable, both cases follow the same path, but testing only one direction provides incomplete behavioral documentation.
- Fix: Add symmetric test case.

```typescript
it('handles unparseable installed version gracefully', () => {
  const result = detectUpgrade('1.4.0', 'garbage');
  expect(result.isUpgrade).toBe(false);
  expect(result.isDowngrade).toBe(false);
  expect(result.isSameVersion).toBe(false);
  expect(result.previousVersion).toBe('garbage');
});
```

**No test for `mergeManifestPlugins` with empty arrays** - `tests/manifest.test.ts:109-133`
**Confidence**: 80%
- Problem: `mergeManifestPlugins` is tested with non-empty arrays but never with empty inputs. The edge cases `mergeManifestPlugins([], ['a'])` and `mergeManifestPlugins(['a'], [])` are untested.
- Fix: Add boundary tests.

```typescript
it('handles empty existing list', () => {
  const result = mergeManifestPlugins([], ['devflow-code-review']);
  expect(result).toEqual(['devflow-code-review']);
});

it('handles empty new list', () => {
  const result = mergeManifestPlugins(['devflow-core-skills'], []);
  expect(result).toEqual(['devflow-core-skills']);
});
```

## Issues in Code You Touched (Should Fix)

### HIGH

**No test coverage for `list.ts` manifest integration logic** - `src/cli/commands/list.ts:11-65`
**Confidence**: 88%
- Problem: `list.ts` was significantly rewritten to read manifests from both user and local scopes, display install status, show feature flags, and indicate per-plugin install state. None of this new behavior is tested. The pure manifest utility functions are well-tested, but the orchestration logic in `list.ts` -- scope precedence (`localManifest ?? userManifest`), feature string construction, installed-vs-not-installed tagging -- has zero coverage.
- Impact: Regressions in the display logic or scope resolution would go undetected. The feature-string logic (`[...].filter(Boolean).join(', ') || 'none'`) and scope precedence are easy to break.
- Fix: Extract the pure logic (feature string construction, scope resolution) into testable functions, or add integration-style tests with mocked `readManifest`/`getGitRoot`/`getDevFlowDirectory`.

```typescript
// Extractable pure function for testing:
export function formatFeatures(features: { teams: boolean; ambient: boolean; memory: boolean }): string {
  return [
    features.teams ? 'teams' : null,
    features.ambient ? 'ambient' : null,
    features.memory ? 'memory' : null,
  ].filter(Boolean).join(', ') || 'none';
}
```

**No test coverage for `init.ts` manifest integration logic** - `src/cli/commands/init.ts:296-305,611-624`
**Confidence**: 85%
- Problem: Two new blocks of code were added to `init.ts`: (1) upgrade detection at line 296-305 that reads the existing manifest and displays upgrade/reinstall messages, and (2) manifest writing at line 611-624 that constructs and persists the manifest with conditional plugin merging. Neither block is tested. The existing `init-logic.test.ts` tests pure functions re-exported from init but does not cover the new manifest integration.
- Impact: The conditional plugin merge logic (`existingManifest && options.plugin ? mergeManifestPlugins(...) : installedPluginNames`) is especially risk-prone -- a full install overwrites the plugin list while a partial install merges. This branching logic has no test.
- Fix: The merge condition could be extracted as a pure function and tested directly.

```typescript
// Extractable pure function:
export function resolvePluginList(
  existingManifest: ManifestData | null,
  isPartialInstall: boolean,
  installedPluginNames: string[],
): string[] {
  return existingManifest && isPartialInstall
    ? mergeManifestPlugins(existingManifest.plugins, installedPluginNames)
    : installedPluginNames;
}
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Duplicated `beforeEach`/`afterEach` temp directory pattern across describe blocks** - `tests/manifest.test.ts:10-16,53-59`
**Confidence**: 75% (moved to Suggestions)

### LOW

**Test file `init-logic.test.ts` has heavyweight `beforeEach` in `installViaFileCopy` block** - `tests/init-logic.test.ts:474-488`
**Confidence**: 70% (moved to Suggestions)

## Suggestions (Lower Confidence)

- **Duplicated temp dir setup across `readManifest` and `writeManifest` describe blocks** - `tests/manifest.test.ts:10-16,53-59` (Confidence: 75%) -- Both describe blocks repeat identical `beforeEach`/`afterEach` for tmpDir creation and cleanup. A shared helper or single wrapping describe with shared setup would reduce duplication.

- **`installViaFileCopy` test setup is borderline heavy** - `tests/init-logic.test.ts:474-488` (Confidence: 70%) -- The 15-line `beforeEach` creating multiple directories and files is approaching the 10-line threshold from test-patterns, but is justified by the integration nature of the test.

- **`writeManifest` `overwrites existing manifest` test uses partial assertion** - `tests/manifest.test.ts:90` (Confidence: 65%) -- The test asserts only `result?.version` rather than the full updated object, which means other fields could silently be corrupted during overwrite without detection.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 2 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Tests Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

### Rationale

The new `tests/manifest.test.ts` file is well-structured, follows good testing practices (behavior-focused, real filesystem via temp dirs, clean AAA structure, proper cleanup), and covers the core happy paths plus several error paths for the manifest utility functions. All 17 tests pass.

However, there are two categories of gaps:

1. **Edge case gaps in the new tests** (blocking): The `readManifest` validation has a structural hole where partially-valid manifests pass validation but would crash consumers. The `compareSemver` v-prefix path is untested.

2. **Missing integration coverage** (should-fix): The new logic added to `list.ts` and `init.ts` -- manifest scope resolution, conditional plugin merging, upgrade detection orchestration, feature string formatting -- has no test coverage at all. These are the riskiest parts of the change since they wire together the well-tested primitives with branching conditions.

The test quality for what IS tested is solid. The gap is in what is NOT tested: the integration seams where the manifest utilities meet the CLI commands.
