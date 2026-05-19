# Consistency Review Report

**Branch**: feat/wave-1 -> main
**Date**: 2026-03-13

## Issues in Your Changes (BLOCKING)

### HIGH

**Manifest `readManifest` uses unsafe cast without full validation** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts:27-28`
**Confidence**: 85%
- Problem: `readManifest` casts with `as ManifestData` after only checking `version`, `plugins` (array), and `scope`. It does not validate the `features` object (teams/ambient/memory), `installedAt`, or `updatedAt`. Other utility modules in this codebase (e.g., `paths.ts:49`, `git.ts:26-28`) validate thoroughly before returning. The CLAUDE.md engineering principles require "Validate at boundaries" with Zod schemas. While the rest of the codebase does not consistently use Zod for internal file reads, the partial validation here is inconsistent with the exhaustive checks seen elsewhere (e.g., `safe-delete-install.ts` validates every field of parsed profile content).
- Fix: Either validate all fields or add a comment acknowledging the trust boundary. Minimal fix:
```typescript
export async function readManifest(devflowDir: string): Promise<ManifestData | null> {
  const manifestPath = path.join(devflowDir, 'manifest.json');
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const data = JSON.parse(content) as ManifestData;
    if (
      !data.version ||
      !Array.isArray(data.plugins) ||
      !data.scope ||
      typeof data.features !== 'object' ||
      typeof data.features?.teams !== 'boolean' ||
      typeof data.features?.ambient !== 'boolean' ||
      typeof data.features?.memory !== 'boolean' ||
      !data.installedAt ||
      !data.updatedAt
    ) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}
```

### MEDIUM

**`compareSemver` is not exported but follows a different error pattern than peers** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts:64`
**Confidence**: 82%
- Problem: `compareSemver` returns `number | null` to signal parse failure. Other utility functions in this codebase that handle failure conditions (e.g., `getGitRoot` returns `Promise<string | null>`, `readManifest` returns `Promise<ManifestData | null>`) consistently use `null` for "not available". However, `compareSemver` is the only function that returns a union of a numeric value and null where null means "bad input" rather than "absent". The consumer `detectUpgrade` handles this correctly, but the pattern is unusual for this codebase. This is minor since the function is private.
- Fix: Consider documenting the return contract with a JSDoc `@returns` tag, or rename to make the nullable nature clear (e.g., `tryCompareSemver`). No blocking action needed.

**Deleted plugin-local agent copies without updating `devflow-specify` plugin.json** - `/Users/dean/Sandbox/devflow/plugins/devflow-specify/agents/skimmer.md` and `synthesizer.md` (deleted)
**Confidence**: 85%
- Problem: Two agent files were removed from `plugins/devflow-specify/agents/`. According to the build system, shared agents in `shared/agents/` are the single source of truth and plugin-local copies are gitignored build artifacts. The commit message `chore: untrack gitignored build artifacts in devflow-specify` confirms these were tracked copies that should have been gitignored. This is consistent with the architecture. However, the `devflow-specify` entry in `plugins.ts:33` still declares `agents: ['skimmer', 'synthesizer']`, and `shared/agents/skimmer.md` and `shared/agents/synthesizer.md` exist in the shared directory. The deletion is consistent with the intended architecture -- this is cleanup, not a feature regression. Noting for completeness.
- Fix: No action needed. The deletion correctly aligns tracked files with the gitignore policy. The shared agents remain as the single source of truth.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`list.ts` action changed from sync to async without error boundary** - `/Users/dean/Sandbox/devflow/src/cli/commands/list.ts:12`
**Confidence**: 80%
- Problem: The `list` command action was changed from a synchronous function to `async` to support manifest reads. The existing `init.ts` command wraps its async operations in try/catch blocks with `process.exit(1)` on failure. The new `list.ts` async action has no top-level error handling -- if `readManifest` or `getGitRoot` throw an unexpected error, the promise rejection will bubble up as an unhandled rejection. While both `readManifest` and `getGitRoot` internally catch errors and return null, the pattern is inconsistent with `init.ts` which wraps all I/O in try/catch.
- Fix: Either wrap the async body in try/catch (matching `init.ts` pattern) or document that the called functions are guaranteed to never throw. The risk is low since both functions catch internally.

**Confidence threshold documented in three separate locations with slight wording variations** - Multiple files
**Confidence**: 83%
- Problem: The 80% confidence threshold is documented in:
  1. `/Users/dean/Sandbox/devflow/shared/agents/reviewer.md:66` -- "Only report findings with >=80% confidence in Blocking, Should-Fix, and Pre-existing sections"
  2. `/Users/dean/Sandbox/devflow/shared/agents/synthesizer.md:134` -- "Maintain >=80% confidence threshold in final output"
  3. `/Users/dean/Sandbox/devflow/plugins/devflow-code-review/commands/code-review.md:98` -- "Create inline PR comments for findings with >=80% confidence only"

  While all three are semantically consistent, the phrasing differs. If the threshold changes in the future, three locations need updating. The existing codebase pattern for shared constants is to define them once (e.g., `LEGACY_SKILL_NAMES` in `plugins.ts`) and reference from consumers.
- Fix: This is acceptable for markdown agent instructions where the threshold is behavioral guidance rather than a programmatic constant. No code change needed, but consider adding a comment in the reviewer agent noting "Keep in sync with synthesizer.md and code-review.md" if the threshold is likely to change.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`init.ts` uses `p` as both import alias and callback parameter** - `/Users/dean/Sandbox/devflow/src/cli/commands/init.ts:6,45,50-51,335-338`
**Confidence**: 80%
- Problem: The file imports `@clack/prompts` as `* as p` (line 6) and also uses `p` as a lambda parameter name in several `.map` and `.filter` callbacks (e.g., line 335: `DEVFLOW_PLUGINS.filter(p => ...)`, line 45: `input.split(',').map(p => ...)`). This shadows the `p` import within those callbacks. While this does not cause bugs (the callbacks don't reference `@clack/prompts`), it is a naming inconsistency. Other files in the codebase (e.g., `plugins.test.ts`) use `plugin` as the callback parameter name.
- Fix: Rename callback parameters from `p` to `plugin` or `pl` (some already use `pl` at line 166). Address in a separate cleanup PR.

### LOW

**Inconsistent import ordering style between new and existing utility files** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts:1-2` vs `/Users/dean/Sandbox/devflow/src/cli/commands/list.ts:1-8`
**Confidence**: 65%
- Problem: `manifest.ts` uses `import { promises as fs } from 'fs'` then `import * as path from 'path'` (node built-ins first). `list.ts` imports third-party packages first (`commander`, `@clack/prompts`, `picocolors`), then local modules, then `* as path from 'path'` last. The existing codebase files like `init.ts` follow: external packages first, then local imports, then node built-ins mixed in. There is no enforced import order (no eslint rule detected). This is minor and subjective.
- Fix: Not actionable without an eslint import-order rule. Skip.

## Suggestions (Lower Confidence)

- **Consider adding `ManifestData` Zod schema** - `/Users/dean/Sandbox/devflow/src/cli/utils/manifest.ts` (Confidence: 70%) -- The project CLAUDE.md mandates "Validate at boundaries - Parse, don't validate (Zod schemas)". The manifest file is a trust boundary (user-writable JSON). A Zod schema would replace the manual field checks and align with the stated engineering principles. However, no other utility file in this codebase currently uses Zod for internal file parsing, so this would be a new pattern introduction.

- **`list.ts` date formatting is locale-dependent** - `/Users/dean/Sandbox/devflow/src/cli/commands/list.ts:26-27` (Confidence: 65%) -- `new Date(manifest.installedAt).toLocaleDateString()` produces different output depending on the user's locale. Other date displays in the codebase (CHANGELOG, manifest `installedAt`/`updatedAt`) use ISO format. The inconsistency is minor and arguably intentional (CLI output vs stored data).

- **Reviewer agent language focus table expanded without corresponding conditional activation update** - `/Users/dean/Sandbox/devflow/shared/agents/reviewer.md:36-40` (Confidence: 62%) -- The reviewer agent's focus area table now includes go, java, python, rust entries. The code-review command at line 72-78 also lists these. The conditional activation table at lines 156-158 includes them too. All three are consistent with each other -- this is correct. Noting only that this triples the surface area for future language additions.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

**Consistency Score**: 8/10

The changes are well-aligned with existing codebase patterns overall. The new `manifest.ts` utility follows the established pattern of small, focused utility modules with exported pure functions and null-returning error handling. The skill file (`search-first/SKILL.md`) follows the established frontmatter format, includes the required Iron Law section, and falls within the target line count (133 lines, target 120-150). The reviewer/synthesizer agent updates introduce the confidence system consistently across all three touchpoints (reviewer, synthesizer, code-review command). The deleted plugin-local agent copies correctly align with the gitignore policy for build artifacts. The only notable consistency gap is the incomplete field validation in `readManifest` compared to the thorough validation patterns seen elsewhere in the utility layer.

**Recommendation**: APPROVED_WITH_CONDITIONS

Conditions:
1. Strengthen `readManifest` field validation to cover `features`, `installedAt`, and `updatedAt` (HIGH -- prevents silent data corruption if manifest is hand-edited or partially written).
