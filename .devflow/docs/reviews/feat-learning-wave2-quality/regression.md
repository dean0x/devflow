# Regression Review Report

**Branch**: feat-learning-wave2-quality -> main
**Date**: 2026-03-25
**PR**: #162

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**`hasLearningHook` returns false for users with legacy Stop hook, breaking `--status` display** - `src/cli/commands/learn.ts:131-141`
**Confidence**: 85%
- Problem: `hasLearningHook()` only checks `settings.hooks.SessionEnd` for the new marker. Users who installed learning before this PR have the hook registered under `settings.hooks.Stop` with marker `stop-update-learning`. After upgrading the CLI (but before running `devflow learn --disable && --enable` or `devflow init`), `hasLearningHook()` returns `false`. The `--status` command at line 301 will show `Self-learning: disabled (hook not registered)` even though the (now-deprecated) Stop hook is still executing.
- Impact: Confusing status output for existing users. The old Stop hook is now a no-op (just `exit 0`), so learning genuinely stops working, but the status message says "disabled" without explaining the required upgrade step.
- Fix: Either (a) have `hasLearningHook` also detect the legacy marker as a "needs upgrade" state and show a specific message like `Self-learning: needs upgrade (legacy Stop hook detected). Run: devflow learn --disable && devflow learn --enable`, or (b) have `--enable` auto-detect and upgrade the legacy hook in-place (the `init` flow already does this via remove-then-add).

**`docs/reference/file-organization.md` not updated -- still references old hook name and event** - `docs/reference/file-organization.md:50,157`
**Confidence**: 92%
- Problem: The file tree at line 50 still lists `stop-update-learning` as `# Stop hook: triggers background learning` and the narrative at line 157 still says `A fourth hook (stop-update-learning) provides self-learning`. This is now incorrect -- the hook has been replaced by `session-end-learning` on the `SessionEnd` event.
- Impact: Documentation drift. Developers consulting this reference doc will get incorrect information about how the learning system is triggered.
- Fix: Update line 50 to reference `session-end-learning` with `# SessionEnd hook: triggers background learning`, add `session-end-learning` to the file tree, and update line 157 to say `A fourth hook (session-end-learning) provides self-learning`.

### MEDIUM

**Default `max_daily_runs` changed from 10 to 5 without migration for existing configs** - `src/cli/commands/learn.ts:236`, `scripts/hooks/background-learning:95,101`
**Confidence**: 82%
- Problem: The default `max_daily_runs` was halved from 10 to 5 in both TypeScript and shell code. Users who had the implicit default of 10 (no explicit config) will now get 5 runs per day without any notice. The `--configure` prompt placeholder also changed from 10 to 5.
- Impact: Behavioral change for existing users -- they get fewer learning runs. Not technically a regression since this is a default change, but it's a silent behavior modification.
- Fix: Document this as a behavioral change in the PR description or CHANGELOG. Consider logging a one-time notice when the new lower cap is first encountered.

**Procedural observation threshold raised from 2 to 3 -- existing observations near threshold may stall** - `scripts/hooks/background-learning:298,500-501`
**Confidence**: 80%
- Problem: Procedural observations previously required only 2 sightings (no temporal spread) to reach artifact creation. Now they require 3 sightings AND 24h+ temporal spread (same as workflows). Existing procedural observations with count=2 and confidence=0.50 that were previously at "ready" status will now need a third sighting plus temporal spread before creating artifacts.
- Impact: Users with procedural observations at count=2 that would have triggered artifact creation under the old rules will now need additional sessions. The confidence formula also changed (new observations start at 0.33 instead of 0.50 for procedural).
- Fix: This appears intentional (threshold hardening). Document as a behavioral change. Consider a note in the PR description that existing procedural observations may need additional reinforcement.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`session-end-learning` missing from `docs/reference/file-organization.md` file tree** - `docs/reference/file-organization.md:45-53`
**Confidence**: 90%
- Problem: The file tree in the reference documentation lists all hook scripts but `session-end-learning` is not present. The PR added this new file but did not add it to the reference documentation's file tree listing.
- Impact: Incomplete documentation for the new hook script.
- Fix: Add `session-end-learning` to the file tree between `stop-update-learning` and `background-learning`.

**`background-learning` still has `increment_daily_counter` function defined but never called** - `scripts/hooks/background-learning:131-138`
**Confidence**: 88%
- Problem: The `increment_daily_counter()` function at lines 131-138 is still defined in `background-learning`, but the call was removed (replaced by the comment at line 721 noting that `session-end-learning` increments before spawning). This is dead code.
- Impact: Dead code increases maintenance burden and could confuse future developers about whether the counter is being incremented.
- Fix: Remove the `increment_daily_counter` function from `background-learning`.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**PF-006 (per-line jq spawning) still present in `reinforce_loaded_artifacts`** - `scripts/hooks/session-end-learning:108-131`
**Confidence**: 82%
- Problem: The `reinforce_loaded_artifacts` function uses a `while IFS= read` loop that spawns `json_field` (which invokes jq or node) twice per line of learning-log.jsonl. This is the same pattern flagged in PF-006. At scale (50 observations), this adds noticeable latency to every SessionEnd hook.
- Impact: Per known pitfall PF-006, this pattern adds 1-3s latency per 100 entries. The SessionEnd hook runs synchronously before session teardown.
- Fix: Replace with single-pass `jq -s` (slurp) operation as recommended in PF-006 resolution.

## Suggestions (Lower Confidence)

- **Race condition between session-end-learning cp/rm and concurrent sessions** - `scripts/hooks/session-end-learning:190-192` (Confidence: 65%) -- If two sessions end simultaneously and both reach the "batch full" check, one could `cp` the session count file while the other is about to `rm` it. The window is small but exists.

- **No migration path for existing `.learning-last-trigger` files** - `CLAUDE.md:102` (Confidence: 70%) -- The old `.learning-last-trigger` file is replaced by `.learning-session-count` and `.learning-batch-ids`, but there is no cleanup of the old file. It will remain as orphaned state in `.memory/`.

- **`background-learning` `check_daily_cap` may redundantly reject after `session-end-learning` already checked** - `scripts/hooks/background-learning:685` (Confidence: 60%) -- Both hooks check the daily cap. If the counter is bumped between the two checks (by another concurrent session), the background learner could reject a batch that was already counted.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Regression Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The hook migration from Stop to SessionEnd is well-structured with proper legacy cleanup in `removeLearningHook` and auto-upgrade in `devflow init`. Tests are comprehensive with 78 passing (including new legacy cleanup tests). However, two HIGH issues should be addressed: (1) the `hasLearningHook` function does not detect the legacy state, causing confusing `--status` output for upgrading users, and (2) `docs/reference/file-organization.md` was not updated to reflect the hook rename. The threshold hardening (procedural: 2->3, temporal spread required for both types) and daily cap reduction (10->5) are intentional behavioral changes but should be documented.
