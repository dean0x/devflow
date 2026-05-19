# Resolution Summary

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-14_1424
**Review**: .docs/reviews/feature-triage-layer-ci-gate/2026-05-14_1424
**Command**: /resolve

## Decisions Citations

- applies ADR-001 — batch-3, testing:negative-format (clean break: explicitly verify old format is rejected)

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 15 |
| Fixed | 13 |
| False Positive | 2 |
| Deferred | 0 |
| Blocked | 0 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| Phase 8→9 stale ref (Decisions Citations) | resolve-teams.md:231 | 7af0dfa |
| Phase 8→9 stale ref (Output Artifact) | resolve-teams.md:383 | 7af0dfa |
| Phase 8→9 stale ref (write timing) | resolve.md:184 | 7af0dfa |
| Phase 7→8 stale ref (OVERLAPPING_SLUGS) | implement:orch/SKILL.md:223 | 7af0dfa |
| Phases 1-7→1-9 (implement:orch ref) | pipeline:orch/SKILL.md:35 | 7af0dfa |
| Phase 7→8 (Completion ref) | pipeline:orch/SKILL.md:39 | 7af0dfa |
| Phases 1-7→1-8 (resolve:orch ref) | pipeline:orch/SKILL.md:78 | 7af0dfa |
| PIPELINE/ORCHESTRATED→PIPELINE format | pipeline:orch/SKILL.md:27 | 7af0dfa |
| Old INTENT/DEPTH→INTENT (DEPTH) format (10 occurrences) | test-driven-development/SKILL.md:154,193-201 | 7af0dfa |
| IMPLEMENT/ORCHESTRATED→IMPLEMENT (ORCHESTRATED) | plan:orch/SKILL.md:251 | 7af0dfa |
| FAILING masks PENDING — reordered classification priority | git.md:292 | 7af0dfa |
| Unbounded CI polling — added total budget (4 files) | implement:orch, resolve:orch, resolve.md, resolve-teams.md | 7af0dfa |
| CI gate SYNC markers (4 files) | implement:orch, resolve:orch, resolve.md, resolve-teams.md | 7af0dfa |
| Dead CHAT in CLASSIFICATION_PATTERN | helpers.ts:5 | 4ccf0b0 |
| Negative test for old INTENT/DEPTH format | ambient.test.ts:403 | 4ccf0b0 |

## False Positives
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| Shell injection via unvalidated issue number | implement:triage/SKILL.md:23 | Triage skills are prompt instructions, not scripts. `gh` CLI rejects non-integer arguments. Model-level instruction, not executable code path. |
| CI Coder bypasses quality gates | implement:orch/SKILL.md:162, resolve:orch/SKILL.md:126 | Accepted as intentional. CI fixes are typically minor mechanical changes (missing import, lint fix). Re-running full Simplifier + Scrutinizer pipeline for these changes is cost-prohibitive and disproportionate to risk. |

## Deferred to Tech Debt
(none)

## Blocked
(none)
