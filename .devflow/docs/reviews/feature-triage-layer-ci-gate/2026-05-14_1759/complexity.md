# Complexity Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

(No blocking complexity issues found.)

## Issues in Code You Touched (Should Fix)

### MEDIUM

**CI Status Gate duplicated across 4 files without extraction** - `shared/skills/implement:orch/SKILL.md:155`, `shared/skills/resolve:orch/SKILL.md:115`, `plugins/devflow-resolve/commands/resolve.md:203`, `plugins/devflow-resolve/commands/resolve-teams.md:250`
**Confidence**: 82%
- Problem: The CI Status Gate block (6 numbered steps, ~10 lines of identical specification) is now copy-pasted verbatim across 4 files. The `<!-- SYNC: ci-status-gate -->` markers were added in this PR, which indicates awareness of the duplication, but the SYNC markers are passive documentation — they do not enforce consistency. Any future change to the gate logic requires updating 4 files in lockstep. This is a maintainability risk (the exact scenario that caused this PR's phase-number corrections in the first place).
- Fix: Consider extracting the CI Status Gate specification into a shared reference (e.g., `shared/skills/ci-status-gate/reference.md` or a section in an existing shared skill) and referencing it from each orchestration skill. The SYNC markers are a reasonable stopgap for now, but the pattern of "duplicate then mark for sync" adds maintenance complexity that grows with each new consumer. If a shared reference is not feasible for markdown-based skill files, at minimum document the SYNC contract (which files participate, who owns updates) in a single canonical location.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Resolve command files (resolve.md, resolve-teams.md) are large multi-phase orchestration documents** - `plugins/devflow-resolve/commands/resolve.md`, `plugins/devflow-resolve/commands/resolve-teams.md`
**Confidence**: 80%
- Problem: These files describe 10-phase orchestration flows (Phase 0 through Phase 9) with sub-steps, agent spawn templates, edge case tables, architecture diagrams, and output artifact templates — all in single documents. While the changes in this PR are limited to phase number corrections and adding the CI gate, these files are structurally complex (300+ lines each with deeply nested sections). This is a known characteristic of orchestration command specifications and is partially mitigated by the phase-based structure, but it contributes to the phase-numbering drift that this PR fixes.
- Fix: Informational only. The phase-based structure provides reasonable readability. The SYNC markers added in this PR are a positive step toward managing the cross-file consistency challenge.

## Suggestions (Lower Confidence)

- **Phase numbering drift risk from manual cross-references** - `shared/skills/implement:orch/SKILL.md:226`, `shared/skills/pipeline:orch/SKILL.md:35` (Confidence: 70%) — Multiple files contain prose references to phase numbers in other files (e.g., "implement:orch Phase 8 normally removes it"). These are fragile: any future phase insertion will cause the same drift this PR fixes. Consider using phase names instead of numbers in cross-references (e.g., "implement:orch Completion phase" instead of "implement:orch Phase 8").

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 1 | 0 |

**Complexity Score**: 8/10
**Recommendation**: APPROVED

The changes in this PR are straightforward: phase number corrections after CI Status Gate insertion, format updates (INTENT/DEPTH to parenthetical), classification pattern cleanup, and a negative test addition. The cyclomatic complexity of the actual code change (tests/integration/helpers.ts) is minimal — removing one alternation from a regex. The markdown specification changes are mechanical find-and-replace of phase numbers and format strings. The one should-fix item (CI gate duplication with SYNC markers) is a reasonable pattern for the current scale but worth tracking. The negative test for old INTENT/DEPTH format (applies ADR-001 clean break philosophy) is a good complexity-reducing practice — explicitly rejecting deprecated formats prevents ambiguous pattern matching.
