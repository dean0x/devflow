# Complexity Review Report

**Branch**: feat-ambient-mode -> main
**Date**: 2026-05-25

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

(none)

### MEDIUM

**Inline rule content duplicated as both source file and TypeScript constant** - `src/cli/commands/ambient.ts:26-52`, `shared/rules/commands.md:1-27`
**Confidence**: 85%
- Problem: The `COMMANDS_RULE_CONTENT` string literal in `ambient.ts` (lines 26-52) is a verbatim copy of `shared/rules/commands.md`. Any future edit to the command list must be made in two places. This is a classic duplication-as-maintainability-hazard: the test at `tests/ambient.test.ts:335-339` validates the TypeScript constant, but nothing validates that the constant and the source file remain in sync.
- Fix: Read the rule content from the source file at build time or at runtime, rather than duplicating it as a string literal. For example:
  ```typescript
  // At build time (preferred — no runtime I/O):
  import { readFileSync } from 'fs';
  import * as path from 'path';
  export const COMMANDS_RULE_CONTENT = readFileSync(
    path.resolve(__dirname, '../../shared/rules/commands.md'), 'utf-8'
  );
  ```
  Or add a test that asserts `COMMANDS_RULE_CONTENT === fs.readFileSync('shared/rules/commands.md', 'utf-8')` to catch drift.

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**LEGACY_SKILL_NAMES is a 208-entry flat list with no structure** - `src/cli/plugins.ts:300-508`
**Confidence**: 82%
- Problem: The `LEGACY_SKILL_NAMES` array has grown to 208 entries. Each entry is a bare string with version-era comments as the only grouping mechanism. This is not a new issue introduced by this PR (the PR only removed the `ambient-router` shadow rename), but the list continues to accumulate. Cyclomatic complexity of any function that iterates this list is low, but cognitive complexity for maintainers is high -- understanding which entries belong to which migration era requires reading inline comments. At 208 entries this approaches the boundary where structured data (e.g., objects with `{ name, addedInVersion, replacedBy }`) would be more maintainable.
- Fix: Consider restructuring into an array of objects with metadata, or at minimum extract into a separate `legacy-skills.ts` file to isolate the growing list from the plugin registry.

## Suggestions (Lower Confidence)

- **`devflow-ambient` plugin still declares 14 agents despite architectural simplification** - `src/cli/plugins.ts:149` (Confidence: 70%) -- The ambient plugin was simplified from a 4-layer classification system to a plan-detection hook + rules file. Yet it still declares all 14 shared agents (coder, validator, simplifier, scrutinizer, evaluator, tester, skimmer, reviewer, git, synthesizer, resolver, designer, knowledge, researcher). If ambient mode no longer orchestrates agents directly (it just detects plans and delegates to `implement:orch`), these agent declarations may be vestigial. However, the orch skills it references may still need these agents at install time.

- **`removeAmbientHook` became async but return type changed silently** - `src/cli/commands/ambient.ts:141` (Confidence: 65%) -- `removeAmbientHook` is now `async` (returns `Promise<string>`) due to the `fs.unlink` call for the commands rule file. The callers in `uninstall.ts` were correctly updated to `await`, but this signature change has no explicit documentation (e.g., JSDoc) explaining why the function became async. Minor, but worth a D-series comment for the next maintainer.

- **`runClaudeStreaming` helper has moderate nesting and callback-based flow** - `tests/integration/helpers.ts:73-153` (Confidence: 62%) -- The `runClaudeStreaming` function uses a Promise constructor with nested event handlers, two timers (safety timeout + grace timer), and a `settled` guard flag. This is a common pattern for process management but has 4 levels of nesting and interleaved state. Not introduced by this PR (the function was simplified, not added), but it remains the most complex function in the changed test helpers.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Complexity Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

This PR is a significant complexity **reduction** -- it deletes 17 skill files, removes the 4-layer ambient classification pipeline (router + classification-rules + 7 triage skills + 7 guided skills), and replaces it with a 28-line bash hook and a 27-line rules file. Net -1200 lines. The architecture goes from a multi-stage classification/triage/routing system to a single-purpose plan detector, which is dramatically simpler to understand and maintain (applies ADR-001 -- clean break philosophy).

The one blocking MEDIUM finding (duplicated rule content) is a maintainability concern that should be addressed before or shortly after merge to prevent the two sources from drifting. The pre-existing LEGACY_SKILL_NAMES growth is informational only.
