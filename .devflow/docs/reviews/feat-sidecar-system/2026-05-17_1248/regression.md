# Regression Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17
**Scope**: Incremental (7 commits since d8e7670)

## Issues in Your Changes (BLOCKING)

### CRITICAL

**Artifact reinforcement logic completely removed** - `scripts/hooks/sidecar-evaluate`
**Confidence**: 95%

- Problem: The old `session-end-learning` hook contained a `reinforce_loaded_artifacts()` function that scanned the transcript for `self-learning[:/]<slug>` references and updated the `last_seen` timestamp on matching observations in `learning-log.jsonl`. This behavior is documented in `CLAUDE.md` as: "Loaded artifacts are reinforced locally (no LLM) on each session end." The new `sidecar-evaluate` hook has zero artifact reinforcement logic -- no grep for slug references, no `last_seen` updates, nothing. The sidecar skill's learning agent prompt also does not mention reinforcement of existing artifacts during its analysis.
- Impact: Without reinforcement, loaded artifacts will never have their `last_seen` timestamps updated. This means the capacity review system (`devflow decisions --review`) and the reconciler's confidence penalty mechanism lose the signal they need to distinguish actively-used artifacts from stale ones. Over time, all artifacts will appear equally "last seen" at their creation date regardless of actual usage frequency, breaking the decay/deprecation lifecycle.
- Fix: Add a reinforcement section to `sidecar-evaluate` (before the learning evaluation block) that:
  1. Scans the transcript for `self-learning[:/][a-z0-9-]+` patterns
  2. If matches found, updates `last_seen` on matching observations in `learning-log.jsonl`
  3. This should run on every deep session regardless of batch/learning config state (it is local-only, no LLM)

  Alternatively, move reinforcement into the `sidecar-dispatch` hook (runs on each prompt), but per-session-end is sufficient and matches the old behavior.

### HIGH

**`session-start-memory` removed `.working-memory-disabled` sentinel fallback** - `scripts/hooks/session-start-memory:21-25`
**Confidence**: 88%

- Problem: The old `session-start-memory` checked the legacy `.working-memory-disabled` sentinel file directly (`[ -f "$CWD/.memory/.working-memory-disabled" ] && exit 0`). The new code removed this check and only reads the sidecar config. However, the `pre-compact-memory` hook at line 24 still checks `[ -f "$CWD/.memory/.working-memory-disabled" ] && exit 0`. This creates an inconsistency: if a user has the old sentinel file from a pre-sidecar installation (or manually created it), `pre-compact-memory` respects it but `session-start-memory` ignores it.
- Impact: For users upgrading from a non-sidecar install where memory was disabled via the old sentinel, `session-start-memory` will start injecting context again even though the user had disabled memory. The `pre-compact-memory` hook would still respect the old sentinel, creating contradictory behavior within the same session.
- Fix: This aligns with ADR-001 (clean break philosophy), so the fix should be to also remove the sentinel check from `pre-compact-memory` for consistency. Both hooks should read only from sidecar config. If the pre-compact hook must work without sidecar config for backwards compat, then `session-start-memory` should also check the old sentinel as a fallback (which it did before this commit removed it).

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`sidecar-evaluate` decisions section no longer checks `.memory/decisions/.disabled` sentinel** - `scripts/hooks/sidecar-evaluate:207-210`
**Confidence**: 82%

- Problem: The old `session-end-decisions` hook checked `[ -f "$MEMORY_DIR/decisions/.disabled" ] && exit 0` at the top. The new `sidecar-evaluate` removed this check in favor of a comment stating "this hook uses DECISIONS_ENABLED" from sidecar config. However, `session-start-context` still respects `.memory/decisions/.disabled` (and the sentinel test at `sentinel.test.ts:322-333` validates this). If a user runs `devflow decisions --disable`, the CLI calls `manageSentinel` to create `.memory/decisions/.disabled` and calls `updateFeature(gitRoot, 'decisions', false)`. Both paths are in sync. But if a user manually creates the sentinel file (or if a migration left it), the session-start-context would suppress decisions injection while the evaluation would still process and write markers.
- Impact: Minor divergence in disable mechanisms. In practice both paths are managed by the CLI, so they stay synchronized. The risk is that a stale sentinel file (from before the sidecar migration) without a matching config entry could cause the decisions agent to run and write to `decisions.md` while `session-start-context` suppresses reading from it -- wasting tokens on invisible work.
- Fix: Add a defensive check: `[ -f "$CWD/.memory/decisions/.disabled" ] && DECISIONS_ENABLED="false"` as a fallback before the sidecar config read, or ensure the sentinel is always cleaned up during migration.

### MEDIUM

**`pre-compact-memory` still uses old sentinel but not sidecar config** - `scripts/hooks/pre-compact-memory:24`
**Confidence**: 84%

- Problem: `pre-compact-memory` checks `[ -f "$CWD/.memory/.working-memory-disabled" ] && exit 0` but does not read the sidecar config. If memory is disabled via sidecar config (`memory: false`), the pre-compact hook will still run and write `backup.json`. This is a mild inconsistency -- the backup is harmless but wasteful, and it gives a false impression that memory is active.
- Impact: Low functional risk (backup.json is benign), but creates semantic confusion about whether memory is truly disabled.
- Fix: Add a sidecar config check to `pre-compact-memory` that mirrors `session-start-memory`:
  ```bash
  SIDECAR_CONFIG="$CWD/.memory/.sidecar/config.json"
  if [ -f "$SIDECAR_CONFIG" ]; then
    MEMORY_ENABLED=$(json_field_file "$SIDECAR_CONFIG" "memory" "true")
    [ "$MEMORY_ENABLED" = "false" ] && exit 0
  fi
  ```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**CLAUDE.md documentation drift on reinforcement** - `CLAUDE.md`
**Confidence**: 90%

- Problem: CLAUDE.md states "Loaded artifacts are reinforced locally (no LLM) on each session end" in the Working Memory section. With reinforcement removed from the hooks, this documentation is now inaccurate. The system no longer reinforces loaded artifacts at all.
- Impact: Developers and AI agents reading CLAUDE.md will assume reinforcement exists and may rely on `last_seen` timestamps being meaningful, when they are actually frozen at creation time.

### LOW

**`memory.ts` usage note inconsistency** - `src/cli/commands/memory.ts:217-218`
**Confidence**: 80%

- Problem: The no-flag usage help message still says "Add memory hooks" and "Remove memory hooks" for --enable/--disable, while the option descriptions (lines 208-209) were updated to say "Enable working memory via sidecar config" / "Disable working memory via sidecar config". Minor UX inconsistency.
- Impact: Users see conflicting descriptions depending on how they invoke help.

## Suggestions (Lower Confidence)

- **Old `devflow learn --run-background` CLI path dead?** - `src/cli/commands/learn.ts` (Confidence: 65%) -- The old hooks spawned `devflow learn --run-background` and `devflow decisions --run-background` in detached nohup processes. The new sidecar system relies on Claude spawning background agents via the sidecar skill. Verify that the `--run-background` subcommand is still needed or can be deprecated.

- **Sidecar dispatch timing gap** - `scripts/hooks/sidecar-dispatch` (Confidence: 70%) -- The old hooks spawned background processes immediately at session end. The new system writes markers at session end but only dispatches them on the next user prompt. If a user doesn't start a new session for days/weeks, the markers sit idle. The old system would have completed the work immediately.

- **Queue overflow edge case with disabled memory** - `scripts/hooks/sidecar-capture:102-108` (Confidence: 62%) -- If memory was previously enabled, queue accumulated, then memory is disabled (which now drains queue via `--disable`), but if the disable happened via raw config edit (not CLI), the queue could persist indefinitely and hit the 200-line overflow path on re-enable.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 1 | 1 | - | - |
| Should Fix | - | - | 2 | - |
| Pre-existing | - | - | 1 | 1 |

**Regression Score**: 4/10
**Recommendation**: CHANGES_REQUESTED

The critical finding (dropped artifact reinforcement) represents a complete loss of a documented behavior that other subsystems depend on for lifecycle management. The HIGH finding (sentinel inconsistency) creates a behavioral difference for upgrading users. Both should be addressed before merge.
