# TypeScript Review Report

**Branch**: feat/self-learning -> main
**Date**: 2026-03-23
**PR**: #160

## Issues in Your Changes (BLOCKING)

### HIGH

**Unsafe `as` cast on unvalidated JSON in `parseLearningLog`** - `src/cli/commands/learn.ts:153`
**Confidence**: 85%
- Problem: `JSON.parse(trimmed) as LearningObservation` performs an unsafe type assertion. The subsequent check (`parsed.id && parsed.type && parsed.pattern`) only validates 3 of 10 required fields. A JSONL line with `{"id":"x","type":"workflow","pattern":"y"}` would pass validation but be accepted as a full `LearningObservation` with all other fields (`confidence`, `observations`, `first_seen`, `last_seen`, `status`, `evidence`, `details`) as `undefined` at runtime despite the type saying they are required. This violates the TypeScript skill iron law: "If you need to handle arbitrary data, use `unknown` and validate."
- Fix: Parse as `unknown`, then validate all required fields or use a Zod schema (per CLAUDE.md principle #9: "Validate at boundaries"):
```typescript
const parsed: unknown = JSON.parse(trimmed);
if (
  typeof parsed === 'object' && parsed !== null &&
  'id' in parsed && typeof (parsed as Record<string, unknown>).id === 'string' &&
  'type' in parsed && (parsed as Record<string, unknown>).type in {'workflow':1,'procedural':1} &&
  'pattern' in parsed && typeof (parsed as Record<string, unknown>).pattern === 'string' &&
  'confidence' in parsed && typeof (parsed as Record<string, unknown>).confidence === 'number' &&
  'status' in parsed && typeof (parsed as Record<string, unknown>).status === 'string'
) {
  observations.push(parsed as LearningObservation);
}
```
Or define a `isLearningObservation(value: unknown): value is LearningObservation` type guard.

**Untyped `options` parameter in command action handler** - `src/cli/commands/learn.ts:231`
**Confidence**: 82%
- Problem: The `.action(async (options) => { ... })` callback receives `options` as an implicitly typed parameter. Commander infers it as `Record<string, any>` internally, so `options.enable`, `options.disable`, etc. are all `any`. This means typos like `options.enabl` would silently be `undefined` instead of causing a compile error. The `init.ts` command in this same PR defines an explicit `InitOptions` interface and passes it via `.action(async (options: InitOptions) => ...)`.
- Fix: Define a `LearnOptions` interface and type the action parameter:
```typescript
interface LearnOptions {
  enable?: boolean;
  disable?: boolean;
  status?: boolean;
  list?: boolean;
  configure?: boolean;
  clear?: boolean;
}

// ...
.action(async (options: LearnOptions) => {
```

### MEDIUM

**Manifest `learn` feature field is optional (`learn?: boolean`) creating asymmetry** - `src/cli/utils/manifest.ts:15`
**Confidence**: 85%
- Problem: The `learn` field in `ManifestData.features` is declared as `learn?: boolean` while `teams`, `ambient`, and `memory` are required `boolean`. Yet in `init.ts:195` and `init.ts:855`, the code always writes `learn: false` or `learn: learnEnabled` -- it is never omitted. Making it optional means consumers must handle `undefined`, but the intent is clearly that it should always be present after this PR lands. Additionally, `readManifest()` (line 30-41) validates `teams`, `ambient`, and `memory` as required booleans but does NOT validate `learn`, so a manifest with `learn: "garbage"` would pass validation.
- Fix: Make it required like the others and add validation:
```typescript
// In ManifestData.features:
learn: boolean;

// In readManifest() validation:
typeof data.features.learn !== 'boolean' ||
```
Note: For backward compatibility with existing manifests that lack `learn`, you can default it in the reader: `data.features.learn = data.features.learn ?? false;`

**Mutable `applyConfigLayer` violates immutability principle** - `src/cli/commands/learn.ts:195-203`
**Confidence**: 80%
- Problem: `applyConfigLayer` mutates its `config` parameter in-place. Per CLAUDE.md principle #4 ("Immutable by default -- No mutations, return new objects"), this should return a new object. The function also uses `as Record<string, unknown>` which is fine for runtime validation but the mutation is inconsistent with project conventions.
- Fix: Return a new config:
```typescript
function applyConfigLayer(config: LearningConfig, json: string): LearningConfig {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    return {
      max_daily_runs: typeof raw.max_daily_runs === 'number' ? raw.max_daily_runs : config.max_daily_runs,
      throttle_minutes: typeof raw.throttle_minutes === 'number' ? raw.throttle_minutes : config.throttle_minutes,
      model: typeof raw.model === 'string' ? raw.model : config.model,
    };
  } catch {
    return config;
  }
}
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Duplicated `HookEntry`, `HookMatcher`, `Settings` interfaces across 4 files** - `src/cli/commands/learn.ts:11-24`, `memory.ts:12-25`, `ambient.ts:11-24`, `hud.ts:18-25`
**Confidence**: 85%
- Problem: The same three interfaces (`HookEntry`, `HookMatcher`, `Settings`) are copy-pasted identically across `learn.ts`, `memory.ts`, `ambient.ts`, and `hud.ts`. This is a DRY violation that compounds with each new hook command -- this PR adds the 4th copy. If the Claude Code settings schema changes (e.g., adding a `timeout_seconds` field or changing `hooks` structure), all four files need synchronized updates.
- Fix: Extract to a shared module:
```typescript
// src/cli/utils/settings-types.ts
export interface HookEntry { type: string; command: string; timeout?: number; }
export interface HookMatcher { hooks: HookEntry[]; }
export interface Settings { hooks?: Record<string, HookMatcher[]>; [key: string]: unknown; }
```
Then import in all four command files. This is a broader refactor that could be a follow-up PR.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`process.env.HOME || '~'` fallback is incorrect on some systems** - `src/cli/commands/learn.ts:382`
**Confidence**: 82%
- Problem: The fallback `'~'` is not expanded by `path.join` -- it would produce a literal directory named `~` in the current working directory. This pattern also exists in `ambient.ts:157,160` (pre-existing). The `getDevFlowDirectory()` utility in `utils/paths.ts` handles this correctly via `os.homedir()`.
- Fix: Use `os.homedir()` or `getDevFlowDirectory()` instead of inline `process.env.HOME || '~'`:
```typescript
import { homedir } from 'os';
const globalDir = path.join(homedir(), '.devflow');
```

## Suggestions (Lower Confidence)

- **`observations.sort()` mutates array in `--list` handler** - `src/cli/commands/learn.ts:297` (Confidence: 65%) -- The `sort()` call mutates `observations` in place. While functionally harmless here since the array is not used after display, using `[...observations].sort(...)` would be more consistent with the project's immutability principle.

- **`LearningConfig.model` could be a string literal union** - `src/cli/commands/learn.ts:49` (Confidence: 70%) -- The `model` field is typed as `string` but the `--configure` wizard only offers `'sonnet' | 'haiku' | 'opus'`. A union type would provide better compile-time safety: `model: 'sonnet' | 'haiku' | 'opus'`.

- **Multiple redundant `JSON.parse` calls in `addLearningHook`** - `src/cli/commands/learn.ts:59,61` (Confidence: 65%) -- `addLearningHook` parses `settingsJson` on line 59, then calls `hasLearningHook(settingsJson)` which parses it again on line 126. Could accept a pre-parsed `Settings` object or restructure to avoid double parsing.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**TypeScript Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The new code is clean, well-structured, and follows existing patterns in the codebase. No `any` types are used, strict mode is enabled, and the test coverage is solid (289 lines of tests for 463 lines of source). The primary concerns are: (1) the unsafe `as` cast on unvalidated JSONL input, which should use a proper type guard, and (2) the untyped `options` parameter which loses compile-time safety. The optional `learn` field in the manifest creates an inconsistency with sibling feature flags that should be addressed before merge.
