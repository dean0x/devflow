# Consistency Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Scope**: Incremental (7 commits since d8e7670 + uncommitted changes)

## Issues in Your Changes (BLOCKING)

### HIGH

**transcript-filter.cjs CLI outputs "[]" for empty results, causing spurious marker writes** - `scripts/hooks/lib/transcript-filter.cjs:201-204` + `scripts/hooks/sidecar-evaluate:156,237`
**Confidence**: 90%
- Problem: The new CLI entry point in `transcript-filter.cjs` outputs `JSON.stringify(userSignals)` and `JSON.stringify(dialogPairs)`. For empty arrays, this produces the literal string `"[]"`. In `sidecar-evaluate`, the shell checks `[ -n "$USER_SIGNALS" ]` (line 156) and `[ -n "$DIALOG_PAIRS" ]` (line 237) to decide whether to write a marker file. Since `"[]"` is a non-empty string, these checks pass even when there is no useful data, triggering unnecessary marker writes and background agent invocations on empty payloads.
- Impact: Wasteful background agent spawns. A `learning.json` marker with `userSignals: "[]"` or a `decisions.json` marker with `dialogPairs: "[]"` will cause `sidecar-dispatch` to inject a SIDECAR directive, leading to a pointless background session. The downstream agent likely handles it gracefully (produces no observations), but it burns tokens and adds latency.
- Fix: In the CLI entry point, output nothing (or exit 0 with empty stdout) when the result array is empty:
  ```javascript
  if (subcommand === 'user-signals') {
    if (userSignals.length === 0) process.exit(0);
    process.stdout.write(JSON.stringify(userSignals) + '\n');
  } else {
    if (dialogPairs.length === 0) process.exit(0);
    process.stdout.write(JSON.stringify(dialogPairs) + '\n');
  }
  ```
  This preserves the `|| true` semantics (exit 0, empty stdout, `[ -n "" ]` fails, marker skipped).

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **`sidecar-capture` exit-on-disable skips decisions-usage-scan unconditionally** - `scripts/hooks/sidecar-capture:46` (Confidence: 65%) -- When `memory: false`, the hook exits at line 46 before reaching the decisions-usage-scan at line 114. If a user disables memory but keeps decisions enabled, ADR/PF citations in assistant responses won't be tracked. This may be intentional (queue capture is prerequisite for citation counting), but differs from `sidecar-evaluate` where each feature is independently gated.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The sidecar system is well-designed with consistent config field names (`memory`, `learning`, `decisions`, `knowledge`), consistent path construction (`$CWD/.memory/.sidecar/config.json`), consistent default-to-enabled semantics across TypeScript and shell, and correct handling of boolean JSON values through `json_field_file`. The one blocking issue is a semantic mismatch between the new `transcript-filter.cjs` CLI output format and the existing shell emptiness checks in `sidecar-evaluate`.
