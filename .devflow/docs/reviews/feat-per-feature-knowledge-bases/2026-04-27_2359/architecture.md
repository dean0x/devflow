# Architecture Review Report

**Branch**: feat/per-feature-knowledge-bases -> main
**Date**: 2026-04-27
**Commits reviewed**: 8358e70..287a532 (7 commits)

## Issues in Your Changes (BLOCKING)

### HIGH

**Duplicated sidecar-parsing logic across TS and CJS layers** - `src/cli/commands/kb.ts:26-44`, `scripts/hooks/json-helper.cjs:1813-1828`
**Confidence**: 85%
- Problem: The sidecar JSON parsing concern is now implemented in two places with subtly different contracts. The TypeScript `readSidecar()` validates field types, filters non-string array elements, and returns a typed `SidecarData` object. The CJS `read-sidecar` operation in `json-helper.cjs` only checks `Array.isArray` but does not filter non-string elements, and it returns raw JSON to stdout. Both are called from different callsites — TS from `kb.ts create/refresh` commands, CJS from `background-kb-refresh` shell hook. This is a DRY/SRP violation: a single parsing concern with two implementations that can drift independently.
- Impact: A future change to the sidecar schema (e.g., adding a new field) requires coordinated updates to both parsers. The CJS version is less strict (no string filtering), so corrupted sidecar data could flow through the shell hook path but be caught in the CLI path, creating inconsistent behavior.
- Fix: Either (a) have `kb.ts` call `json-helper.cjs read-sidecar` via `execFileSync` to consolidate parsing in one place, or (b) have both paths use the same `feature-kb.cjs` library function for parsing. Option (b) is preferred — add a `readSidecar(filePath, field)` to `feature-kb.cjs` exports and consume it from both `kb.ts` (via the already-existing `require()` bridge) and `background-kb-refresh` (via the CLI). This keeps the parsing contract in a single module.

### MEDIUM

**Knowledge agent loses Bash tool but sidecar write is not enforced** - `shared/agents/knowledge.md:14`, `shared/skills/feature-kb/SKILL.md:9`
**Confidence**: 82%
- Problem: Removing `Bash` from the knowledge agent's tool list is architecturally sound (reduces agent capability surface, avoids shell injection). However, the agent now depends on a sidecar file handoff pattern (`.create-result.json` / `.refresh-result.json`) to communicate metadata back to the host process. This contract is only documented in prose (responsibility #7 in the agent spec) — there is no structural enforcement. If the agent fails to write the sidecar (which is explicitly a known scenario, per the fallback logic), the host silently falls back to empty `referencedFiles: []`, which means the KB will never detect staleness (no files to track).
- Impact: Silent data loss in the staleness tracking pipeline. KBs created without sidecar data become permanently "current" regardless of actual file changes.
- Fix: After the `claude -p` invocation in `kb.ts` create/refresh, check whether the sidecar was written. If not, log a warning and prompt the user (for interactive `create`) or log a warning (for `refresh`/background). Consider requiring at minimum the `directories` entries as fallback `referencedFiles` when the sidecar is absent.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`readSidecar` exported from command module breaks layer separation** - `src/cli/commands/kb.ts:21-45`
**Confidence**: 80%
- Problem: `readSidecar` is a general-purpose utility (parse a JSON file, validate field types, return typed data). It is exported from `src/cli/commands/kb.ts`, a command module. Tests import it directly (`tests/feature-kb/feature-kb.test.ts:611`). Command modules should contain command wiring, not reusable utilities. This creates a dependency in the wrong direction — utility consumers importing from a command module.
- Impact: As more consumers need sidecar parsing (e.g., if background hooks adopt the TS version), they would import from a command file, violating the project's command = orchestration-only convention.
- Fix: Move `readSidecar` and `SidecarData` to `src/cli/utils/sidecar.ts` (or similar utility path). Re-export from `kb.ts` if needed for backward compatibility during transition.

**Staleness map variable scoping creates nullable pattern** - `src/cli/commands/kb.ts:490,514`
**Confidence**: 80%
- Problem: The `stalenessMap` variable is declared as `Record<...> | undefined` and only populated when `slug` is not provided. The lookup at line 514 uses `stalenessMap?.[kbSlug] ?? featureKb.checkStaleness(...)` as a fallback. While correct, this creates a pattern where the `checkStaleness` call is redundant when a specific slug is provided — the staleness was never computed globally, so the fallback always triggers for single-slug refreshes. This is fine functionally but the `undefined`-or-populated pattern is unnecessary complexity.
- Impact: Minor. The code is correct but the control flow is harder to reason about than necessary.
- Fix: Compute staleness consistently: always call `checkStaleness` per-slug inside the loop, or compute `checkAllStaleness` upfront regardless of whether `slug` is provided (the cost is negligible for small index sizes).

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`json-helper.cjs` is a 1830+ line god module** - `scripts/hooks/json-helper.cjs`
**Confidence**: 88%
- Problem: This file now has 37 operations (with `read-sidecar` being the latest addition). It violates SRP — it handles JSON parsing, learning log management, knowledge file writing, manifest reconciliation, sidecar reading, and more. Each operation is independent, but they share a single file, single dispatch, and single error boundary.
- Impact: Maintenance burden. Adding or modifying any operation requires reading/understanding the entire 1800+ line file. Test failures in one operation can mask issues in others.
- Fix: Not blocking for this PR (pre-existing architectural debt). Consider splitting into domain-specific modules in a future refactor: `json-io.cjs` (basic operations), `learning-ops.cjs`, `knowledge-ops.cjs`, `sidecar-ops.cjs`.

## Suggestions (Lower Confidence)

- **`as Record<string, unknown>` type assertion in readSidecar** - `src/cli/commands/kb.ts:34` (Confidence: 65%) -- The assertion bypasses type narrowing. Consider using a Zod schema for boundary validation per project CLAUDE.md principle #9 ("Validate at boundaries -- Parse, don't validate").

- **Shell hook source guards are reactive, not preventive** - `scripts/hooks/background-kb-refresh:13`, `background-learning:15,17,23`, `background-memory-update:21,23` (Confidence: 70%) -- The new `|| { echo ...; exit 1; }` guards are good defensive programming, but the root cause (sourced file missing) would indicate a broken installation. Consider a single validation function at hook entry that checks all required sourced files exist before proceeding.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 1 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Architecture Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR makes several sound architectural improvements: removing `Bash` from the knowledge agent (reducing capability surface), removing the unused `category` field (simplifying the data model), extracting `get-mtime` into a shared helper (DRY), and replacing inline JSON parsing with a structured helper. The main concern is the duplicated sidecar-parsing logic across the TypeScript and CJS layers, which creates a maintenance risk as the sidecar contract evolves. The sidecar handoff pattern itself is well-designed but needs a fallback strategy for when the agent fails to produce sidecar data.
