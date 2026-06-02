# Performance Review Report

**Branch**: feat/init-flow-simplification -> main
**Date**: 2026-06-01_1725
**Scope**: src/cli/plugins.ts, src/cli/commands/init.ts, tests/plugins.test.ts (init flow refactor)
**PR**: #232

## Context

The init command runs **once per install** — a human-interactive CLI path gated on
`p.multiselect`/`p.confirm` prompts that block on user input. CPU-time micro-performance is
irrelevant here; the only performance concerns worth flagging are (a) new blocking I/O or
network calls on the path, (b) accidental repeated work inside loops, and (c) algorithmic
regressions. All three were checked. No benchmark theater applied for the n≈21 pure function.

## Issues in Your Changes (BLOCKING)

None.

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

None relevant to performance within the reviewed scope.

## Verification Summary (claims confirmed)

**`partitionSelectablePlugins` — O(n), pure, no I/O** (plugins.ts:719-737)
- Single `for` loop over `plugins` (n≈21). `EXCLUDED` is a `Set` → O(1) `.has()` per element.
  `plugin.commands.length > 0` is O(1) property access. No nested loops → **O(n)** total.
- No I/O, no network, no `await`. Does not mutate the input array (pushes to fresh local
  arrays). Deterministic, preserves `DEVFLOW_PLUGINS` ordering within each bucket.
- Replaces two prior inline `.filter()` chains (old init.ts:315-325, two filters + two maps)
  with one O(n) pass + two maps → strictly fewer array allocations. Minor net improvement, no regression.

**Bounded selection loop — no repeated work, fixed bound** (init.ts:322-373)
- `while (attempts < MAX_ATTEMPTS)` with `MAX_ATTEMPTS = 3`; `attempts++` is the first
  statement and `break` fires on success. Bounded; no unbounded `while(true)`. (avoids
  unbounded-loop reliability rule.)
- `workflowChoices`, `languageChoices`, and `workflowInitialValues` are all computed **once
  before** the loop (init.ts:304-320), not recomputed per iteration. No accidental repeated
  work inside the loop body.
- The only per-iteration cost is `await p.multiselect(...)` — an interactive prompt that
  blocks on human input, not CPU or I/O. Re-prompting up to 3x on empty selection is intended
  UX, not a performance concern.

**No new blocking I/O or network calls**
- The changed regions add no `readFileSync`/`writeFileSync`/`execSync`/`fetch`. The partition
  is pure in-memory; the loop only awaits interactive prompts.
- The recommended-path `Promise.all` parallelizing project discovery + safe-delete version
  check (init.ts:462) is pre-existing context, not introduced by this diff, and already
  parallelizes independent I/O correctly.

**`WORKFLOW_ORDER` hoist** (plugins.ts:701-705)
- Moved from a per-invocation local array (old init.ts:1222) to a module-level constant —
  allocated once at module load instead of once per `init` call. Negligible but positive; no
  regression. The downstream `Set`-based `installedSet.has()` filter is O(n) and unchanged.

## Decisions / Knowledge Applied

- **PF-005** (read in full): about not framing a capability as novel without checking the
  existing agent roster — a design/workflow pitfall, not a performance concern. Does not apply
  to this pure-function + bounded-loop change. No citation warranted.
- **FEATURE_KNOWLEDGE cli-rules**: concerns the rules subsystem, not the partition/loop logic
  under review. No performance-relevant gotcha applies.

## Suggestions (Lower Confidence)

None.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**Performance Score**: 10
**Recommendation**: APPROVED
