# Code Review Summary

**Branch**: feat/init-flags-viewmode → main
**Date**: 2026-05-14_0955

## Merge Recommendation: CHANGES_REQUESTED

This PR adds 3 new Claude Code flags (`disable-adaptive-thinking`, `always-thinking`, `disable-git-instructions`) and view mode support (`default`/`verbose`/`focus`) to the init flow and manifest. The three new flags are clean additions following the established `FLAG_REGISTRY` pattern with no issues. The view mode feature is functionally correct but has six critical issues spanning architecture, type safety, testing, regression prevention, and cleanup. All issues are straightforward to fix but must be resolved before merge.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking | 0 | 6 | 0 | 0 | **6** |
| Should Fix | 0 | 0 | 4 | 0 | **4** |
| Pre-existing | 0 | 1 | 1 | 0 | **2** |

---

## Blocking Issues

All six blocking issues must be resolved before merge. Four are deduped across multiple reviewers (confidence boosted).

### 1. `applyViewMode` accepts unvalidated string parameter
**Files**: `src/cli/utils/flags.ts:222`
**Severity**: HIGH
**Confidence**: 92% (5 reviewers: security, architecture, consistency, typescript, reliability)

The function signature `applyViewMode(settingsJson: string, mode: string)` accepts any arbitrary string. While `init.ts` constrains calls to `'default' | 'verbose' | 'focus'` and uses a select prompt in the advanced path, the utility function itself enforces no boundaries. A future caller could pass untrusted input, and the function would silently write invalid view modes to `settings.json`. This violates the boundary validation principle ("parse at boundaries, trust internally") and the TypeScript skill's guidance.

**Fix**: Define a union type and validate at the function boundary:
```typescript
// flags.ts
export const VIEW_MODES = ['default', 'verbose', 'focus'] as const;
export type ViewMode = typeof VIEW_MODES[number];

export function applyViewMode(settingsJson: string, mode: ViewMode): string {
  // Type-safe parameter; add runtime guard for JS callers:
  if (!VIEW_MODES.includes(mode)) {
    return settingsJson;
  }
  const settings = JSON.parse(settingsJson) as Record<string, unknown>;
  if (mode === 'default') {
    delete settings['viewMode'];
  } else {
    settings['viewMode'] = mode;
  }
  return JSON.stringify(settings, null, 2) + '\n';
}
```

Also update `ManifestData.viewMode` to use `ViewMode | undefined` instead of `string | undefined`, and validate in `readManifest` (see issue #5).

---

### 2. Uninstall does not strip viewMode from settings.json
**Files**: `src/cli/commands/uninstall.ts:414`
**Severity**: HIGH
**Confidence**: 90%

The init flow writes `viewMode` to `settings.json` via `applyViewMode()`, but the uninstall flow calls `stripFlags()` but never calls `stripViewMode()`. After uninstall, the orphaned `viewMode` key remains in the user's settings. This breaks the uninstall cleanup contract: every Devflow-managed key must have a corresponding cleanup path (applies ADR-001 clean break philosophy).

**Fix**: Import and call `stripViewMode` in the uninstall settings cleanup:
```typescript
import { stripFlags, stripViewMode } from '../utils/flags.js';

// At uninstall.ts:414
settingsContent = stripFlags(settingsContent);
settingsContent = stripViewMode(settingsContent);
```

---

### 3. No tests for new `applyViewMode` and `stripViewMode` functions
**Files**: `src/cli/utils/flags.ts:222-236`, test file missing
**Severity**: HIGH
**Confidence**: 95% (testing, regression reviewers)

Two new pure functions were added to `flags.ts` but the existing test file `tests/flags.test.ts` has zero test coverage for them. The existing file thoroughly tests `applyFlags`, `stripFlags`, and `getDefaultFlags` with multiple scenarios each (roundtrip, preservation of existing settings, edge cases). This is a gap in the established testing convention for this module.

**Fix**: Add test cases to `tests/flags.test.ts` covering default/non-default modes, preservation of other settings, roundtrip behavior, and missing viewMode:
```typescript
describe('applyViewMode', () => {
  it('removes viewMode key when mode is default', () => {
    const input = JSON.stringify({ viewMode: 'verbose', hooks: {} }, null, 2);
    const result = JSON.parse(applyViewMode(input, 'default'));
    expect(result.viewMode).toBeUndefined();
    expect(result.hooks).toEqual({});
  });

  it('sets viewMode for non-default modes', () => {
    const input = JSON.stringify({}, null, 2);
    expect(JSON.parse(applyViewMode(input, 'verbose')).viewMode).toBe('verbose');
    expect(JSON.parse(applyViewMode(input, 'focus')).viewMode).toBe('focus');
  });

  it('preserves existing settings', () => {
    const input = JSON.stringify({ hooks: {}, tui: 'fullscreen' }, null, 2);
    const result = JSON.parse(applyViewMode(input, 'verbose'));
    expect(result.hooks).toEqual({});
    expect(result.tui).toBe('fullscreen');
    expect(result.viewMode).toBe('verbose');
  });
});

describe('stripViewMode', () => {
  it('removes viewMode key', () => {
    const input = JSON.stringify({ viewMode: 'focus', hooks: {} }, null, 2);
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

Also add tests to `tests/manifest.test.ts` for the new `viewMode` field normalization and roundtrip.

---

### 4. No tests for `viewMode` field in manifest
**Files**: `src/cli/utils/manifest.ts:22,71`, test file `tests/manifest.test.ts`
**Severity**: HIGH
**Confidence**: 90% (testing reviewer)

The `ManifestData` interface gained an optional `viewMode?: string` field and `readManifest` normalizes it (line 71). The existing test file comprehensively tests every other optional field (`hud`, `learn`, `knowledge`, `decisions`, `rules`, `flags`) but has no test for `viewMode`. Additionally, the "returns parsed manifest for valid data" test fixture does not include the `viewMode` field, so the golden-path roundtrip test does not exercise it at all.

**Fix**: Add tests to `tests/manifest.test.ts`:
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

Also update the golden-path test fixture to include `viewMode: 'verbose'`.

---

### 5. `ManifestData.viewMode` typed as unvalidated string
**Files**: `src/cli/utils/manifest.ts:22,71`
**Severity**: HIGH
**Confidence**: 87% (architecture, consistency, typescript, reliability reviewers)

The `ManifestData` interface type `viewMode?: string` allows any string. The `readManifest` function accepts any string value without validating it belongs to the set of known modes (`'default'`, `'verbose'`, `'focus'`). A corrupted or manually-edited manifest could round-trip an invalid mode back into settings on re-init.

**Fix**: Import the `ViewMode` type from `flags.ts` (once defined there) and validate in `readManifest`:
```typescript
// manifest.ts — at the import section
import type { ViewMode } from './flags.js';

// In ManifestData interface
viewMode?: ViewMode;

// In readManifest function
const knownModes = new Set(['default', 'verbose', 'focus']);
viewMode: typeof features.viewMode === 'string' && knownModes.has(features.viewMode)
  ? (features.viewMode as ViewMode)
  : undefined,
```

---

### 6. Redundant settings.json read in recommended path
**Files**: `src/cli/commands/init.ts:440-450`
**Severity**: HIGH
**Confidence**: 82% (complexity, architecture reviewers)

The recommended path reads `settings.json` at line 445 to preserve `viewMode`, then reads it again at line 1074 for the main settings mutation block. This means the viewMode preservation logic adds a separate I/O + parse step that is disconnected from the main mutation block. Additionally, the path construction (`path.join(os.homedir(), '.claude')`) diverges from the later `getInstallationPaths(scope)` resolution, creating a maintenance risk if path resolution ever changes.

**Fix**: Extract the viewMode preservation logic into the main settings mutation block (lines 1073-1118), before `stripViewMode` is called:
```typescript
// Inside the settings mutation block, before stripViewMode:
try {
  const currentParsed = JSON.parse(content) as Record<string, unknown>;
  if (currentParsed && typeof currentParsed === 'object' && !Array.isArray(currentParsed)) {
    if (currentParsed.viewMode === 'verbose' || currentParsed.viewMode === 'focus') {
      viewMode = currentParsed.viewMode;
    }
  }
} catch { /* ignore */ }

content = stripViewMode(content);
content = applyViewMode(content, viewMode);
```

This consolidates all settings.json mutations into one block and eliminates a separate `fs.readFile`.

---

## Should-Fix Issues

These are not blocking but should be resolved as part of this PR:

### 1. Missing JSDoc on view mode functions
**Files**: `src/cli/utils/flags.ts:222,232`
**Severity**: MEDIUM
**Confidence**: 90%

Every exported function in `flags.ts` has JSDoc comments, but `applyViewMode` and `stripViewMode` do not. This breaks the established pattern and means the `'default'`-means-delete behavior is undocumented at the call site.

**Fix**: Add JSDoc comments:
```typescript
/**
 * Apply view mode to a settings JSON string.
 * When mode is 'default', removes the viewMode key entirely (Claude Code's default behavior).
 * Non-default modes ('verbose', 'focus') are set as the viewMode key value.
 */
export function applyViewMode(settingsJson: string, mode: ViewMode): string {

/**
 * Strip viewMode key from a settings JSON string.
 * Used before re-applying to ensure clean upgrade from any previous value.
 */
export function stripViewMode(settingsJson: string): string {
```

---

### 2. `readManifest` does not validate viewMode against known values
**Files**: `src/cli/utils/manifest.ts:71`
**Severity**: MEDIUM
**Confidence**: 82%

While issue #5 above addresses the type, the runtime validation is worth calling out separately. When reading a manifest, unknown `viewMode` values should gracefully default to `undefined` rather than propagate invalid data.

**Fix**: See issue #5 above — validate in the readManifest normalization block.

---

### 3. Recommended path reads settings.json with unvalidated type check
**Files**: `src/cli/commands/init.ts:440-450`
**Severity**: MEDIUM
**Confidence**: 80%

The code casts `JSON.parse(currentSettings)` to `Record<string, unknown>` without guarding against non-object JSON (e.g., a string or array). While unlikely, malformed settings.json could cause issues.

**Fix**: Add a type guard:
```typescript
const parsed = JSON.parse(currentSettings);
if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
  if (parsed.viewMode === 'verbose' || parsed.viewMode === 'focus') {
    viewMode = parsed.viewMode;
  }
}
```

---

### 4. View mode is not part of FLAG_REGISTRY pattern
**Files**: `src/cli/utils/flags.ts:220-236`
**Severity**: MEDIUM
**Confidence**: 82%

The view mode utilities are colocated in `flags.ts` but do not participate in the `FLAG_REGISTRY` pattern. They have no CLI management path (`devflow flags --view-mode`), no presence in `getDefaultFlags()`, and no integration with `devflow flags --status/--list`. This creates a module with two distinct responsibilities (flag registry + view mode management).

**Future improvement** (not blocking): Model view mode as a `type: 'setting'` entry in `FLAG_REGISTRY` to give it CLI management for free, or extract to a separate module if view mode needs its own lifecycle. For now, the colocated utilities are acceptable.

---

## Pre-existing Issues (Not Blocking)

### 1. Init action handler is 1134 lines with high cyclomatic complexity
**Files**: `src/cli/commands/init.ts:165-1298`
**Severity**: HIGH
**Confidence**: 85% (complexity reviewer)

This is not new — the function was already well past critical thresholds. However, the repeated pattern (feature default in recommended path + prompt in advanced path + hook toggle + manifest field) is a clear candidate for future extraction. The PR adds ~35 lines to an already-monolithic function, continuing the pattern of feature accretion. Do not block on this, but consider follow-up extraction work.

---

### 2. Multiple JSON parse/serialize round-trips in settings mutation block
**Files**: `src/cli/commands/init.ts:1073-1118`
**Severity**: HIGH
**Confidence**: 88% (complexity reviewer)

The settings mutation block chains multiple operations that each parse and serialize JSON internally (`stripFlags`, `applyFlags`, `stripViewMode`, `applyViewMode`). With the new functions, there are now at least 4 JSON parse/stringify cycles in this block. Not a performance bottleneck (one-shot CLI), but a maintainability concern. Future refactor should consolidate to a single parse/mutate/stringify pass.

---

## Action Plan

1. **Fix `applyViewMode` type safety** (issue #1) — Define `ViewMode` union type, add runtime validation, update signature
2. **Add `stripViewMode` to uninstall** (issue #2) — One-line fix in uninstall.ts
3. **Write tests for view mode functions** (issues #3, #4) — ~80 lines of test code in two test files
4. **Validate manifest viewMode** (issue #5) — Import `ViewMode` type, add validation in `readManifest`
5. **Consolidate redundant settings.json read** (issue #6) — Move viewMode preservation into main mutation block
6. **Add JSDoc comments** (should-fix #1) — Document behavior of new functions

All fixes are straightforward and follow the established patterns in the codebase. Estimated effort: 1-2 hours. No architectural rework required.

---

## Notes

- The three new flags (`disable-adaptive-thinking`, `always-thinking`, `disable-git-instructions`) are clean additions following `FLAG_REGISTRY` with zero issues
- View mode feature is well-designed and user-facing but has implementation gaps in testing, type safety, and cleanup
- Applies ADR-001 (clean break philosophy): no migration code needed for viewMode since it's a new additive field; unknown values gracefully degrade to undefined
- No regressions in existing tests or functionality
