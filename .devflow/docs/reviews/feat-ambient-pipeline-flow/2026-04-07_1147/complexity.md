# Complexity Review Report

**Branch**: feat/ambient-pipeline-flow -> main
**Date**: 2026-04-07

## Issues in Your Changes (BLOCKING)

### HIGH

**Duplicated function bodies across diff hunks in `ambient.ts`** - `src/cli/commands/ambient.ts`
**Confidence**: 95%
- Problem: The diff shows the `filterHookEntries`, `addAmbientHook`, `removeAmbientHook`, `removeLegacyAmbientHook`, and predicate functions (`isLegacy`, `isAmbient`, `isClassification`) repeated 4 times in the diff output. This suggests the file may contain duplicated code blocks. However, examining the actual file (234 lines) and the diff stat (+101/-101), this appears to be a diff rendering artifact of the same function being modified in what was originally a multi-hunk diff across repeated `export` declarations in the same file.
- Investigation: The file is 234 lines, which is within acceptable bounds. The `addAmbientHook` function itself grew from ~20 lines to ~40 lines but remains a single function. No actual duplication issue.
- Verdict: **False positive from diff rendering.** No action needed.

### MEDIUM

**`addAmbientHook` function grew in cyclomatic complexity** - `src/cli/commands/ambient.ts:53-127`
**Confidence**: 85%
- Problem: The `addAmbientHook` function previously handled one hook type (UserPromptSubmit preamble) with a simple legacy-remove + idempotency-check + add pattern. It now manages two independent hook types (UserPromptSubmit preamble + SessionStart classification), doubling its conditional branches. The function has 4 `if` branches for existence checks and a `changed` tracking variable, bringing cyclomatic complexity to approximately 7.
- Impact: While not critical (below the "warning" threshold of 10), this is a function doing two conceptually distinct operations (adding a preamble hook and adding a classification hook) in one function body. The parameter `devflowDir` is the only shared dependency between the two operations.
- Fix: Consider extracting an `addSingleHook(settings, eventName, hookMarker, command)` helper that both hook additions call. This would reduce `addAmbientHook` to: (1) remove legacy, (2) add preamble hook, (3) add classification hook, (4) serialize. Each helper would have CC ~2-3.

```typescript
// Suggested refactoring pattern:
function ensureHook(settings: Settings, eventName: string, marker: string, command: string): boolean {
  const exists = settings.hooks?.[eventName]?.some((m) =>
    m.hooks.some((h) => h.command.includes(marker)),
  );
  if (exists) return false;

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks[eventName]) settings.hooks[eventName] = [];

  settings.hooks[eventName].push({
    hooks: [{ type: 'command', command, timeout: 5 }],
  });
  return true;
}
```

## Issues in Code You Touched (Should Fix)

_None identified._

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`parseRouterTables` and `parseClassificationIntents` helper functions duplicated across test file** - `tests/ambient.test.ts`
**Confidence**: 82%
- Problem: The diff shows `parseRouterTables` (a ~25-line function) and `parseClassificationIntents` (a ~15-line function) appearing twice in the diff. Examining the test file (646 lines total), these helper functions appear to be defined once but the diff shows them duplicated, likely another diff rendering artifact from the way the file was restructured. However, at 646 lines, the test file is above the 500-line "critical" file length threshold.
- Impact: The test file's length is driven by comprehensive test coverage (structural validation tests, drift detection tests, hook management tests), which is justified. Not a maintainability concern per se, but worth monitoring.
- Fix: No immediate action needed. The file length is justified by its breadth of coverage. If it grows further, consider splitting into `ambient-hooks.test.ts` and `ambient-router-validation.test.ts`.

## Suggestions (Lower Confidence)

- **Router SKILL.md reduced from ~170 to ~50 lines -- verify no lost edge-case handling** - `shared/skills/router/SKILL.md` (Confidence: 70%) -- The old router contained extensive edge-case documentation (mixed intent, continuation behavior, REVIEW-after-IMPLEMENT depth matching, EXPLORE depth tiers). The new version is intentionally minimal but delegates classification rules to `classification-rules.md` (~31 lines). Several edge cases from the old file (e.g., "REVIEW after IMPLEMENT/GUIDED stays GUIDED", "scope ambiguous defaults to GUIDED") are no longer documented anywhere. This is a simplification tradeoff -- the edge cases may still be handled by model inference from the lean rules, but there is no explicit guarantee.

- **Pipeline:orch removed AskUserQuestion from allowed-tools -- behavioral change** - `shared/skills/pipeline:orch/SKILL.md:5` (Confidence: 65%) -- The `allowed-tools` changed from `Read, Grep, Glob, Bash, Task, AskUserQuestion` to `Read, Grep, Glob, Bash, Task`. The Iron Law changed from "USER GATES BETWEEN STAGES" to "FULL PIPELINE, NO INTERRUPTIONS". This is an intentional design decision (auto-proceed between stages), but worth noting that critical review findings will now auto-resolve without human confirmation, which has safety implications for destructive operations.

- **Classification bias shift toward ORCHESTRATED** - `shared/skills/router/references/classification-rules.md:22` (Confidence: 62%) -- The old router said "prefer GUIDED -- escalate only when scope clearly exceeds main-session capacity." The new classification-rules.md says "Default to ORCHESTRATED for substantive work -- it produces better results." This reverses the conservatism principle, meaning more prompts will trigger full agent pipelines (7+ agents for review, multi-agent Coder for implement). This is a deliberate tradeoff but increases average cost per prompt.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Complexity Score**: 8/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR represents a significant simplification of the ambient mode architecture -- the router SKILL.md went from ~170 lines to ~50 lines, classification rules were extracted to a lean 31-line reference document, and the preamble hook was reduced from a multi-line classification prompt to a single sentence. The overall direction reduces complexity. The one actionable finding is that `addAmbientHook` could benefit from a helper to avoid the growing conditional structure as more hook types are added in the future. The `Task` to `Agent` renames across 15+ command/skill files are mechanical and introduce zero complexity change.
