# Regression Review Report

**Branch**: fix/179-memory-extraction -> main
**Date**: 2026-04-09

## Issues in Your Changes (BLOCKING)

### HIGH

**get_mtime detection order reversed: BSD tried first instead of GNU capability check** - `scripts/hooks/get-mtime:7`
**Confidence**: 85%
- Problem: The original `get_mtime` in both `stop-update-memory` and `background-memory-update` detected the platform by running `stat --version`, which only succeeds on GNU coreutils. If it succeeded, GNU stat (`stat -c %Y`) was used; otherwise BSD stat (`stat -f %m`) was used. The new extracted `get-mtime` tries BSD stat first (`stat -f %m "$file" 2>/dev/null`) and falls through to GNU stat. On GNU/Linux, `stat -f %m` may succeed with a different meaning (`-f` selects filesystem info on GNU stat, not file mtime), potentially returning wrong data instead of failing cleanly. The original approach was explicitly correct by design: detect GNU capability first, then fall back to BSD.
- Fix: Restore the original detection approach:
```bash
get_mtime() {
  local file="$1"
  if stat --version &>/dev/null 2>&1; then
    stat -c %Y "$file"  # GNU (Linux)
  else
    stat -f %m "$file"   # BSD (macOS)
  fi
}
```

### MEDIUM

**`devflow memory --clear` uses interactive `p.select()` without non-TTY guard** - `src/cli/commands/memory.ts:196`
**Confidence**: 82%
- Problem: The new `--clear` handler calls `p.select()` (line 196) to ask the user to choose between "local" and "all" projects. There is no `process.stdin.isTTY` check before this prompt. If invoked in a non-interactive context (e.g., CI script, piped input), `p.select()` will hang or fail. Other handlers in memory.ts and init.ts consistently guard interactive prompts with TTY checks. This breaks the convention and could cause unexpected behavior in scripts.
- Fix: Add a non-TTY guard, defaulting to all projects:
```typescript
if (options.clear) {
  // ...discovery code...
  let targets: string[];
  if (!process.stdin.isTTY) {
    targets = allProjects;
  } else {
    const scope = await p.select({ ... });
    // ...
    targets = scope === 'local' ? [currentProject!] : allProjects;
  }
  // ...cleanup logic...
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Removed queue cleanup from `devflow memory --disable` without migration path** - `src/cli/commands/memory.ts:273-280`
**Confidence**: 85%
- Problem: Previously, `devflow memory --disable` automatically cleaned up `.pending-turns.jsonl` and `.pending-turns.processing` in the current project. This behavior was removed, and users must now explicitly run `devflow memory --clear`. The `--disable` subcommand no longer mentions `--clear` in its output, so users who relied on automatic cleanup will silently accumulate stale queue files. The same cleanup was also removed from the `else` branch of `init.ts` (when `memoryEnabled` is false), meaning `devflow init --no-memory` also no longer cleans up.
- Fix: At minimum, add a log hint after disabling:
```typescript
p.log.success('Working memory disabled -- hooks removed');
p.log.info(color.dim('Run devflow memory --clear to clean up queue files'));
```

**Removed test coverage for queue cleanup, knowledge file format, and pitfall detection** - `tests/memory.test.ts`
**Confidence**: 83%
- Problem: This PR removes 10 tests (~130 lines) covering: (1) queue file cleanup (4 tests), (2) knowledge file TL;DR parsing (3 tests), (3) ADR number extraction (2 tests), (4) pitfall duplicate detection (1 test). The commit message says "remove language-behavior tests" but several of these tests validated real business logic behavior (e.g., that cleanup safely handles missing files, that TL;DR parsing works). While these may test patterns rather than exported functions, they exercised integration paths. Only 3 replacement tests were added (for the new `Settings` object overload).
- Fix: The queue cleanup tests should be migrated to test the new `--clear` handler behavior (or at least the `filterProjectsWithMemory` helper). The knowledge file tests may be acceptable to remove if they only tested inline shell logic, but consider whether the pitfall-detection and TL;DR-parsing patterns are covered elsewhere.

## Pre-existing Issues (Not Blocking)

_No pre-existing regression issues detected._

## Suggestions (Lower Confidence)

- **`filterProjectsWithMemory` not exported or tested** - `src/cli/commands/memory.ts:151` (Confidence: 70%) -- New helper function is private and has no dedicated unit test. It could silently break without detection.

- **`--clear` with zero discovered projects but valid current project shows empty select** - `src/cli/commands/memory.ts:196-205` (Confidence: 65%) -- If `discoverProjectGitRoots()` returns empty but current project has `.memory/`, the select will work but the "All projects (1 found)" option is slightly misleading since it is only the current project.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED
