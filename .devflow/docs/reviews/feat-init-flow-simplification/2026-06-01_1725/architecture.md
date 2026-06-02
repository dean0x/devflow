# Architecture Review Report

**Branch**: feat/init-flow-simplification -> main
**Date**: 2026-06-01_1725
**PR**: #232
**Scope**: src/cli/plugins.ts, src/cli/commands/init.ts, tests/plugins.test.ts

## Summary of Assessment

The refactor is architecturally sound. The orchestrator's specific questions resolve favorably:

- **WORKFLOW_ORDER placement**: Correctly moved from a function-local `const` inside `init.ts` to an exported `const` in `plugins.ts` — single source of truth. The registry module (`plugins.ts`) is the right home: it already owns `PluginDefinition`, `DEVFLOW_PLUGINS`, and the command declarations that WORKFLOW_ORDER mirrors. The regression-guard test ties the two together. `/bug-analysis` is placed after `/self-review`, consistent with ADR-004 (bug-analysis is a separate post-pipeline workflow, not part of the main review pipeline) — its ordering position reflects that separation rather than embedding it in the review flow.
- **partitionSelectablePlugins mirrors existing pattern**: Yes, appropriately. It sits alongside `buildAssetMaps`/`buildFullSkillsMap`/`buildRulesMap` as a pure, exported, side-effect-free transformer over `PluginDefinition[]`. Same signature shape (takes plugins, returns derived structure), same testability profile, documented as pure/non-mutating/deterministic. This is the correct DIP-friendly boundary: `init.ts` depends on the abstraction (the partition contract) rather than re-deriving classification inline.
- **Exclusion set sharing**: The `EXCLUDED` set now lives in exactly one production location (`plugins.ts:723`). The previous inline filter in `init.ts` (old lines 315-324) was deleted. The test re-declares its own `EXCLUDED` set (`plugins.test.ts:310`) — this is an acceptable independent test oracle, not production duplication. No coupling concern.
- **Two-step selection loop**: Well-structured. Bounded (`MAX_ATTEMPTS = 3`, satisfies the reliability rule on bounded loops), handles empty buckets, handles cancel at each step, and fails closed (`p.cancel` + `process.exit(0)`) on exhausted attempts. See one MEDIUM observation below on the warning placement.
- **Layering/coupling between init.ts and plugins.ts**: Improved. `init.ts` (orchestration/UI) now consumes two pure exports from `plugins.ts` (registry/domain) instead of duplicating classification rules. Dependency points one direction: command → registry. No leakage of UI concerns into `plugins.ts`.

No blocking issues found. The items below are MEDIUM/LOW and informational.

---

## Issues in Your Changes (BLOCKING)

None.

---

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Re-prompt warning is unreachable on the final attempt's failure path** — `src/cli/commands/init.ts:367-372`
**Confidence**: 82%
- Problem: Inside the loop, after computing `combined`, the "Select at least one plugin." warning is gated by `if (attempts < MAX_ATTEMPTS)`. With `MAX_ATTEMPTS = 3`, a user who selects nothing three times sees the warning after attempts 1 and 2, then on attempt 3 gets `p.cancel('Installation cancelled — no plugins selected.')`. This is logically correct, but the structure couples the "retry hint" and the "give up" decision into one branch evaluated *after* the prompts run. The loop therefore always runs the prompts at least once even when `attempts === MAX_ATTEMPTS` is about to fail — which is the intended behavior, but the control flow reads as if the warn/cancel are alternatives to *re-prompting* rather than post-prompt feedback. Minor SRP smell: the loop body mixes "collect selection" with "decide whether to terminate."
- Impact: Maintainability only — no functional defect. A future editor could misread the `attempts < MAX_ATTEMPTS` guard as protecting the prompt rather than the warning.
- Fix: Optional clarity improvement — extract the terminal decision:
```ts
if (combined.length > 0) { selectedPlugins = combined; break; }
const isLastAttempt = attempts >= MAX_ATTEMPTS;
if (isLastAttempt) {
  p.cancel('Installation cancelled — no plugins selected.');
  process.exit(0);
}
p.log.warn('Select at least one plugin.');
```
This separates "did we get a selection" from "are we out of attempts" and removes the nested `if/else` after the `break`.

### LOW

**Language-bucket dependency on `commands.length === 0` is an implicit contract** — `src/cli/plugins.ts:729`
**Confidence**: 80%
- Problem: `partitionSelectablePlugins` classifies a plugin as "language" purely by `commands.length === 0`. This is an inferred classification rather than an explicit property (e.g., the existing `optional` flag, or a `category` field). Today every command-less selectable plugin happens to be a language/ecosystem plugin, so the heuristic is correct. But the bucket is *named* `language` while its actual predicate is "command-less" — a semantic gap. If a future non-language, command-less plugin is added (e.g., a config-only or skills-only plugin), it would silently land in the "Step 2 — Language plugins" UI section.
- Impact: Latent mislabeling risk; no current defect. The function's own doc comment says "command-less, optional language/ecosystem" — conflating two independent attributes.
- Fix: Either rename the bucket to `commandless` to match the actual predicate, or assert the intended invariant (every command-less selectable plugin is `optional`). The existing test "command-less plugins land in language bucket" already encodes the heuristic; a complementary test asserting `optional === true` for everything in the language bucket would lock the semantic intent.

---

## Pre-existing Issues (Not Blocking)

None within scope worth flagging at CRITICAL severity.

---

## Suggestions (Lower Confidence)

- **WORKFLOW_ORDER typed as `string[]` rather than a literal/branded command type** — `src/cli/plugins.ts:701` (Confidence: 65%) — Command identifiers are stringly-typed across both `WORKFLOW_ORDER` and `PluginDefinition.commands`. A shared `Command` union or branded type would let the compiler catch a misspelled `/code-reveiw` in WORKFLOW_ORDER instead of relying on the runtime regression-guard test. Out of scope for this PR but worth noting as a consistency improvement.
- **`installedSet` rebuild on every init** — `src/cli/commands/init.ts:1256` (Confidence: 60%) — `pluginsToInstall.flatMap(p => p.commands)` recomputes the available-commands set inline; could be a small helper colocated with WORKFLOW_ORDER in plugins.ts (e.g., `orderCommands(plugins)`) to keep all command-ordering logic in one module. Minor.

---

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 1 | 1 |
| Pre-existing | - | - | 0 | 0 |

**Architecture Score**: 9
**Recommendation**: APPROVED

The refactor strengthens the layering: classification rules and display ordering now live in the registry module as pure exports, `init.ts` consumes them as abstractions, and the exclusion set is no longer duplicated in production code. WORKFLOW_ORDER placement is correct and ADR-004-consistent. The two findings are maintainability-grade (loop-body SRP clarity, implicit language-bucket contract) and do not block merge.
