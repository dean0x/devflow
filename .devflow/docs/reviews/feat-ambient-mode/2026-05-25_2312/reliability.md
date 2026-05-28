# Reliability Review Report

**Branch**: feat/ambient-mode -> main
**Date**: 2026-05-25

## Issues in Your Changes (BLOCKING)

No CRITICAL or HIGH reliability issues found.

## Issues in Code You Touched (Should Fix)

No reliability issues found in adjacent code.

## Pre-existing Issues (Not Blocking)

No CRITICAL pre-existing reliability issues found.

## Suggestions (Lower Confidence)

- **Unvalidated JSON.parse input** - `src/cli/commands/ambient.ts:118` (Confidence: 65%) — `addAmbientHook` and `removeAmbientHook` call `JSON.parse(settingsJson)` without a try/catch. If malformed JSON is passed, the error propagates as an unhandled exception. The caller (`ambientCommand` action at line 216) does catch the initial `readFile` but not subsequent parse failures of the content. Low risk because the caller reads directly from disk and the file should be well-formed, but a malformed `settings.json` would produce a confusing stack trace rather than a user-friendly message.

- **`isAmbient` predicate matches any command containing "preamble"** - `src/cli/commands/ambient.ts:82` (Confidence: 62%) — The `PREAMBLE_HOOK_MARKER` is `'preamble'`, and `h.command.includes(PREAMBLE_HOOK_MARKER)` could match a hypothetical third-party hook command that contains the substring "preamble" in its path. This is a theoretical false-positive risk; in practice the marker value is sufficiently specific for the devflow ecosystem.

- **`removeCommandsRule` swallows ENOENT but no retry for transient I/O** - `src/cli/commands/ambient.ts:103` (Confidence: 60%) — The narrow ENOENT catch is correct and an improvement over the previous bare `catch {}`. No reliability gap currently, but noted for completeness.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Reliability Score**: 9/10
**Recommendation**: APPROVED

## Analysis Notes

Changes reviewed:
- `src/cli/commands/ambient.ts` — Extracted `installCommandsRule`/`removeCommandsRule` helpers, removed redundant null check in `filterHookEntries`, fixed classification discard tracking in `removeAmbientHook`
- `src/cli/plugins.ts` — Added 16 legacy prefixed skill names to `LEGACY_SKILL_NAMES` (append-only array, no runtime iteration concern)
- `tests/ambient.test.ts` — Added fs mocks to prevent filesystem side-effects, new edge case test for stale classification cleanup
- `shared/rules/commands.md`, `plugins/devflow-ambient/README.md`, `README.md` — Documentation/wording only

Reliability observations:
1. **Bounded iteration**: No loops introduced. The `filterHookEntries` function iterates over `settings.hooks[eventName]` which is bounded by the number of registered hooks (typically 1-3). Safe.
2. **Assertion density**: The null/undefined guard at line 60 (`if (!settings.hooks?.[eventName]) return false`) is an effective precondition. The removed redundant check at line 72 was safe to remove — `settings.hooks` is guaranteed non-null by the guard.
3. **Resource cleanup**: File operations (`mkdir`, `writeFile`, `unlink`) are properly guarded. `removeCommandsRule` correctly narrows the catch to ENOENT only (improvement over previous bare `catch {}`).
4. **Idempotency**: Both `addAmbientHook` and `removeAmbientHook` are idempotent — repeated calls produce the same result. The `removeAmbientHook` fix (tracking `removedClassification`) correctly detects the edge case where only a stale classification hook exists.
5. **Sequential call safety**: The two `filterHookEntries` calls in `removeAmbientHook` are safe even when the first deletes `settings.hooks` entirely — the second call's optional chaining guard handles it.
