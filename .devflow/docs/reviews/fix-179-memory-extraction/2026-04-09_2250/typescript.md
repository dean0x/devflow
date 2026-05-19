# TypeScript Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Non-null assertion on `currentProject!` is unsafe when `scope` is narrowed by select** - `src/cli/commands/memory.ts:213`
**Confidence**: 85%
- Problem: The `scope` variable is assigned from `p.select()` whose options are conditionally built. When `currentProject` is null (no git root detected or no `.memory/`), the `'local'` option is excluded from the select. However, if `allProjects.length > 0` and `currentProject` is null, the select will only offer `'all'`, so `scope === 'local'` can never be true and the `!` assertion is never reached at runtime. The assertion is safe *today* due to the conditional option building, but it relies on implicit coupling between the options array construction and the downstream branch. If the select options are ever refactored (e.g., a third option added, or the guard changed), the `!` assertion becomes a runtime null dereference.
- Fix: Replace the non-null assertion with a guarded check that is robust to future changes:
```typescript
const targets = scope === 'local' && currentProject ? [currentProject] : allProjects;
```

### MEDIUM

**`--clear` path has no non-TTY fallback** - `src/cli/commands/memory.ts:196-206`
**Confidence**: 82%
- Problem: The `--clear` handler calls `p.select()` interactively but does not check `process.stdin.isTTY` beforehand. Other command paths in the codebase (e.g., `init.ts`) guard interactive prompts with TTY checks. Running `devflow memory --clear` in a non-interactive environment (CI, piped input) will produce an unhandled error or hang.
- Fix: Add a TTY guard before the select, with a sensible non-TTY default:
```typescript
if (!process.stdin.isTTY) {
  // Non-interactive: clean current project only (or all if no current project)
  const targets = currentProject ? [currentProject] : allProjects;
  // ... proceed with cleanup
} else {
  const scope = await p.select({ ... });
  // ... existing interactive flow
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`filterProjectsWithMemory` returns `string[]` but silently drops `fs.access` exceptions beyond ENOENT** - `src/cli/commands/memory.ts:146-154`
**Confidence**: 80%
- Problem: The `hasMemoryDir` function catches all exceptions from `fs.access`, not just `ENOENT`. If access is denied (EACCES) or the path is too long (ENAMETOOLONG), the project is silently skipped rather than surfacing a warning to the user.
- Fix: This is acceptable for a best-effort cleanup utility, but consider logging a warning for unexpected errors:
```typescript
async function hasMemoryDir(root: string): Promise<boolean> {
  try {
    await fs.access(path.join(root, '.memory'));
    return true;
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Unexpected error -- not just "doesn't exist"
      // Could log warning here
    }
    return false;
  }
}
```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`addMemoryHooks` double-parses when `hasMemoryHooks` already has the object** - `src/cli/commands/memory.ts:24-29` (Confidence: 70%) -- `addMemoryHooks` parses JSON into `settings` on line 25, then passes the already-parsed object to `hasMemoryHooks(settings)` (good). But `removeMemoryHooks` still parses separately on line 71. Consider accepting `string | Settings` on `removeMemoryHooks` too for symmetry, though this is a minor consistency point.

- **Test coverage gap for `--clear` in non-TTY** - `tests/memory.test.ts` (Confidence: 65%) -- The new `--clear` command path has no test coverage. The tests added cover `countMemoryHooks` accepting parsed Settings objects, but the interactive cleanup flow (project discovery, file deletion, error handling) is untested. Given this is a user-facing CLI command, consider at minimum a unit test for `filterProjectsWithMemory`.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The TypeScript quality is solid overall. No `any` types, proper use of `string | Settings` union with runtime narrowing, clean type imports via `import type`, and the codebase compiles with zero errors. The two blocking items are a non-null assertion that should be a guarded check (`currentProject!`) and a missing non-TTY guard on the new `--clear` interactive prompt. The removed tests (queue cleanup, knowledge file format) were replaced with focused tests for the new `Settings`-accepting overloads, which is a net positive for test relevance. The test suite for the core functions (`addMemoryHooks`, `removeMemoryHooks`, `hasMemoryHooks`, `countMemoryHooks`) remains comprehensive.
