# Regression Review Report

**Branch**: feat/ambient-mode -> main
**Date**: 2026-05-25

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

(none)

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED

## Analysis Notes

### Changes Reviewed

1. **`src/cli/commands/ambient.ts`** — Extracted `installCommandsRule()` and `removeCommandsRule()` helpers from inline code, removed redundant null check in `filterHookEntries`, fixed `removeAmbientHook` to correctly track classification hook removal, updated plan trigger wording from "first message in a session" to "a prompt".

2. **`src/cli/plugins.ts`** — Added 16 entries to `LEGACY_SKILL_NAMES` for cleanup of deprecated `devflow:`-prefixed triage/guided/router skill directories that are no longer in any plugin manifest or `shared/skills/`.

3. **`shared/rules/commands.md`** — Updated plan trigger wording to match actual hook behavior (UserPromptSubmit fires on every prompt, not just first message).

4. **`tests/ambient.test.ts`** — Added fs mocks to prevent real filesystem side-effects, added edge case test for classification-only cleanup, added sync test for source file drift detection.

5. **`README.md`** / **`plugins/devflow-ambient/README.md`** — Documentation updates (rule count 12->13, trigger wording, skills clarification).

### Regression Checklist

- [x] No exports removed without deprecation — `COMMANDS_RULE_PATH` still exported, new helpers (`installCommandsRule`, `removeCommandsRule`) added as exports
- [x] Return types backward compatible — no signature changes
- [x] Default values unchanged
- [x] Side effects preserved — `installCommandsRule` and `removeCommandsRule` do exactly what the inline code did before
- [x] All consumers of changed code updated — `init.ts`, `uninstall.ts`, `cli.ts` all import the same symbols as before
- [x] Migration complete across codebase — `LEGACY_SKILL_NAMES` additions target orphaned disk artifacts not in any plugin manifest (applies ADR-002)
- [x] CLI options preserved
- [x] Commit message matches implementation
- [x] Breaking changes: none

### Key Observations

1. **`filterHookEntries` null check removal** (line 72): Safe. The function early-returns at line 60 if `settings.hooks` is falsy, guaranteeing `settings.hooks` is non-null at line 72. The `&& settings.hooks` guard was redundant.

2. **`removeAmbientHook` classification tracking fix**: Previously, removing only a stale classification hook (without any UserPromptSubmit hook present) would discard the mutation. The new code correctly returns serialized settings when either removal occurs. This is a bug fix, not a regression.

3. **Plan trigger wording change**: The `preamble` hook registers as `UserPromptSubmit` which fires on every user prompt. The old documentation ("first message in a session") was inaccurate. The new wording ("a prompt") matches the actual behavior. This corrects a documentation-reality mismatch.

4. **Legacy skill names**: All 16 added entries (`devflow:router`, `devflow:implement:triage`, `devflow:implement:guided`, etc.) are confirmed orphaned — they exist on disk from previous installations but are absent from both `shared/skills/` and all `plugin.json` manifests. Cleanup is correct and intentional.

5. **Test fs mocking**: Tests now mock `fs.mkdir`, `fs.writeFile`, and `fs.unlink` to prevent real filesystem writes during unit tests. The mocks are properly restored via `afterEach`. All 46 tests pass.
