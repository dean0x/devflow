# Consistency Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-30

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent module decomposition approach across CLI commands** - `src/cli/commands/kb/`
**Confidence**: 82%
- Problem: The `kb` command is the only CLI command decomposed into a directory of submodule files (`kb/index.ts`, `kb/shared.ts`, `kb/create.ts`, etc.). Every other command in the codebase (`ambient.ts`, `learn.ts`, `memory.ts`, `flags.ts`, `hud.ts`, `init.ts`) is a single file, even `learn.ts` at 1303 lines. This creates an inconsistent convention for where to find command logic. The `kb.ts` compatibility shim adds indirection without a clear precedent.
- Fix: This is a judgment call. The decomposition itself is reasonable for readability, but it introduces a pattern that no other command follows. Either (a) document in CLAUDE.md that commands exceeding ~600 lines should be split into a directory module, establishing a precedent, or (b) accept the one-off inconsistency since the old `kb.ts` was 607 lines and learning from it. No blocking action required if the team accepts this as the new convention going forward.

### MEDIUM

**`execFileSync` vs `execFileAsync` pattern inconsistency** - `src/cli/utils/kb-agent.ts:8`
**Confidence**: 83%
- Problem: The new `kb-agent.ts` introduces `promisify(execFile)` to create `execFileAsync`. Every other `execFile` usage in the CLI codebase (`learn.ts`, `uninstall.ts`, etc.) uses `execFileSync`. While the async version is explicitly motivated (keeping the event loop free for clack spinner animation), this is the first and only place in the CLI that uses the async variant. Future contributors may be confused about which pattern to follow.
- Fix: The async approach is technically better for spinner UX and is well-documented in the JSDoc comment. Add a brief comment at the `execFileSync` usage in `loadKnowledgeContext` (which is in the same file in the working tree) explaining why that one stays sync (it returns a string directly, no spinner context). This provides local contrast documentation rather than leaving the choice implicit.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Feature-kb type annotations duplicated across shared.ts and test file** - `src/cli/commands/kb/shared.ts:19-28`, `tests/feature-kb/feature-kb.test.ts:29-39`
**Confidence**: 85%
- Problem: The `FeatureKbModule` interface in `shared.ts` and the `as { ... }` type cast in `feature-kb.test.ts` define the same function signatures independently. When `cachedIndex` was added to `checkAllStaleness` and `listKBs`, both locations had to be updated in lockstep. This violates DRY and risks them drifting apart.
- Fix: Export the `FeatureKbModule` interface from `shared.ts` and import it in the test file:
  ```typescript
  // tests/feature-kb/feature-kb.test.ts
  import type { FeatureKbModule } from '../../src/cli/commands/kb/shared.js';
  // ...
  const { loadIndex, ... } = require(...) as FeatureKbModule;
  ```

## Pre-existing Issues (Not Blocking)

No pre-existing consistency issues worth noting in the touched files.

## Suggestions (Lower Confidence)

- **Shell hook error message format could include path** - `scripts/hooks/session-start-memory:11` (Confidence: 65%) -- The error messages like `"session-start-memory: failed to source json-parse"` are good but don't include the resolved path of the script that failed. Including `$SCRIPT_DIR/json-parse` in the message would aid debugging in environments where multiple devflow installations coexist.

- **Comment trailing module.exports in feature-kb.cjs** - `scripts/hooks/lib/feature-kb.cjs:653-654` (Confidence: 62%) -- The trailing comment explaining `loadIndex` is already exported reads oddly since `loadIndex` was always in the exports line. The comment's purpose is to explain the cached-index pattern, but its phrasing ("Note: loadIndex is already exported above") implies it was added as a new export. A more direct comment like "Tip: pass loadIndex output to listKBs/checkAllStaleness via cachedIndex to avoid double reads" would match the intent better.

- **sidecar-ops.cjs adds string filtering not present in original** - `scripts/hooks/lib/sidecar-ops.cjs:26` (Confidence: 68%) -- The original `read-sidecar` case in `json-helper.cjs` did not filter array elements (it output the raw array). The new `sidecar-ops.cjs` adds `.filter(v => typeof v === 'string')`, tightening validation. This is arguably better behavior (consistent with the TypeScript `readSidecar`), but it is a silent behavioral change for shell callers of `json-helper read-sidecar`. If any shell script depends on non-string values in the array, this would break. Low risk given the sidecar format is well-defined, but worth noting.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR demonstrates strong internal consistency: the shell hook error-handling pattern is applied uniformly across all 8 hooks, the sidecar protocol is coherent between TypeScript and CJS layers, the `cachedIndex` parameter is threaded consistently through `listKBs` and `checkAllStaleness`, and the `shared.ts` module properly centralizes the cross-cutting concerns for the new directory structure. The main consistency concern is the one-off module decomposition pattern for `kb` that no other command follows. The type duplication between `shared.ts` and the test file should be addressed to avoid drift. Overall, the changes are well-structured and the new patterns (safe-path extraction, sidecar-ops domain routing, async agent spawning) are individually coherent.
