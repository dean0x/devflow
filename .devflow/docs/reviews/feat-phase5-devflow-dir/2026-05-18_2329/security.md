# Security Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-18

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**TOCTOU race in `moveFile` migration — `access` check then `rename` is non-atomic** - `src/cli/utils/migrations.ts:15-32`
**Confidence**: 82%
- Problem: The `moveFile` function checks source existence with `fs.access(src)`, then checks destination absence with `fs.access(dest)`, then renames. Between the access checks and the rename, another concurrent session (migrations run in parallel across projects via `pooled()`, and concurrent `devflow init` invocations are possible) could create the destination or remove the source. If two concurrent migrations both pass the `access(dest)` check before either writes, one rename succeeds and the other either throws ENOENT (source gone) or silently overwrites (depending on OS).
- Impact: During migration, files could be lost or overwritten if two concurrent `devflow init` runs trigger the same migration on the same project. The migration is tracked globally (`~/.devflow/migrations.json`), which mitigates this since the ID is checked before running, but there is a race window between the "has this migration run?" check and the marker write. For a developer tool that runs locally with low concurrency, this is unlikely but not impossible.
- Fix: Use `fs.rename` directly and handle ENOENT (source gone = already migrated) and EEXIST (dest exists = already migrated) as idempotent success. Remove the `access` checks:
```typescript
async function moveFile(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fs.rename(src, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return; // Source already gone
    if (code === 'EXDEV') {
      try {
        await fs.cp(src, dest, { recursive: true, errorOnExist: true });
        await fs.rm(src, { recursive: true, force: true });
      } catch (cpErr) {
        if ((cpErr as NodeJS.ErrnoException).code === 'ERR_FS_CP_EEXIST') return;
        throw cpErr;
      }
    } else {
      throw err;
    }
  }
}
```

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

### HIGH

**Misleading variable name `memoryDir` in `decisions-append` masks path derivation logic** - `scripts/hooks/json-helper.cjs:1828-1831`
**Confidence**: 85%
- Problem: The variable named `memoryDir` on line 1829 is computed as `path.dirname(decisionsDir)` which yields `.devflow/` — not the memory directory. Then `projectRoot = path.dirname(memoryDir)` relies on this misnaming. The code works correctly because the path arithmetic happens to produce the right result, but the naming creates a maintenance hazard: a future developer reading `memoryDir` will assume it points to `.devflow/memory/` and may use it incorrectly.
- Impact: No immediate security or functional bug, but misleading variable names in path-sensitive code increase the risk of future path confusion bugs that could lead to data being written to wrong directories.
- Fix: Rename to reflect reality:
```javascript
const decisionsDir = path.dirname(decisionsFile);
const devflowDir = path.dirname(decisionsDir);  // .devflow/
const projectRoot = path.dirname(devflowDir);
const decisionsLockDir = getDecisionsLockDir(projectRoot);
```

### MEDIUM

**`decisions-append` derives `projectRoot` from file path structure instead of using canonical source** - `scripts/hooks/json-helper.cjs:1828-1831`
**Confidence**: 80%
- Problem: The `decisions-append` case computes `projectRoot` by walking up `path.dirname()` from the input `decisionsFile` argument, assuming the file is exactly 3 directories deep under the project root (`.devflow/decisions/decisions.md`). If the path layout ever changes, or if an attacker crafts a `decisionsFile` argument pointing elsewhere, the derived `projectRoot` would be wrong — causing the lock to be acquired in the wrong directory and the usage/notification files to be written to an unintended location. Other cases like `render-ready` receive `baseDir` directly as an explicit argument and use `getDecisionsLockDir(baseDir)`, which is safer.
- Impact: Currently functional because callers always pass the correct `.devflow/decisions/decisions.md` path. But the implicit coupling between file path depth and variable derivation is fragile. An incorrect `projectRoot` would cause lock contention isolation failure (lock acquired in wrong dir) and misplaced notification writes.
- Fix: Accept `projectRoot` or `cwd` as an explicit argument to `decisions-append`, consistent with other operations:
```javascript
case 'decisions-append': {
  const decisionsFile = safePath(args[0]);
  const entryType = args[1];
  const cwd = args[3] || process.cwd();  // explicit project root
  ...
  const decisionsLockDir = getDecisionsLockDir(cwd);
```

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`getKnowledgePath` and `getHandoffPath` accept unsanitized slugs** - `src/cli/utils/project-paths.ts:216,255` (Confidence: 70%) — These functions use `path.join(projectRoot, '.devflow', 'features', slug, ...)` without any path traversal validation. Callers like `feature-knowledge.cjs` do call `validateSlug()` before use, but the defense is not at the boundary — a new caller could forget. Consider adding slug validation inside the path module itself for defense in depth.

- **Cross-device migration `cp` then `rm` is not atomic** - `src/cli/utils/migrations.ts:27-28` (Confidence: 65%) — The EXDEV fallback in `moveFile` does `fs.cp(src, dest)` followed by `fs.rm(src)`. If the process crashes between copy and delete, data exists in both locations. On next run, the `access(dest)` check returns early, leaving the old source in place. This is a data duplication issue rather than data loss, and the migration is one-time, so the practical risk is very low.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 1 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Security Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The directory consolidation is fundamentally a path-refactoring PR with no new authentication, cryptographic, injection, or secrets-handling concerns. The `project-paths.ts`/`.cjs` centralization is a security improvement — it eliminates scattered string-concatenation path construction. The `.devflow/.gitignore` correctly covers all transient per-developer files while allowing committed content (decisions.md, pitfalls.md, features/) to be tracked. The migration code is well-structured with idempotent move semantics and proper lock acquisition.

The TOCTOU race in `moveFile` is the only blocking concern — it is a real race condition in the migration path that could cause data loss in concurrent scenarios, though the practical risk is low given the single-developer usage pattern. The `decisions-append` path derivation issues are non-blocking but should be addressed to prevent future maintenance confusion. The overall security posture of the codebase is maintained — this PR applies ADR-001 (clean break philosophy) appropriately via a one-time migration rather than accumulating backward-compatible code paths (avoids PF-001).
