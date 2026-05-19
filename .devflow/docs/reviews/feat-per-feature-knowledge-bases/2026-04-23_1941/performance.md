# Performance Review Report

**Branch**: feat-per-feature-knowledge-bases -> main
**Date**: 2026-04-23

## Issues in Your Changes (BLOCKING)

### HIGH

**checkAllStaleness spawns N+2 redundant processes per slug** - `scripts/hooks/lib/feature-kb.cjs:153-161`
**Confidence**: 92%
- Problem: `checkAllStaleness` iterates all slugs calling `checkStaleness` per slug. Each `checkStaleness` call: (1) re-reads `index.json` from disk via `loadIndex`, (2) spawns `git rev-parse --git-dir` to verify git repo, and (3) spawns `git log --after=... --name-only ...` per slug. For N feature KBs this produces N redundant `loadIndex` reads and N redundant `git rev-parse` calls, plus N `git log` invocations. Each `execFileSync` call forks a process (~5-10ms per spawn on macOS), so at 20 KBs this adds ~300-600ms of synchronous blocking time. The git-repo check and index read are invariant across slugs and should be hoisted.
- Fix: Hoist `loadIndex` and the `git rev-parse` check above the loop, pass results into an inner function:
```javascript
function checkAllStaleness(worktreePath) {
  const index = loadIndex(worktreePath);
  if (!index) return {};

  let isGitRepo = true;
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: worktreePath, stdio: 'pipe' });
  } catch {
    isGitRepo = false;
  }

  const results = {};
  for (const [slug, entry] of Object.entries(index.features)) {
    if (!isGitRepo) {
      results[slug] = { stale: false, changedFiles: [] };
      continue;
    }
    const files = entry.referencedFiles || [];
    if (files.length === 0) {
      results[slug] = { stale: false, changedFiles: [] };
      continue;
    }
    try {
      const result = execFileSync(
        'git', ['log', `--after=${entry.lastUpdated}`, '--name-only', '--pretty=format:', '--', ...files],
        { cwd: worktreePath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const changedFiles = [...new Set(result.split('\n').map(l => l.trim()).filter(Boolean))];
      results[slug] = { stale: changedFiles.length > 0, changedFiles };
    } catch {
      results[slug] = { stale: false, changedFiles: [] };
    }
  }
  return results;
}
```

**CLI list and check commands double-call checkAllStaleness via separate listKBs + checkAllStaleness** - `src/cli/commands/kb.ts:52-53` and `src/cli/commands/kb.ts:99-100`
**Confidence**: 90%
- Problem: Both `devflow kb list` and `devflow kb check` call `listKBs(worktreePath)` then `checkAllStaleness(worktreePath)`. `listKBs` calls `loadIndex` once, then `checkAllStaleness` calls `loadIndex` again (N+1 times total due to the per-slug issue above). The index is read from disk 2+N times for a single CLI invocation when it should be read exactly once. Additionally, `checkAllStaleness` spawns N+1 synchronous subprocesses (1 `git rev-parse` per slug + N `git log` calls, though the per-slug issue amplifies this). For a developer with 10-20 KBs, the `list` command will take 1-2 seconds from redundant I/O alone.
- Fix: Refactor `checkAllStaleness` to accept the already-loaded index, and have both commands load the index once:
```typescript
const worktreePath = await getWorktreePath();
const kbs = featureKb.listKBs(worktreePath);
// checkAllStaleness already loads index internally; the fix is in feature-kb.cjs
// to hoist loadIndex and reuse it
const staleness = featureKb.checkAllStaleness(worktreePath);
```
Or expose a combined `listWithStaleness(worktreePath)` function that loads index once and returns both datasets.

### MEDIUM

**Sequential execFileSync for KB refresh spawns N blocking claude processes** - `src/cli/commands/kb.ts:259-301`
**Confidence**: 85%
- Problem: `devflow kb refresh` iterates all stale slugs and calls `execFileSync('claude', ...)` for each one sequentially. Each `claude -p` invocation is an LLM call that can take 30-120 seconds. With 5 stale KBs, this blocks the CLI for 2.5-10 minutes. The KBs are independent artifacts operating on non-overlapping file sets, so parallel execution is safe.
- Fix: Use `execFile` (async, non-sync) with `Promise.all` or a concurrency limiter to refresh stale KBs in parallel (or at least 2-3 at a time):
```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFile);

// Process up to 3 refreshes in parallel
const CONCURRENCY = 3;
for (let i = 0; i < slugsToRefresh.length; i += CONCURRENCY) {
  const batch = slugsToRefresh.slice(i, i + CONCURRENCY);
  await Promise.all(batch.map(async (kbSlug) => {
    // ... build prompt, call execFileAsync('claude', [...])
  }));
}
```

**markStale uses O(n*m) nested array scan with prefix matching** - `scripts/hooks/lib/feature-kb.cjs:263-276`
**Confidence**: 80%
- Problem: `markStale` iterates all features (n) and for each, iterates all referenced files, calling `changedFiles.some()` with three comparison branches (exact match, startsWith in both directions). For m changed files and k referenced files per feature, this is O(n * k * m). With many KBs and large changesets, this quadratic-ish scan adds up. The `startsWith` prefix matching in both directions (`f.startsWith(ref) || ref.startsWith(f)`) is also semantically surprising -- a changed file "src/cli/commands/kb.ts" would match a reference "src/cli/" but also "src/cli/commands/kb.ts.bak" would match "src/cli/commands/kb.ts" which seems unintended.
- Fix: Pre-build a Set for exact matches, and use a sorted array or trie for prefix checks. At minimum, separate exact-match from prefix-match logic:
```javascript
function markStale(worktreePath, changedFiles) {
  const index = loadIndex(worktreePath);
  if (!index) return [];
  const changedSet = new Set(changedFiles);
  const staleSlugsList = [];
  for (const [slug, entry] of Object.entries(index.features)) {
    const refs = entry.referencedFiles || [];
    const overlap = refs.some(ref =>
      changedSet.has(ref) ||
      changedFiles.some(f => f.startsWith(ref + '/')) ||  // file is under ref directory
      changedFiles.some(f => ref.startsWith(f + '/'))     // ref is under changed directory
    );
    if (overlap) staleSlugsList.push(slug);
  }
  return staleSlugsList;
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Synchronous readFileSync for index loading in hot paths** - `scripts/hooks/lib/feature-kb.cjs:78-86`
**Confidence**: 82%
- Problem: `loadIndex` uses `fs.readFileSync` which blocks the Node.js event loop. This function is called in every staleness check, list, and update operation. While acceptable for single-call CLI tools, the same module is `require()`'d by `kb.ts` (the CLI command) which already uses async I/O patterns (`await fs.readFile` in its own code). When orchestration commands call `checkAllStaleness` indirectly via the CLI or via `node feature-kb.cjs` as a subprocess, the synchronous I/O isn't a bottleneck (each process is short-lived). However, `loadIndex` being sync prevents future use as an imported library in long-running async contexts. This is a LOW-risk item but worth noting for future-proofing.
- Fix: Consider exposing async variants (`loadIndexAsync`) for callers that are already async-native. The sync variants can remain for the CLI subprocess path.

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Potential for batching git log calls across slugs** - `scripts/hooks/lib/feature-kb.cjs:135-139` (Confidence: 70%) -- Instead of N separate `git log` calls (one per slug), all referenced files from all slugs could be passed to a single `git log --after=<earliest-lastUpdated> --name-only ...` call, then results partitioned by slug. This would reduce N process spawns to 1 but requires additional logic to handle per-slug `lastUpdated` timestamps.

- **execFileSync for claude invocations captures stdout in memory** - `src/cli/commands/kb.ts:203-211` (Confidence: 65%) -- `execFileSync('claude', ..., { stdio: 'pipe' })` buffers the entire LLM response in memory. For large KB outputs this could be significant. Using `stdio: 'inherit'` or streaming would avoid buffering but the current approach works fine for typical KB sizes.

- **acquireLock busy-wait spin loop** - `scripts/hooks/lib/feature-kb.cjs:172-196` (Confidence: 62%) -- The lock acquisition uses `Atomics.wait` for 100ms sleep intervals which is fine for short contention, but in the worst case (lock held for 30 seconds by a crashed process that left a non-stale lock), this spins 300 times. The stale lock detection at 60 seconds mitigates this for most real scenarios.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | - | 0 | 1 | 0 |
| Pre-existing | - | - | 0 | 0 |

**Performance Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The primary concern is the N+1 process-spawning pattern in `checkAllStaleness`, where each slug triggers redundant `loadIndex` reads and `git rev-parse` subprocess calls. This is a classic N+1 pattern that scales linearly with the number of feature KBs. The fix is straightforward -- hoist invariant operations above the loop. The sequential `claude` CLI invocations for KB refresh are a secondary concern that becomes meaningful when multiple KBs are stale. Both the `list` and `check` CLI commands exhibit redundant index loading. None of these are critical -- the feature works correctly -- but they introduce unnecessary latency that will compound as projects accumulate more feature KBs.
