# Architecture Review Report

**Branch**: feat/wave-1 -> main
**Date**: 2026-03-13

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Unsafe type assertion in `readManifest` -- `JSON.parse` cast bypasses runtime validation** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts:27`
**Confidence**: 85%
- Problem: `readManifest` casts the parsed JSON directly via `as ManifestData`, then only checks three fields (`version`, `plugins` array, `scope`). The `features` object, `installedAt`, and `updatedAt` fields are not validated. A corrupt or hand-edited manifest with `features: null` or a missing `installedAt` will pass validation but cause runtime errors downstream when `list.ts` calls `new Date(manifest.installedAt)` or accesses `manifest.features.teams`.
- Fix: Validate all required fields, or use a schema-based approach. Minimal fix:
```typescript
export async function readManifest(devflowDir: string): Promise<ManifestData | null> {
  const manifestPath = path.join(devflowDir, 'manifest.json');
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const data = JSON.parse(content);
    if (
      !data.version ||
      !Array.isArray(data.plugins) ||
      !data.scope ||
      typeof data.features !== 'object' ||
      data.features === null ||
      typeof data.features.teams !== 'boolean' ||
      typeof data.features.ambient !== 'boolean' ||
      typeof data.features.memory !== 'boolean' ||
      !data.installedAt ||
      !data.updatedAt
    ) {
      return null;
    }
    return data as ManifestData;
  } catch {
    return null;
  }
}
```
Alternatively, adopt Zod for boundary validation, consistent with the project's CLAUDE.md principle "Validate at boundaries -- Parse, don't validate (Zod schemas)". This codebase does not currently use Zod anywhere, so introducing it for one utility would be premature, but the manual validation above is the minimum.

---

**`writeManifest` returns `void` instead of signaling failure** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts:40-43`
**Confidence**: 82%
- Problem: `writeManifest` can throw on `fs.mkdir` or `fs.writeFile` failures (permissions, disk full), and the caller in `init.ts:624` does not wrap it in try/catch. A write failure at the end of `init` would crash with an unhandled promise rejection after all plugins have already been installed, giving the user a confusing error message despite a successful install.
- Fix: Either wrap the call in init.ts in a try/catch with a non-fatal warning, or have `writeManifest` return a success boolean:
```typescript
// In init.ts, around line 624:
try {
  await writeManifest(devflowDir, manifestData);
} catch {
  p.log.warn('Failed to write installation manifest (install succeeded)');
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`init.ts` command handler growing into a God Function (627 lines)** - `/Users/dean/Sandbox/devflow/src/cli/commands/init.ts:112-627`
**Confidence**: 85%
- Problem: The `init` command action handler is a single 515-line async function spanning lines 112-627. This PR adds two more concerns to it: manifest reading/upgrade detection (lines 297-305) and manifest writing (lines 612-624). The function now handles: scope selection, plugin selection, teams/ambient/memory selection, security mode, path resolution, upgrade detection, directory validation, plugin installation, legacy cleanup, extras configuration, settings, hooks, safe-delete, verbose output, and manifest writing. This is a clear SRP violation -- one function with 15+ reasons to change.
- Impact: Each new feature added to `init` makes the function harder to understand, test, and maintain. The manifest integration itself is clean, but it compounds an existing structural problem.
- Fix: Extract logical phases into named functions. This does not need to happen in this PR, but the trajectory should be acknowledged. For example:
```typescript
// Future refactor direction:
async function resolveInstallScope(options: InitOptions): Promise<ScopeResult> { ... }
async function selectPlugins(options: InitOptions): Promise<PluginSelection> { ... }
async function detectExistingInstall(devflowDir: string, version: string): Promise<UpgradeInfo | null> { ... }
async function installPlugins(config: InstallConfig): Promise<void> { ... }
async function configureExtras(config: ExtrasConfig): Promise<void> { ... }
async function writeInstallManifest(config: ManifestConfig): Promise<void> { ... }
```

### LOW

**`list.ts` scope detection derives scope from manifest presence rather than manifest content** - `/Users/dean/Sandbox/devflow/src/cli/commands/list.ts:28`
**Confidence**: 80%
- Problem: Line 28 derives the display scope as `localManifest ? 'local' : 'user'`, but the manifest itself already contains a `scope` field. If a user installs with `--scope=user` while inside a git repo, the local manifest detection could show incorrect scope information if manifest files exist in both locations with different scope values.
- Impact: Minor UI inconsistency. The local-first fallback (`localManifest ?? userManifest`) is reasonable, but it should use the manifest's own `scope` field for display.
- Fix:
```typescript
const scope = manifest.scope;  // Use the manifest's own field instead of inferring
```

## Pre-existing Issues (Not Blocking)

_No critical pre-existing issues found in the reviewed files._

## Suggestions (Lower Confidence)

- **Custom semver comparison duplicates common utility** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts:64-80` (Confidence: 70%) -- The `compareSemver` function is a hand-rolled semver parser. The `search-first` skill added in this same PR would suggest checking if Node.js `semver` package or `node:util` could handle this. However, the function is intentionally simple (31 lines, handles only x.y.z), and the project avoids unnecessary dependencies in CLI tooling, so "Build" is likely the correct decision. Worth a `// search-first: Built custom` comment.

- **Deleted plugin-local agents may leave stale installed copies** - `/Users/dean/Sandbox/devflow/plugins/devflow-specify/agents/skimmer.md` (deleted), `/Users/dean/Sandbox/devflow/plugins/devflow-specify/agents/synthesizer.md` (deleted) (Confidence: 65%) -- Two plugin-local agent files were deleted (`skimmer.md`, `synthesizer.md` from devflow-specify). These were duplicates of shared agents. The build system distributes shared agents, but previously installed copies of these plugin-local agents may persist in `~/.claude/agents/devflow/` after upgrade. The existing legacy cleanup mechanism only handles skills and commands (`LEGACY_SKILL_NAMES`, `LEGACY_COMMAND_NAMES`), not agents. Users reinstalling will get the shared versions, so this is a minor concern.

- **No migration path documented for manifest schema changes** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts:7-18` (Confidence: 60%) -- The `ManifestData` interface has no version field for the schema itself. If future versions add fields to the manifest, older manifests read by newer code will pass the current loose validation but may have missing fields. A `schemaVersion` field would future-proof this.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 1 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The architecture of this PR is solid. The manifest module (`manifest.ts`) is well-separated with clear single-responsibility functions, proper typing, and comprehensive test coverage (186 lines of tests for 107 lines of code). The confidence threshold and consolidation rules added to the reviewer/synthesizer agents are cleanly integrated into existing patterns. The search-first skill follows established skill conventions precisely.

The two blocking MEDIUM issues are straightforward to address: tighten manifest validation to prevent runtime crashes from malformed files, and wrap the manifest write in init.ts with error handling so a write failure does not crash an otherwise successful install. Neither requires architectural rework.

The deleted plugin-local agent duplicates (skimmer.md, synthesizer.md) correctly consolidate to the shared agent pattern, which is the project's established convention.
