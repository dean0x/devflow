# Complexity Review Report

**Branch**: feat-per-feature-knowledge-bases -> main
**Date**: 2026-04-23

## Issues in Your Changes (BLOCKING)

### HIGH

**CLI interface in `feature-kb.cjs` uses sequential `if` blocks instead of a dispatch table** - `scripts/hooks/lib/feature-kb.cjs:339-463`
**Confidence**: 85%
- Problem: The CLI entrypoint uses 5 sequential `if (subcommand === '...')` blocks, each containing duplicated worktree validation, stderr logging, and `process.exit(0)`. The pattern repeats the same argument parsing boilerplate 5 times (worktree resolution, null check, error message, exit). This is 125 lines of CLI dispatch that could be ~60 lines with a dispatch table or command map. Cyclomatic complexity of the CLI section is ~12 (5 subcommands x 2-3 branches each).
- Fix: Extract the worktree validation into a helper (`requireWorktree(argv[1])`), and use a command map pattern:
```javascript
const commands = {
  list: (argv) => { ... },
  stale: (argv) => { ... },
  'update-index': (argv) => { ... },
  'mark-stale': (argv) => { ... },
  remove: (argv) => { ... },
};
const handler = commands[subcommand];
if (!handler) { process.stderr.write(`Error: unknown subcommand...\n`); process.exit(1); }
handler(argv);
```

**`acquireLock` busy-wait loop with deeply nested error recovery** - `scripts/hooks/lib/feature-kb.cjs:172-196`
**Confidence**: 82%
- Problem: The `acquireLock` function has 4 levels of nesting (while > try/catch > try/catch > try/catch) with 3 `catch` blocks that swallow errors at different levels. The flow is: attempt mkdir > on fail check stale lock > on stale remove lock > on remove failure ignore > wait 100ms > retry. This is difficult to follow and the multiple nested catch blocks make it hard to reason about which error condition leads to which recovery path. Nesting depth of 4 exceeds the warning threshold.
- Fix: Extract the stale-lock check into a separate function to flatten the nesting:
```javascript
function tryBreakStaleLock(lockPath, staleMs) {
  try {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs > staleMs) {
      try { fs.rmdirSync(lockPath); } catch { /* ignore */ }
      return true; // lock broken, retry
    }
  } catch {
    return true; // lock disappeared, retry
  }
  return false; // lock is fresh, wait
}
```

### MEDIUM

**`removeEntry` early return inside `finally` block skips lock release** - `scripts/hooks/lib/feature-kb.cjs:295-313`
**Confidence**: 90%
- Problem: Inside the `try` block of `removeEntry`, there is a nested `try/catch` that `return`s on JSON parse failure (line 300). This `return` exits the function but the `finally` block does execute (so the lock is released). However, reading the code, the `return` inside a `try/catch` within a `try/finally` creates a confusing control flow. A reader must carefully trace which `try`/`finally` scope the `return` belongs to. The function also declares a default `index` variable at line 296 that is immediately overwritten in the `try` block — this dead assignment adds mental overhead.
- Fix: Remove the early return by restructuring: if the index can't be parsed, the slug won't exist in `features`, so `delete index.features[slug]` is a harmless no-op. The function can simply continue to the write step, which writes the default empty index. Alternatively, move the guard before acquiring the lock: check if the index file exists first.

**Repetitive "Load Feature Knowledge" 4-step block across 10+ command/orchestration files** - multiple files
**Confidence**: 85%
- Problem: The same 4-step "Load Feature Knowledge" block is copy-pasted verbatim into 10+ files (code-review.md, code-review-teams.md, debug.md, debug-teams.md, implement.md, implement-teams.md, plan.md, plan-teams.md, resolve.md, resolve-teams.md, self-review.md, debug:orch/SKILL.md, explore:orch/SKILL.md, etc.). Each block reads:
  1. Read `.features/index.json` if it exists
  2. Based on X, identify relevant KBs
  3. For each match: check staleness via `node scripts/hooks/lib/feature-kb.cjs stale ...`, read `.features/{slug}/KNOWLEDGE.md`
  4. Set `FEATURE_KNOWLEDGE` (or `(none)` if no KBs exist or none are relevant)

  While command files are markdown templates (not runtime code), this creates a maintenance burden: any change to the feature knowledge loading algorithm requires updating 10+ files in sync. The existing `KNOWLEDGE_CONTEXT` loading is a single-line bash command that doesn't suffer from this problem because it's a one-liner.
- Fix: Consider creating a companion CLI subcommand in `feature-kb.cjs` (e.g., `node feature-kb.cjs load-relevant <worktree> <file1> [file2...]`) that encapsulates the 4-step algorithm into a single-line invocation, matching the `knowledge-context.cjs index` pattern. Then the command files would use a single line instead of the 4-step block.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`kb.ts` CLI command file mixes sync and async patterns** - `src/cli/commands/kb.ts:27-29` and `src/cli/commands/kb.ts:202-211`
**Confidence**: 80%
- Problem: The `featureKb` module is loaded synchronously at module scope via `createRequire` (line 27-29), and its functions (`listKBs`, `checkAllStaleness`, etc.) are all synchronous. However, the Commander action handlers are all `async` functions that `await` results. The `create` and `refresh` subcommands call `execFileSync` (synchronous, blocking) while being inside `async` handlers. This mix creates confusion: the `async` keyword suggests non-blocking behavior, but the actual I/O is blocking. Additionally, `execFileSync` with `stdio: 'pipe'` throws on non-zero exit — the catch blocks at lines 214 and 298 handle this, but the error message loses the child process's stderr output (which may contain the actual failure reason from `claude`).
- Fix: Either commit to sync (remove `async` where not needed) or use `execFile` (async) with proper stream handling. For the error messages, capture stderr from the child process: `const { stdout, stderr } = child_process.spawnSync(...)` and include `stderr` in the error output.

## Pre-existing Issues (Not Blocking)

No pre-existing complexity issues identified.

## Suggestions (Lower Confidence)

- **`markStale` bidirectional prefix matching may produce unexpected results** - `scripts/hooks/lib/feature-kb.cjs:270-272` (Confidence: 70%) — The overlap check uses `f.startsWith(ref) || ref.startsWith(f)` which means a changed file `src/cli/` (a directory prefix) would match a ref `src/cli/commands/foo.ts` and vice versa. This bidirectional prefix match is likely intentional for directory-level matching, but could produce false positives when file paths happen to share prefixes (e.g., `src/client.ts` would match `src/cli/cli.ts` since `src/cli` starts with `src/cl`). The exact-match check `f === ref` is redundant since `f.startsWith(ref)` covers it when they're equal.

- **`updateIndex` does not validate that `.features/` directory exists before acquiring lock** - `scripts/hooks/lib/feature-kb.cjs:221-252` (Confidence: 65%) — If the `.features/` directory doesn't exist, `acquireLock` will attempt to `mkdirSync` the lock directory inside a non-existent parent, which will throw. The function would benefit from an `mkdirSync(featuresDir, { recursive: true })` before the lock acquisition, similar to how test fixtures create the directory.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Complexity Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The codebase is well-structured overall. The `feature-kb.cjs` module follows clean single-responsibility design with clear function boundaries, good JSDoc, and proper input validation. The main complexity concerns are in the CLI dispatch section (which can be tightened with a dispatch table) and the lock acquisition logic (which has deeply nested error recovery). The cross-cutting concern of the 4-step "Load Feature Knowledge" block repeated across 10+ command files is a maintainability issue worth addressing before the pattern becomes load-bearing.
