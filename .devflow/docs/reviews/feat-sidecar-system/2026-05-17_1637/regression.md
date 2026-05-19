# Regression Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Scope**: 11 commits of bug fixes since last review (0f0ee8a7..HEAD)

## Issues in Your Changes (BLOCKING)

### MEDIUM

**`read_daily_cap` returns inflated count on tab-less corrupted file** - `scripts/hooks/sidecar-evaluate:99`
**Confidence**: 82%
- Problem: When `cut -f2` encounters a line with no tab delimiter, it returns the entire line (e.g. `"2026-05-17"`). The `tr -dc '0-9'` sanitization then strips non-digits, producing `"20260517"` — a value that always exceeds `MAX_DAILY`, causing learning/decisions evaluation to be permanently skipped until the next day.
- Impact: If the runs-today file becomes corrupted (tab missing), the feature silently stops working for the remainder of the day. The user gets no error, just no learning/decisions processing.
- Mitigation: The writer (`printf '%s\t%d\n'`) always produces correct format, so this scenario requires external corruption. Additionally, the OLD code would CRASH the hook entirely on non-numeric input (arithmetic error under `set -e`), so the new behavior (silently skip) is strictly safer.
- Fix: Add a bounds check after sanitization. If the parsed count exceeds a reasonable maximum (e.g., 100), fall back to the default:
```bash
count=$(cut -f2 "$runs_file" 2>/dev/null | tr -dc '0-9')
count="${count:-$default}"
# Guard against inflated values from tab-less corruption
[ "${#count}" -gt 3 ] && count="$default"
```

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

### LOW

**`.failed` marker files accumulate indefinitely** - `scripts/hooks/sidecar-dispatch:111`
**Confidence**: 80%
- Problem: When a marker exhausts its retry count (`MAX_RETRIES=3`), it's renamed to `.failed`. No code path ever cleans up `.failed` files. Over extended use, these could accumulate in `.memory/.sidecar/`.
- Impact: Minimal — these are small files and the `.sidecar/` directory is gitignored. The only concern is disk hygiene over very long periods.
- Fix: Add an expiry sweep (e.g., remove `.failed` files older than 7 days) at the top of the stale-retry loop, or document that `devflow memory --clear` should clean them.

## Suggestions (Lower Confidence)

_None._

## Verification of Recent Fixes

| Commit | Fix | Regression Check | Result |
|--------|-----|------------------|--------|
| 97523f1 | Removed orphan cleanup from sidecar-capture | Queue unbounded growth? | **SAFE** — overflow cap (>200 lines to keep last 100) at line 107-113 provides the bounding mechanism. Tests confirm user entries are preserved. |
| 75dfbff | Sanitized arithmetic inputs with `tr -dc 0-9` | Break legitimate values? | **MINOR ISSUE** — see MEDIUM finding above. Empty file correctly returns 0 via `${count:-$default}`. Normal operation unaffected. |
| db9977d | Default `--status` to disabled outside git repos | Break other code paths? | **SAFE** — early return before any git-dependent logic. `--enable`/`--disable` paths already had `if (gitRoot)` guards. |
| 2eab8a6 | transcript-filter outputs empty string for empty arrays | Break callers? | **SAFE** — only caller is `sidecar-evaluate` which uses `[ -n "$VAR" ]` checks, which now correctly evaluate empty string as false. |
| 2eab8a6 | Retry cleanup: `JUST_RECOVERED` tracking | Marker lost during transition? | **SAFE** — `.retries` preserved for just-recovered markers; cleaned on next call when the marker dispatches successfully. |
| 2eab8a6 | Feature-disable skip in dispatch | Marker persists forever on re-enable? | **SAFE** — disabled markers are `rm -f`'d immediately. Re-enable triggers fresh marker creation in `sidecar-evaluate` on next session end. |
| 75dfbff | Node reinforcement atomic (write-to-.tmp then rename) | .tmp orphan? | **SAFE** — orphan .tmp cleaned at line 140 (`rm -f "$TEMP_LOG"`) before each reinforcement run. |

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 1 |

**Regression Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The single MEDIUM finding is a defensive-coding edge case that only triggers under file corruption (which the writer never produces). All 6 targeted fix commits were verified to not introduce regressions. The fix actually improves safety compared to the pre-fix behavior (crash vs. silent skip). Test suite confirms 117/117 passing.

Condition: Consider adding a bounds check in `read_daily_cap` to prevent inflated values from tab-less corruption, though this is low-priority given the writer always produces correct format.
