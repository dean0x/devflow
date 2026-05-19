# Reliability Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-19

## Issues in Your Changes (BLOCKING)

### MEDIUM

**TOCTOU in .devflow/.gitignore creation (consolidate-to-devflow-dir migration)** - `src/cli/utils/migrations.ts:358`
**Confidence**: 85%
- Problem: The gitignore creation uses `access()` then `writeFile()` — a TOCTOU window where a concurrent migration on the same project could check access, both pass, and both write. This is the same anti-pattern fixed by the `moveFile` refactor earlier in this PR. While the per-project concurrency cap (16) makes collisions unlikely, and the written content is deterministic (so double-write is functionally idempotent), it contradicts the TOCTOU-elimination approach applied to `moveFile` in the same commit.
- Fix: Use `writeFile` with `{ flag: 'wx' }` (exclusive create) and catch `EEXIST`:
```typescript
// 5. Create .devflow/.gitignore if not present
const devflowGitignore = path.join(devflowDir, '.gitignore');
try {
  await fs.writeFile(devflowGitignore, getDevflowGitignoreContent(), { flag: 'wx' });
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
}
```

**TOCTOU in rename-kb-to-knowledge migration** - `src/cli/utils/migrations.ts:230-231`
**Confidence**: 82%
- Problem: The `access(oldPath)` + `rename(oldPath, newPath)` pattern is the same TOCTOU race eliminated in `moveFile` by this PR. Between the `access` check and the `rename` call, the file could be removed by a concurrent process. Since the same PR explicitly documents this as a fixed anti-pattern in `moveFile`, the `rename-kb-to-knowledge` migration should follow the same approach. The broad `catch` block currently swallows both "file not found" and genuine rename errors, reducing debuggability.
- Fix: Drop the access guard and catch specific error codes from rename directly:
```typescript
for (const [oldName, newName] of renames) {
  const oldPath = path.join(featuresDir, oldName);
  const newPath = path.join(featuresDir, newName);
  try {
    await fs.rename(oldPath, newPath);
    infos.push(`Renamed .features/${oldName} -> .features/${newName}`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') continue; // already renamed or never existed
    throw err; // surface real errors
  }
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Non-atomic .gitignore writes in migration step 6** - `src/cli/utils/migrations.ts:378`
**Confidence**: 80%
- Problem: The root `.gitignore` cleanup in step 6 uses `fs.writeFile()` for a read-modify-write cycle without atomic semantics. Other migration code in this PR (and across the codebase) consistently uses `writeFileAtomicExclusive` for file rewrites. A crash between the read and write would truncate the gitignore. While unlikely, it is inconsistent with the atomic-write discipline applied elsewhere in this PR.
- Fix: Use `writeFileAtomicExclusive(gitignorePath, cleaned.join('\n'))` for consistency with the rest of the atomic-write convention.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`createDocsStructure` sequential mkdir calls** - `src/cli/utils/post-install.ts:509-511`
**Confidence**: 85%
- Problem: Three sequential `mkdir` calls that are independent of each other. The consolidate migration (same PR) explicitly parallelizes identical mkdir calls with `Promise.all`. These three could follow the same pattern. Not introduced by this PR (only the log message changed), but this function was touched and the pattern inconsistency was introduced by the same PR's choices.
- Fix:
```typescript
await Promise.all([
  fs.mkdir(path.join(docsDir, 'status', 'compact'), { recursive: true }),
  fs.mkdir(path.join(docsDir, 'reviews'), { recursive: true }),
  fs.mkdir(path.join(docsDir, 'releases'), { recursive: true }),
]);
```

## Suggestions (Lower Confidence)

- **EXDEV fallback in moveFile has no dest-exists guard** - `src/cli/utils/migrations.ts:29-30` (Confidence: 65%) -- The `cp` + `rm` fallback for cross-device moves does not check if `dest` already exists before copying. If `rename` raised `EXDEV` (not `EEXIST`), the destination is guaranteed absent on the same device, but on cross-device the semantics may differ. On macOS/Linux `cp` overwrites by default so this is safe in practice, but an explicit check would make the contract clearer.

- **Parallel moves with shared parent directories** - `src/cli/utils/migrations.ts:325` (Confidence: 70%) -- `Promise.all` over the memMap entries calls `moveFile` for 26 entries concurrently. Each `moveFile` calls `mkdir(path.dirname(dest), { recursive: true })`. When multiple entries share the same parent directory (e.g., 7 entries target `decisions/`), the concurrent `mkdir` calls are redundant. This is functionally safe (`recursive: true` handles it), but the step-1 `Promise.all` that pre-creates all 6 subdirectories already guarantees these parents exist, making the per-file mkdir a no-op in the common case. The overhead is negligible but the structure could be simplified.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Reliability Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR demonstrates strong reliability awareness: TOCTOU fixes in `moveFile`, parallelized I/O with `Promise.all`, derived skip sets to eliminate manual sync obligations, and atomic write patterns for `features/index.json`. The two blocking MEDIUM issues are consistency gaps where the same TOCTOU patterns fixed in `moveFile` were not applied to the `rename-kb-to-knowledge` migration and the `.devflow/.gitignore` creation. Both are low-risk in practice (migrations run once per machine, content is idempotent) but should be fixed for consistency with the PR's own stated approach. Applies ADR-001 (clean break philosophy observed -- migration moves data forward without backward-compat shims). Avoids PF-001 (no backward-compat layer added for the directory consolidation).
