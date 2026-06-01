# Regression Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Unprefixed variables in eval-reinforce** - `scripts/hooks/eval-reinforce:11,14,17,18,21` (Confidence: 65%) -- Variables `LEARNING_LOG`, `LOADED_SLUGS`, `NOW_ISO`, `SLUGS_PATTERN`, `TEMP_LOG` are not prefixed with `_REINFORCE_` unlike the other eval modules which use `_LEARN_`, `_DEC_`, `_KNOW_` prefixes. Not a regression (matches original code), but could cause namespace collisions if a future module reuses these names.

- **Log file rename is a behavioral change for monitoring scripts** - `scripts/hooks/sidecar-capture:97` (Confidence: 60%) -- The log file was renamed from `.working-memory-update.log` to `.sidecar-capture.log`. Any external scripts or monitoring that reference the old filename would break. CLAUDE.md and tests are updated, but users with custom `tail -f` workflows won't be notified. This is documented in the PR description, so likely intentional.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED

## Detailed Analysis

### Decomposition Fidelity: sidecar-evaluate -> eval-* modules

The monolithic `sidecar-evaluate` (496 lines) was decomposed into an orchestrator (118 lines) plus 5 sourced modules (`eval-helpers`, `eval-reinforce`, `eval-learning`, `eval-decisions`, `eval-knowledge`). Line-by-line comparison confirms:

1. **eval-helpers** -- `read_daily_cap()`, `atomic_increment_daily()`, `load_existing_ids()` are byte-for-byte identical to the functions they replace in the original. Variable prefixing in callers (`_LEARN_`, `_DEC_`) is the only change.

2. **eval-reinforce** -- Identical logic to original lines 167-241. EXIT trap + explicit release pattern preserved. Variable `REINFORCED` renamed to `_REINFORCE_RESULT` (cosmetic, no behavior change).

3. **eval-learning** -- Identical logic to original lines 247-364, with one intentional addition: EXIT trap at line 70 (`trap 'sidecar_lock_release "$SIDECAR_DIR/.learning-batch.lock"' EXIT`). The original did NOT have an EXIT trap for the learning lock -- only explicit release. This is an intentional improvement (documented in PR description) that ensures lock release on unexpected exit. The trap is cleared at line 126 before control returns to the orchestrator, so subsequent modules are unaffected. `sidecar_lock_release` is safe to double-call (`rmdir ... || true`).

4. **eval-decisions** -- Identical logic to original lines 370-432. Variable prefixing (`_DEC_`) only.

5. **eval-knowledge** -- Identical logic to original lines 438-493. Variable prefixing (`_KNOW_`). One micro-optimization: `cat "$FILE" | tr` replaced with `tr < "$FILE"` (avoids useless use of cat). No behavior change.

### Orchestrator Variable Namespace

All variables required by eval-* modules are set in the orchestrator before `source` calls:
- `SCRIPT_DIR` (line 19), `CWD` (line 28), `DEVFLOW_DIR` (line 34)
- Feature dirs: `MEMORY_DIR`, `FEATURES_DIR`, `SIDECAR_DIR`, `LEARNING_DIR`, `DECISIONS_DIR_DATA` (lines 37-41)
- Feature flags: `LEARNING_ENABLED`, `DECISIONS_ENABLED`, `KNOWLEDGE_ENABLED` (lines 45-53)
- `sidecar-lock` sourced (line 57) before eval-helpers needs `sidecar_lock_acquire`
- `TODAY`, `NOW`, `FILTER_LIB`, `MARKER_SUFFIX`, `SESSION_ID`, `SESSION_DEEP`, `TRANSCRIPT` (lines 63-108)
- `_HAS_JQ`, `json_field_file()` from `json-parse` (line 23)

### hook-bootstrap / hook-log-init Extraction

All 7 hooks now use shared helpers instead of inline 3-line sequences. Behavior is identical:
- `hook-bootstrap`: sources `debug-trace` + calls `devflow_debug_init` + emits START marker
- `hook-log-init`: sources `log-paths` + computes `LOG_DIR`/`LOG_FILE` + defines `log()` + applies size guard

The `/tmp` fallback was improved from hardcoded `/tmp` to `${TMPDIR:-/tmp}` -- a reliability improvement, not a regression.

### CWD Validation Ordering Fix (sidecar-capture)

`devflow_debug_set_cwd "$CWD"` was moved AFTER the `[ -z "$CWD" ] || [ ! -d "$CWD" ]` guard (line 46-48). This is a correctness fix -- previously `devflow_debug_set_cwd` was called before CWD validation, which could set a bad Phase 2 log path. This was identified in Cycle 2 and is now fixed (avoids PF-007).

### sidecar-evaluate CWD Validation Tightening

Original: `[ -z "$CWD" ] && exit 0`
New: `if [ -z "$CWD" ] || [ ! -d "$CWD" ]; then exit 0; fi`

This adds a directory existence check that was missing. This is a robustness improvement that matches the pattern used by all other hooks. Not a regression.

### Feedback-loop Guard Normalization

Original: `[ "${DEVFLOW_BG_LEARNER:-}" = "1" ] && exit 0`
New: `if [ "${DEVFLOW_BG_LEARNER:-}" = "1" ]; then exit 0; fi`

Functionally identical. The `if` form is safer under `set -e` (the `&&` form technically works because `exit 0` always succeeds, but the `if` form is unambiguous). Applied consistently across `sidecar-evaluate` and `sidecar-dispatch`.

### debug.ts Pure Function Extraction (applies ADR-007)

`applyDebugTrace`, `stripDebugTrace`, `readDebugStatus` extracted as pure string->string functions, tested directly. The command action is now a thin I/O wrapper. Option processing reordered to `status->enable->disable` (consistent with `learn.ts` and `decisions.ts`). No behavioral regression -- all test assertions preserved with updated test strategy (pure function calls instead of simulated I/O).

### Test Migration

Tests rewritten from I/O-based (tmpDir + file read/write) to pure function tests. Coverage is equivalent or improved:
- Added idempotency test for `applyDebugTrace`
- Added immutability tests (input string unchanged)
- Added malformed JSON tests for both enable and disable paths
- Added `readDebugStatus` edge cases (array env, non-1 values)
- `eval-helpers` tests now source real production functions instead of duplicating logic

### Cross-Cycle Awareness

Cycle 2 fixed two ordering issues in `sidecar-capture`: `devflow_debug_set_cwd` before CWD validation, and `log-paths` before `MEMORY_ENABLED` gate. Both fixes are preserved in this branch. No re-raised false positives from prior cycles.
