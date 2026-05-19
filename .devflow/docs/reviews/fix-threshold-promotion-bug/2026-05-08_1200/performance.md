# Performance Review Report

**Branch**: fix/threshold-promotion-bug -> main
**Date**: 2026-05-08

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Sequential `updateDecisionsStatus` with per-call lock acquire/release in batch deprecation** - `src/cli/commands/decisions.ts:830-841`
**Confidence**: 85%
- Problem: The capacity review batch deprecation loop calls `updateDecisionsStatus` for each selected entry. Each call independently acquires the `.decisions.lock` (mkdir), reads the file, applies a regex, writes the file, and releases the lock. For N selected entries, this results in N lock acquire/release cycles and N separate file read/write pairs on the same file. With up to 20 candidates selectable, this is 20 sequential lock+read+regex+write+unlock operations.
- Fix: Batch the deprecation into a single lock acquisition: read the file once, apply all status updates in memory, write once. This would reduce N file reads + N file writes + N lock cycles to 1 of each. However, since `updateDecisionsStatus` may target different files (decisions.md vs pitfalls.md), a grouping strategy is needed:
```typescript
// Group selected entries by filePath, then batch-update each file once
const byFile = new Map<string, typeof candidates>();
for (const entryId of selected as string[]) {
  const entry = candidates.find(e => e.id === entryId);
  if (!entry) continue;
  const group = byFile.get(entry.filePath) || [];
  group.push(entry);
  byFile.set(entry.filePath, group);
}
for (const [filePath, entries] of byFile) {
  // Single lock, single read, multiple regex replacements, single write
  await batchUpdateDecisionsStatus(filePath, entries.map(e => e.id), 'Deprecated');
}
```
- Note: The interactive UI already imposes user-speed latency between selections, so the per-entry overhead is small relative to wall-clock time. This is primarily a code-quality concern for programmatic use, not a user-facing latency issue.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Spawning Node subprocess for `count-active` when the logic exists in-process** - `src/cli/commands/decisions.ts:862-878`
**Confidence**: 82%
- Problem: After batch deprecation, the capacity review calls `execFileSync('node', [jsonHelperPath, 'count-active', ...])` twice (once for decisions, once for pitfalls). Each call spawns a new Node.js process, which incurs ~50-100ms startup overhead. The `countActiveHeadings` logic in `json-helper.cjs` is a pure function (regex scan of file content). Since the TypeScript CLI already has the file content available (it was just read for parsing entries), this work could be done in-process without spawning a subprocess.
- Fix: Import or inline the `countActiveHeadings` logic in TypeScript. The function is a simple regex count:
```typescript
function countActiveHeadings(content: string, type: 'decision' | 'pitfall'): number {
  const prefix = type === 'decision' ? 'ADR' : 'PF';
  const re = new RegExp(`^## ${prefix}-\\d+:`, 'gm');
  // Count headings that are NOT followed by Deprecated/Superseded status
  let count = 0;
  let match;
  while ((match = re.exec(content)) !== null) {
    const sectionStart = match.index;
    const nextHeading = content.indexOf('\n## ', sectionStart + 1);
    const section = nextHeading !== -1 ? content.slice(sectionStart, nextHeading) : content.slice(sectionStart);
    const status = section.match(/- \*\*Status\*\*:\s*(\w+)/);
    if (!status || (status[1] !== 'Deprecated' && status[1] !== 'Superseded')) count++;
  }
  return count;
}
```
  This saves two subprocess spawns (~100-200ms total).
- Note: The D23 comment says "single source of truth" justifying the subprocess call. This is a valid design principle but the performance trade-off is worth evaluating -- the TypeScript version could call the same CJS module via `require()` at build time or duplicate the ~15 lines.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Redundant `Date.now()` - `firstSeenMs` spread calculation on newly-created entries** - `scripts/hooks/json-helper.cjs:1036-1038` (Confidence: 65%) -- For newly-created entries (`first_seen` was just set to `nowIso` on the same tick), the spread calculation `(Date.now() - firstSeenMs) / 1000` will always be ~0, which always passes `spread >= th.spread` when `th.spread === 0`. The condition is technically correct but the spread check is a no-op by construction for immediate-type entries. A simple `th.spread === 0` check would skip the `Date` parsing entirely.

- **`candidates.find()` inside a loop** - `src/cli/commands/decisions.ts:831` (Confidence: 62%) -- The batch deprecation loop calls `candidates.find(e => e.id === entryId)` for each selected entry. With `candidates` capped at 20, this is O(20) per lookup, giving O(400) worst-case. Practically negligible, but a `Map` lookup would be O(1).

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The changes are primarily a bug fix (immediate-type promotion on first creation) and a code relocation (capacity review from learn.ts to decisions.ts). The core performance characteristics are sound: the `calculateConfidence` function is O(1), the JSONL file processing is linear in file size (bounded at 100 entries via `capEntries`), and the lock acquisition uses non-blocking `mkdir` with timeout. The two identified issues (sequential lock cycling in batch deprecation and subprocess spawns for `count-active`) are real but affect only the interactive CLI path where user-perceived latency is dominated by interaction time, not I/O. The relocation from learn.ts to decisions.ts is a clean move with no migration code (applies ADR-001).
