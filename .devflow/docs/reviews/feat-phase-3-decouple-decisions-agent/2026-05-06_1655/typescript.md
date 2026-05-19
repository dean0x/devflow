# TypeScript Review Report

**Branch**: feat-phase-3-decouple-decisions-agent -> main
**Date**: 2026-05-06

## Issues in Your Changes (BLOCKING)

### HIGH

**Unused `debug` field in agent option interfaces** - `src/cli/utils/decisions-agent.ts:80`, `src/cli/utils/learning-agent.ts:34`
**Confidence**: 90%
- Problem: Both `DecisionsAgentOpts.debug` and `LearningAgentOpts.debug` declare a `debug: boolean` field and callers pass it (`decisions.ts:209`, `learn.ts:566`), but neither `runDecisionsAgent` nor `runLearningAgent` ever destructures or reads the field. The `debug` property is accepted, validated, and silently discarded -- a silent contract violation. If the caller expects debug logging (as the config wizard promises at `decisions.ts:386`), nothing happens.
- Fix: Either destructure `debug` from opts and use it (e.g., conditionally log the prompt, write a debug file to `~/.devflow/logs/`), or remove the field from the interface and the callers until the feature is implemented. Leaving a dead interface field is misleading.

**Incorrect notification text directs decisions users to wrong command** - `src/cli/hud/notifications.ts:88`
**Confidence**: 95%
- Problem: The notification text reads `run devflow learn --review` regardless of whether the notification originates from the decisions pipeline (`.decisions-notifications.json`) or the learning pipeline (`.notifications.json`). When the entry key contains `decisions-capacity-`, the message should direct users to `devflow decisions --review`, not `devflow learn --review`.
- Fix:
```typescript
const command = worst.key.startsWith('decisions-capacity-')
  ? 'devflow decisions --review'
  : 'devflow learn --review';
return {
  id: worst.key,
  severity: isSeverity(worst.entry.severity) ? worst.entry.severity : 'dim',
  text: `⚠ Decisions: ${fileType} at ${count}/${ceiling} — run ${command}`,
  count,
  ceiling,
};
```

**Unvalidated type assertion on structured output observations** - `src/cli/utils/decisions-agent.ts:273`
**Confidence**: 85%
- Problem: `_extractStructuredOutput` verifies that `inner.observations` is an array but then casts the entire inner object as `{ observations: RawObservation[] }` without validating that individual array elements conform to the `RawObservation` interface. Since the observations come from an LLM (Claude), any element could have missing `id`, `type`, `pattern`, `evidence`, or `quality_ok` fields. The downstream `_normalizeObservations` then accesses `obs.id`, `obs.type`, etc. on potentially undefined fields, producing silent garbage (empty strings, `undefined` serialized as `"undefined"` in JSON).
- Fix: Add a runtime type guard for `RawObservation` items, similar to the existing `isLearningObservation` guard in `learn.ts`, and filter the array through it:
```typescript
function isRawObservation(v: unknown): v is RawObservation {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string'
    && (o.type === 'decision' || o.type === 'pitfall')
    && typeof o.pattern === 'string'
    && Array.isArray(o.evidence)
    && typeof o.quality_ok === 'boolean';
}

// In _extractStructuredOutput:
const raw = (inner as { observations: unknown[] }).observations;
return raw.filter(isRawObservation);
```

### MEDIUM

**`async` function uses only synchronous `readFileSync`** - `src/cli/utils/background-runner.ts:388`
**Confidence**: 85%
- Problem: `_loadObservationsFromLog` is declared `async` and returns `Promise<string>`, but its implementation uses `fs.readFileSync` (synchronous) and no `await` expressions. The `async` keyword is unnecessary -- it wraps the return value in a promise for no reason and misleadingly signals to readers that the function performs async I/O.
- Fix: Remove `async` and return the string directly (it will be auto-wrapped by the `async` caller `loadExistingObservations`), or switch to `fs.promises.readFile` if async behavior is intended.

**Redundant final `writeObservations` after review loop** - `src/cli/commands/decisions.ts:629`
**Confidence**: 82%
- Problem: Inside the `--review` loop, `writeObservations` is called after each `deprecate` or `keep` action (lines 614, 623). Then line 629 calls `writeObservations` again unconditionally after the loop exits. This is functionally correct (idempotent write) but is a wasted I/O call when the last iteration already wrote, and also writes when all items were skipped (unchanged data). The `learn.ts` equivalent has the same pattern -- this was copy-pasted.
- Fix: Remove the per-iteration writes and keep only the final write at line 629, or remove line 629 since each action already writes. The per-iteration pattern is safer for crash recovery, so keep those and remove the final one:
```typescript
// Remove this line (629):
await writeObservations(logPath, updatedObservations);
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`model as string` redundant type assertion** - `src/cli/commands/decisions.ts:409`
**Confidence**: 88%
- Problem: `model` is the return value of `p.select()` with `value: 'sonnet' | 'haiku' | 'opus'` string literals. The `as string` cast is redundant -- `@clack/prompts` already returns the value type (`string`). While harmless, unnecessary type assertions are an anti-pattern per the TypeScript skill checklist (prefer type guards over `as` casts).
- Fix: Remove the cast; `model` is already `string`.

**Missing `noUncheckedIndexedAccess` in tsconfig** - `tsconfig.json`
**Confidence**: 80%
- Problem: The TypeScript skill checklist recommends `noUncheckedIndexedAccess: true` for strict configs. The project uses `"strict": true` but does not enable `noUncheckedIndexedAccess`. Multiple files in this PR access array/record indices without null checks (e.g., `background-runner.ts:146` `content.split('\t')` destructured without checking length, `decisions-agent.ts:273` accessing object properties after an `as` cast). Enabling this flag would surface these at compile time.
- Fix: Add `"noUncheckedIndexedAccess": true` to `tsconfig.json` `compilerOptions`. This is a broader project improvement, not blocking for this PR, but worth noting.

## Pre-existing Issues (Not Blocking)

No critical pre-existing issues found in unchanged code.

## Suggestions (Lower Confidence)

- **`capEntries` destructured date/count without length check** - `src/cli/utils/background-runner.ts:145-146` (Confidence: 70%) -- `content.split('\t')` is destructured into `[date, countStr]` without verifying the split produced two elements. If the file contains a single value without a tab, `countStr` would be `undefined` and `parseInt(undefined, 10)` returns `NaN`, which the `isNaN` check catches. Not a bug but fragile.

- **`LearningObservation` type shared across decisions and learning boundaries** - `src/cli/commands/decisions.ts:22-28` (Confidence: 65%) -- `decisions.ts` imports `LearningObservation`, `readObservations`, `writeObservations`, and `isLearningObservation` from `learn.ts`. This creates a coupling where the decisions command depends on the learning command module for its core data types. A shared types module (e.g., `utils/observation-types.ts`) would be a cleaner boundary.

- **`_buildDecisionsPrompt` uses variable name `p` shadowing the `@clack/prompts` import** - `src/cli/utils/decisions-agent.ts:156` (Confidence: 60%) -- The `.map(p => ...)` lambda shadows the `p` from `@clack/prompts` imported in the calling module. Not a direct issue in this file (no `p` import here), but if this function were ever moved or inlined, it would shadow.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**TypeScript Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The new code follows strong TypeScript patterns overall -- no `any` types, proper `unknown` usage for parsed JSON, discriminated union types for observation statuses, exhaustive switches in `learning-counts.ts`, and well-typed interfaces. The main concerns are: (1) the unvalidated type assertion on LLM output that could produce garbage observations, (2) the dead `debug` interface field creating a false contract, and (3) the wrong CLI command in notification text that would confuse users. Applies ADR-001 -- the split-migration is a functional necessity for the decoupled pipeline architecture, not backward-compat cruft. Avoids PF-001 -- no unnecessary compat layers were added.
