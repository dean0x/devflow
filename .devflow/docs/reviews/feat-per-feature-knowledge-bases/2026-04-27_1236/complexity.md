# Complexity Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-27

## Issues in Your Changes (BLOCKING)

### HIGH

**Sidecar pattern duplication between `create` and `refresh` actions** - `src/cli/commands/kb.ts:381-434` and `src/cli/commands/kb.ts:497-544`
**Confidence**: 85%
- Problem: The sidecar file lifecycle (pre-clean, spawn claude, read sidecar JSON, call updateIndex, post-clean, error-cleanup) is duplicated across `create` and `refresh` handlers. Both follow the identical sequence: `unlink sidecar -> execFileSync claude -> parse sidecar -> updateIndex -> unlink sidecar`, with the same try/catch error-cleanup structure in the catch block. This is 3 occurrences of the sidecar lifecycle when counting the shell script's version in `background-kb-refresh:108-175`.
- Fix: Extract a shared helper, e.g.:
  ```typescript
  async function runKbAgentWithSidecar(opts: {
    worktreePath: string;
    sidecarPath: string;
    prompt: string;
  }): Promise<Record<string, unknown>> {
    try { await fs.unlink(opts.sidecarPath); } catch { /* pre-clean */ }
    try {
      execFileSync('claude', [
        '-p', opts.prompt,
        '--allowedTools', KB_AGENT_TOOLS,
        '--dangerously-skip-permissions',
      ], { cwd: opts.worktreePath, stdio: 'pipe', encoding: 'utf8' });
      let sidecar = {};
      try {
        sidecar = JSON.parse(await fs.readFile(opts.sidecarPath, 'utf8'));
      } catch { /* agent didn't write sidecar */ }
      try { await fs.unlink(opts.sidecarPath); } catch { /* post-clean */ }
      return sidecar;
    } catch (err) {
      try { await fs.unlink(opts.sidecarPath); } catch { /* cleanup */ }
      throw err;
    }
  }
  ```

### MEDIUM

**Inline Node.js one-liner for JSON parsing in shell script** - `scripts/hooks/background-kb-refresh:163-168`
**Confidence**: 82%
- Problem: The sidecar JSON parsing uses an inline `node -e` one-liner with embedded single-quoted file path `$SIDECAR`. This creates a nesting depth of 3 (for loop > if > node inline try/catch) and mixes two languages in a single expression. The `$SIDECAR` path is interpolated into the JavaScript string without escaping, which could break on paths containing single quotes (unlikely but fragile).
- Fix: Use `json-parse` helper or `json-helper.cjs` which already exist in the hooks library:
  ```bash
  REF_FILES=$(node "$SCRIPT_DIR/json-helper.cjs" get-field "$SIDECAR" "referencedFiles" "[]" 2>/dev/null || echo "[]")
  ```
  Or if `json-helper.cjs` does not support file-based access, add a `read-field` subcommand to it rather than embedding inline JS.

**Complex fallback chain in refresh `referencedFiles` resolution** - `src/cli/commands/kb.ts:539`
**Confidence**: 84%
- Problem: `sidecar.referencedFiles ?? (kbEntry as Record<string, unknown>)?.referencedFiles as string[] ?? []` — this is a multi-step nullish coalescing chain with an intermediate type assertion (`as Record<string, unknown>`) and a second assertion (`as string[]`). The double `??` with casts in between is harder to reason about than necessary, especially since `kbEntry` already has a typed interface with `directories` and `name` but apparently lacks `referencedFiles` on its type.
- Fix: Add `referencedFiles` to the `FeatureKbModule.listKBs` return type (it is already present in the data, just not typed). Then simplify:
  ```typescript
  referencedFiles: sidecar.referencedFiles ?? kbEntry?.referencedFiles ?? [],
  ```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`kb.ts` file length at 588 lines with 6 command handlers in a single file** - `src/cli/commands/kb.ts`
**Confidence**: 80%
- Problem: The file contains the root action handler (enable/disable/status at ~100 lines), plus 5 subcommand handlers (list, check, create, refresh, remove). Adding the sidecar pattern increased the per-handler complexity. The root action handler alone (lines 145-248) is ~100 lines with 3 branches (enable/disable/status), each at 3 levels of nesting. The `create` handler spans lines 350-446 (~96 lines) and the `refresh` handler spans lines 455-555 (~100 lines).
- Fix: The file is approaching but not exceeding critical thresholds. No immediate action needed, but if more subcommands are added, consider splitting into `kb/create.ts`, `kb/refresh.ts`, etc. The sidecar extraction suggested above would reduce both `create` and `refresh` by ~15 lines each.

**`background-kb-refresh` main loop body spans 82 lines (101-182)** - `scripts/hooks/background-kb-refresh:101-182`
**Confidence**: 80%
- Problem: The for-loop body handles: KB existence check, sidecar pre-clean, metadata fetch, prompt construction, claude spawn with watchdog, exit code handling, sidecar read + index update, sidecar cleanup, and lock refresh. That is 9 distinct responsibilities in a single loop iteration, spanning 82 lines. The nesting reaches 3 levels (for > if > node inline).
- Fix: In shell scripts, extracting functions is the primary decomposition tool. Consider extracting the per-slug refresh body into a `refresh_single_kb()` function, keeping the loop body to just the function call and count increment.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`shell-hooks.test.ts` at 1588 lines** - `tests/shell-hooks.test.ts`
**Confidence**: 82%
- Problem: This test file is well past the 500-line warning threshold. It covers hooks for memory, learning, and now KB refresh. The new 78-line `session-end-kb-refresh guard clauses` describe block is well-structured, but contributes to an already large file.
- Fix: Consider splitting into per-hook test files (e.g., `tests/hooks/kb-refresh.test.ts`, `tests/hooks/memory.test.ts`, `tests/hooks/learning.test.ts`).

## Suggestions (Lower Confidence)

- **Removed `set -e` from background hooks may mask failures** - `scripts/hooks/background-kb-refresh:8`, `scripts/hooks/background-learning:9`, `scripts/hooks/background-memory-update:9` (Confidence: 65%) -- Removing `set -e` from three background scripts is a deliberate choice (background scripts should be resilient), but it means any unexpected failure mid-script will silently continue. The scripts already handle errors at key points, so this is likely intentional.

- **Test deduplication between `kb-command.test.ts` and `feature-kb.test.ts`** - `tests/feature-kb/kb-command.test.ts` (Confidence: 70%) -- Seven tests were removed from `kb-command.test.ts` (stale-slugs and refresh-context tests) because they were duplicates of tests in `feature-kb.test.ts`. The remaining 10 tests in `kb-command.test.ts` may have further overlap with the more thorough `feature-kb.test.ts` suite.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Complexity Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The primary complexity concern is the sidecar lifecycle duplication across `create`, `refresh`, and the shell-based `background-kb-refresh`. Extracting this into a shared helper would eliminate ~30 lines of duplicated try/catch/cleanup logic. The inline node one-liner in the shell script is a secondary concern. The test refactoring (replacing try/catch+boolean with `toThrow`) is a clear positive -- reducing ceremony and improving readability. The `set -e` removal is a reasonable design choice for background scripts. Overall, the changes are well-structured and do not introduce severe complexity regressions.
