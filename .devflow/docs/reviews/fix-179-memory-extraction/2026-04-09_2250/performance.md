# Performance Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

### HIGH

**Sequential I/O in `--clear` handler: `discoverProjectGitRoots` then `filterProjectsWithMemory` then `getGitRoot`** - `src/cli/commands/memory.ts:180-184`
**Confidence**: 85%
- Problem: The `--clear` handler runs three independent async operations sequentially: `discoverProjectGitRoots()`, `filterProjectsWithMemory(gitRoots)`, and `getGitRoot()`. The first and third are independent of each other; `getGitRoot()` does not depend on `discoverProjectGitRoots()` and could run in parallel.
- Impact: Adds unnecessary latency to the `--clear` command. `discoverProjectGitRoots` scans the filesystem and `getGitRoot` spawns a git subprocess -- running them serially adds the sum of both durations rather than the max.
- Fix:
```typescript
const [gitRoots, gitRoot] = await Promise.all([
  discoverProjectGitRoots(),
  getGitRoot(),
]);
const projectsWithMemory = await filterProjectsWithMemory(gitRoots);
const currentProject = gitRoot && await hasMemoryDir(gitRoot) ? gitRoot : null;
```

### MEDIUM

**Sequential file deletions in `--clear` loop** - `src/cli/commands/memory.ts:215-222`
**Confidence**: 82%
- Problem: For each project in `targets`, two `fs.unlink` calls run sequentially (one for `.pending-turns.jsonl`, one for `.pending-turns.processing`). These are independent I/O operations on different files. Additionally, projects themselves are processed in a serial `for` loop rather than in parallel.
- Impact: With N projects, this creates 2N sequential filesystem operations. For a handful of projects the impact is negligible, but the `discoverProjectGitRoots` function can return many projects, making the serial loop a potential bottleneck.
- Fix:
```typescript
const results = await Promise.all(targets.map(async (project) => {
  const memDir = path.join(project, '.memory');
  const [q, pr] = await Promise.all([
    fs.unlink(path.join(memDir, '.pending-turns.jsonl')).then(() => true).catch(() => false),
    fs.unlink(path.join(memDir, '.pending-turns.processing')).then(() => true).catch(() => false),
  ]);
  if (q || pr) {
    p.log.info(color.dim(`Cleaned: ${project}`));
  }
  return q || pr;
}));
const cleaned = results.filter(Boolean).length;
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`get_mtime` helper calls `stat` twice on BSD systems (stdout leak)** - `scripts/hooks/get-mtime:7-10`
**Confidence**: 85%
- Problem: The `get_mtime` function tries BSD `stat -f %m` first, and on success it `return`s. However, `stat -f %m` writes the mtime to stdout as its side effect, which is correct. The issue is that on GNU/Linux, `stat -f %m "$file" 2>/dev/null` will fail silently (exit non-zero, stderr suppressed), then fall through to `stat -c %Y` -- this is fine. But the previous implementation (`stat --version` check) was a one-time dispatch that avoided calling `stat` on the file with the wrong flags at all. The new approach calls `stat` on the actual file first (BSD), then falls back to GNU. This is functionally correct but performs one extra failed `stat` call per invocation on Linux. Given this runs in background hooks (not in the hot path), the impact is minimal.
- Impact: One extra failed syscall per `get_mtime` invocation on Linux. Negligible for background hooks, but called multiple times per update cycle (stale lock check, pre-update mtime, post-update mtime).
- Fix: No action required for current usage (background-only). If this helper is ever used in a hot path, consider caching the platform detection result.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Single-pass jq extraction rebuilds JSON array for every JSONL line** - `scripts/hooks/background-memory-update:150-165`
**Confidence**: 80%
- Problem: The jq invocation `jq -r '(.role // "") + "\t" + ...'` is applied to the full `$ENTRIES` string via heredoc. This works because jq processes JSONL natively (one JSON object per line). However, the node fallback reads the entire stdin into memory and splits by newline, which is fine for the capped 20-line input but would not scale.
- Impact: Negligible at current cap of 20 lines. The queue overflow safety in `stop-update-memory` (line 84-92) and the MAX_LINES cap (line 140-146) keep input bounded.

## Suggestions (Lower Confidence)

- **Redundant double-parse in `addMemoryHooks`** - `src/cli/commands/memory.ts:26-28` (Confidence: 70%) -- `addMemoryHooks` parses the JSON string into `settings`, then calls `hasMemoryHooks(settings)` which now accepts the parsed object directly (good improvement). However, if `hasMemoryHooks` returns false, the function continues to build hooks and re-serializes. The early-return path avoids serialization, which is the right pattern. No issue here, just noting the improvement is well-placed.

- **Preamble and prompt-capture-memory share identical JSON extraction block** - `scripts/hooks/preamble:16-24`, `scripts/hooks/prompt-capture-memory:18-26` (Confidence: 65%) -- Both hooks duplicate the same jq/node field-extraction pattern for `cwd` and `prompt`. This is not a performance issue per se, but extractable into a shared helper sourced from both scripts, reducing maintenance surface. Both hooks run on every user prompt submission, so keeping them lean matters.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The changes are net-positive for performance: extracting `get_mtime` into a shared helper eliminates code duplication across two hooks, the batched jq field extraction in preamble/prompt-capture-memory reduces subprocess spawns from 2 to 1 per hook invocation (previously `json_field` was called twice, now a single jq/node call extracts both fields), and the `hasMemoryHooks`/`countMemoryHooks` accepting a parsed Settings object avoids a redundant JSON re-parse in `addMemoryHooks`. The only actionable item is parallelizing the independent async calls in the new `--clear` handler.
