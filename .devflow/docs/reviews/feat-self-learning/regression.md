# Regression Review Report

**Branch**: feat/self-learning -> main
**Date**: 2026-03-23
**PR**: #160
**Commits**: 2 (fc22ee4 feat, 62550a9 fix)

## Issues in Your Changes (BLOCKING)

### HIGH

**`learn?: boolean` optional field inconsistent with init.ts non-optional usage** - `src/cli/utils/manifest.ts:15`, `src/cli/commands/init.ts:858`
**Confidence**: 85%
- Problem: The `ManifestData.features.learn` field is declared as optional (`learn?: boolean`) in the type definition, yet `init.ts:858` always writes it as a required value: `features: { teams: teamsEnabled, ambient: ambientEnabled, memory: memoryEnabled, learn: learnEnabled, hud: hudEnabled }`. More importantly, `readManifest()` does NOT validate `learn` in its guard clause (lines 37-47 of manifest.ts), which is correct for backwards compatibility. However, this means code consuming `manifest.features.learn` must always handle `undefined`, but no such guard exists anywhere in the codebase currently. If future code reads `manifest.features.learn` without a nullish check (following the pattern of `teams`/`ambient`/`memory` which are non-optional), it will silently get `undefined` for manifests written by older versions, causing a behavioral regression for upgrade users.
- Fix: This is acceptable as-is for v1 since no code currently reads `manifest.features.learn` outside of init.ts. However, document the upgrade-path consideration: any future code reading this field must use `manifest.features.learn ?? false`. Alternatively, make `learn` non-optional with a default in `readManifest`:
```typescript
// In readManifest, after parsing:
data.features.learn = data.features.learn ?? false;
```

### MEDIUM

**`session-start-memory` writes to `.learning-notified-at` during SessionStart hook (side effect in read-only context)** - `scripts/hooks/session-start-memory:232`
**Confidence**: 82%
- Problem: The session-start-memory hook is a SessionStart hook that is supposed to inject context. The new Section 1.75 writes `date +%s > "$NOTIFIED_MARKER"` unconditionally whenever learned behaviors exist. This write side effect in a SessionStart hook is a behavioral change. If the SessionStart hook is triggered multiple times in the same session (e.g., on `/clear`), the notification marker gets updated each time, meaning the "NEW" artifact notification only appears on the first `/clear` rather than persisting until the next full session start. This subtly differs from the documented behavior of "new artifacts since last notification."
- Fix: Consider gating the marker write on whether NEW_ARTIFACTS was non-empty, so the marker only advances when there were actually new items to notify about:
```bash
if [ -n "$NEW_ARTIFACTS" ]; then
  # Update notified marker only when we actually showed new items
  date +%s > "$NOTIFIED_MARKER"
fi
```
Currently the marker is updated even when no new artifacts exist, which just wastes a write but does not cause harm.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**init.ts monolith grows by 37 lines** - `src/cli/commands/init.ts`
**Confidence**: 80%
- Problem: PF-002 from pitfalls.md identifies init.ts as a monolith (765 lines, cyclomatic complexity ~176). This PR adds 37 more lines (learn prompt, hook registration, manifest feature), further compounding the issue. The learning selection block (lines 349-369) follows the exact same pattern as memory and ambient selection, reinforcing the need for the `collectInitChoices()` extraction noted in PF-002.
- Fix: Not blocking for this PR since it follows the established pattern consistently. However, this increases the urgency of the PF-002 refactoring.

## Pre-existing Issues (Not Blocking)

_No critical pre-existing regressions detected._

## Suggestions (Lower Confidence)

- **Two Stop hooks race on large session transcripts** - `scripts/hooks/stop-update-learning`, `scripts/hooks/stop-update-memory` (Confidence: 65%) -- Both hooks spawn background `claude -p` processes simultaneously on session stop. For users with large session transcripts and limited API rate limits, two concurrent Sonnet/Haiku calls may compete for throughput. The feedback-loop guards are correct (`DEVFLOW_BG_UPDATER`/`DEVFLOW_BG_LEARNER` env vars properly cross-guard), but there is no sequencing or rate coordination between them.

- **`printf '%s\n' "$ART_CONTENT"` may truncate on very long model-generated content** - `scripts/hooks/background-learning:610` (Confidence: 62%) -- The `printf '%s\n'` for writing artifact content is safe against shell expansion (good), but extremely long model-generated content (>128KB) could hit platform-specific `ARG_MAX` limits on some systems. The `printf` builtin in bash handles this fine on macOS, but POSIX does not guarantee it.

- **Temporal decay uses macOS-specific `date -j -f` as primary path** - `scripts/hooks/background-learning:290-292` (Confidence: 70%) -- The `date -j -f "%Y-%m-%dT%H:%M:%SZ" ... +%s` with GNU `date -d` fallback follows the existing pattern in the codebase (same as in stop-update-memory), so this is consistent. But if the codebase ever targets Linux-first or CI environments, the macOS-first path ordering could cause confusion.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Regression Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Conditions

1. Acknowledge the `learn?: boolean` optional type issue as a known upgrade-path consideration. Either add a defaulting guard in `readManifest` or document that all consumers must null-check.
2. Consider moving the `NOTIFIED_MARKER` write inside the `if [ -n "$NEW_ARTIFACTS" ]` block in session-start-memory.

### Regression Checklist

- [x] No exports removed without deprecation
- [x] Return types backward compatible
- [x] Default values unchanged for existing features
- [x] Side effects preserved (memory hooks, ambient hooks unaffected)
- [x] All consumers of changed code updated (init, uninstall, manifest)
- [x] Migration complete across codebase (hook add/remove in init + uninstall)
- [x] CLI options preserved (no removed flags)
- [x] Commit message matches implementation
- [ ] Breaking changes documented in CHANGELOG (no CHANGELOG entry for new feature)
- [x] Feedback loop guards properly cross-guard between memory and learning hooks
- [x] Lock directories are distinct (`.working-memory.lock` vs `.learning.lock`)
- [x] PF-001 (Synthesizer glob) -- not affected by this change
- [x] PF-002 (Init monolith) -- acknowledged, follows existing pattern
- [x] PF-003 (pluginHints duplication) -- not affected (no new plugin added)

### Positive Observations

The implementation is well-structured and follows established patterns closely:
- Hook registration (`addLearningHook`/`removeLearningHook`/`hasLearningHook`) mirrors the ambient hook pattern exactly
- Stop hook feedback-loop prevention uses the same env-var guard pattern as memory hooks, with proper cross-guarding
- Lock file mechanism replicates the memory hook's mkdir-based atomic locking
- Path traversal sanitization on model-generated artifact names is a good security measure
- 28 tests cover all exported pure functions comprehensively
- `printf %s` for writing model content prevents shell injection
- Graceful degradation throughout (jq missing, claude missing, lock timeout, daily cap)
