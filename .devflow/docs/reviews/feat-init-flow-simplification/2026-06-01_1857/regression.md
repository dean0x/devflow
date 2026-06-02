# Regression Review Report

**Branch**: feat/init-flow-simplification -> main
**PR**: #232
**Date**: 2026-06-01_1857

## Issues in Your Changes (BLOCKING)

### CRITICAL
None.

### HIGH
None.

## Issues in Code You Touched (Should Fix)
None at >=80% confidence.

## Pre-existing Issues (Not Blocking)
None of CRITICAL severity. (`/ambient` command is intentionally absent from `WORKFLOW_ORDER`
— it was never present in the old local copy either, and `devflow-ambient` is excluded from the
forward regression guard via `partitionSelectablePlugins`. Not a regression.)

## Suggestions (Lower Confidence)

- **Interactive `local`-scope install path is now unreachable** — `src/cli/commands/init.ts:209-225`
  (Confidence: 70%) — Removing the interactive scope prompt (applies ADR-010) means interactive
  TTY users can no longer select `local` scope and thus never reach the interactive-driven
  `createDocsStructure` / `updateGitignore` / local `.claudeignore` branches. This is the
  documented intent (ADR-010: "--scope flag and non-TTY auto-detection unchanged"), and
  `--scope local` still reaches all of that logic, so it is behavior-by-design rather than a
  defect. Noted only so a future reader does not mistake the now-dead interactive `local` path
  for an accidental drop.

## Regression Verification Performed

The orchestrator flagged four specific regression risks. Each was verified against current code:

1. **WORKFLOW_ORDER moved from init.ts to plugins.ts — other importers?**
   `grep` across `src/` and `tests/` confirms the symbol is referenced only by `plugins.ts`
   (definition), `init.ts:21` (import) + `init.ts:1279` (use), and `tests/plugins.test.ts`.
   No external importer broke. The local duplicate in init.ts was deleted and replaced by the
   import — value is identical except for the intentional `/bug-analysis` addition. CLI builds
   clean (`tsc` exit 0). applies ADR-011.

2. **`--scope` flag and non-TTY install path preserved?**
   `init.ts:209-225` retains: `--hud-only` → user, `--scope` normalize+validate (exits on
   invalid), `!isTTY` → user (with log line). Only the trailing interactive `else` (the scope
   `p.select` prompt) was removed; `scope` falls through to its `'user'` initializer for
   interactive TTY. Exactly matches ADR-010 ("hardcode interactive scope to user, while keeping
   the --scope CLI flag and non-TTY auto-detection unchanged").

3. **Removed scope prompt dropped downstream scope-dependent logic?**
   All scope consumers remain intact: `needsDiscovery = ... scope === 'user'`, multi-project
   `.claudeignore`, `updateGitignore`/`createDocsStructure` (local), security deny-list
   (`scope === 'user'`). None were deleted. The only consequence is that interactive runs always
   take the `user` branch — see Suggestion above. No logic removed.

4. **`partitionSelectablePlugins` exclusions dropped a previously-selectable plugin?**
   Old single-multiselect filter excluded `{core-skills, ambient, audit-claude}`; new `EXCLUDED`
   set is identical. Workflow bucket = `commands.length > 0` and non-excluded → plan, implement,
   code-review, resolve, debug, explore, research, release, self-review, bug-analysis (all
   non-optional → all pre-selected via `workflowInitialValues`, matching old `preSelected`
   semantics). Language bucket = command-less optional plugins (typescript, react, accessibility,
   ui-design, go, java, python, rust), none pre-selected (matches old behavior where optional
   plugins were not pre-selected). No previously-selectable plugin dropped. avoids PF-007 (the
   `commands.length > 0` partition contract is documented inline).

Additional checks:
- **Empty-selection guard**: bounded retry loop (`MAX_ATTEMPTS = 3`), `attempts++` before steps,
  `shouldRetry(attempts, MAX, accepted)` correctly returns false on attempt 3 → graceful cancel.
  Old flow used `required: true` on a single multiselect; the new flow replaces that hard
  requirement with a bounded re-prompt + cancel — functionally equivalent (cannot proceed with
  zero plugins). Both steps now `required: false`, with non-emptiness enforced by `combineSelection`.
- **Forward + reverse WORKFLOW_ORDER guards** present (`tests/plugins.test.ts:400,414`), plus
  duplicate-entry check. The reverse guard (prior-cycle addition) is intact.
- **Tests**: 116/116 pass (`tests/plugins.test.ts` + `tests/init-logic.test.ts`); `combineSelection`
  (5 cases), `shouldRetry` (4 cases), `partitionSelectablePlugins` (8 cases) all covered.

## Cross-Cycle Awareness
PRIOR_RESOLUTIONS parsed (Cycle 2). The two prior false positives — (1) test re-declaring the
EXCLUDED set, (2) precondition assert for both-empty buckets — were NOT re-raised. The prior
"reverse WORKFLOW_ORDER regression guard" fix is verified present at `tests/plugins.test.ts:414`.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 10
**Recommendation**: APPROVED
