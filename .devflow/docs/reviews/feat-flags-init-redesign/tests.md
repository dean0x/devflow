# Tests Review Report

**Branch**: feat/flags-init-redesign -> main
**Date**: 2026-03-27

## Issues in Your Changes (BLOCKING)

### HIGH

**`resolveEnabledFlags` logic bug allows manifest with empty flags array to silently fall through to defaults** - `src/cli/commands/flags.ts:15`
**Confidence**: 85%
- Problem: `resolveEnabledFlags` checks `manifest.features.flags.length > 0` before returning the manifest's flags. This means a user who explicitly disabled ALL flags (empty array `[]`) will get the defaults re-applied instead of an empty set. The function conflates "no manifest" with "manifest says zero flags enabled."
- Impact: `devflow flags --disable tool-search,lsp,clear-context-on-plan` would appear to work, but next time `--enable` or `--status` is called, it would resolve back to defaults because the manifest has `flags: []`.
- Fix: Distinguish between "manifest exists with explicit empty flags" and "no manifest / legacy manifest without flags field":
  ```typescript
  async function resolveEnabledFlags(devflowDir: string): Promise<string[]> {
    const manifest = await readManifest(devflowDir);
    if (manifest && Array.isArray(manifest.features.flags)) {
      return manifest.features.flags;
    }
    return getDefaultFlags();
  }
  ```
  This is already safely typed since `readManifest` normalizes missing `flags` to `[]`. The test for this behavior is **missing entirely** from `tests/flags.test.ts`.

**No tests for `flags.ts` command module (`resolveEnabledFlags`, `updateSettingsFlags`, `updateManifestFlags`, `parseFlagIds`)** - `src/cli/commands/flags.ts:13-63`
**Confidence**: 90%
- Problem: The `flags.ts` command module contains 4 non-trivial functions (`resolveEnabledFlags`, `updateSettingsFlags`, `updateManifestFlags`, `parseFlagIds`) that perform I/O and validation. None of these are exported or tested. The test file `tests/flags.test.ts` only covers the pure utility functions from `src/cli/utils/flags.ts`.
- Impact: The command-layer logic has zero automated coverage. The `resolveEnabledFlags` bug described above would have been caught with a test. The `parseFlagIds` function calls `process.exit(1)` on invalid input -- this is untested and makes the function difficult to test without mocking `process.exit`.
- Fix: Export the pure functions (`parseFlagIds`, `resolveEnabledFlags`) or extract them to a testable module. Add tests covering:
  1. `resolveEnabledFlags` with no manifest (should return defaults)
  2. `resolveEnabledFlags` with manifest containing empty flags array (should return `[]`, not defaults -- currently broken)
  3. `resolveEnabledFlags` with manifest containing specific flags
  4. `parseFlagIds` with valid IDs
  5. `parseFlagIds` with invalid IDs (mock `process.exit`)
  6. `updateSettingsFlags` writes correct JSON
  7. `updateManifestFlags` updates manifest correctly

### MEDIUM

**`applyFlags` error path not tested: malformed JSON input** - `src/cli/utils/flags.ts:69`
**Confidence**: 82%
- Problem: `applyFlags` calls `JSON.parse(settingsJson)` without try/catch. If called with malformed JSON (which is plausible -- corrupt settings file), it throws an unhandled exception. `stripFlags` has the same issue at line 93. Neither function's error path is tested.
- Impact: If `settings.json` is corrupted, both `devflow init` and `devflow flags --enable/--disable` will crash with an opaque JSON parse error instead of a graceful failure.
- Fix: Either add try/catch with meaningful error messages, or add tests that document this is expected behavior (caller is responsible for valid JSON). At minimum, add a test:
  ```typescript
  it('throws on malformed JSON input', () => {
    expect(() => applyFlags('not-json{', ['tool-search'])).toThrow();
  });

  it('throws on malformed JSON input', () => {
    expect(() => stripFlags('not-json{')).toThrow();
  });
  ```

**No test for `applyFlags` idempotency (applying same flag twice)** - `tests/flags.test.ts:59-110`
**Confidence**: 80%
- Problem: The test suite does not verify that calling `applyFlags` twice with the same flag produces the same result (idempotency). In the current implementation, applying `tool-search` twice would work correctly due to object key overwriting, but this behavioral contract is not asserted.
- Fix: Add a test:
  ```typescript
  it('is idempotent when applying the same flags twice', () => {
    const input = JSON.stringify({ hooks: {} }, null, 2);
    const once = applyFlags(input, ['tool-search']);
    const twice = applyFlags(once, ['tool-search']);
    expect(JSON.parse(once)).toEqual(JSON.parse(twice));
  });
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`manifest.test.ts` does not test the new `flags` field during roundtrip write/read** - `tests/manifest.test.ts:118-163`
**Confidence**: 82%
- Problem: The `writeManifest` tests were updated to include `flags: []` in their fixtures, but no test verifies writing a manifest with a non-empty `flags` array (e.g., `flags: ['tool-search', 'lsp']`) and reading it back correctly. The normalization code in `readManifest` that handles the `flags` field is tested for the missing-field case but not for populated data.
- Fix: Add a test case:
  ```typescript
  it('preserves non-empty flags array through write/read roundtrip', async () => {
    const data: ManifestData = {
      version: '1.4.0',
      plugins: ['devflow-core-skills'],
      scope: 'user',
      features: { teams: false, ambient: true, memory: true, learn: false, hud: false, flags: ['tool-search', 'lsp'] },
      installedAt: '2026-03-13T00:00:00.000Z',
      updatedAt: '2026-03-13T00:00:00.000Z',
    };
    await writeManifest(tmpDir, data);
    const result = await readManifest(tmpDir);
    expect(result!.features.flags).toEqual(['tool-search', 'lsp']);
  });
  ```

**No test coverage for init.ts two-mode flow integration with flags** - `src/cli/commands/init.ts:270-828`
**Confidence**: 80%
- Problem: The init command gained significant new logic: a two-mode (recommended/advanced) branching flow, flag selection in advanced mode, and automatic flag application in recommended mode. None of this is tested. The `init-logic.test.ts` file tests pure utility functions extracted from init, but the orchestration logic (which mode applies defaults, which respects CLI overrides) has no coverage.
- Impact: The recommended path silently applies `getDefaultFlags()` and the advanced path offers a multiselect -- neither path is verified by any test. Regressions in the mode selection logic would go undetected.
- Fix: This is a pre-existing architectural issue (PF-002 in pitfalls.md notes init is a 765+ line monolith). The recommended fix from PF-002 (extract `collectInitChoices()`) would make this testable. At minimum, test the pure decision logic:
  1. Recommended mode defaults (verify `enabledFlags` equals `getDefaultFlags()`)
  2. CLI flag overrides in recommended mode (e.g., `--teams` overrides default)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`parseFlagIds` uses `process.exit(1)` for validation errors** - `src/cli/commands/flags.ts:59`
**Confidence**: 85%
- Problem: Using `process.exit(1)` in a validation function makes it impossible to test without mocking the process, and violates the project's "always use Result types" principle from CLAUDE.md. Other similar functions in the codebase (e.g., `parsePluginSelection` in init.ts) return result objects with `invalid` arrays.
- Impact: Cannot unit-test the error path of `parseFlagIds`. The function kills the process instead of returning an error the caller can handle.

## Suggestions (Lower Confidence)

- **FLAG_REGISTRY count assertion is fragile** - `tests/flags.test.ts:11` (Confidence: 65%) -- The test `expect(FLAG_REGISTRY.length).toBeGreaterThanOrEqual(5)` will never fail as flags are added but would silently pass if flags were accidentally removed. Consider using an exact count or a more meaningful invariant.

- **Missing test for `stripFlags` then `applyFlags` roundtrip (reverse order)** - `tests/flags.test.ts:163` (Confidence: 70%) -- The roundtrip test verifies apply-then-strip but not strip-then-apply. The two compositions are not identical -- strip-then-apply should produce exactly the default state, which could be a useful regression test.

- **`updateSettingsFlags` swallows all read errors as empty object** - `src/cli/commands/flags.ts:29` (Confidence: 60%) -- The catch block on `fs.readFile` falls back to `'{}'` for any error, including permission errors (EACCES). This could silently overwrite a settings file the user cannot read but can write to.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Tests Score**: 5/10
**Recommendation**: CHANGES_REQUESTED

The pure utility functions in `src/cli/utils/flags.ts` are well tested with good coverage of happy paths, edge cases, and a roundtrip test. However, the command module (`src/cli/commands/flags.ts`) has zero test coverage despite containing non-trivial logic with a real bug (`resolveEnabledFlags` conflates empty flags with missing manifest). The init.ts changes (two-mode flow, flag integration) are also untested. The test quality for what exists is solid -- behavioral focus, clear AAA structure, no mocking needed for pure functions -- but the coverage gap is significant for a feature that modifies user settings files.
