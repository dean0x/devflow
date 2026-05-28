# TypeScript Review Report

**Branch**: feat/ambient-mode -> main
**Date**: 2026-05-25

## Issues in Your Changes (BLOCKING)

No CRITICAL or HIGH issues found.

## Issues in Code You Touched (Should Fix)

No issues found.

## Pre-existing Issues (Not Blocking)

No CRITICAL pre-existing issues in changed files.

## Suggestions (Lower Confidence)

- **Bare `catch` clauses lack typed error narrowing** - `ambient.ts:217`, `ambient.ts:244` (Confidence: 65%) — The two bare `catch {}` clauses in the command action swallow all errors without narrowing. While the refactored `removeCommandsRule` (line 106-108) correctly uses `(err as NodeJS.ErrnoException).code`, the pre-existing catches at lines 217 and 244 could mask unexpected failures (e.g., JSON parse errors, permission denials). However, these are in the CLI command handler (not a library function) where graceful degradation to defaults is reasonable.

- **`filterHookEntries` mutates its argument without signaling in the type signature** - `ambient.ts:55-76` (Confidence: 62%) — The function modifies `settings` in place and returns a boolean indicating whether anything changed. This is a side-effecting function whose mutation contract is not visible in the type signature. A more TypeScript-idiomatic approach would return a new settings object or use a branded/wrapper pattern. However, this is consistent with how other hook-manipulation utilities work in this codebase and the function is internal (non-exported), so this is a style preference rather than a defect.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**TypeScript Score**: 9/10
**Recommendation**: APPROVED

## Analysis Notes

The TypeScript changes in this PR are well-structured and type-safe:

1. **Extracted helpers** (`installCommandsRule`, `removeCommandsRule`) are properly typed with explicit `Promise<void>` returns and follow idempotent patterns.

2. **Error narrowing** in `removeCommandsRule` (line 107) correctly uses `(err as NodeJS.ErrnoException).code !== 'ENOENT'` instead of a bare catch — this is a meaningful improvement over the previous inline version that caught all errors silently.

3. **Redundant null check removal** (line 72): Removing `settings.hooks &&` from the condition is correct — the early return guard at line 60 (`if (!settings.hooks?.[eventName]) return false`) already narrows `settings.hooks` to non-undefined for the remainder of the function. TypeScript's control flow analysis handles this correctly.

4. **Classification tracking** (line 166): The addition of `const removedClassification = filterHookEntries(...)` and using it in the return condition (`if (!removedPrompt && !removedClassification)`) properly captures whether a cleanup change was made, fixing a logical bug where stale classification hooks could be removed without triggering a settings write.

5. **Test quality**: The new test fixtures properly mock `fs.mkdir`, `fs.writeFile`, and `fs.unlink` to eliminate filesystem side-effects, and the `beforeEach`/`afterEach` pattern with `vi.restoreAllMocks()` ensures test isolation.

6. **LEGACY_SKILL_NAMES additions** (plugins.ts lines 508-523): Properly typed string array entries following the established pattern.

7. **No `any` types** — all code uses proper typing including the `Settings` interface with `[key: string]: unknown` index signature.

8. **All exports have explicit return types** — `Promise<void>`, `Promise<string>`, `boolean`.

The project compiles cleanly with `tsc --noEmit` under strict mode.
