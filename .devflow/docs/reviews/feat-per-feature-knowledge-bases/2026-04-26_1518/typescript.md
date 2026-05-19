# TypeScript Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-26

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Redundant type annotation on `find` callback** - `src/cli/commands/kb.ts:475`
**Confidence**: 85%
- Problem: The callback `(k: { slug: string }) => k.slug === kbSlug` explicitly annotates `k` with `{ slug: string }`, but `kbs` is already typed as `Array<{ slug: string; name: string; category: string; directories: string[]; lastUpdated: string }>` via the `FeatureKbModule` interface (line 22). TypeScript infers the element type from the array. The manual annotation narrows the inferred type, potentially masking future type errors if the `FeatureKbModule` interface changes.
- Fix: Remove the redundant annotation and let TypeScript infer the type:
  ```typescript
  const kbEntry = kbs.find((k) => k.slug === kbSlug);
  ```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Unchecked `JSON.parse` in hook functions** - `src/cli/commands/kb.ts:69,102,133` (Confidence: 65%) -- The `addKbHook`, `removeKbHook`, and `hasKbHook` functions call `JSON.parse` on the input string without try/catch. If called with invalid JSON they throw a raw `SyntaxError`. This matches the existing pattern in `removeAmbientHook`, `removeLearningHook`, etc. (all callers wrap in try/catch), so it is consistent with the codebase convention. Still, defensive parsing at the function level would be safer.

- **Long line in `entriesToAdd` array** - `src/cli/utils/post-install.ts:476` (Confidence: 60%) -- The `entriesToAdd` array on line 476 is a single line with 8 string entries totaling ~145 characters. Breaking it into a multi-line array would improve readability and make future additions cleaner. This is purely stylistic and consistent with how the original shorter array was written.

- **Test error assertion pattern uses `let threw` flag** - `tests/feature-kb/feature-kb.test.ts:509,538,550,562` (Confidence: 70%) -- Four tests use a `let threw = false; try { ... } catch { threw = true; ... } expect(threw).toBe(true)` pattern instead of Vitest's built-in `expect(() => ...).toThrow()`. The pattern works and correctly captures the exit status, but only the status assertion requires the try/catch; the "did it throw" check could use `expect.assertions(1)` or a `rejects`/`toThrow` wrapper for clarity. However, since `execFileSync` needs the catch to inspect the error's `.status` property, the pattern is defensible.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Assessment

The TypeScript changes in this PR are well-structured and follow established codebase patterns consistently:

- **No `any` types** -- All new code uses proper types. The `FeatureKbModule` interface provides strong typing for the CJS module bridge. The `Settings` and `HookMatcher` imports are used correctly.
- **Consistent hook management pattern** -- `addKbHook`/`removeKbHook`/`hasKbHook` follow the exact same signatures and structure as `addAmbientHook`/`removeAmbientHook`/`hasAmbientHook` and the learning/memory equivalents. The function union input `string | Settings` on `hasKbHook` matches `hasAmbientHook`.
- **Non-null assertions are safe** -- The `settings.hooks!` assertions on lines 112/114 are guarded by the `if (matchers)` check that ensures `settings.hooks?.SessionEnd` is truthy, so `settings.hooks` must be defined.
- **Manifest backwards compatibility** -- The `kb` field is properly defaulted to `false` in `readManifest` (line 59 of manifest.ts) for old manifests that lack it, matching the `hud`/`learn` pattern.
- **Test quality** -- New tests cover add/remove/has for the hook functions, CLI subcommands, idempotency, and edge cases. The `expect(index).not.toBeNull()` guards before `!` assertions in tests are a welcome improvement.
- **PF-001 check** -- No Promise resolver parameter renaming issues found in the changed test files. The tests use `execFileSync`/`execSync` callbacks correctly without shadowing concerns (avoids PF-001).

The single MEDIUM finding (redundant type annotation) is minor. The code is clean, well-typed, and production-ready.
