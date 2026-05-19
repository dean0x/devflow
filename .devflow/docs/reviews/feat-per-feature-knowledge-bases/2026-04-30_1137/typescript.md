# TypeScript Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-30T11:37

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Type assertion `as Record<string, unknown>` after `unknown` validation in sidecar.ts** - `src/cli/utils/sidecar.ts:20`
**Confidence**: 80%
- Problem: After checking `typeof raw !== 'object' || raw === null`, the code casts `raw as Record<string, unknown>`. This is a safe-enough pattern since the null and non-object cases are excluded, but it still bypasses structural narrowing. A narrowing helper or user-defined type guard would be more idiomatic TypeScript.
- Fix: This is an acceptable pattern given the defensive property-level checks that follow (lines 22-29 individually validate each field). Acceptable as-is, but for consistency with the Iron Law ("use `unknown` with type guards"), a tiny helper could narrow more explicitly:
```typescript
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Long single-line type definitions in shared.ts** - `src/cli/commands/kb/shared.ts:17` (Confidence: 65%) -- The `KbEntry` type alias is defined as a single line exceeding 140 characters. Multi-line formatting would improve readability. Same applies to line 16 (`KbIndex`) and the `FeatureKbModule` interface methods on lines 20-27.

- **`process.exit(1)` instead of Result-type error propagation** - `src/cli/commands/kb/create.ts:13,81` (Confidence: 70%) -- Several subcommand handlers call `process.exit(1)` on error. This matches the project's existing Commander.js CLI convention, but CLAUDE.md instructs "Always use Result types -- Never throw errors in business logic." Since these are CLI boundary handlers (not business logic), the pattern is acceptable, but a future refactor could return exit codes instead. Applies consistently across `create.ts`, `refresh.ts`, `remove.ts`, `shared.ts`.

- **`execFileSync` in `loadKnowledgeContext` blocks event loop** - `src/cli/utils/kb-agent.ts:25` (Confidence: 65%) -- The `loadKnowledgeContext` function uses synchronous `execFileSync` while the rest of `kb-agent.ts` is async (using `execFileAsync`). Since this is called before the async agent spawn and is bounded by a 10s timeout, blocking is acceptable here, but an async variant would be more consistent with the file's async-first style.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: APPROVED

### Positive Observations

- **Clean module decomposition**: The monolithic `kb.ts` (607 lines) was split into 7 focused modules (`index.ts`, `shared.ts`, `toggle.ts`, `list.ts`, `check.ts`, `create.ts`, `refresh.ts`, `remove.ts`) plus a new `utils/sidecar.ts` and `utils/kb-agent.ts`. Each module has a single responsibility.
- **Backward-compatible shim**: The old `commands/kb.ts` is preserved as a re-export shim (`export * from './kb/index.js'`) so existing importers (tests, init.ts) continue working without changes.
- **Proper `unknown` usage**: `readSidecar` in `sidecar.ts` correctly uses `unknown` with runtime type narrowing -- property checks for `Array.isArray`, `typeof === 'string'`, and the `is` type predicate in the filter. This follows the TypeScript Iron Law.
- **Well-typed CJS bridge**: The `FeatureKbModule` interface in `shared.ts` accurately types the CJS module's API surface, including the new `loadIndex` and optional `cachedIndex` parameters. The `KbIndex` union with `null` correctly models the CJS module's return type.
- **Performance optimization**: Loading the index once via `featureKb.loadIndex()` and passing it to both `listKBs` and `checkAllStaleness` eliminates redundant file reads -- a clean use of the optional `cachedIndex` parameter.
- **Async agent spawning**: Switching from `execFileSync` to `promisify(execFile)` in `runKbAgent` keeps the event loop free for clack spinner animation -- a correct architectural choice.
- **No `any` types**: Zero instances of `any` across all new files. All dynamic data flows through `unknown` with runtime guards.
- **Type-only imports**: `import type { SidecarData }` in `index.ts` line 16 correctly uses type-only re-export.
- **Strict mode passes**: `tsc --noEmit` produces zero errors with `"strict": true` in tsconfig.json.

### Knowledge Context

Scanned PF-001 (Promise resolver param shadowing). Read the full body in `.memory/knowledge/pitfalls.md`. This pitfall concerns `resolve` param naming in Promise callbacks within `tests/integration/helpers.ts`. No Promise resolver params appear in any of the changed TypeScript files in this PR, so PF-001 does not apply.
