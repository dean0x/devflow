# Architecture Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-24

## Issues in Your Changes (BLOCKING)

### HIGH

**`checkAllStaleness` duplicates staleness logic from `checkStaleness` instead of delegating** - `scripts/hooks/lib/feature-kb.cjs:166-198`
**Confidence**: 85%
- Problem: The refactored `checkAllStaleness` inlines the git-log staleness check logic rather than calling `checkStaleness` per slug. While this is framed as an N+1 optimization (checking `git rev-parse --git-dir` once), it duplicates the core staleness algorithm (git log with `--after`, `--name-only`, parsing). If the staleness algorithm changes (e.g., new git flags, different date semantics), two code paths must be updated in lockstep. The original implementation delegated cleanly to `checkStaleness`.
- Impact: Violation of DRY and SRP -- `checkAllStaleness` now has two responsibilities: batching optimization AND staleness computation. The optimization (single git-dir check) could be achieved without duplicating the staleness logic itself.
- Fix: Extract the inner staleness computation into a shared helper (e.g., `computeStalenessForEntry(worktreePath, entry)`) that both `checkStaleness` and `checkAllStaleness` call. The batch function handles only the git-dir pre-check and iteration:
  ```javascript
  function computeStalenessForEntry(worktreePath, entry) {
    const files = entry.referencedFiles || [];
    if (files.length === 0) return NOT_STALE;
    try {
      const result = execFileSync('git',
        ['log', `--after=${entry.lastUpdated}`, '--name-only', '--pretty=format:', '--', ...files],
        { cwd: worktreePath, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const changedFiles = parseGitChangedFiles(result);
      return { stale: changedFiles.length > 0, changedFiles };
    } catch {
      return NOT_STALE;
    }
  }
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`removeEntry` early-returns before lock when `.features/` is absent, but swallows parse errors post-lock** - `scripts/hooks/lib/feature-kb.cjs:340-365`
**Confidence**: 82%
- Problem: The new early-return guard `if (!fs.existsSync(featuresDir)) return;` is a good defensive addition. However, in the locked section, the `catch` block after `JSON.parse(fs.readFileSync(...))` now has an empty comment `/* no index to modify */` but still proceeds to `delete index.features[slug]` and `fs.writeFileSync(...)`. Before this PR, it returned early. Now it writes the default `{ version: 1, features: {} }` to disk when the index file is missing or corrupt. This is a behavior change that creates an empty index.json where none existed.
- Impact: If index.json is somehow deleted while `.features/` still exists, `removeEntry` will now create a new empty index.json file rather than being a true no-op. Minor but semantically different from the documented "No-op if the slug does not exist" contract.
- Fix: Restore the early return in the catch block:
  ```javascript
  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    releaseLock(lockPath);
    return; // nothing to remove
  }
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`acquireLock` busy-waits with `Atomics.wait` fallback comment referencing Node < 16 but no actual fallback** - `scripts/hooks/lib/feature-kb.cjs:232-247`
**Confidence**: 80%
- Problem: The comment says `/* Node < 16 fallback: busy-wait */` but the catch block is empty -- there is no actual fallback implementation. On Node versions that lack `SharedArrayBuffer` or `Atomics.wait`, the loop spins with zero delay, consuming 100% CPU for up to `timeoutMs`. This is pre-existing logic that was refactored (extracted to `tryBreakStaleLock`) but the empty-catch pattern was preserved.
- Impact: On environments without `SharedArrayBuffer` (some CI containers, older Node), the lock acquisition loop will spin hot rather than sleeping.
- Fix: Add a synchronous sleep fallback using `child_process.spawnSync`:
  ```javascript
  } catch {
    // Fallback: shell sleep for environments without SharedArrayBuffer
    try { require('child_process').spawnSync('sleep', ['0.1']); } catch { /* truly busy-wait */ }
  }
  ```

## Suggestions (Lower Confidence)

- **`findOverlapping` directory-boundary matching is asymmetric** - `scripts/hooks/lib/feature-kb.cjs:324-326` (Confidence: 70%) -- The matching logic `f === ref || f.startsWith(ref + '/') || ref.startsWith(f + '/')` correctly handles directory boundaries, but does not handle the case where `ref` has a trailing slash (e.g., `src/cli/`). If `referencedFiles` entries include trailing slashes, `ref.startsWith(f + '/')` would fail for `f = 'src/cli'` because `'src/cli/'.startsWith('src/cli/')` is true but `f.startsWith(ref + '/')` becomes `'src/cli'.startsWith('src/cli//')` which is false. The current test suite uses entries without trailing slashes, which matches the convention, but no validation enforces this.

- **Phase renumbering across 7 orchestration skills increases cross-reference fragility** - multiple files (Confidence: 65%) -- The renumbering from fractional phases (0, 0.5, 0.6, 1, 2...) to sequential integers (1, 2, 3...) is cleaner, but `pipeline:orch/SKILL.md` line 22 now references sub-orchestrator phases by number (`implement:orch Phase 2, review:orch Phase 3, resolve:orch Phase 2`). These cross-references couple pipeline:orch to the internal numbering of other skills. If any sub-orchestrator renumbers again, pipeline:orch breaks silently. Consider using phase names instead of numbers in cross-references.

- **`NOT_STALE` sentinel object is shared by reference across all call sites** - `scripts/hooks/lib/feature-kb.cjs:31` (Confidence: 62%) -- `Object.freeze` prevents mutation, which is correct. However, callers receiving `NOT_STALE` share the same frozen reference. If any caller later spreads or destructures the result and adds properties, they would get a new object anyway. The freeze is defensive but the `changedFiles: []` array is also frozen (shallow freeze), which means callers cannot push to it. This is likely fine given the read-only nature, but worth noting that the array is shared across all NOT_STALE returns.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 1 | 0 |

**Architecture Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The PR is a well-structured refactoring that achieves several positive architectural goals: renumbering fractional phases to sequential integers improves readability across 7 orchestration skills, the `markStale` to `findOverlapping` rename clarifies intent (query vs. mutation), the dispatch table in the CLI replaces a chain of if-else blocks (OCP improvement), `exitOnInvalidSlug` centralizes validation (DRY), `KB_AGENT_TOOLS` constant eliminates duplicated tool strings, directory-boundary matching in `findOverlapping` fixes a real bug (prefix matching without path separators), and the `tryBreakStaleLock` extraction improves testability. The `NOT_STALE` sentinel, `parseGitChangedFiles` helper, and `requireWorktree` CLI utility are clean extractions that reduce duplication.

The one blocking HIGH issue is the duplicated staleness algorithm in `checkAllStaleness` -- the N+1 optimization is sound, but the implementation duplicates logic that should be shared with `checkStaleness`. The should-fix MEDIUM issue is the subtle behavior change in `removeEntry` that writes an empty index.json when the file is missing. Both are straightforward to address.
