# Performance Review Report

**Branch**: feat/flags-init-redesign -> main
**Date**: 2026-03-27

## Issues in Your Changes (BLOCKING)

### HIGH

**Sequential I/O where parallel is possible (recommended path)** - `src/cli/commands/init.ts:336-353`
**Confidence**: 85%
- Problem: In the recommended init path, `discoverProjectGitRoots()` and the safe-delete detection (`getInstalledVersion(profilePath)`) are executed sequentially. These are independent filesystem operations — `discoverProjectGitRoots` scans `~/.claude/history.jsonl` and checks git directories, while `getInstalledVersion` reads the shell profile. Neither depends on the other's result.
- Impact: On machines with many Claude projects (e.g., 50+ git roots to stat), `discoverProjectGitRoots` can take hundreds of milliseconds. Running the profile read in parallel would save a round-trip.
- Fix: Use `Promise.all` for the independent async operations:
```typescript
// Instead of:
if (earlyGitRoot && scope === 'user') {
  discoveredProjects = await discoverProjectGitRoots();
}
// ... then later:
if (profilePath && safeDeleteAvailable) {
  const trashCmd = safeDeleteInfo.command;
  safeDeleteBlock = generateSafeDeleteBlock(shell, process.platform, trashCmd);
  if (safeDeleteBlock) {
    const installedVersion = await getInstalledVersion(profilePath);
    // ...
  }
}

// Consider:
const [discoveredResult, installedVersionResult] = await Promise.all([
  earlyGitRoot && scope === 'user' ? discoverProjectGitRoots() : Promise.resolve([]),
  profilePath && safeDeleteAvailable && safeDeleteBlock
    ? getInstalledVersion(profilePath)
    : Promise.resolve(0),
]);
discoveredProjects = discoveredResult;
// ... use installedVersionResult
```

### MEDIUM

**Redundant manifest reads in flags command enable/disable** - `src/cli/commands/flags.ts:99-105` and `src/cli/commands/flags.ts:113-120`
**Confidence**: 85%
- Problem: Both `--enable` and `--disable` paths call `resolveEnabledFlags(devflowDir)` (which internally calls `readManifest`), then call `updateManifestFlags(devflowDir, updated)` (which also calls `readManifest`). This results in two sequential reads of the same `manifest.json` file when one would suffice.
- Impact: Minor — doubles the file I/O for a small JSON file during a CLI command. The manifest is typically under 1KB, so this adds ~1-2ms of unnecessary disk I/O.
- Fix: Pass the already-read manifest into `updateManifestFlags` instead of re-reading it:
```typescript
// In flags.ts, modify updateManifestFlags to accept an optional pre-read manifest:
async function updateManifestFlags(
  devflowDir: string,
  flagIds: string[],
  existingManifest?: ManifestData | null,
): Promise<void> {
  const manifest = existingManifest ?? await readManifest(devflowDir);
  if (!manifest) return;
  manifest.features.flags = flagIds;
  manifest.updatedAt = new Date().toISOString();
  await writeManifest(devflowDir, manifest);
}

// And in the enable path:
if (options.enable) {
  const ids = parseFlagIds(options.enable as string);
  const manifest = await readManifest(devflowDir);
  const current = manifest && manifest.features.flags.length > 0
    ? manifest.features.flags
    : getDefaultFlags();
  const updated = [...new Set([...current, ...ids])];
  await updateSettingsFlags(claudeDir, updated);
  await updateManifestFlags(devflowDir, updated, manifest);
  // ...
}
```

**Sequential settings + manifest writes in flags command** - `src/cli/commands/flags.ts:104-105`
**Confidence**: 82%
- Problem: `updateSettingsFlags` and `updateManifestFlags` write to different files (`settings.json` and `manifest.json`) but are awaited sequentially. These are independent writes.
- Impact: Adds one extra file-write latency to every `devflow flags --enable/--disable` invocation. Typically 1-5ms depending on filesystem.
- Fix: Use `Promise.all` since these writes are independent:
```typescript
await Promise.all([
  updateSettingsFlags(claudeDir, updated),
  updateManifestFlags(devflowDir, updated),
]);
```

## Issues in Code You Touched (Should Fix)

_No issues found._

## Pre-existing Issues (Not Blocking)

_No issues found._

Note: PF-002 (init command monolith, ~765 lines) remains relevant — this PR adds ~87 net lines to init.ts, growing it further. However, the two-mode refactoring (recommended vs. advanced) actually improves the structure by separating concerns. The monolith pitfall is tracked separately and does not block this PR.

## Suggestions (Lower Confidence)

- **Double JSON parse/stringify on init settings path** - `src/cli/commands/init.ts:823-824` (Confidence: 65%) — `stripFlags` and `applyFlags` each call `JSON.parse`/`JSON.stringify` on the settings content. In the init flow, the settings string is already being parsed and re-serialized by adjacent hook functions (`addMemoryHooks`, `addHudStatusLine`, etc.), so there are multiple redundant parse/serialize round-trips. A future refactor could pass a parsed object through the pipeline instead of re-serializing at each step. This is a pre-existing architectural pattern, not introduced by this PR.

- **`parseFlagIds` uses linear search for validation** - `src/cli/commands/flags.ts:54` (Confidence: 60%) — `FLAG_REGISTRY.some(f => f.id === id)` is O(n) per input ID. With 5 flags this is negligible, but a `Set`-based lookup would be O(1). Not worth changing at current registry size.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Performance Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The new code is well-structured with pure functions, no synchronous I/O in the critical path, and efficient data structures (Sets for lookups in `--disable` and `--list` paths). The `flags.ts` utility functions are CPU-bound (JSON parse/serialize on small payloads) and appropriately avoid any blocking I/O.

The recommended init path is a meaningful performance improvement over the old flow — it skips 6-8 interactive prompts entirely, reducing wall-clock time from ~30s of user interaction to near-instant. The one HIGH finding (parallelizable I/O in the recommended path) is worth addressing to fully capitalize on that fast path. The two MEDIUM findings are minor optimizations for the standalone `devflow flags` command.

No critical performance issues. Merge is safe after addressing the HIGH-severity parallelization opportunity.
