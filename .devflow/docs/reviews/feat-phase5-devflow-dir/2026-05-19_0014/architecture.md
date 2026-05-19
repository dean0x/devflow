# Architecture Review Report

**Branch**: feat/phase5-devflow-dir -> main
**Date**: 2026-05-19

## Issues in Your Changes (BLOCKING)

### HIGH

**`moveFile` lost POSIX idempotency guard against destination overwrite** - `src/cli/utils/migrations.ts:18-35`
**Confidence**: 85%
- Problem: The TOCTOU fix removed the `access(dest)` pre-check that prevented overwriting an already-present destination on POSIX. On POSIX systems, `rename()` atomically replaces an existing destination without throwing `EEXIST` (EEXIST is Windows-only). The `if (code === 'EEXIST') return;` guard on line 26 will never trigger on macOS/Linux. In the old code, the `try { await fs.access(dest); return; } catch {}` was the defense against overwriting a file at `dest` that already existed.
- Impact: In a crash-recovery scenario where both src and dest exist, the migration will overwrite dest with src content. For this specific migration context (one-time registry-tracked, src is canonical), overwriting is likely harmless. However, the JSDoc promises "skipping when dest already exists (idempotent)" which is no longer true on POSIX — the function silently overwrites.
- Fix: Add an explicit POSIX-safe dest check, or handle rename's success-when-dest-exists as a tolerated overwrite:
```typescript
async function moveFile(src: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  // On POSIX, rename atomically replaces dest — check existence first
  // to preserve idempotent "skip if dest present" semantics.
  try { await fs.access(dest); return; } catch { /* dest absent, proceed */ }
  try {
    await fs.rename(src, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    if (code === 'EXDEV') {
      await fs.cp(src, dest, { recursive: true });
      await fs.rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}
```
Note: The TOCTOU concern from the old code (access+access+rename is non-atomic) is valid in theory but moot here because (a) the migration registry ensures single execution and (b) no concurrent process is racing to create dest. The access(dest) check is the pragmatic correct approach for this use case. Alternatively, update the JSDoc to document that the function prefers src content when both exist (making overwrite the intended behavior). applies ADR-001 — the migration code is permissible because it runs once and facilitates the directory consolidation.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Gitignore entry `learning/.learning.lock/` is a dead entry — lock lives at `memory/.learning.lock`** - `scripts/hooks/lib/project-paths.cjs:287-333`, `src/cli/utils/project-paths.ts:289-337`, `scripts/hooks/ensure-devflow-init:52`
**Confidence**: 90%
- Problem: The `.devflow/.gitignore` content (maintained in three synchronized locations) includes `learning/.learning.lock/` which would match `.devflow/learning/.learning.lock/`. However, `getLearningLockDir()` returns `.devflow/memory/.learning.lock` — the lock directory lives under `memory/`, not `learning/`. The `memory/` wildcard entry already covers it, so the explicit `learning/.learning.lock/` entry is dead. This predates this PR (the lock always lived in memory/) but was carried forward when the gitignore content was extracted into `getDevflowGitignoreContent()`.
- Impact: No functional impact (the lock is covered by the `memory/` wildcard), but dead entries in a canonical source-of-truth function create confusion for future maintainers.
- Fix: Either remove the dead entry `learning/.learning.lock/` from all three gitignore sources, or move the lock directory to `.devflow/learning/.learning.lock` (colocating it with other learning files would be more consistent with the decisions lock at `.devflow/decisions/.decisions.lock`).

### MEDIUM

**Three-copy gitignore content is a weaker DRY than a single source** - `scripts/hooks/lib/project-paths.cjs:286-334`, `src/cli/utils/project-paths.ts:289-337`, `scripts/hooks/ensure-devflow-init:40-87`
**Confidence**: 82%
- Problem: The PR description and commit message correctly identify that the old code had gitignore content maintained identically in three places. The fix extracts `getDevflowGitignoreContent()` as the canonical source (in both `.cjs` and `.ts`), but the shell hook `ensure-devflow-init` still carries a full heredoc copy with a comment pointing to the CJS function. There are now three copies: the CJS function, the TS function (marked "CJS COUNTERPART: must mirror this exactly"), and the shell heredoc (marked "CANONICAL SOURCE: ... keep in sync"). The comment trail documents the coupling but does not eliminate it — any future change still requires lockstep updates in three files. The DRY violation is improved (from 3 implicit copies to 1 canonical + 2 documented mirrors) but not eliminated.
- Impact: Future maintainers adding a new transient file must update three locations. The comment-based synchronization is better than the prior state but is still a maintenance liability.
- Fix: Consider having the shell hook call the CJS module to generate the gitignore content at runtime (`node -e "require('./lib/project-paths.cjs').getDevflowGitignoreContent()"`) rather than embedding a heredoc. This would reduce to two copies (CJS + TS) which the existing parity test already enforces. Alternatively, accept this as a pragmatic tradeoff (the shell hook needs to work without Node in some edge cases) and document it as such.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`memoryDir` parameter name is misleading in the new `.devflow/` layout** - `src/cli/utils/legacy-decisions-purge.ts:153-156`
**Confidence**: 82%
- Problem: The `purgeLegacyDecisionsEntries` function accepts `memoryDir` which now points to `.devflow/memory/`. However, the function uses `memoryDir` primarily to derive `decisionsDir` (via `path.join(memoryDir, 'decisions')` in the fallback path). In the new layout, decisions live at `.devflow/decisions/` (sibling of memory/, not a child). The `projectRoot` parameter and canonical `getDecisionsDir()` function are used when `projectRoot` is provided, but the fallback `path.join(memoryDir, 'decisions')` is structurally wrong for the new layout (it would resolve to `.devflow/memory/decisions/` instead of `.devflow/decisions/`).
- Impact: Low — the `projectRoot` parameter is always provided by migrations.ts callers, so the fallback path is never taken for the `.devflow/` layout. But the interface is confusing and the fallback would produce wrong results if triggered.

## Suggestions (Lower Confidence)

- **`MEMORY_LEGACY_SKIP_FILES` could be a `ReadonlySet` instead of `readonly string[]`** - `src/cli/utils/migrations.ts:68` (Confidence: 65%) — The array is only used as a spread into a `new Set(...)`. Declaring it as a `ReadonlySet` would make intent clearer and avoid the intermediate spread, though the performance difference is negligible.

- **Migration step 5 uses `access` + `writeFile` (TOCTOU) for gitignore creation** - `src/cli/utils/migrations.ts:357-360` (Confidence: 70%) — The pattern `try { await fs.access(gitignore); } catch { await fs.writeFile(...); }` has the same TOCTOU window the `moveFile` refactor aimed to fix. Could use `writeFile` with `{ flag: 'wx' }` (exclusive create) and catch EEXIST instead. Low risk in practice since migrations are single-threaded.

- **`ensure_docs_dir()` helper now requires a subdirectory argument** - `shared/skills/docs-framework/SKILL.md:107` (Confidence: 72%) — Changed from `mkdir -p ".devflow/docs/"` to `mkdir -p ".devflow/docs/$1"`. If called without an argument, it would `mkdir -p ".devflow/docs/"` which still works, but the semantic change means existing agent code calling `ensure_docs_dir` without args gets subtly different behavior (`.devflow/docs/` vs `.devflow/docs/` — actually identical). No functional issue but the change lacks documentation.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The directory consolidation is architecturally sound: it centralizes scattered runtime directories (`.memory/`, `.features/`, `.docs/`) under a single `.devflow/` root, simplifying path resolution and reducing gitignore complexity. The migration itself is well-structured with explicit mapped moves, catch-all handling, gitignore cleanup, and empty-directory removal. The DRY improvement for gitignore content (extracting `getDevflowGitignoreContent()` into project-paths) is a clear win, even if the shell heredoc copy remains.

Key architectural positives:
- **Single Responsibility**: `project-paths.ts`/`.cjs` owns all path resolution, migrations.ts owns the move logic
- **Idempotency by design**: moveFile handles ENOENT gracefully, migration registry prevents re-runs
- **Parallelized I/O**: independent mkdir and moveFile calls use `Promise.all`
- **DRY improvement**: skip set derived from memMap keys eliminates lockstep maintenance (avoids PF-001 — no unnecessary migration compat code)
- **Comprehensive test coverage**: 380 lines of new tests covering rename-kb and consolidate-to-devflow migrations

The HIGH issue (POSIX rename overwrite semantics) should be addressed before merge — either by restoring the dest-existence check or by updating the JSDoc to document the overwrite-is-ok semantics. The MEDIUM issues are non-blocking improvements.
