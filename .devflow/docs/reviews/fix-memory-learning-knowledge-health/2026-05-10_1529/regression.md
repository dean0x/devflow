# Regression Review Report

**Branch**: fix/memory-learning-knowledge-health -> main
**Date**: 2026-05-10
**Commits**: 3 (5318e2d, 88bf7ea, 64993af)

## Issues in Your Changes (BLOCKING)

### HIGH

**ensure-features-init creates malformed index.json (`{}` instead of `{"version":1,"features":{}}`)** - `scripts/hooks/ensure-features-init:13`
**Confidence**: 95%
- Problem: The `ensure-features-init` script creates `index.json` with content `{}` (line 13: `printf '{}' > "$_FEATURES_DIR/index.json"`). However, `feature-knowledge.cjs` expects the index format `{"version":1,"features":{}}`. When `checkAllStaleness()` runs against a `{}` index, it passes the truthy check (`if (!index) return {}`) but then accesses `index.features` which is `undefined`, causing `Object.keys(undefined)` to throw a `TypeError`. The crash is currently masked by `|| true` in the knowledge-refresh hook (line 43: `STALE_SLUGS=$(node ... 2>/dev/null || true)`), so the behavior is "silently crash then exit" rather than "handle empty index correctly". On main, this code path was unreachable because `[ -f index.json ] || exit 0` prevented execution when no index existed. The lazy-init creates a reachable but malformed state.
- Impact: Every fresh project's first session will trigger a `TypeError` crash in node, suppressed by `|| true`. While not user-visible today, this is latent breakage: any future caller of `checkAllStaleness` that doesn't suppress errors will crash. It also prevents `devflow knowledge list` and `devflow knowledge check` from working correctly on lazy-initialized indexes. The correct canonical format used by `updateIndex()` (line 366 of feature-knowledge.cjs) is `{ version: 1, features: {} }`.
- Fix: Change the init script to create the canonical format:
  ```bash
  printf '{"version":1,"features":{}}' > "$_FEATURES_DIR/index.json"
  ```

### MEDIUM

**Removed content-array parsing without verifying `response_text` replaces it** - `scripts/hooks/stop-update-memory:25-33`
**Confidence**: 85%
- Problem: The old stop hook handled `assistant_message` in two forms: as a plain string, and as a content array (array of `{type:"text",text:...}` and `{type:"tool_use",...}` blocks). The content-array code path had a corresponding test ("content array: joins text blocks, excludes tool_use") which is now replaced with auto-clean tests. The new code relies entirely on `response_text` being a pre-flattened string field in the stop hook JSON input from Claude Code. The commit includes a one-time diagnostic (lines 52-59) that logs the input field names to confirm `response_text` is present, which is prudent. However, the diagnostic only fires once per project (marker-based), and if `response_text` is absent, the hook will silently produce empty captures for every subsequent session (the empty-check at line 71 exits with `log "Skipped: empty response_text"`). The old dual-format parsing was defensive by design; the new code is betting that Claude Code always provides `response_text` as a string.
- Impact: If Claude Code does not yet provide `response_text` (or provides it under a different name, or only for certain stop reasons), all working memory capture silently stops. The diagnostic log helps detect this on first run, but the failure mode is silent thereafter. The commit message acknowledges this risk ("BREAKING change in the hook's input contract"). applies ADR-001 -- this is a clean break from the old field, consistent with the project's philosophy of no backward-compat code.
- Fix: The diagnostic is the right approach. Consider additionally: if `RESPONSE_TEXT` is empty and the diagnostic hasn't fired yet, log the actual field names to aid debugging. Alternatively, add a temporary fallback that checks `assistant_message` if `response_text` is empty, with a deprecation log.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Auto-clean grep pattern may false-positive on content containing `"role":"assistant"`** - `scripts/hooks/stop-update-memory:64` (Confidence: 65%) -- The orphan detection uses `grep -q '"role":"assistant"'` to check if the queue has any assistant entries. If a user prompt happens to contain the literal string `"role":"assistant"`, the auto-clean would not fire when it should. Edge case but worth noting.

- **Timeout increase from 180s to 300s may mask hanging processes** - `src/cli/utils/learning-agent.ts:73`, `src/cli/utils/decisions-agent.ts:122` (Confidence: 60%) -- The timeout increase is reasonable for slow models, but 5-minute background processes that hang will take longer to clean up. Not a regression per se, but a tradeoff.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

### Regression Checklist

- [x] No exports removed without deprecation -- N/A (shell scripts)
- [x] Return types backward compatible -- N/A
- [x] All consumers of changed code updated -- `assistant_message` fully removed from codebase (verified: zero remaining references)
- [x] Migration complete across codebase -- clean break, no stale references (applies ADR-001)
- [x] Commit messages match implementation -- all 3 commits accurately describe their changes
- [ ] **FAIL**: New lazy-init creates index.json with wrong format (`{}` vs `{"version":1,"features":{}}`)
- [x] Diagnostic logging added for the `response_text` field assumption
- [x] Test coverage updated: old content-array test replaced with auto-clean tests; overflow test updated to use mixed roles

### Key Risk Assessment

1. **`response_text` field existence**: HIGH risk but mitigated by diagnostic logging. If Claude Code doesn't provide this field, working memory capture stops silently. The one-time diagnostic log (lines 52-59) will reveal this on first run per project. Recommendation: monitor the diagnostic logs after deployment.

2. **Malformed index.json**: MEDIUM risk. The `|| true` suppression masks the TypeError today, but the wrong format is a latent bug that will surface if any code path reads the lazy-initialized index without error suppression. Fix is trivial (one-line change to the printf format string).

3. **Content-array regression**: The old content-array test was NOT testing dead code -- it tested a real parsing path for `assistant_message` when Claude Code sent it as an array. If `response_text` replaces this entirely (providing pre-flattened text), the test removal is correct. If `response_text` is not available and a fallback to `assistant_message` is needed, this is a real regression. The diagnostic will clarify which scenario applies.
