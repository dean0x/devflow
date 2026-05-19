# Testing Review Report

**Branch**: feat/init-flags-viewmode -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

### HIGH

**No tests for new `applyViewMode` / `stripViewMode` functions** - `src/cli/utils/flags.ts:222-236`
**Confidence**: 95%
- Problem: Two new pure functions (`applyViewMode` and `stripViewMode`) were added to `flags.ts` but the existing test file `tests/flags.test.ts` has no corresponding test coverage. The existing file thoroughly tests `applyFlags`, `stripFlags`, and `getDefaultFlags` with multiple scenarios each (roundtrip, preservation of existing settings, edge cases). The new view mode utilities follow the exact same pattern but ship with zero tests. This is a gap in the established testing convention for this module.
- Fix: Add a `describe('applyViewMode')` and `describe('stripViewMode')` block to `tests/flags.test.ts` covering:
  1. `applyViewMode` sets `viewMode` key for `'verbose'` and `'focus'`
  2. `applyViewMode` with `'default'` removes the `viewMode` key (the delete-on-default behavior)
  3. `applyViewMode` preserves existing settings (hooks, env, etc.)
  4. `stripViewMode` removes existing `viewMode` key
  5. `stripViewMode` handles missing `viewMode` gracefully
  6. Roundtrip: `stripViewMode(applyViewMode(base, 'focus'))` returns base without `viewMode`
  7. Edge case: arbitrary string mode values (the `mode` parameter is typed as `string`, not the union type)

```typescript
describe('applyViewMode', () => {
  it('sets viewMode for non-default values', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(applyViewMode(input, 'verbose'));
    expect(result.viewMode).toBe('verbose');
  });

  it('removes viewMode when set to default', () => {
    const input = JSON.stringify({ viewMode: 'focus', hooks: {} }, null, 2);
    const result = JSON.parse(applyViewMode(input, 'default'));
    expect(result.viewMode).toBeUndefined();
  });

  it('preserves existing settings', () => {
    const input = JSON.stringify({ hooks: { Stop: [] }, env: { X: '1' } }, null, 2);
    const result = JSON.parse(applyViewMode(input, 'focus'));
    expect(result.hooks).toEqual({ Stop: [] });
    expect(result.env).toEqual({ X: '1' });
    expect(result.viewMode).toBe('focus');
  });
});

describe('stripViewMode', () => {
  it('removes viewMode key', () => {
    const input = JSON.stringify({ viewMode: 'verbose', hooks: {} }, null, 2);
    const result = JSON.parse(stripViewMode(input));
    expect(result.viewMode).toBeUndefined();
    expect(result.hooks).toEqual({});
  });

  it('handles missing viewMode gracefully', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const result = JSON.parse(stripViewMode(input));
    expect(result).toEqual({ hooks: {} });
  });

  it('roundtrip with applyViewMode', () => {
    const base = JSON.stringify({ hooks: { Stop: [] } }, null, 2);
    const applied = applyViewMode(base, 'focus');
    const stripped = stripViewMode(applied);
    expect(JSON.parse(stripped)).toEqual({ hooks: { Stop: [] } });
  });
});
```

**No tests for `viewMode` field in manifest read/write** - `src/cli/utils/manifest.ts:22,71`
**Confidence**: 90%
- Problem: The `ManifestData` interface gained an optional `viewMode?: string` field. The `readManifest` function includes normalization logic (line 71: defaults to `undefined` when absent, accepts string values). The existing `tests/manifest.test.ts` comprehensively tests normalization for every other optional field (`hud`, `learn`, `knowledge`, `decisions`, `rules`, `flags`) but has no test for `viewMode`. The pattern is clear: each optional feature field gets a "normalizes old manifest without X" test and a "returns parsed manifest" test that includes the field. `viewMode` breaks this pattern.
- Fix: Add tests to `tests/manifest.test.ts`:
  1. Verify `viewMode` is `undefined` when absent from old manifest data
  2. Verify `viewMode` is preserved when present as a string
  3. Verify `viewMode` roundtrips through `writeManifest` / `readManifest`

```typescript
it('normalizes old manifest without viewMode to undefined', async () => {
  const oldData = {
    version: '2.0.0',
    plugins: ['devflow-core-skills'],
    scope: 'user',
    features: { teams: false, ambient: true, memory: true, learn: true, hud: true, knowledge: true, decisions: true, rules: true, flags: [] },
    installedAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-13T00:00:00.000Z',
  };
  await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(oldData), 'utf-8');
  const result = await readManifest(tmpDir);
  expect(result).not.toBeNull();
  expect(result!.features.viewMode).toBeUndefined();
});

it('preserves viewMode when present', async () => {
  const data: ManifestData = {
    version: '2.0.0',
    plugins: ['devflow-core-skills'],
    scope: 'user',
    features: { teams: false, ambient: true, memory: true, learn: true, hud: true, knowledge: true, decisions: true, rules: true, flags: [], viewMode: 'focus' },
    installedAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-13T00:00:00.000Z',
  };
  await fs.writeFile(path.join(tmpDir, 'manifest.json'), JSON.stringify(data), 'utf-8');
  const result = await readManifest(tmpDir);
  expect(result).not.toBeNull();
  expect(result!.features.viewMode).toBe('focus');
});
```

### MEDIUM

**`applyViewMode` accepts arbitrary strings without validation** - `src/cli/utils/flags.ts:222`
**Confidence**: 82%
- Problem: The function signature is `applyViewMode(settingsJson: string, mode: string)` -- accepting any string. In `init.ts` the value is narrowed via a select prompt (lines 696-709), but the utility function itself would happily write `viewMode: "banana"` to settings.json. The existing `applyFlags` function does not have this problem because it validates against the registry. While the init flow guards this at the call site, the utility is exported and could be called from other entry points (e.g., `devflow flags` CLI, future scripts). A test asserting the accepted values would document the contract.
- Fix: Either:
  (a) Add a type-safe union parameter: `mode: 'default' | 'verbose' | 'focus'`
  (b) Or at minimum, add a test that documents the behavior for invalid inputs so future callers understand the contract.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Existing `flags.test.ts` "returns parsed manifest for valid data" test does not include `viewMode`** - `tests/manifest.test.ts:76-87`
**Confidence**: 85%
- Problem: The "returns parsed manifest for valid data" test at line 76 constructs a `ManifestData` object for the happy-path roundtrip test. This object does not include the new `viewMode` field. While the test still passes (because `viewMode` is optional and defaults to `undefined`), this means the golden-path test does not exercise the new field at all. Every other feature field is present in this test fixture.
- Fix: Add `viewMode: 'verbose'` (or any valid value) to the test fixture at line 81 to ensure the roundtrip covers it:

```typescript
features: { teams: false, ambient: true, memory: true, learn: false, hud: false, knowledge: false, decisions: false, rules: true, flags: [], viewMode: 'verbose' },
```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Init flow viewMode preservation has no integration-level test** - `src/cli/commands/init.ts:440-450` (Confidence: 65%) -- The recommended-path logic reads `settings.json` from disk to preserve existing `viewMode`. This I/O + JSON parsing path is untested. An integration test that writes a settings.json with `viewMode: 'focus'`, runs the recommended init flow, and verifies the value survives would catch regressions. However, init command tests are integration-heavy and may be intentionally out of scope for this PR.

- **`stripViewMode` followed by `applyViewMode('default')` is redundant** - `src/cli/commands/init.ts:1107-1108` (Confidence: 62%) -- When `viewMode` is `'default'`, `stripViewMode` removes the key, then `applyViewMode(content, 'default')` also deletes the key. Not a bug (idempotent), but the strip-then-apply pattern re-parses and re-serializes JSON twice for no effect in the default case. Consistent with the flags pattern (`stripFlags` then `applyFlags`), so this is a style choice.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Testing Score**: 4/10
**Recommendation**: CHANGES_REQUESTED

The PR adds two new pure functions (`applyViewMode`, `stripViewMode`) and a new manifest field (`viewMode`) with zero test coverage. The existing test suite for `flags.ts` and `manifest.ts` sets a clear precedent: every public function and every manifest field normalization path has dedicated tests. The new code follows the exact same patterns as the tested code but ships without tests, breaking the established convention. The fixes are straightforward -- approximately 40-50 lines of test code following the existing patterns in the same test files. Applies ADR-001 (no migration/compat code needed for viewMode since it's a new additive field).
