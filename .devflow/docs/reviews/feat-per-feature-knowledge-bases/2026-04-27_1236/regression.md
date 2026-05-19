# Regression Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-27
**Diff**: `git diff 998f2b2...HEAD` (10 files, +202/-130)

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Sidecar pattern fails silently when agent does not write the expected JSON file** - `scripts/hooks/background-kb-refresh:176-178`, `src/cli/commands/kb.ts:420-422`
**Confidence**: 82%
- Problem: The new sidecar pattern (`background-kb-refresh` and `kb.ts create`/`refresh`) relies on the Knowledge agent writing `.create-result.json` or `.refresh-result.json`. If the agent fails to write the sidecar (e.g., prompt misunderstanding, tool error, timeout), the caller falls through to empty defaults. In `background-kb-refresh`, the `else` branch at line 176-178 logs "No sidecar file -- skipping index update" which means the `lastUpdated` timestamp in the index is NOT refreshed even though the background script already wrote a fresh timestamp to `.kb-last-refresh` (line 86). This creates a state where the 2-hour throttle has advanced but the KB index still shows the old `lastUpdated`, so the KB will appear stale again next session but cannot be refreshed until the 2-hour throttle expires.
- Fix: When the sidecar is missing but the claude process exited successfully (exit code 0), still update the index `lastUpdated` with the existing metadata (like `kb.ts refresh` does at line 535-542 using fallback `referencedFiles`). Only skip the full index update on agent failure.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`set -e` removal from background hooks changes error propagation semantics** - `scripts/hooks/background-kb-refresh:8`, `scripts/hooks/background-learning:9-10`, `scripts/hooks/background-memory-update:9-10`
**Confidence**: 83%
- Problem: `set -e` was removed from three background hooks. While these scripts use explicit error handling in many places (e.g., `|| true`, `2>/dev/null`), the removal means any unexpected command failure in the setup phase (before the main loop) will no longer abort the script. For instance, in `background-kb-refresh`, if `source "$SCRIPT_DIR/log-paths"` fails or `source "$SCRIPT_DIR/get-mtime"` fails, the script will continue with undefined functions (`log`, `get_mtime`, `devflow_log_dir`) potentially producing confusing failures downstream rather than failing fast.
- Fix: Either restore `set -e` or add explicit error checks after the critical `source` commands:
  ```bash
  source "$SCRIPT_DIR/log-paths" || { echo "Failed to source log-paths" >&2; exit 1; }
  source "$SCRIPT_DIR/get-mtime" || { echo "Failed to source get-mtime" >&2; exit 1; }
  ```

**Removed test coverage for `stale-slugs` with empty index** - `tests/feature-kb/kb-command.test.ts:82-94`
**Confidence**: 80%
- Problem: Two tests were removed from `kb-command.test.ts` without equivalent replacement: (1) `stale-slugs outputs only stale slugs one per line` (non-git worktree) and (2) `stale-slugs outputs nothing for empty index`. The first test has a near-equivalent in `feature-kb.test.ts` (`outputs nothing for non-stale index`), but the second test (empty index `{ version: 1, features: {} }`) has no equivalent. The underlying `checkAllStaleness` returns `{}` for a missing index, but the CLI `stale-slugs` subcommand iterating over an empty features object is not tested.
- Fix: Add a test case in `feature-kb.test.ts` CLI stale-slugs describe block:
  ```typescript
  it('outputs nothing for empty index', () => {
    const tmp = makeTmpFeatureWorktree({ version: 1, features: {} });
    const output = execFileSync('node', [FEATURE_KB_CJS, 'stale-slugs', tmp], { encoding: 'utf8' });
    expect(output.trim()).toBe('');
  });
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`FeatureKbModule` interface does not declare `referencedFiles` in `listKBs` return type** - `src/cli/commands/kb.ts:22,539`
**Confidence**: 85%
- Problem: The `listKBs` return type in the `FeatureKbModule` interface declares `{ slug, name, category, directories, lastUpdated }` but at runtime `listKBs` returns the full index entry which includes `referencedFiles`. The refresh command at line 539 works around this with `(kbEntry as Record<string, unknown>)?.referencedFiles as string[]`. This is a pre-existing type-safety gap that predates this PR.
- Fix: Add `referencedFiles: string[]` to the `listKBs` return type in the interface.

## Suggestions (Lower Confidence)

- **Shell variable injection in node -e command** - `scripts/hooks/background-kb-refresh:165` (Confidence: 65%) -- The `$SIDECAR` variable is interpolated directly into a Node.js `require('fs').readFileSync('$SIDECAR','utf8')` string inside a `node -e` command. If `$SIDECAR` contains single quotes (unlikely given the controlled path construction from `$CWD/.features/$SLUG/.refresh-result.json`), this could break. The controlled construction makes exploitation unlikely.

- **`PRE_SLUGS` with slugs containing spaces would break the for loop** - `scripts/hooks/background-kb-refresh:89-93,101` (Confidence: 62%) -- The `for SLUG in $STALE_SLUGS` loop relies on word splitting. Since slugs are validated to be kebab-case (no spaces), this is safe in practice, but there is no explicit assertion at this layer.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Regression Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The sidecar pattern is a sound architectural improvement over having the agent call `Bash` to update the index directly -- it moves the mutation out of the sandboxed agent and into the trusted caller. However, the silent failure mode when the sidecar is missing (HIGH finding) can leave the index in an inconsistent state where the throttle advances but `lastUpdated` does not. The `set -e` removal is intentional (background hooks should not abort on transient failures) but leaves the setup phase unprotected. The test de-duplication is clean -- removed tests from `kb-command.test.ts` are covered in `feature-kb.test.ts` except for the empty-index edge case. PF-001 (Promise resolver renaming) is not relevant to these changes.
