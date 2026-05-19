# Architecture Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-30

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Sidecar-ops module handles only one command but uses generic router pattern** - `scripts/hooks/lib/sidecar-ops.cjs:14`
**Confidence**: 82%
- Problem: `sidecar-ops.cjs` extracts the `read-sidecar` case from `json-helper.cjs` into its own module, but the router pattern (`handle(command, args) => boolean`) implies this module will accumulate more operations over time. Currently it handles exactly one command, making the abstraction premature. More importantly, the behavioral change in line 26-29 silently altered the output contract: the old `read-sidecar` always returned `[]` for non-array values, but the new version returns the raw string for string values. The `background-kb-refresh` hook (line 179) reads `description` via `read-sidecar` and now gets the raw string instead of `[]`, which is the correct new behavior -- but this is a contract change in a moved function that could confuse callers expecting the old behavior.
- Fix: The contract change (strings returned as-is) is architecturally correct for the description field use case. Document this behavioral difference in the JSDoc to prevent regressions:
```javascript
/**
 * Handle sidecar-related operations.
 * 
 * read-sidecar <file> <field>:
 *   - Array fields: returns JSON-stringified array (string elements only)
 *   - String fields: returns the raw string value
 *   - Other/missing: returns '[]'
 */
```

### MEDIUM

**Compatibility shim creates a hidden re-export chain** - `src/cli/commands/kb.ts:1-6`
**Confidence**: 85%
- Problem: The old `kb.ts` is now a `@deprecated` re-export shim (`export * from './kb/index.js'`), and `kb/index.ts` in turn re-exports from `./toggle.js` and `../../utils/sidecar.js`. This creates a 3-layer re-export chain: `kb.ts -> kb/index.ts -> toggle.ts / sidecar.ts`. Callers importing from `commands/kb.js` now silently traverse two module boundaries. While functionally correct, this violates the Deep Modules principle (Ousterhout) -- the shim adds a module that hides nothing and exists only to preserve old import paths.
- Fix: Search for callers still importing from `commands/kb.js` (tests, init.ts) and update them to import from `commands/kb/index.js` directly. Then remove the shim entirely. If this requires a follow-up PR, add a TODO with a deadline.

**`FeatureKbModule` interface duplicated between TypeScript and CJS module boundary** - `src/cli/commands/kb/shared.ts:19-28`
**Confidence**: 80%
- Problem: The `FeatureKbModule` interface in `shared.ts` manually mirrors the exports of `feature-kb.cjs`. This is a fragile boundary: if a function signature changes in the CJS module (e.g., adding a parameter, changing a return type), the TypeScript interface silently lies. The old monolith had the same issue, but the decomposition makes it more visible -- `shared.ts` is the canonical type definition consumed by 6 subcommand modules, amplifying the blast radius of a mismatch. There is no compile-time or test-time check that the interface matches the CJS module.
- Fix: Add a lightweight boundary test (similar to the existing `apply-feature-kb-skill.test.ts` pattern) that asserts each method exists with the expected arity:
```typescript
it('FeatureKbModule interface matches CJS exports', () => {
  const mod = require('scripts/hooks/lib/feature-kb.cjs');
  expect(typeof mod.loadIndex).toBe('function');
  expect(typeof mod.listKBs).toBe('function');
  expect(mod.listKBs.length).toBe(1); // or 2 with optional param
  // ... etc
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`cachedIndex` parameter uses `undefined` sentinel instead of explicit `null`** - `scripts/hooks/lib/feature-kb.cjs:204-206`
**Confidence**: 83%
- Problem: `checkAllStaleness(worktreePath, cachedIndex)` uses `cachedIndex !== undefined` to distinguish "not provided" from "provided but null." This works but creates an asymmetric API: `loadIndex()` can return `null` (no index file), but passing that `null` into `checkAllStaleness` means "use this null value" rather than "load it yourself." The TS type `KbIndex = { ... } | null` allows `null`, meaning `checkAllStaleness(path, null)` will skip the `loadIndex` call and proceed with a null index, which is then checked by `if (!index) return {}` -- correct but confusing. The same pattern applies to `listKBs`.
- Fix: This is minor and the current behavior is safe. Consider using an explicit overload or a named options object to make intent clearer in a future refactor. No immediate action needed.

**`process.exit(1)` scattered across subcommand handlers** - `src/cli/commands/kb/create.ts:78`, `src/cli/commands/kb/remove.ts:24`, `src/cli/commands/kb/shared.ts:43`
**Confidence**: 81%
- Problem: Multiple subcommand handlers call `process.exit(1)` directly for error conditions. This is a mild DIP violation -- the handler knows about process lifecycle instead of letting the caller (Commander) handle exit codes. More practically, it makes these handlers untestable without process mocking. The old monolith had the same issue, so this is not a regression, but the decomposition was an opportunity to fix it.
- Fix: Return a status code or throw a typed error from handlers, letting the Commander action wrapper call `process.exit`. Not blocking for this PR since it's inherited behavior.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`json-helper.cjs` is a god module with 1800+ lines** - `scripts/hooks/json-helper.cjs`
**Confidence**: 90%
- Problem: The giant `switch` statement in `json-helper.cjs` handles dozens of unrelated operations. This PR correctly begins extracting domain-specific operations (sidecar-ops) but only moved one case. The remaining switch still handles learning, memory, knowledge, and transcript operations -- each is a separate bounded context forced into a single module.
- Fix: Continue the extraction pattern established by `sidecar-ops.cjs` for other domains (learning-ops, memory-ops, etc.) in follow-up PRs. The routing pattern (`if (module.handle(op, args)) { process.exit(0); }`) is clean and composable.

## Suggestions (Lower Confidence)

- **`execFileSync` vs `execFileAsync` inconsistency in KB operations** - `scripts/hooks/lib/feature-kb.cjs:248` (Confidence: 68%) -- `checkAllStaleness` uses synchronous `execFileSync` for git calls, while `kb-agent.ts` uses `execFileAsync` for claude spawning. The feature-kb module is used both in CLI commands (async context) and in shell hook scripts (sync context), so the sync choice is defensible. Consider documenting this design decision.

- **`loadKnowledgeContext` function added to `kb-agent.ts` but not used by any kb subcommand** - `src/cli/utils/kb-agent.ts:17-32` (Confidence: 72%) -- This function loads the KNOWLEDGE_CONTEXT index but none of the kb subcommands (`create.ts`, `refresh.ts`) pass it to the agent prompt. The `background-kb-refresh` shell hook does load it (line 100-105). This may be intentional pre-positioning for a future change or an unused extraction.

- **No integration test for the `sidecarOps.handle` routing in `json-helper.cjs`** - `scripts/hooks/json-helper.cjs:633` (Confidence: 65%) -- The new routing logic (`if (sidecarOps.handle(op, args)) { process.exit(0); }`) runs before the main switch but has no dedicated test verifying that `read-sidecar` is correctly routed to the new module rather than falling through to the (now-removed) switch case.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The decomposition from a 600-line monolithic `kb.ts` into 7 focused modules (`index.ts`, `shared.ts`, `toggle.ts`, `create.ts`, `refresh.ts`, `remove.ts`, `check.ts`) is a strong SRP improvement. Each module has one reason to change and the shared utilities (`shared.ts`, `sidecar.ts`, `kb-agent.ts`) correctly centralize cross-cutting concerns. The `sidecar-ops.cjs` extraction from `json-helper.cjs` follows the same decomposition principle at the CJS layer. The `cachedIndex` optimization in `checkAllStaleness` and `listKBs` eliminates the N+1 index reads found in the old code. The sidecar communication pattern between agents and host processes (write JSON file, read on return) is a clean inter-process contract. Conditions: address the sidecar-ops behavioral change documentation (HIGH) and plan for shim removal (MEDIUM).
