# Complexity Review Report

**Branch**: feat-phase-3-decouple-decisions-agent -> main
**Date**: 2026-05-06

## Issues in Your Changes (BLOCKING)

### HIGH

**Monolithic action handler in decisions.ts (580 lines)** - `src/cli/commands/decisions.ts:147-726`
**Confidence**: 92%
- Problem: The `.action(async (options) => { ... })` callback is a single 580-line function containing all 12 subcommand branches (`--run-background`, `--status`, `--list`, `--configure`, `--purge`, `--reset`, `--clear`, `--review`, `--dismiss-capacity`, `--enable`, `--disable`, plus the no-flag help path). This far exceeds the 50-line function length threshold (CRITICAL per the complexity skill's metrics) and makes the file difficult to navigate, test in isolation, and modify safely.
- Impact: Any change to one subcommand risks unintended interaction with others. Local variables like `settingsContent`, `memoryDir`, and `logPath` are declared mid-function and scoped to later branches, creating implicit ordering dependencies. The `learn.ts` command it mirrors has the same issue at 896 lines, but duplicating the anti-pattern into a new file is the point of intervention.
- Fix: Extract each `--flag` branch into a named async function. The pattern is straightforward since each branch ends with `return`:
```typescript
async function handleRunBackground(options: DecisionsOptions): Promise<void> { ... }
async function handleStatus(settingsContent: string, logPath: string, memoryDir: string): Promise<void> { ... }
async function handleList(logPath: string): Promise<void> { ... }
// ... etc

.action(async (options: DecisionsOptions) => {
  if (options.runBackground) return handleRunBackground(options);
  // shared setup
  const settingsContent = ...;
  const logPath = ...;
  if (options.status) return handleStatus(settingsContent, logPath, memoryDir);
  if (options.list) return handleList(logPath);
  // ...
});
```

**Nesting depth 7 in --review block** - `src/cli/commands/decisions.ts:544-638`
**Confidence**: 85%
- Problem: The `--review` branch reaches 7 levels of indentation (action handler -> if options.review -> try -> for loop -> if action === deprecate -> object literal -> property). This exceeds the CRITICAL threshold of >4 nesting depth. The nested `for (const obs of flagged)` loop contains interactive prompts, mutation logic, and write-back operations all interleaved.
- Impact: Difficult to reason about control flow, especially around the partial-save behavior on cancel (line 598-600). The mixed responsibilities (UI display, observation mutation, file I/O) at deep nesting levels make this section fragile.
- Fix: Extract the inner loop body into a helper:
```typescript
async function reviewSingleObservation(
  obs: LearningObservation,
  updatedObservations: LearningObservation[],
  logPath: string,
): Promise<'cancel' | 'continue'> {
  // display, prompt, mutate, write — each at lower nesting
}
```

**Long boolean expression on line 148 (231 characters)** - `src/cli/commands/decisions.ts:148`
**Confidence**: 82%
- Problem: `const hasFlag = options.enable || options.disable || options.status || options.list || options.configure || options.clear || options.reset || options.purge || options.review || options.dismissCapacity || options.runBackground;` is a 231-character single-line boolean expression with 11 disjuncts. Adding a new subcommand requires editing this line, risking typos.
- Impact: Hard to scan visually; a missing option silently falls through to the help text path. The expression duplicates the option names rather than deriving from a single source.
- Fix: Derive from the options object:
```typescript
const knownFlags = ['enable', 'disable', 'status', 'list', 'configure',
  'clear', 'reset', 'purge', 'review', 'dismissCapacity', 'runBackground'] as const;
const hasFlag = knownFlags.some(f => options[f]);
```

### MEDIUM

**extractBatchMessages spawns a node subprocess per session** - `src/cli/utils/background-runner.ts:249-273`
**Confidence**: 80%
- Problem: The function iterates session IDs and spawns a separate `node -e` subprocess for each one to call `extractChannels`. While the batch size is currently small (1 for decisions, 3-5 for learning), this is an indirect and heavyweight invocation pattern. Each iteration constructs a JavaScript string literal, shells out to `node`, parses stdout JSON, and catches errors individually.
- Impact: The subprocess-per-session approach is harder to reason about than a direct `require()` call, and the inline `script` string (lines 256-262) containing `JSON.stringify`-interpolated paths is a complexity smell even though it is safe here.
- Fix: Load the module directly in-process where possible:
```typescript
const { extractChannels } = require(filterModule);
const content = fs.readFileSync(transcriptPath, 'utf8');
const result = extractChannels(content);
```
If CJS/ESM boundary prevents direct require, consider a single subprocess that processes all session IDs in one invocation.

## Issues in Code You Touched (Should Fix)

No issues identified.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**learn.ts action handler is 896 lines** - `src/cli/commands/learn.ts` (pre-existing)
**Confidence**: 95%
- Problem: The same monolithic action handler pattern exists in the sibling `learn.ts` at an even larger scale. The decisions.ts file was modeled after this structure, propagating the pattern.
- Impact: Informational only. The ideal approach would be to refactor learn.ts first, then model decisions.ts after the improved structure.

## Suggestions (Lower Confidence)

- **split-migration.cjs adds migration code for a system split** - `scripts/hooks/lib/split-migration.cjs` (Confidence: 65%) -- The split-migration.cjs introduces a 200-line one-time migration that partitions learning-log.jsonl into two files. Given the project's clean-break philosophy (applies ADR-001, avoids PF-001), it is worth confirming that a migration (rather than starting fresh) was the intended approach for existing observation data. The migration itself is well-structured with idempotency guards and atomic writes; this is a philosophical question, not a code quality issue.

- **Duplicated observation type filtering across decisions.ts subcommands** - `src/cli/commands/decisions.ts` (Confidence: 70%) -- Multiple subcommands (--status at line 259, --list at line 311, --purge at line 448, --review at line 549) independently filter `o.type === 'decision' || o.type === 'pitfall'`. A shared predicate (`isDecisionsType(o)`) would reduce duplication and prevent divergence.

- **Prompt string literals embedded in agent runners** - `src/cli/utils/decisions-agent.ts:159-214`, `src/cli/utils/learning-agent.ts:104-165` (Confidence: 62%) -- The multi-paragraph prompt templates are embedded as template literals inside the function bodies. While this keeps them co-located with usage, the 55+ line string literals make the functions appear more complex than their logic warrants. Extracting to constants or separate files would improve scanability.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 3 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Complexity Score**: 6/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR executes a well-planned decomposition of a monolithic bash script into focused TypeScript utilities. The shared `background-runner.ts` (15 functions, none exceeding 52 lines) and the two agent runners (`learning-agent.ts` at 194 lines, `decisions-agent.ts` at 318 lines) demonstrate good function-level decomposition. The `decisions-config.ts` at 115 lines is clean and minimal. The split-migration and session-end hook are straightforward.

The primary complexity concern is the `decisions.ts` command file where a 580-line monolithic action handler contains all subcommand logic inline. This mirrors the pre-existing pattern in `learn.ts` but represents an opportunity to establish a better structural precedent. Extracting each subcommand into a named function would bring every function under the 50-line threshold and reduce maximum nesting from 7 to 3-4 levels. This is a should-fix-before-merge item, not a blocker, given that it matches the established codebase pattern.
