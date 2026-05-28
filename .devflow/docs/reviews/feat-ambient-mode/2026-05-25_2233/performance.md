# Performance Review Report

**Branch**: feat-ambient-mode -> main
**Date**: 2026-05-25
**PR**: #227

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

(none)

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

- **Duplicate COMMANDS_RULE_CONTENT string** - `src/cli/commands/ambient.ts:26-52` (Confidence: 65%) — The rule content is defined as a large template literal in `ambient.ts` AND also exists as `shared/rules/commands.md`. On `--enable`, the TypeScript code writes the embedded string to disk, which could drift from the canonical `shared/rules/commands.md` source. If these diverge, the installed rule content differs depending on whether it was installed via `devflow ambient --enable` or via the build-time rules pipeline. Not a performance issue per se but a maintenance risk that could cause unnecessary file writes if the two sources diverge during upgrades (the rule is "always overwritten" per the idempotency comment at line 93).

- **`addAmbientHook` performs file I/O on every call even when hook is unchanged** - `src/cli/commands/ambient.ts:126-127` (Confidence: 70%) — The function always writes the commands rule file (`mkdir` + `writeFile`) even when `changed` is false (the hook already exists). The early return on line 129 only checks whether the JSON settings changed, but the rule file write at lines 126-127 happens unconditionally before that check. This means every idempotent call to `addAmbientHook` performs two filesystem syscalls (`mkdir` + `writeFile`) that produce no change. Impact is minimal since this only runs during `devflow init` or `devflow ambient --enable` (not on every prompt), but it violates the "idempotent" contract claimed in the JSDoc.

- **`removeAmbientHook` swallows all errors from `fs.unlink`** - `src/cli/commands/ambient.ts:148-151` (Confidence: 60%) — The catch block silently swallows all errors including permission errors, not just ENOENT. If the file exists but cannot be deleted (e.g., permission denied), the function returns silently. This is a reliability concern rather than strictly performance.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Performance Score**: 9/10
**Recommendation**: APPROVED

## Rationale

This PR is a significant **performance improvement** at the system level. The changes replace a 4-layer ambient classification pipeline (SessionStart hook reading classification-rules.md + UserPromptSubmit preamble injecting classification instructions on every prompt + router skill + triage skills) with a two-component system:

1. A lean preamble hook that only fires when all three plan markers (`## Goal`, `## Steps`, `## Files`) are present — zero output for normal prompts.
2. A static commands awareness rule file (loaded once by Claude Code's rules system, not per-prompt).

**Performance wins (applies ADR-001):**

- **Eliminated per-prompt overhead**: The old system injected classification instructions on every `UserPromptSubmit` event, requiring the model to classify intent before responding. The new preamble hook does a cheap bash string match and exits silently for 99%+ of prompts. This is a direct token savings on every single prompt.
- **Eliminated SessionStart hook I/O**: The old `session-start-classification` hook read `classification-rules.md` from disk and injected it as `additionalContext` on every session start. Deleted entirely.
- **Removed ~1,200 lines of skill files**: 17 skill directories deleted (router, classification-rules, 7 triage skills, 7 guided skills, 2 legacy). Fewer installed skills means less context pollution and faster skill catalog lookups.
- **Preamble bash pattern matching is O(1)**: The three `[[ "$PROMPT" == *"## Goal"* ]]` checks are substring searches — negligible CPU cost compared to the old word-count calculation + classification injection.
- **No N+1 or memory leak patterns**: The hook processes a single stdin read, does three string matches, and exits. No loops, no caches, no resource leaks.

The `addAmbientHook` and `removeAmbientHook` functions were changed from synchronous to async to accommodate the new `fs.writeFile`/`fs.unlink` calls for the commands rule. This is correct — these functions are only called during CLI commands (`devflow init`, `devflow ambient --enable/--disable`), not on the hot path.

No performance regressions detected.
