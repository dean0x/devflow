# Architecture Review Report

**Branch**: feat/pr-description-pipeline -> main
**Date**: 2026-05-08
**PR**: #206 — fix(decisions): update --review to deprecate in rendered markdown

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

(none)

## Architectural Assessment

This PR makes four well-scoped changes across four files. Each change is architecturally sound.

### 1. `tryImmediatePromotion` Unification (json-helper.cjs)

The inline promotion block in the `process-observations` existing-entry path was structurally identical to the standalone `tryImmediatePromotion` function, differing only in two guards (`status !== 'created'` and epoch-0 fallback for `first_seen`). The PR extends `tryImmediatePromotion` with two opt-in boolean parameters (`guardCreated`, `firstSeenFallback`) that both default to `false`, preserving the original contract for new-entry callers while enabling the existing-entry path to share the same code.

This is a textbook DRY improvement. The options-object pattern with safe defaults ensures OCP compliance — new callers get original behavior; existing-entry callers opt into the guards they need. No coupling is introduced; the function remains self-contained with no new imports or dependencies.

### 2. `clearCapacityNotifications` Extraction (decisions.ts)

Notification clearing logic was previously inlined in the capacity review handler, making it untestable without spawning `json-helper.cjs` child processes. The PR extracts it into a pure function that takes pre-computed counts and the notifications map. The handler gathers counts first, then delegates to the extracted function. This follows DIP: the function depends on data (counts), not on infrastructure (child processes).

The extracted function accepts a configurable `threshold` parameter (default 50), which is good ISP practice even if only the default is used today. The function mutates in place and the caller writes atomically — this separation matches the existing pattern in the codebase (gather data, transform, write).

### 3. Type Hardening (decisions.ts)

`DecisionsEntryStatus` is introduced as a union type (`'Accepted' | 'Active' | 'Deprecated' | 'Superseded' | 'Unknown'`), replacing the previous untyped `string` on `DecisionsEntry.status`. A `toDecisionsStatus` normalizer uses a `Set`-based lookup for O(1) validation, falling back to `'Unknown'` for unrecognized values. The `file` field is similarly narrowed from `string` to `'decisions' | 'pitfalls'`.

This is proper boundary validation at the parse site (decisions.ts ~line 812) — data is normalized the moment it enters the typed domain. Downstream code can rely on the union without defensive checks. `applies ADR-001` — no migration or backward-compat layer is added; raw strings from markdown are simply normalized at the parse boundary.

### 4. Lock Error Discrimination (learn.ts)

`acquireMkdirLock` previously caught all `mkdir` errors and treated them as "lock held." The fix narrows the catch to only swallow `EEXIST` (the expected "lock held" signal), re-throwing unexpected filesystem errors (ENOSPC, EACCES, etc.). The release-side `rmdir` in decisions.ts is correctly left as a bare `try/catch` with an explanatory comment — hardening belongs on the acquire side only.

This is a targeted improvement to error-handling transparency without changing the function's contract or signature.

### Tests

Tests for `clearCapacityNotifications` now call the extracted function directly instead of duplicating the inline logic. The capacity mode status filter test adds a NOTE comment explaining why the inline `!== 'Deprecated'` filter remains inline (it mirrors a distinct pre-filter step in the parser, not the same logic as `filterEligibleEntries`). This is appropriate — not every one-liner warrants extraction.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Architecture Score**: 9/10
**Recommendation**: APPROVED

All four changes follow sound architectural principles: DRY unification via options-object pattern, testability-driven extraction, parse-boundary type narrowing, and targeted error-handling improvement. No SOLID violations, no coupling introduced, no layering concerns. The changes are minimal, focused, and consistent with the existing codebase conventions.
