# Performance Review Report

**Branch**: chore/init-flow-improvements -> main
**Date**: 2026-03-22

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Sequential `fs.access` in `discoverProjectGitRoots` loop** - `src/cli/utils/post-install.ts:451-459`
**Confidence**: 85%
- Problem: The newly added `discoverProjectGitRoots()` function checks each project path sequentially with `await fs.access(path.join(project, '.git'))` inside a `for` loop. For users with many projects in `history.jsonl` (e.g., 50+ projects), this means 50+ sequential filesystem stat calls that could each take ~1-5ms, totaling 50-250ms of unnecessary wall-clock time.
- Impact: Adds latency to the interactive prompt phase proportional to the number of projects in Claude history. This runs during the prompt-gathering phase (before the spinner), so the delay is directly perceived by the user with no visual feedback.
- Fix: Use `Promise.allSettled` to parallelize the filesystem checks:
```typescript
const results = await Promise.allSettled(
  [...projects].map(async (project) => {
    await fs.access(path.join(project, '.git'));
    return project;
  })
);
const gitRoots = results
  .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
  .map(r => r.value);
return gitRoots.sort();
```

**Sequential `installClaudeignore` in discovered projects loop** - `src/cli/commands/init.ts:745-747`
**Confidence**: 82%
- Problem: When `claudeignoreEnabled` is true with `scope === 'user'`, the code runs `installClaudeignore` sequentially for each discovered project. Each invocation performs two filesystem operations (read template + write file with `wx` flag). With many projects, this serializes operations that are independent of one another.
- Impact: For a user with N discovered projects, this adds N * (read + write) sequential I/O. Typically small, but combined with the sequential `discoverProjectGitRoots` above, the prompt-to-install delay grows linearly with project count.
- Fix: Parallelize with `Promise.all`:
```typescript
const results = await Promise.all(
  discoveredProjects.map(root => installClaudeignore(root, rootDir, verbose))
);
const created = results.filter(Boolean).length;
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Repeated read-write cycles on `settings.json` (3 consecutive reads)** - `src/cli/commands/init.ts:690,703,729`
**Confidence**: 84%
- Problem: After installing settings, the code performs three separate read-parse-modify-write cycles on `settings.json` in sequence: ambient hook (line 690), memory hooks (line 703), and HUD status line (line 729). Each cycle reads the entire file, parses JSON, modifies it, serializes, and writes back. This pattern was present before but the refactor reorganized these operations and made them unconditional (previously some were gated behind `selectedExtras.includes('settings')`).
- Impact: Three sequential file reads and three sequential file writes where one read and one write would suffice. The I/O overhead is minor in absolute terms (~5-10ms total), but the JSON parse-serialize-parse-serialize churn is wasteful and increases the risk of data races if any operation fails mid-sequence.
- Fix: Read `settings.json` once, apply all three transformations in memory, then write once:
```typescript
try {
  let content = await fs.readFile(settingsPath, 'utf-8');
  if (ambientEnabled) {
    content = addAmbientHook(content, devflowDir);
  }
  const cleaned = removeMemoryHooks(content);
  content = memoryEnabled ? addMemoryHooks(cleaned, devflowDir) : cleaned;
  content = hudEnabled
    ? addHudStatusLine(content, devflowDir)
    : removeHudStatusLine(content);
  await fs.writeFile(settingsPath, content, 'utf-8');
} catch { /* settings.json may not exist yet */ }
```
This reduces 3 reads + 3 writes to 1 read + 1 write and eliminates intermediate disk flushes.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Sequential `fs.rm` in legacy skill cleanup loop** - `src/cli/commands/init.ts:634-642`
**Confidence**: 80%
- Problem: The legacy skill cleanup iterates through 37 entries in `LEGACY_SKILL_NAMES`, calling `await fs.rm()` sequentially for each. Most will fail immediately (entry does not exist), but the sequential await pattern means each failure must resolve before the next attempt begins.
- Impact: Minor (~37 sequential stat calls). Not a regression from this PR since the code existed before.
- Fix: Could batch with `Promise.allSettled`, but low priority given the small fixed list size.

## Suggestions (Lower Confidence)

- **Loading full `history.jsonl` into memory** - `src/cli/utils/post-install.ts:433` (Confidence: 65%) -- For users with extensive Claude history, `history.jsonl` could grow large. A streaming line reader (e.g., `readline.createInterface`) would avoid loading the entire file into a single string, but this is unlikely to matter in practice unless the file exceeds several MB.

- **`getGitRoot()` called before spinner** - `src/cli/commands/init.ts:422` (Confidence: 60%) -- The `earlyGitRoot` call spawns a child process (`git rev-parse`) during the prompt phase. This is fast but adds latency before the first prompt appears. Already necessary for the claudeignore logic, so this is an inherent tradeoff of the "all prompts first" architecture.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Performance Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR's primary purpose is a UX refactor (prompts-first, then install) rather than a performance change, and it achieves that well. The main performance concerns are the two new sequential I/O loops (`discoverProjectGitRoots` and `installClaudeignore` batch) that scale linearly with project count. For users with a handful of projects these are negligible, but they should be parallelized to maintain performance for power users with many Claude projects. The repeated settings.json read-write cycles are a low-effort consolidation that would reduce both I/O and fragility.
