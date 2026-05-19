# TypeScript Review Report

**Branch**: feat/sidecar-system -> main
**Date**: 2026-05-17

## Issues in Your Changes (BLOCKING)

### HIGH

**Race condition in `updateFeature` — non-atomic read-modify-write** - `src/cli/utils/sidecar-config.ts:58-64`
**Confidence**: 85%
- Problem: `updateFeature` performs a read-then-write without any locking mechanism. When called 4 times sequentially in `init.ts:1139-1142`, each call reads and writes independently. While these calls are sequential (`await`), if two concurrent sessions both run `devflow init` or toggle features simultaneously (e.g., user runs `devflow learn --disable` while `devflow init` is in progress), the second writer can overwrite the first writer's changes because there's no file-level lock or compare-and-swap.
- Fix: The risk is low for typical single-user CLI usage and the `init.ts` call site awaits each in sequence. However, consider adding a batch variant or documenting the trade-off:
```typescript
/**
 * D-RACE: No file lock — concurrent writers can clobber.
 * Acceptable because CLI commands are single-threaded per-user.
 * If concurrent access becomes a concern, add mkdir-based locking
 * (like acquireMkdirLock from mkdir-lock.ts).
 */
```

**`as Record<string, unknown>` downcast after `unknown` parse — correct but slightly unsafe pattern** - `src/cli/utils/sidecar-config.ts:32`
**Confidence**: 82%
- Problem: After verifying `typeof parsed === 'object' && parsed !== null`, the code casts to `Record<string, unknown>`. While the null check makes this safe for the immediate use, the cast bypasses TypeScript's narrowing — if this pattern is copy-pasted without the null check, it becomes unsafe. The `readConfig` function already validates each field individually (good), but the intermediate cast could be replaced with a proper type guard for stronger type safety.
- Fix: Use an inline refinement or a utility:
```typescript
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
// Usage:
if (!isRecord(parsed)) return { ...DEFAULT_CONFIG };
return {
  memory: typeof parsed.memory === 'boolean' ? parsed.memory : DEFAULT_CONFIG.memory,
  // ...
};
```

### MEDIUM

**`init.ts` calls `updateSidecarFeature` 4 times independently — unnecessary I/O** - `src/cli/commands/init.ts:1139-1142`
**Confidence**: 83%
- Problem: Each `updateSidecarFeature` call reads the config file, modifies one key, and writes it back. This results in 4 reads and 4 writes when a single read + batch-modify + write would suffice. While functionally correct (each subsequent read sees the prior write due to `await`), this is wasteful I/O.
- Fix: Use `writeConfig` directly with the full desired state:
```typescript
import { writeConfig } from '../utils/sidecar-config.js';
// ...
if (gitRoot) {
  await writeConfig(gitRoot, {
    memory: memoryEnabled,
    learning: learnEnabled,
    decisions: decisionsEnabled,
    knowledge: knowledgeEnabled,
  });
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`memory.ts` --enable still writes hooks AND sidecar config (dual-state)** - `src/cli/commands/memory.ts:318-331`
**Confidence**: 84%
- Problem: The `--enable` path registers sidecar hooks in `settings.json` (via `addMemoryHooks`) AND writes sidecar config (via `updateFeature`). The `--disable` path only writes sidecar config (line 337: "hooks remain registered"). This asymmetry means `--enable` does two things while `--disable` does one. The JSDoc at line 335 explains the design — hooks are shared — but the enable path still modifies `settings.json` when the hooks may already be registered. This could be confusing during future maintenance.
- Fix: Guard the hook registration behind a `hasMemoryHooks` check (which already exists at line 319) and add a comment clarifying the asymmetry:
```typescript
if (options.enable) {
  // Hooks are shared across features; only add if missing
  if (!hasMemoryHooks(settingsContent)) {
    const updated = addMemoryHooks(settingsContent, devflowDir);
    await fs.writeFile(settingsPath, updated, 'utf-8');
    p.log.success('Working memory enabled — sidecar hooks registered');
  } else {
    p.log.info('Sidecar hooks already registered');
  }
  // Feature-specific toggle lives in sidecar config
  if (gitRoot) {
    await updateFeature(gitRoot, 'memory', true);
  }
  // ...
}
```
Note: The current code already has the `hasMemoryHooks` guard at line 319 — the difference is just that it short-circuits the entire enable block rather than separating hook registration from config update. This is a clarity improvement, not a bug.

**Unused import of `getClaudeDirectory` after partial refactor** - `src/cli/commands/learn.ts:6`
**Confidence**: 80%
- Problem: `getClaudeDirectory` is imported alongside `getDevFlowDirectory` on line 6. It is still used on line 373 (`const claudeDir = getClaudeDirectory()` inside `--reset`), so this is NOT actually dead code. However, the diff removed many uses of `getClaudeDirectory` (settings.json reads for status, enable/disable) making the import seem orphaned at first glance. No action needed — just noting this was verified.

## Pre-existing Issues (Not Blocking)

_None identified at CRITICAL severity in unchanged code._

## Suggestions (Lower Confidence)

- **`writeConfig` is not atomic** - `src/cli/utils/sidecar-config.ts:51` (Confidence: 70%) — Uses `fs.writeFile` directly. If the process crashes mid-write, the config file could be truncated. Consider the `.tmp` + rename pattern used elsewhere in this codebase (e.g., the deleted `background-runner.ts:194-196`). Low risk for a 4-field JSON config, but worth noting since the project already has `writeFileAtomicExclusive` in `fs-atomic.ts`.

- **`isFeatureEnabled` reads the full config file to check one boolean** - `src/cli/utils/sidecar-config.ts:70-75` (Confidence: 65%) — For a 4-field config this is fine, but if the call pattern becomes hot (e.g., hooks calling `isFeatureEnabled` on every prompt), the I/O cost may matter. The current usage is CLI-only, so this is acceptable.

- **No `Array.isArray` check in `readConfig`** - `src/cli/utils/sidecar-config.ts:31` (Confidence: 62%) — The check `typeof parsed !== 'object' || parsed === null` passes for arrays (since `typeof [] === 'object'`). If the config file contains a JSON array (e.g., `[]`), the cast to `Record<string, unknown>` would silently produce wrong types. Add `|| Array.isArray(parsed)` to the guard.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The new `sidecar-config.ts` module is well-typed, uses `unknown` correctly for JSON parsing (applies Iron Law), validates each field individually with explicit boolean type checks, and follows the immutable update pattern (`{ ...config, [feature]: enabled }`). The deleted code (background-runner.ts, learning-agent.ts, decisions-agent.ts) was a large simplification that removes complex infrastructure. The remaining issues are minor — a missing array guard, redundant I/O in init, and a race condition that only matters under concurrent CLI invocations. This applies ADR-001 (no migration code for the sidecar refactor — clean break from old hook-based enable/disable to sidecar config).
