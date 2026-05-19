# TypeScript Review Report

**Branch**: feat-per-feature-knowledge-bases -> main
**Date**: 2026-04-23T19:41:00Z

## Issues in Your Changes (BLOCKING)

### HIGH

**Missing `validateSlug` call in `refresh` command** - `src/cli/commands/kb.ts:242`
**Confidence**: 85%
- Problem: The `create` (line 143) and `remove` (line 316) subcommands both call `featureKb.validateSlug(slug)` before using user-provided slugs, but `refresh` does not when the user provides a slug argument. The slug is interpolated into a file path (line 264: `path.join(worktreePath, '.features', kbSlug, 'KNOWLEDGE.md')`) and into a prompt string sent to `claude -p` (line 283) before `checkStaleness` eventually validates it on line 263. While `checkStaleness` does call `validateSlug` internally, the inconsistency means (a) a malformed slug triggers a confusing internal error instead of a user-facing message, and (b) if the order of operations ever changes, the path construction could precede validation.
- Fix: Add validation at the top of the `refresh` action, consistent with `create` and `remove`:
  ```typescript
  .action(async (slug?: string) => {
    if (slug) {
      try {
        featureKb.validateSlug(slug);
      } catch (err) {
        p.log.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }
    p.intro(color.cyan(slug ? `Refresh KB: ${slug}` : 'Refresh Stale KBs'));
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Non-null assertions (`!`) on `loadIndex` return values in tests** - `tests/feature-kb/feature-kb.test.ts:48-49,122-123,138,157,177,187`
**Confidence**: 82%
- Problem: Seven uses of the non-null assertion operator (`result!.version`, `index!.features[...]`) in test code. While `loadIndex` is typed as returning `{ version: number; features: Record<string, unknown> } | null`, the tests assert `not.toBeNull()` before using `!` in some cases but not consistently. The non-null assertions bypass TypeScript's null safety and could mask bugs if a test setup error causes `loadIndex` to return `null` unexpectedly -- the test would throw a confusing `Cannot read property of null` runtime error instead of a clear assertion failure.
- Fix: Use a guarded assertion pattern that narrows the type:
  ```typescript
  const index = loadIndex(tmp);
  expect(index).not.toBeNull();
  if (!index) throw new Error('unreachable'); // narrows type without !
  expect(index.features['payments']).toBeDefined();
  ```
  Or use Vitest's `assert` for a more concise pattern:
  ```typescript
  const index = loadIndex(tmp);
  assert(index !== null, 'loadIndex should return a valid index');
  // index is now narrowed to non-null
  ```

## Pre-existing Issues (Not Blocking)

No pre-existing TypeScript issues found in reviewed files.

## Suggestions (Lower Confidence)

- **`FeatureKbModule` interface could use `import type` for module-level isolation** - `src/cli/commands/kb.ts:18` (Confidence: 65%) -- The interface is defined inline rather than extracted to a shared type declaration. Since the CJS module exports 9 functions but the TS interface only types 5, a shared `FeatureKbModule` type (used by both `kb.ts` and the test file's inline type assertion) would prevent drift if the API surface changes. Low priority given the current scope.

- **Test file shadows built-in `require` identifier** - `tests/feature-kb/feature-kb.test.ts:15` (Confidence: 70%) -- `const require = createRequire(import.meta.url)` shadows the global `require`. This matches the project convention (`tests/learning/staleness.test.ts:15`, `tests/knowledge/index-generator.test.ts:13`), so it is intentional and consistent, but `_require` or a more specific name would be clearer (avoids PF-001 shadow-rename pitfall territory, though here the shadow is desired).

- **`as string` cast on `@clack/prompts` `text()` return** - `src/cli/commands/kb.ts:172,182,193` (Confidence: 62%) -- After `isCancel` guard, the `name` and `directoriesRaw` values are cast with `as string`. This follows the project convention (see `learn.ts:660` using `model as string`), so it is consistent. Ideally `@clack/prompts` would export a type-narrowing utility, but this is a limitation of the library's types rather than the PR's code.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The new TypeScript code is well-structured: no `any` types, proper `strict` mode compliance, consistent use of `createRequire` for CJS interop, thorough `FeatureKbModule` interface typing, and good `validateSlug` boundary validation coverage. The one blocking issue is a consistency gap -- `refresh` lacks the `validateSlug` guard that `create` and `remove` have. The test non-null assertions are a minor safety concern but do not block merge.
