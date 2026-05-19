# Complexity Review Report

**Branch**: refactor/rename-knowledge-to-decisions -> main
**Date**: 2026-05-03

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Duplicated fs.stat existence checks with repeated boolean tracking pattern** - `src/cli/utils/migrations.ts:147-175`
**Confidence**: 85%
- Problem: The `MIGRATION_RENAME_KNOWLEDGE_TO_DECISIONS` function checks `newDirExists` in two separate scopes (lines 154-158 and 163-167), each using the identical try/catch-around-stat-then-set-boolean pattern. The first check (lines 153-159) determines early return. The second check (lines 162-175) determines rename-vs-skip. This duplicated existence-check logic increases cyclomatic complexity and makes the branching harder to follow. There are 5 separate try/catch blocks in the function body plus 2 more in the for-loop, yielding a total of 7 try/catch blocks in ~75 lines.
- Fix: Extract a reusable `exists` helper and flatten the branching:
```typescript
async function exists(p: string): Promise<boolean> {
  try { await fs.stat(p); return true; } catch { return false; }
}

// Then in the migration:
const oldDirExists = await exists(oldDir);
const newDirExists = await exists(newDir);

if (!oldDirExists && !newDirExists) return { infos, warnings };

if (oldDirExists && !newDirExists) {
  await fs.rename(oldDir, newDir);
  infos.push('Renamed .memory/knowledge/ to .memory/decisions/');
} else if (oldDirExists && newDirExists) {
  warnings.push('.memory/decisions/ already exists — skipping directory rename');
}
// ... rest of migration
```

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**json-helper.cjs is 1838 lines with 30+ functions and a monolithic switch dispatch** - `scripts/hooks/json-helper.cjs`
**Confidence**: 90%
- Problem: This file is well past the 500-line file-length warning threshold (at 1838 lines) and contains 30+ functions plus a large switch statement dispatcher starting around line 630. The rename PR touched ~94 lines across this file (all mechanical renames), but the pre-existing size makes any modification risky and time-consuming to validate. This is not blocking because the PR makes no structural changes to the file.
- Fix: Consider splitting into focused modules in a future refactor (e.g., `decisions-writer.cjs`, `reconciler.cjs`, `lock-utils.cjs`).

### MEDIUM

**learn.ts is 1303 lines combining CLI command definition, observation parsing, lock management, and status formatting** - `src/cli/commands/learn.ts`
**Confidence**: 85%
- Problem: This file serves as a monolith combining the CLI command handler, observation data structures, lock acquisition, status rendering, and decisions file mutation. The PR only touched comment renames and one function rename (`updateKnowledgeStatus` to `updateDecisionsStatus`), but the pre-existing size (1303 lines) makes future maintenance costly. The `learnCommand.action` handler alone has 12+ options branching through deeply nested conditionals.
- Fix: Extract `updateDecisionsStatus`, `acquireMkdirLock`, and observation I/O into dedicated utility modules.

### LOW

**LEGACY_SKILL_NAMES array is 171 lines with no structural grouping** - `src/cli/plugins.ts:243-413`
**Confidence**: 80%
- Problem: This growing list (now 170+ entries across 8 version eras) uses only inline comments to delineate groups. The PR added 4 more entries. While comments provide context, the linear array makes it easy to accidentally duplicate entries or miss a cleanup. This is a pre-existing readability concern, not introduced by this PR.
- Fix: Consider grouping into separate arrays per version era and concatenating, or adding a build-time deduplication check.

## Suggestions (Lower Confidence)

- **Notification key still uses old "knowledge-capacity" prefix** - `scripts/hooks/json-helper.cjs:1290,1782` (Confidence: 70%) -- The `notifKey` values `'knowledge-capacity-decisions'` and `'knowledge-capacity-pitfalls'` were not renamed to `'decisions-capacity-*'`. This may be intentional for backwards compatibility with existing notification state, but creates a naming inconsistency. Confirm whether this was deliberate.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 2 | 1 |

**Complexity Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR is overwhelmingly a mechanical rename refactor ("knowledge" to "decisions") across 84 files with no structural logic changes to existing code. The new migration function (`MIGRATION_RENAME_KNOWLEDGE_TO_DECISIONS`) is the only net-new logic, and its complexity is moderate but could be improved by extracting a small `exists` helper to eliminate repeated try/catch-stat patterns. The renamed `decisions-index.cjs` and `decisions-usage-scan.cjs` files are clean copies of their predecessors with updated names. Test coverage for the migration is thorough (10 test cases). Pre-existing complexity in `json-helper.cjs` (1838 lines) and `learn.ts` (1303 lines) is noted but not blocking.
