# Consistency Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent `--status` pattern: memory checks hooks while learn/decisions/knowledge check sidecar config** - `src/cli/commands/memory.ts:303-313`
**Confidence**: 90%
- Problem: The `devflow memory --status` command still reports status based on the hook count in settings.json (`countMemoryHooks(settingsContent)`), while `devflow learn --status`, `devflow decisions --status`, and `devflow knowledge --status` all use `isFeatureEnabled(gitRoot, ...)` from the sidecar config. In the new sidecar system, hooks are shared across all features and always remain registered. A user who runs `devflow memory --disable` will see the sidecar config set `memory: false`, but `--status` will still report "enabled (5/5 hooks)" because the hooks remain in settings.json. This is the opposite of the expected behavior.
- Fix: Change `memory --status` to check sidecar config like the other commands:
```typescript
if (options.status) {
  const enabled = gitRoot ? await isFeatureEnabled(gitRoot, 'memory') : true;
  const count = countMemoryHooks(settingsContent);
  const total = Object.keys(MEMORY_HOOK_CONFIG).length;
  if (enabled && count === total) {
    p.log.info(`Working memory: ${color.green('enabled')}`);
  } else if (!enabled) {
    p.log.info(`Working memory: ${color.dim('disabled')}`);
  } else {
    p.log.info(`Working memory: ${color.yellow(`partial (${count}/${total} hooks)`)} — run --enable to fix`);
  }
  return;
}
```

### MEDIUM

**Stale option descriptions in memory command still reference hook-based model** - `src/cli/commands/memory.ts:208-209`
**Confidence**: 92%
- Problem: The option descriptions say `'Add UserPromptSubmit/Stop/SessionStart/PreCompact hooks'` for `--enable` and `'Remove memory hooks'` for `--disable`. But `--disable` no longer removes hooks (it writes sidecar config). Meanwhile `learn` and `decisions` have been updated to say "Enable/Disable via sidecar config". The usage help text at line 217-218 also says "Add memory hooks" / "Remove memory hooks" which is misleading.
- Fix: Update descriptions to match the learn/decisions pattern:
```typescript
.option('--enable', 'Enable working memory via sidecar config')
.option('--disable', 'Disable working memory via sidecar config')
```
And update the help note accordingly:
```typescript
`${color.cyan('devflow memory --enable')}   Enable working memory\n` +
`${color.cyan('devflow memory --disable')}  Disable working memory\n` +
```

**Inconsistent `--enable` behavior: memory still modifies settings.json hooks while others only update sidecar config** - `src/cli/commands/memory.ts:318-330`
**Confidence**: 85%
- Problem: `devflow memory --enable` does TWO things: (1) adds hooks to settings.json AND (2) updates sidecar config. But `devflow learn --enable` and `devflow decisions --enable` ONLY update sidecar config. The comment on line 300 says "Resolve current project root for sentinel management" which is a stale comment — sentinels are no longer used for memory. The dual mechanism means `memory` has a different contract than the other commands: it assumes hooks are per-feature, but in the new sidecar system, hooks are shared. This could cause confusion if a user disables memory (sidecar config=false) then re-enables it (which would try to re-add hooks that are already there because they were never removed).
- Fix: The `enable` path is currently idempotent (it checks `hasMemoryHooks` first), so there is no functional bug. But the pattern diverges. Consider documenting this is intentional (memory owns hook installation because sidecar hooks are "memory hooks" from settings.json perspective) or aligning the enable/disable contract fully. At minimum, update the comment on line 300.

**Comment referencing "sentinel management" is stale** - `src/cli/commands/memory.ts:300`
**Confidence**: 95%
- Problem: The comment `// Resolve current project root for sentinel management` references the old sentinel-based disable mechanism that this PR removes for memory. The actual use of `gitRoot` is now for sidecar config updates.
- Fix: `// Resolve current project root for sidecar config`

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`decisions --disable` creates sentinel AND updates sidecar config; `memory --disable` only updates sidecar config** - `src/cli/commands/decisions.ts:820-831` vs `src/cli/commands/memory.ts:334-344`
**Confidence**: 82%
- Problem: Decisions disable does two things: `updateFeature(gitRoot, 'decisions', false)` + creates `decisions/.disabled` sentinel. This is intentional because `session-start-context` reads the sentinel. However, `memory --disable` drops the sentinel entirely (the old `.working-memory-disabled` sentinel was removed) and relies only on sidecar config. Knowledge disable creates `.features/.disabled` sentinel + updates sidecar config. Learning disable only updates sidecar config. This is a 4-way inconsistency in the disable mechanism:
  - memory: sidecar config only
  - learning: sidecar config only
  - decisions: sidecar config + sentinel
  - knowledge: sentinel (in `handleToggle`) + sidecar config
  
  The explanation is that `session-start-context` reads `.features/.disabled` and `decisions/.disabled` sentinels independently of sidecar hooks, so those sentinels must remain. Memory and learning are fully gated by the sidecar hooks which read config.json. This is architecturally justified but not documented anywhere — a future maintainer may add a sentinel for memory/learning or remove one for decisions/knowledge thinking they're redundant.
- Fix: Add a brief comment in each command's disable path explaining why it does/doesn't create a sentinel:
```typescript
// memory --disable: No sentinel needed — sidecar-capture and sidecar-dispatch
// read config.json directly. session-start-memory also reads config.json.
```
```typescript
// decisions --disable: Sentinel required — session-start-context reads
// decisions/.disabled independently of sidecar hooks.
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`session-start-memory` still checks the legacy `.working-memory-disabled` sentinel** - `scripts/hooks/session-start-memory:22`
**Confidence**: 85%
- Problem: The hook checks both the old sentinel `[ -f "$CWD/.memory/.working-memory-disabled" ] && exit 0` and the new sidecar config. The old sentinel is never created by any code in this PR (memory --disable no longer creates it). This is defensive but creates confusion about which mechanism is canonical. This applies ADR-001 (clean break philosophy) — the legacy sentinel check could be removed since no code path creates it anymore.
- Note: This is defensive against users who may have the sentinel from a previous version. Given the small user base (ADR-001), this could be removed for clarity but is not blocking.

## Suggestions (Lower Confidence)

- **`init.ts` calls `updateSidecarFeature` 4 times sequentially instead of `writeConfig` once** - `src/cli/commands/init.ts:1139-1142` (Confidence: 65%) — Each call reads config, updates one field, writes back. Could construct the full config object and call `writeConfig` once for efficiency and atomicity.

- **`sidecar-evaluate` uses different runs-today file paths than the old hooks** - `scripts/hooks/sidecar-evaluate:111,208` (Confidence: 70%) — The learning runs file moved from `.memory/.learning-runs-today` to `.memory/.sidecar/.learning-runs-today`, and similarly for decisions. Existing counters from previous sessions won't be found. This is intentional clean-break (applies ADR-001) but the path divergence means the daily cap resets on upgrade.

- **`MEMORY_HOOK_CONFIG` name implies these are "memory hooks" but they now serve all sidecar features** - `src/cli/commands/memory.ts:16` (Confidence: 60%) — The name could be `SIDECAR_HOOK_CONFIG` to reflect that these hooks serve memory, learning, decisions, and knowledge. However, from the settings.json perspective they are registered by `devflow memory --enable`, so the current name has some justification.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 3 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Consistency Score**: 6/10
**Recommendation**: CHANGES_REQUESTED

The core sidecar architecture is well-designed and the enable/disable/status pattern is consistent across `learn`, `decisions`, and `knowledge`. However, `memory` lags behind — its `--status` still reports hook counts (which are always 5/5 in the sidecar model), its `--disable` doesn't explain why it behaves differently from the old behavior, and its option descriptions still reference the old hook-management model. The disable mechanism has a defensible 4-way split (some features need sentinels, some don't) but it lacks documentation. The PR correctly applies ADR-001 (clean break, no migration code).
