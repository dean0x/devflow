# Resolution Summary

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28
**Review**: .devflow/docs/reviews/fix-stop-hook-field-rename/2026-05-28_1431
**Command**: /resolve

## Decisions Citations

- applies ADR-007 — batch-1, consist-sidecar-dispatch-dbg (dbg annotations on pre-bootstrap guards)
- applies ADR-007 — batch-2, complex-eval-learning-nesting (no changes to dbg call sites)
- applies ADR-007 — batch-4, doc-claude-md-debug (debug tracing docs added to CLAUDE.md)
- avoids PF-006 — batch-1, doc-sidecar-capture-var-rename (RESPONSE_TEXT → ASSISTANT_MSG)
- avoids PF-006 — batch-3, test-regression-old-field (negative regression test for old field name)
- avoids PF-007 — batch-2, complex-eval-learning-nesting (source files edited, not installed copies)

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 18 |
| Fixed | 18 |
| False Positive | 0 |
| Deferred | 0 |
| Blocked | 0 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| sidecar-capture feedback-loop guards before hook-bootstrap | sidecar-capture:13-16 | 23c8c45 |
| RESPONSE_TEXT → ASSISTANT_MSG variable rename | sidecar-capture:44,52,69-71,77-78,83,85 | 23c8c45 |
| Security comment: never log ASSISTANT_MSG content | sidecar-capture:50-51 | 23c8c45 |
| sidecar-dispatch dbg annotations on feedback-loop guards | sidecar-dispatch:14-16 | 23c8c45 |
| eval-learning deep nesting — extract _learn_write_marker() | eval-learning:91-129 | 870a32a |
| eval-reinforce deep nesting — extract _reinforce_via_jq/_node() | eval-reinforce:28-51 | 870a32a |
| eval-helpers load_existing_ids Node fallback — streaming readline | eval-helpers:53-57 | 870a32a |
| eval-reinforce Node fallback — streaming readline | eval-reinforce:53-77 | 870a32a |
| debug.ts unsafe Record<string,string> → Record<string,unknown> | debug.ts:24 | 4c4e598 |
| Regression test for old response_text field (avoids PF-006) | sentinel.test.ts:129 | 4c4e598 |
| Size guard test lower-bound assertion (>2MB) | shell-hooks.test.ts:169 | 4c4e598 |
| CLAUDE.md missing debug tracing system docs | CLAUDE.md:55,83 | 25fea45 |
| CLAUDE.md sidecar-evaluate decomposition description | CLAUDE.md:45 | 25fea45 |
| CLAUDE.md Phase number inconsistency (12 vs 9) | CLAUDE.md:59,180 | 25fea45 |
| session-start-memory cat → head -c 65536 | session-start-memory:59 | 870a32a |
| pre-compact-memory cat → head -c 65536 | pre-compact-memory:75 | 870a32a |
| session-start-context _build_learned_section() extraction | session-start-context:110-179 | 870a32a |
| sidecar-evaluate orchestrator contract manifest comment | sidecar-evaluate:117 | 870a32a |

## False Positives
(none)

## Deferred to Tech Debt
(none)
