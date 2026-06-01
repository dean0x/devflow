# Architecture Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28

## Issues in Your Changes (BLOCKING)

### HIGH

**EXIT trap collision between sourced modules** - `scripts/hooks/eval-reinforce:20`, `scripts/hooks/eval-learning:70`
**Confidence**: 92%
- Problem: Both `eval-reinforce` (line 20) and `eval-learning` (line 70) install global `trap ... EXIT` handlers to release their respective locks. Because these modules are sourced sequentially into the same shell process by `sidecar-evaluate`, the second trap overwrites the first. If `eval-reinforce` acquires its lock and `eval-learning` subsequently sets its own EXIT trap, a crash between lines 70 and 126 of `eval-learning` would release the learning lock but leave the reinforce lock orphaned. The prior resolution summary listed "EXIT trap asymmetry (now fixed)" but the underlying collision between two sourced modules sharing one global trap remains.
- Fix: Use stacked trap handlers or use `trap -` immediately after lock release (which both modules already do on the happy path at lines 78 and 126 respectively). Alternatively, wrap each lock-protected section in a subshell `(...)` so each module's EXIT trap is scoped to that subshell. The simplest fix is to move the lock release + trap clear into a helper that is called in both the normal and EXIT paths:
```bash
# In eval-helpers, add:
with_lock() {
  local lock_dir="$1"; shift
  if sidecar_lock_acquire "$lock_dir" 3; then
    trap "sidecar_lock_release '$lock_dir'" EXIT
    "$@"
    sidecar_lock_release "$lock_dir"
    trap - EXIT
  else
    log "Skipped: could not acquire lock $lock_dir"
  fi
}
```

**Implicit coupling: sourced modules depend on orchestrator namespace without compile-time contract** - `scripts/hooks/eval-decisions:1-11`, `scripts/hooks/eval-learning:1-11`, `scripts/hooks/eval-reinforce:1-9`, `scripts/hooks/eval-knowledge:1-8`
**Confidence**: 82%
- Problem: Each eval module documents its required variables in a header comment (e.g., `DECISIONS_ENABLED`, `SESSION_DEEP`, `SIDECAR_DIR`, `FILTER_LIB`, `log()`, `dbg()`, etc.) but there is no runtime validation that these are set before the module executes. If the orchestrator is refactored and a variable is removed or renamed, modules will silently misbehave rather than fail fast. This is a form of content coupling (Stevens et al., 1974) -- the modules directly depend on the internal state of their caller. The `hook-bootstrap` and `hook-log-init` helpers correctly use `${VAR:?message}` fail-fast guards, but the eval modules do not follow the same pattern. (applies ADR-007 -- single debug toggle works because all modules share a namespace, but the shared namespace itself lacks guards)
- Fix: Add fail-fast guards at the top of each eval module for their critical dependencies:
```bash
# At top of each eval-* module, after the header comment:
: "${SIDECAR_DIR:?eval-decisions: SIDECAR_DIR must be set by orchestrator}"
: "${DECISIONS_DIR_DATA:?eval-decisions: DECISIONS_DIR_DATA must be set by orchestrator}"
```
This follows the pattern already established by `hook-bootstrap` and `hook-log-init`, making the implicit contract explicit and catching drift at the earliest possible point.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**hook-log-init uses wc -c subprocess but debug-trace uses stat for the same purpose** - `scripts/hooks/hook-log-init:31`
**Confidence**: 83%
- Problem: The `hook-log-init` size guard on line 31 uses `wc -c < "$LOG_FILE"` to check file size, while the newly extracted `_devflow_dbg_size_guard` in `debug-trace` uses the optimized `stat -f%z / stat -c%s` approach with `wc -c` as a last-resort fallback. This is an inconsistency within the same PR that introduces both helpers. The PR description calls out debug-trace size guard improvements specifically, but hook-log-init was written fresh with the older approach.
- Fix: Reuse the `stat`-first approach in `hook-log-init`, or better yet, extract the size-reading logic from `_devflow_dbg_size_guard` into a shared function in `hook-bootstrap` that both `debug-trace` and `hook-log-init` can use:
```bash
# In hook-log-init line 31, replace wc -c with stat:
_LOG_SIZE=$(stat -f%z "$LOG_FILE" 2>/dev/null || stat -c%s "$LOG_FILE" 2>/dev/null || wc -c < "$LOG_FILE" 2>/dev/null || echo 0)
if [ "${_LOG_SIZE:-0}" -gt 2097152 ]; then
```

**eval-reinforce uses unprefixed variables while other eval modules use _PREFIX convention** - `scripts/hooks/eval-reinforce:11-18`
**Confidence**: 85%
- Problem: `eval-reinforce` uses unprefixed variables (`LEARNING_LOG`, `LOADED_SLUGS`, `NOW_ISO`, `SLUGS_PATTERN`, `TEMP_LOG`) while `eval-learning`, `eval-decisions`, and `eval-knowledge` consistently use `_LEARN_*`, `_DEC_*`, `_KNOW_*` prefixes. Since all modules execute in the same shell namespace, unprefixed variables risk collision with the orchestrator's own variables or future modules. The code was moved verbatim from the monolith (where it was also unprefixed), so this is understandable, but the decomposition was the right time to normalize naming. (avoids PF-004 -- god script decomposition should include namespace cleanup)
- Fix: Prefix all local variables in `eval-reinforce` with `_REINFORCE_`:
```bash
_REINFORCE_LOG="$LEARNING_DIR/learning-log.jsonl"
_REINFORCE_SLUGS=$(grep -oE ...)
_REINFORCE_NOW_ISO=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
_REINFORCE_SLUGS_PATTERN=$(echo "$_REINFORCE_SLUGS" | paste -sd '|' -)
_REINFORCE_TEMP_LOG="${_REINFORCE_LOG}.tmp.$$"
```

## Pre-existing Issues (Not Blocking)

No CRITICAL pre-existing issues identified.

## Suggestions (Lower Confidence)

- **Consider subshell isolation for eval modules** - `scripts/hooks/sidecar-evaluate:111-115` (Confidence: 70%) -- Sourcing the eval modules with `(source "$SCRIPT_DIR/eval-learning")` in subshells would completely isolate variable namespaces, trap handlers, and exit codes. The cost is one fork per module (~5ms each), but it eliminates the entire class of namespace collision and trap-clobbering bugs. The orchestrator would need to pass required variables via `export`.

- **Pure function JSDoc comments in debug.ts claim "Does not mutate" but internally mutate the parsed object** - `src/cli/commands/debug.ts:21-26` (Confidence: 65%) -- `applyDebugTrace` parses the input string, mutates the resulting object (line 23-24: `settings.env ??= {}` and assignment), then serializes. The "Does not mutate" claim is true for the *input string* (strings are immutable in JS) but misleading -- it suggests functional purity where there is intermediate mutation. This is cosmetic since the parsed object is local, but the JSDoc could be more precise: "Does not mutate the input. Internally parses, modifies, and re-serializes."

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The decomposition of the 501-line `sidecar-evaluate` monolith into an orchestrator + 5 sourceable modules is architecturally sound and follows the direction established by `hook-bootstrap` and `hook-log-init` (applies ADR-007 -- shared helpers). The `debug.ts` pure function extraction follows the existing `applyFlags`/`stripFlags` pattern well. The main architectural concerns are: (1) the EXIT trap collision between `eval-reinforce` and `eval-learning` sharing one global trap slot in the same process, and (2) the implicit namespace coupling between sourced modules and their orchestrator that lacks the fail-fast guards already established by the new shared helpers.
