# TypeScript Review Report

**Branch**: feat/ambient-keyword-trigger -> main
**PR**: #235
**Date**: 2026-06-02_1826

## Scope

The only TypeScript change in this PR is `tests/shell-hooks.test.ts` (+295 lines, lines 1080–1372): a vitest suite (`describe('preamble keyword detection')`) that shells out to the `preamble` hook via `execSync`. This is the implementation of the four-suite test plan from `ADR-014` (functionality truth table, JSON API contract, security/fuzz, performance), which the code structure follows verbatim (Suites 1–4). The new code is a test harness; there is no production TypeScript change.

## Issues in Your Changes (BLOCKING)

None. The new test code passes all TypeScript quality gates from `devflow:typescript`:

- **No `any`** — the Iron Law ("unknown over any") is honored. Where dynamic JSON shape is needed, Suite 2 (C1/C6, line 1206) correctly uses `JSON.parse(out) as Record<string, unknown>` and narrows individual fields with `typeof` / `as string` checks rather than `any`.
- **Explicit return types on all helpers** — `runPreamble(): string` (1099), `expectedContext(): string` (1109), `median(): number` (1346), `measureMs(): number[]` (1351). Matches the project's `localDateString(): string` convention (line 9).
- **`const`/`let` discipline** — `let tmpDir` (1088) is correct (reassigned per `beforeEach`); every other binding is `const`. Mirrors the existing `working memory queue behavior` block (line 646).
- **Resource cleanup** — `beforeEach` creates a unique `fs.mkdtempSync` dir (1091) and `afterEach` removes it with `fs.rmSync(tmpDir, { recursive: true, force: true })` (1095). Identical to the established teardown pattern used throughout this file.
- **execSync buffer handling** — Suite 3 (line 1289–1292) correctly routes the 200KB hostile payload through a temp file (`< "${inputFile}"`) rather than `input:` stdin to avoid the execSync stdin buffer limit, with an explanatory comment. This is a genuinely correct piece of engineering, not boilerplate.
- **Typed test fixtures** — `matchCases: Array<{ prompt; expectedSkill; label }>` (1122), `noMatchCases` (1130), `hostilePayloads` (1275) are all explicitly typed, giving compile-time safety on the data-driven cases.

## Issues in Code You Touched (Should Fix)

None at >=80% confidence.

## Pre-existing Issues (Not Blocking)

The repeated `JSON.parse(out) as { hookSpecificOutput: { ... } }` assertion pattern (e.g. 1146, 1166, 1175, 1189, 1297) sidesteps `devflow:typescript`'s "type guard over `as`" guidance. This is informational only: it is the established convention across the entire file (lines 703, 727, 833, etc.), test code asserting a known JSON wire shape is a reasonable use of `as`, and changing it would break consistency with ~30 pre-existing sites. Not blocking; not worth a separate fix.

## Suggestions (Lower Confidence)

- **Double `JSON.parse(out)`** - `tests/shell-hooks.test.ts:1184` and `:1208` (Confidence: 70%) — `Object.keys(JSON.parse(out))` re-parses `out` after it was already parsed into `parsed`. Reusing `parsed` would be marginally clearer and avoids a second parse. Stylistic/efficiency, not a correctness or typing issue.
- **`median` on even-length arrays** - `tests/shell-hooks.test.ts:1346` (Confidence: 65%) — `median` returns the upper-middle element for even-length input; with `K = 5` (odd) this is always exact, so it is correct as used. Only flag if `K` ever becomes even. With `noUncheckedIndexedAccess` off in `tsconfig.json`, `sorted[...]` is typed `number` (not `number | undefined`), so there is no type error today.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 1 |

**TypeScript Score**: 9
**Recommendation**: APPROVED

The test harness is well-typed, follows the existing patterns in this file precisely, has correct resource setup/teardown, handles the execSync buffer edge for large payloads correctly, and implements the `ADR-014` four-suite plan faithfully. No TypeScript-quality blockers.
