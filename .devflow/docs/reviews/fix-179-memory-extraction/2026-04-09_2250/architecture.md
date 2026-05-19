# Architecture Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

### HIGH

**`--clear` command handler mixes discovery, UI, and I/O in a single inline block** - `src/cli/commands/memory.ts:177-228`
**Confidence**: 85%
- Problem: The new `--clear` handler (lines 177-228) concentrates three distinct responsibilities in a single procedural block: project discovery (discoverProjectGitRoots + filter), interactive scope selection (p.select), and file deletion across projects. This is a miniature SRP violation within the command action. The pattern also directly couples the command handler to `discoverProjectGitRoots` (a post-install utility), `getGitRoot` (a git utility), and file system deletion logic -- all inline without abstraction.
- Impact: Cannot unit-test the cleanup logic without mocking the interactive prompt and discovery functions. The same project-discovery-then-filter pattern is now duplicated between `--clear` (memory.ts) and init.ts's advanced path (lines 956-959 in init.ts). Adding a `--force` or `--dry-run` flag later requires rewriting the inline block.
- Fix: Extract a pure `cleanQueueFiles(projectPaths: string[]): Promise<{cleaned: number, projects: string[]}>` function and keep the interactive prompt in the command handler. This follows the pattern already used by `createMemoryDir` and `migrateMemoryFiles` -- pure logic extracted, command handler orchestrates.

```typescript
// Extracted function (pure, testable)
export async function cleanQueueFiles(projects: string[]): Promise<{ cleaned: number; paths: string[] }> {
  const cleaned: string[] = [];
  for (const project of projects) {
    const memDir = path.join(project, '.memory');
    const q = await fs.unlink(path.join(memDir, '.pending-turns.jsonl')).then(() => true).catch(() => false);
    const pr = await fs.unlink(path.join(memDir, '.pending-turns.processing')).then(() => true).catch(() => false);
    if (q || pr) cleaned.push(project);
  }
  return { cleaned: cleaned.length, paths: cleaned };
}
```

### MEDIUM

**`hasMemoryDir` and `filterProjectsWithMemory` are module-private but serve a general purpose** - `src/cli/commands/memory.ts:146-154`
**Confidence**: 82%
- Problem: `hasMemoryDir` and `filterProjectsWithMemory` are declared as module-private functions but operate on general project paths and `.memory/` directories. If another command needs to check for `.memory/` existence (e.g., `devflow learn --status` checking whether memory is set up for the current project), these cannot be reused.
- Impact: Likely duplication if any other command needs project-memory detection. Minor -- addresses future extensibility.
- Fix: Consider placing these in `src/cli/utils/post-install.ts` alongside `discoverProjectGitRoots`, since they form a natural chain: discover projects -> filter projects with memory -> operate on them.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`addMemoryHooks` parses JSON then delegates to `hasMemoryHooks(settings)` which may re-parse** - `src/cli/commands/memory.ts:25-63`
**Confidence**: 80%
- Problem: `addMemoryHooks` parses `settingsJson` into a `Settings` object on line 26, then calls `hasMemoryHooks(settings)` on line 28, passing the parsed object. The polymorphic `string | Settings` signature works correctly here. However, the function parses JSON on line 26, does the guard check, then if not short-circuiting, proceeds to mutate `settings` and re-serialize on line 62. If `hasMemoryHooks` returns true, the function returns the original `settingsJson` string (line 29) -- which is correct but means the JSON was parsed unnecessarily in that path.
- Impact: Negligible performance cost, but the `string | Settings` union makes the API surface wider than needed. Callers in init.ts always have a string; the command handler also always has a string. The Settings overload was added for `addMemoryHooks`'s internal use, which is a good optimization. The inconsistency is that `removeMemoryHooks` (line 70) does NOT accept `Settings` -- it only takes `string`. This asymmetry is minor but could confuse future contributors.
- Fix: No immediate action needed. If expanding further, consider making `removeMemoryHooks` also accept `string | Settings` for consistency, or keep both as string-only and have `addMemoryHooks` do its own internal check without the polymorphic public API.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`get_mtime` detection order tries BSD first on all platforms** - `scripts/hooks/get-mtime:7-10`
**Confidence**: 80%
- Problem: The previous implementation detected the platform by checking `stat --version` (GNU-specific), then branched. The new implementation tries `stat -f %m` first (BSD) and falls back to `stat -c %Y` (GNU). On Linux, this means every `get_mtime` call runs a failing `stat -f` first (stderr suppressed) before succeeding with `stat -c`. The old approach detected once; the new approach detects on every call.
- Impact: Minor performance penalty on Linux -- one extra failed subprocess per `get_mtime` invocation. In the background updater, `get_mtime` is called 2-3 times (stale lock check, pre-update mtime, post-update mtime), so the overhead is negligible in practice.
- Fix: Cache the detection result in a variable on first call:

```bash
get_mtime() {
  local file="$1"
  if [ -z "${_STAT_FMT:-}" ]; then
    if stat -f %m / 2>/dev/null >/dev/null; then
      _STAT_FMT="bsd"
    else
      _STAT_FMT="gnu"
    fi
  fi
  if [ "$_STAT_FMT" = "bsd" ]; then
    stat -f %m "$file"
  else
    stat -c %Y "$file"
  fi
}
```

### LOW

**PF-002 (init handler monolith) continues to grow** - `src/cli/commands/init.ts`
**Confidence**: 90%
- Problem: The init.ts removal of queue-cleanup from the disable path (5 lines removed) is a positive reduction, but the file remains a monolith (per PF-002). The `--clear` capability was correctly placed in memory.ts rather than init.ts, which is the right direction.
- Impact: Informational. This PR does not worsen PF-002 and slightly improves it by removing init's involvement in queue cleanup.

## Suggestions (Lower Confidence)

- **Duplicated JSON field extraction pattern across hooks** - `scripts/hooks/preamble:16-24`, `scripts/hooks/prompt-capture-memory:18-26` (Confidence: 70%) -- Both hooks now use an identical 8-line block for jq/node field extraction with `@tsv` + `cut`. Consider extracting a `json_fields` helper into `json-parse` to reduce duplication across hooks.

- **`--clear` interactive prompt blocks non-TTY usage** - `src/cli/commands/memory.ts:196-206` (Confidence: 65%) -- The `p.select` call in `--clear` has no non-TTY fallback. Running `devflow memory --clear` in a CI/scripted context would hang or error. Other commands (init.ts) detect `!process.stdin.isTTY` and apply defaults. Consider adding `--clear --all` or `--clear --local` flags to bypass the prompt.

- **Test coverage removed without equivalent replacement** - `tests/memory.test.ts` (Confidence: 75%) -- The PR removes ~130 lines of tests (queue cleanup tests + knowledge file format tests) and adds ~30 lines (countMemoryHooks accepts parsed Settings). The knowledge file format tests were testing file I/O patterns rather than exported functions, so their removal is defensible. However, the new `--clear` command handler has no test coverage. The `filterProjectsWithMemory` and `hasMemoryDir` helpers are also untested.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

**Architecture Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR demonstrates good architectural instincts: extracting `get_mtime` into a shared helper (DRY), moving queue cleanup from `--disable` to a dedicated `--clear` command (SRP), and making `hasMemoryHooks`/`countMemoryHooks` polymorphic to avoid redundant parsing (efficiency). The `background-memory-update` extraction as a standalone script is a clean separation of the stop-hook's concerns.

The main structural concern is the inline `--clear` handler, which concentrates discovery + UI + I/O without extractable pure logic. Extracting the file-cleanup into a testable function would align with the existing pattern used by other memory utilities. The removed tests should be replaced with coverage for the new `--clear` path.
