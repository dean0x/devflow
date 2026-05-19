# Regression Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-16

## Issues in Your Changes (BLOCKING)

No blocking regression issues found.

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Feature knowledge index drops `shared/rules/reliability.md` from referencedFiles** - `.features/index.json`
**Confidence**: 82%
- Problem: The diff removes `shared/rules/reliability.md` from the `referencedFiles` array in `.features/index.json` (cli-rules knowledge base). The file still exists on disk at `shared/rules/reliability.md`. This means the staleness detection for the cli-rules knowledge base will no longer track changes to the reliability rule, potentially causing the knowledge base to become stale without triggering a refresh when that file is modified.
- Fix: Re-add `shared/rules/reliability.md` to the `referencedFiles` array in `.features/index.json`. This was likely an accidental artifact of a knowledge base refresh that ran with incomplete file discovery.

## Pre-existing Issues (Not Blocking)

No pre-existing regression issues found.

## Suggestions (Lower Confidence)

- **Decisions manifest reconciliation no longer gated by decisions sentinel** - `scripts/hooks/session-start-context:38-41` (Confidence: 68%) -- In `session-start-context`, decisions manifest reconciliation (line 39-41) runs inside the `.learning-disabled` guard but NOT the `decisions/.disabled` guard. The comment says "still done here even if decisions disabled -- manifest is learning's" which explains the intent. However, this means `reconcile-manifest` for the decisions log still runs when decisions is disabled but learning is enabled. This is intentional per the comment, but worth noting as a subtle behavioral change from the prior code in `session-start-memory` where no sentinel gated this section at all.

- **`resolve-teams.md` Phase 9 annotation says "Write resolution-summary.md" but Phase 5 already writes it** - `plugins/devflow-resolve/commands/resolve-teams.md:288` (Confidence: 62%) -- The teams variant's Phase 9 `**Requires:**` header and description says "Write the resolution summary" but the non-teams variant moved this write to Phase 5. The teams variant still says Phase 9 writes it. This is a pre-existing inconsistency between the two command variants that this PR did not introduce but touched the area.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

### Conditions
1. Restore `shared/rules/reliability.md` to `.features/index.json` referencedFiles (or confirm intentional removal)

### Regression Checklist Assessment

- [x] No exports removed without deprecation
- [x] Return types backward compatible
- [x] Default values unchanged (or documented)
- [x] Side effects preserved (events, logging) -- decisions TL;DR and learned behaviors injection moved to `session-start-context` with identical logic
- [x] All consumers of changed code updated -- `init.ts` registers context hook, `uninstall.ts` removes it (applies ADR-001 clean-break: no migration code needed)
- [x] Migration complete across codebase -- sentinel checks added to all 5 memory hooks + 1 learning hook + 1 decisions scanner
- [x] CLI options preserved or deprecated -- `--enable`/`--disable` for memory and learn commands now also manage sentinels
- [x] Commit message matches implementation
- [x] Breaking changes documented in CLAUDE.md

### Detailed Assessment

**Hook Extraction (session-start-memory -> session-start-context)**: The extraction of Sections 1.4, 1.5, and 1.75 from `session-start-memory` into the new `session-start-context` hook is clean. Line-by-line comparison confirms the logic is preserved verbatim, with the addition of per-section sentinel guards (`decisions/.disabled` for Section 1.5, `.learning-disabled` for Sections 1.4 and 1.75). The `session-start-memory` hook retains only Section 1 (Working Memory) which is correct. No logic was lost in the extraction.

**Sentinel Guard Completeness**: All memory hooks (`prompt-capture-memory`, `stop-update-memory`, `background-memory-update`, `pre-compact-memory`, `session-start-memory`) check `.working-memory-disabled`. The learning hook (`session-end-learning`) checks `.learning-disabled`. The decisions scanner (`decisions-usage-scan.cjs`) checks `decisions/.disabled`. The stop hook's scanner invocation is also gated by the decisions sentinel. This is a complete and consistent implementation.

**Uninstall Coverage**: `uninstall.ts` correctly adds both `removeDecisionsHook()` and `removeContextHook()` to the settings cleanup pipeline (avoids PF-001 -- no unnecessary migration code, just proper hook removal). The context hook is unconditionally removed during uninstall, matching its unconditional addition during init.

**CLI Enable/Disable Sentinel Management**: Both `devflow memory --enable/--disable` and `devflow learn --enable/--disable` now create/remove their respective sentinels alongside the hook registration. The `--status` subcommands warn when a sentinel exists (runtime-disabled state). The early-return restructuring in both commands ensures sentinel management runs regardless of whether the hook was already in the desired state.

**CI Status Gate Pattern Block**: The rename from `<!-- SYNC: ci-status-gate -->` to `<!-- PATTERN: ci-status-gate -->` is applied consistently across all 4 files (implement:orch, resolve:orch, resolve.md, resolve-teams.md). The new test in `ambient.test.ts` (`ci-status-gate PATTERN block is consistent...`) validates steps 2-6 are identical between implement:orch and resolve:orch. The content changes (hardcoded "Phase 8" -> "next phase", "max 10 iterations" -> "global budget, see step 6") improve clarity without changing behavior.

**Test Coverage**: 434 lines of new tests in `sentinel.test.ts` cover all sentinel guard paths. Tests in `memory.test.ts` are updated to reflect the hook split -- decisions TL;DR tests moved to the `session-start-context` test suite. No valuable test assertions were removed; the removed lines are comment/description adjustments.
