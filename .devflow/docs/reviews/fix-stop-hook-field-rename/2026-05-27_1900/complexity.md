# Complexity Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27

## Cross-Cycle Awareness

Prior cycle deferred two complexity issues:
1. **sidecar-evaluate at 496 lines with 7-level nesting** (pre-existing, warrants own PR) -- confirmed still present, not re-raised per prior resolution.
2. **Repetitive debug boilerplate across 7 hooks** (coupling concern) -- confirmed still present as designed. The `dbg()` no-op fallback + `source debug-trace || true` + `devflow_debug_init` pattern is repeated identically across all 7 hooks. Prior cycle correctly deferred this as a coupling concern rather than a blocking complexity issue.

No previously-resolved false positives to suppress.

## Issues in Your Changes (BLOCKING)

### HIGH

**Duplicated settings.json read/parse/env-extract logic in test helpers** - `tests/debug.test.ts:24-43, 50-73, 79-89`
**Confidence**: 85%
- Problem: The test file defines three near-identical helper functions (`applyEnable`, `applyDisable`, `readDebugState`) that each independently read settings.json, parse it, extract the env object with the same type guard, and operate on it. The settings.json read + env extraction logic (lines 26-38, 52-64, 80-86) is copied three times with only the mutation differing. This is 40+ lines of duplication within a single 292-line test file.
- Fix: Extract a shared helper:
```typescript
async function readSettings(settingsPath: string): Promise<{ settings: Settings; env: Record<string, string> } | null> {
  let settings: Settings;
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    settings = JSON.parse(raw) as Settings;
  } catch (err: unknown) {
    if (err instanceof SyntaxError) return null;
    settings = {};
  }
  const rawEnv = settings.env;
  const env: Record<string, string> =
    (typeof rawEnv === 'object' && rawEnv !== null && !Array.isArray(rawEnv))
      ? { ...(rawEnv as Record<string, string>) }
      : {};
  return { settings, env };
}
```
Then `applyEnable`, `applyDisable`, and `readDebugState` each call this shared reader, reducing the three 15-line blocks to three 5-line blocks.

### MEDIUM

**Repeated 4-line debug boilerplate block across 7 hooks** - `scripts/hooks/sidecar-capture:8-18`, `scripts/hooks/sidecar-dispatch:8-22`, `scripts/hooks/sidecar-evaluate:7-21`, `scripts/hooks/session-start-memory:7-17`, `scripts/hooks/session-start-context:11-22`, `scripts/hooks/pre-compact-memory:10-19`, `scripts/hooks/preamble:7-17`
**Confidence**: 82%
- Problem: Every hook file now contains an identical 4-line initialization sequence: `dbg() { :; }` / `source "$SCRIPT_DIR/debug-trace" || true` / `devflow_debug_init "hook-name"` / `dbg "=== HOOK START ==="`. While each individual hook remains within complexity thresholds, 7 copies of this pattern means any change to the initialization protocol requires touching all 7 files. This was correctly deferred by the prior cycle as a coupling concern; noting it again at MEDIUM since the pattern is now fully landed.
- Fix: Consider wrapping the 4-line sequence into a single-call init function inside `debug-trace` itself, e.g., `devflow_debug_bootstrap "hook-name"` that does the fallback definition + init + HOOK START log internally. Each hook would then need only: `source "$SCRIPT_DIR/debug-trace" || true` and `devflow_debug_bootstrap "hook-name"`. This halves the per-hook boilerplate from 4 lines to 2.

**Repeated log() definition pattern across 5 hooks** - `scripts/hooks/sidecar-capture:62`, `scripts/hooks/sidecar-dispatch:48`, `scripts/hooks/sidecar-evaluate:59`, `scripts/hooks/session-start-memory:41`, `scripts/hooks/session-start-context:50`
**Confidence**: 80%
- Problem: Five hooks define `log()` with an identical pattern: `source log-paths`, `LOG_DIR=$(devflow_log_dir ... || echo "/tmp")`, `LOG_FILE="$LOG_DIR/.{hook-name}.log"`, `log() { echo "..." >> "$LOG_FILE" ... }`. The 4-line logging setup block is duplicated 5 times (20 lines total), differing only in the hook name string. This PR added the `/tmp` fallback and `2>/dev/null || true` guard to all of them in lockstep, confirming they are functionally identical.
- Fix: Add a `devflow_log_init "hook-name" "$CWD"` function to a shared helper (possibly in `log-paths` itself) that sets up `LOG_DIR`, `LOG_FILE`, and defines `log()`. Each hook replaces 4 lines with 1 call.

## Issues in Code You Touched (Should Fix)

_No issues found at >= 80% confidence._

## Pre-existing Issues (Not Blocking)

### CRITICAL

**sidecar-evaluate is 496 lines with 7-level nesting depth** - `scripts/hooks/sidecar-evaluate`
**Confidence**: 95%
- Problem: This file handles transcript finding, session depth checking, artifact reinforcement (with jq/node dual paths), learning evaluation (config loading, daily cap, batch counting, locking, transcript filtering, marker writing), decisions evaluation (same pattern), and knowledge evaluation (same pattern) -- all in a single script. The reinforcement block (lines 167-241) alone has 7 levels of nesting: `if learning_enabled` > `if log exists` > `if slugs nonempty` > `if lock acquired` > `if has_jq` > `if jq succeeded` > `if diff`. Per the complexity skill: nesting > 6 is CRITICAL severity, file > 500 is CRITICAL.
- Note: This was already deferred in the prior cycle as "warrants own PR". Reaffirming as pre-existing CRITICAL for visibility. The debug-trace additions (adding `dbg` calls) do not worsen the nesting but do add 33 lines to an already oversized file.

## Suggestions (Lower Confidence)

- **Test beforeEach/afterEach duplication** - `tests/debug.test.ts:94-100, 153-159, 230-236, 272-278` (Confidence: 70%) -- Four describe blocks each define identical `beforeEach`/`afterEach` for tmpDir creation and cleanup. A shared test fixture would reduce this.

- **Dual-path jq/node complexity in sidecar-capture field extraction** - `scripts/hooks/sidecar-capture:38-44` (Confidence: 65%) -- The jq/node dual-path for field extraction is a recurring pattern across hooks. While each instance is simple, the aggregate complexity across all hooks is notable.

- **Magic number 5242880 in debug-trace size guard** - `scripts/hooks/debug-trace:33` (Confidence: 62%) -- The 5MB and 2.5MB thresholds are inline magic numbers. Named constants at the top of the file would improve readability: `_MAX_LOG_BYTES=5242880` and `_KEEP_LOG_BYTES=2621440`.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | - | 1 | 2 | - |
| Should Fix | - | - | - | - |
| Pre-existing | 1 | - | - | - |

**Complexity Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The new `debug-trace` helper (59 lines) and `debug.ts` CLI command (81 lines) are well-structured and within all complexity thresholds. The `devflow_debug_init` / `devflow_debug_set_cwd` two-phase design is clean. The test file duplications are the main blocker-tier concern -- extracting shared helpers in the test and collapsing the hook boilerplate would bring this to a clean APPROVED. The pre-existing sidecar-evaluate complexity remains the elephant in the room but is correctly scoped to a separate effort.
