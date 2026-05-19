# Performance Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-27

## Issues in Your Changes (BLOCKING)

### HIGH

**Two sequential Node.js process spawns for sidecar parsing in background-kb-refresh loop** - `scripts/hooks/background-kb-refresh:163-174`
**Confidence**: 85%
- Problem: Inside the per-slug loop (lines 100-182), after the `claude -p` invocation, the script spawns two sequential Node.js processes: one inline `node -e` to parse the sidecar JSON (line 163), then another `node` call to `feature-kb.cjs update-index` (line 169). Each Node.js cold-start adds ~50-100ms. Since this runs up to 3 times (the cap), the overhead is 300-600ms total -- modest in absolute terms for a background process, but avoidable.
- Fix: Consolidate sidecar parsing + index update into a single Node.js invocation. The `feature-kb.cjs` CLI already handles `update-index`; add a mode that reads the sidecar internally, or pass the sidecar path as an argument:
  ```bash
  # Instead of two node invocations:
  node "$SCRIPT_DIR/lib/feature-kb.cjs" update-index-from-sidecar "$CWD" "$SLUG" "$SIDECAR" \
    --name="$NAME" --directories="$DIRS" --category="$CATEGORY" --createdBy="devflow-kb"
  ```

### MEDIUM

**Removed `set -e` from background-kb-refresh without compensating error handling** - `scripts/hooks/background-kb-refresh:8`
**Confidence**: 82%
- Problem: The diff removes `set -e` from `background-kb-refresh`. While this is consistent with the same removal in `background-learning` and `background-memory-update`, the script now continues past failures silently. Specifically, if `source "$SCRIPT_DIR/log-paths"` fails (line 13), `$LOG_FILE` will be empty/unset and all subsequent `log` calls and `>> "$LOG_FILE"` redirects will fail or write to unexpected locations. The `acquire_lock` function and `node` invocations already handle their own errors, but the early sourcing/setup section does not.
- Fix: Add explicit guard after the critical source:
  ```bash
  source "$SCRIPT_DIR/log-paths" || exit 1
  ```
  This preserves the "no set -e" approach while protecting against silent cascading failures in the setup phase.

**`checkStaleness` called redundantly in `devflow kb refresh` for each slug** - `src/cli/commands/kb.ts:492`
**Confidence**: 80%
- Problem: In the refresh command (line 472), `checkAllStaleness` is already called to determine which slugs are stale. Then inside the per-slug loop (line 492), `checkStaleness` is called again for each slug. Each `checkStaleness` call runs `git log` against referenced files -- an I/O operation. When refreshing all stale KBs, this duplicates git operations already performed by `checkAllStaleness`.
- Fix: Reuse the staleness result from the initial `checkAllStaleness` call:
  ```typescript
  const staleness = featureKb.checkAllStaleness(worktreePath);
  // ...
  for (const kbSlug of slugsToRefresh) {
    const staleInfo = staleness[kbSlug]; // Already computed
    // ...
  }
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Inline `node -e` with shell-interpolated file path is fragile for paths with special characters** - `scripts/hooks/background-kb-refresh:163-168`
**Confidence**: 82%
- Problem: The `$SIDECAR` path is interpolated directly into a JavaScript string literal on line 165: `require('fs').readFileSync('$SIDECAR','utf8')`. If the worktree path contains single quotes, backslashes, or other JS-special characters, this will produce a syntax error or incorrect path. While worktree paths with special characters are uncommon, this is a latent reliability issue that could cause silent failures (the `catch` block masks the error).
- Fix: Pass the path as a command-line argument instead:
  ```bash
  REF_FILES=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
      console.log(JSON.stringify(d.referencedFiles || []));
    } catch { console.log('[]'); }
  " "$SIDECAR" 2>/dev/null || echo "[]")
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Sequential KB refresh loop processes slugs one at a time** - `scripts/hooks/background-kb-refresh:100-182`
**Confidence**: 70% (moved to Suggestions -- below threshold)

## Suggestions (Lower Confidence)

- **Sequential KB refresh could benefit from parallelism** - `scripts/hooks/background-kb-refresh:100-182` (Confidence: 70%) -- The for-loop processes up to 3 stale KBs sequentially, each with a 180s timeout. In the worst case this is 540s of wall time. Since each `claude -p` invocation is independent, they could run in parallel with `wait` for all PIDs. However, this is a background process with a cap of 3 and the sequential approach is simpler to reason about, so the trade-off may be intentional.

- **`featureKb.listKBs` called unnecessarily in refresh path** - `src/cli/commands/kb.ts:486` (Confidence: 65%) -- `listKBs` loads and parses the full index to get metadata for each slug. The metadata (name, directories, category) could potentially be extracted from the `checkAllStaleness` call or a single index load, avoiding a redundant file read + parse. The overhead is negligible for typical KB counts (<20), so this is a micro-optimization.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The sidecar pattern is a net performance win -- it removes the need to pass large KB content via prompt (previously `$EXISTING` was embedded in the prompt string), shifting to agent self-read. The pre-computed stale slugs passed from `session-end-kb-refresh` to `background-kb-refresh` eliminate a redundant `node` invocation. The removal of `Bash` from allowed tools reduces the agent's attack surface and avoids expensive shell spawns during refresh. The conditions are the redundant `checkStaleness` calls in `kb.ts` and the fragile path interpolation in the inline `node -e` invocation.
