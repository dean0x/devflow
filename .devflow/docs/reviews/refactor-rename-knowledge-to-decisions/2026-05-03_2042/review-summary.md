# Code Review Summary

**Branch**: refactor/rename-knowledge-to-decisions -> main
**Date**: 2026-05-03_2042
**Reviewers**: Architecture, Security, Performance, Complexity, Consistency, Regression, Testing, TypeScript, Documentation

## Merge Recommendation: CHANGES_REQUESTED

This is a comprehensive and well-executed rename refactor (knowledge → decisions) across 84 files with ~1200 lines changed. The migration is thorough, well-tested (11 migration test cases, all 1183 tests pass), and maintains backward compatibility. However, 4 blocking issues must be resolved before merge:

1. **Migration ordering allows pre-v2 entries to survive** (Architecture HIGH) — purge migrations reference new path but execute before directory rename
2. **Migration renames lock files without holding them** (Security HIGH) — concurrent processes could corrupt decisions.md
3. **Phase Completion Checklists have stale headings** (Documentation HIGH, 3 occurrences) — headings renamed but checklist items not
4. **Stale comment "log/knowledge"** (TypeScript/Consistency MEDIUM) — one missed comment in learn.ts:936

Beyond these, 3 secondary MEDIUM issues span consistency, testing, and documentation that should be addressed:
- Notification keys `knowledge-capacity-*` not renamed to `decisions-capacity-*` (affects 3 files, internal data contract)
- Missing test for both-directories-exist conflict scenario in migration
- Section heading "Knowledge Index + On-Demand Read Pattern" in docs/self-learning.md

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 4 | 0 | 0 |
| Should Fix | 0 | 0 | 3 | 0 |
| Pre-existing | 0 | 0 | 2 | 1 |

**Total Distinct Issues**: 10 (9 architectural/code quality + 1 pre-existing complexity)

---

## Blocking Issues (MUST FIX)

### 1. Migration Ordering Allows Pre-v2 Entries to Survive

**File**: `src/cli/utils/migrations.ts:231-236`  
**Severity**: HIGH  
**Confidence**: 87% (flagged by Architecture, Consistency)

**Problem**:
The `MIGRATIONS` array runs `purge-legacy-knowledge-v2` and `purge-legacy-knowledge-v3` BEFORE `rename-knowledge-to-decisions`. Both purge functions now reference `.memory/decisions/` (line 116 in `legacy-knowledge-purge.ts`), but on a first-time upgrade from a pre-v2 install:
1. `.memory/knowledge/` exists, `.memory/decisions/` does not
2. Purge migrations run against non-existent `decisions/` and no-op
3. Migration marks both purges as applied
4. Rename migration moves `.memory/knowledge/` → `.memory/decisions/`
5. Pre-v2 seeded entries now live in `.memory/decisions/` despite purge marking

This is a narrow edge case (requires skipping all intermediate versions), but it violates documented migration semantics.

**Fix**:
After the directory rename in `MIGRATION_RENAME_KNOWLEDGE_TO_DECISIONS.run()`, re-run purge logic:

```typescript
// After the rename, re-run purge logic against the new path
// (handles the skip-version edge case)
const { purgeAllPreV2KnowledgeEntries } = await import('./legacy-knowledge-purge.js');
const purgeResult = await purgeAllPreV2KnowledgeEntries({ memoryDir });
if (purgeResult.removed > 0) {
  infos.push(`Post-rename: purged ${purgeResult.removed} legacy entry(ies)`);
}
```

---

### 2. Migration Renames Lock Files Without Holding Them

**File**: `src/cli/utils/migrations.ts:177-189`  
**Severity**: HIGH  
**Confidence**: 85% (flagged by Security)

**Problem**:
The migration renames `.knowledge.lock` → `.decisions.lock` using `fs.rename()` without first acquiring the lock. If background learning or a concurrent CLI session holds `.knowledge.lock`:
1. Lock holder attempts to release the lock (rmdir on old path)
2. Old path no longer exists → release fails silently or throws
3. Concurrent process could create a new `.knowledge.lock`
4. Lock serialization guarantee is violated
5. Two writers could corrupt `decisions.md` or `pitfalls.md`

**Fix**:
Acquire each lock before renaming, or skip fresh (non-stale) locks. The stale detection threshold is 60 seconds:

```typescript
for (const [oldName, newName] of lockRenames) {
  const oldPath = path.join(memoryDir, oldName);
  const newPath = path.join(memoryDir, newName);
  try {
    const stat = await fs.stat(oldPath);
    // Only rename lock dirs that are stale (>60s old) — live locks
    // will expire and the new name will be used next time.
    if (oldName.endsWith('.lock')) {
      const age = Date.now() - stat.mtimeMs;
      if (age < 60_000) continue; // live lock — skip
    }
    await fs.rename(oldPath, newPath);
  } catch { /* does not exist — skip */ }
}
```

---

### 3. Phase Completion Checklist Items Not Renamed to Match Headings

**Files**: `shared/skills/debug:orch/SKILL.md:111`, `shared/skills/review:orch/SKILL.md:144`, `shared/skills/explore:orch/SKILL.md:164`  
**Severity**: HIGH  
**Confidence**: 92% (flagged by Documentation)

**Problem**:
Phase headings were renamed (e.g., "Phase 1: Load Decisions Index") but the corresponding Phase Completion Checklist items at the bottom of each file still reference old headings ("Load Knowledge Index"):

| File | Heading Says | Checklist Says (Line) |
|------|---|---|
| debug:orch | "Phase 1: Load Decisions Index" (line 27) | "Phase 1: Load Knowledge Index" (line 111) ❌ |
| review:orch | "Phase 3: Load Decisions Index" (line 47) | "Phase 3: Load Knowledge Index" (line 144) ❌ |
| explore:orch | "Phase 1: Load Decisions (Orchestrator-Local)" (line 33) | "Phase 1: Load Knowledge (Orchestrator-Local)" (line 164) ❌ |

This creates internal contradictions within the same files.

**Fix**:
Update each checklist item to match its phase heading:
- `debug:orch/SKILL.md:111`: `Phase 1: Load Knowledge Index` → `Phase 1: Load Decisions Index`
- `review:orch/SKILL.md:144`: `Phase 3: Load Knowledge Index` → `Phase 3: Load Decisions Index`
- `explore:orch/SKILL.md:164`: `Phase 1: Load Knowledge (Orchestrator-Local)` → `Phase 1: Load Decisions (Orchestrator-Local)`

---

### 4. Stale Comment "log/knowledge" in learn.ts

**File**: `src/cli/commands/learn.ts:936`  
**Severity**: MEDIUM (but HIGH confidence)  
**Confidence**: 90% (flagged by TypeScript, Consistency)

**Problem**:
Comment reads `// partial progress (and log/knowledge stay consistent).` but surrounding code says "decisions". This stale comment creates inconsistency with the rename refactor's intent.

**Fix**:
Change to `// partial progress (and log/decisions stay consistent).`

---

## Should-Address Issues (MEDIUM Severity)

### 1. Notification Keys `knowledge-capacity-*` Not Renamed

**Files**: `scripts/hooks/json-helper.cjs:1290,1782`, `src/cli/commands/learn.ts:1184-1185`, `src/cli/hud/notifications.ts:57-58`  
**Severity**: MEDIUM  
**Confidence**: 85% (flagged by Architecture, Consistency, Testing)

**Problem**:
The notification keys `knowledge-capacity-decisions` and `knowledge-capacity-pitfalls` are stored in `.notifications.json` (data contract) and used as lookup keys across 3 files. They were not renamed to `decisions-capacity-*`. This is functionally correct (opaque keys) but creates a leaky abstraction:
- External-facing concepts say "decisions"
- Internal notification keys still say "knowledge-capacity"
- The string `worst.key.replace('knowledge-capacity-', '')` in `notifications.ts:58` would break silently if keys change without updating this code

**Fix Options**:
(a) Rename keys to `decisions-capacity-decisions` / `decisions-capacity-pitfalls` and add migration for existing `.notifications.json` files, OR  
(b) Add code comment documenting this as an intentional "frozen key" that must not change without updating extraction logic

Option (a) is preferred for naming coherence.

---

### 2. Missing Test for Both-Directories-Exist Scenario

**File**: `tests/learning/rename-migration.test.ts`  
**Severity**: MEDIUM  
**Confidence**: 82% (flagged by Testing)

**Problem**:
The migration handles the case where both `.memory/knowledge/` and `.memory/decisions/` exist (emits warning, skips directory rename, updates manifest/log). The test suite covers the partial-state case but not the both-directories-exist scenario. The migration code is tested but the warning emission path is not.

**Fix**:
Add test case verifying behavior when both directories coexist:

```typescript
it('warns when both .memory/knowledge/ and .memory/decisions/ exist', async () => {
  const projectRoot = path.join(tmpDir, 'both-dirs-project');
  const memoryDir = path.join(projectRoot, '.memory');
  await fs.mkdir(path.join(memoryDir, 'knowledge'), { recursive: true });
  await fs.mkdir(path.join(memoryDir, 'decisions'), { recursive: true });
  await fs.writeFile(path.join(memoryDir, 'knowledge', 'decisions.md'), 'old', 'utf-8');
  await fs.writeFile(path.join(memoryDir, 'decisions', 'decisions.md'), 'new', 'utf-8');

  const result = await renameMigration.run(makeCtx(projectRoot));

  expect(result!.warnings).toContain('.memory/decisions/ already exists — skipping directory rename');
  // Old directory should still exist (not deleted)
  const oldContent = await fs.readFile(path.join(memoryDir, 'knowledge', 'decisions.md'), 'utf-8');
  expect(oldContent).toBe('old');
});
```

---

### 3. Documentation Section Headings Not Renamed

**File**: `docs/self-learning.md:101,103`  
**Severity**: MEDIUM  
**Confidence**: 82% (flagged by Documentation)

**Problem**:
Two section headings/phrases still reference "Knowledge" while internal content uses "Decisions":
- Line 101: `## Knowledge Index + On-Demand Read Pattern` should be `## Decisions Index + On-Demand Read Pattern`
- Line 103: "Knowledge consumers (slash commands and orch skills)" should be "Decisions consumers (slash commands and orch skills)"

These are entry points for readers and create misleading impressions.

**Fix**:
Rename both to use "Decisions".

---

## Pre-existing Issues (Informational)

### 1. Complex Functions with High Try/Catch Density

**Files**: `src/cli/utils/migrations.ts` (7 try/catch blocks in ~75 lines), `json-helper.cjs` (1838 lines, 30+ functions), `learn.ts` (1303 lines)  
**Severity**: LOW → MEDIUM  
**Confidence**: 85%

These are not blocking for this PR (the rename adds no new complexity) but are architectural debt for future consideration.

### 2. Missing `.gitignore` Entry for Shared `knowledge.md` Agent

**File**: `.gitignore` (root) and plugin directories  
**Severity**: HIGH (pre-existing regression)  
**Confidence**: 85% (flagged by Regression)

**Problem**:
The `knowledge.md` agent lives in `shared/agents/` (single source of truth) and should be distributed by build system, not committed per-plugin. However, `plugins/devflow-explore/agents/knowledge.md` and pre-existing copies in `devflow-ambient` and `devflow-plan` are tracked in git. All other shared agents have explicit `.gitignore` entries.

**Fix**:
Add `plugins/*/agents/knowledge.md` to root `.gitignore`, then `git rm --cached plugins/*/agents/knowledge.md`.

---

## Strengths

1. **Comprehensive rename**: All 84 files correctly updated — zero remaining stale `knowledge` references in paths, variables, function names, imports
2. **Migration well-structured**: Directory rename, lock renames, manifest path rewriting, log path rewriting — all idempotent and handles partial state
3. **Test coverage excellent**: All 1183 tests pass, 11 dedicated migration tests with good scenario coverage (fresh project, directory rename, lock rename, usage file, manifest, log, idempotency, partial state, empty manifest, mixed paths)
4. **No API breakage**: No exports removed, no return types changed, no CLI options dropped
5. **Architecture preserved**: Separation of concerns maintained, migration registry pattern correctly applied
6. **Performance unchanged**: No new algorithmic patterns, no new hot-path operations

---

## Action Plan

**Before Merge**:
1. Fix migration ordering: add post-rename purge in `MIGRATION_RENAME_KNOWLEDGE_TO_DECISIONS.run()`
2. Fix lock rename race: skip fresh locks or acquire before renaming (60s stale threshold)
3. Fix Phase Completion Checklists: rename 3 checklist items in debug:orch, review:orch, explore:orch
4. Fix stale comment in learn.ts:936

**Before or After Merge** (secondary):
5. Rename notification keys `knowledge-capacity-*` → `decisions-capacity-*` with migration, OR add comment documenting frozen key
6. Add test case for both-directories-exist scenario
7. Rename documentation section headings in docs/self-learning.md
8. Add `.gitignore` entry for `plugins/*/agents/knowledge.md`

All fixes are low-risk mechanical changes. Estimated effort: 30 min to 1 hour.
