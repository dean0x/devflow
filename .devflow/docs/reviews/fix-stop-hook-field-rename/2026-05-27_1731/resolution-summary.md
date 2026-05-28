# Resolution Summary

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27
**Review**: .devflow/docs/reviews/fix-stop-hook-field-rename/2026-05-27_1731
**Command**: /resolve

## Decisions Citations

- applies ADR-001 — batch-1-shell-hooks, log-paths soft-fail unification (clean break from hard-fail pattern)
- avoids PF-003 — batch-1-shell-hooks, hook code updated in source (users pick up via devflow init)

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 20 |
| Fixed | 10 |
| False Positive | 6 |
| Deferred | 2 |
| Blocked | 0 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| Debug log directory missing chmod 700 | debug-trace:29,42-43 | 22186e1 |
| sidecar-capture log() missing error suppression | sidecar-capture:61 | 22186e1 |
| Unguarded $() in dbg forks subprocesses when debug OFF (4 sites) | session-start-context:142, sidecar-dispatch:149,157, sidecar-evaluate:463 | 22186e1 |
| Missing dbg HOOK COMPLETE bookend in preamble | preamble:44 | 22186e1 |
| Unbounded debug log growth (no rotation) | debug-trace:31-33 | 22186e1 |
| Inconsistent log-paths hard-fail vs soft-fail | sidecar-capture:59, sidecar-evaluate:56 | 22186e1 |
| Inconsistent LOG_FILE path computation (one-step vs two-step) | sidecar-capture:60-61 | 22186e1 |
| debug.ts JSON.parse conflates ENOENT with corruption | debug.ts:27 | 34c6065 |
| debug.ts unsafe type assertion on settings.env | debug.ts:32 | 34c6065 |
| No tests for debug-trace, debug CLI, stop_reason regression, log creation | tests/*.ts | ec11b20 |

## False Positives
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| Missing dbg on feedback-loop exits in dispatch/evaluate | sidecar-dispatch:14-16, sidecar-evaluate:13-15 | Guards run before devflow_debug_init; dbg would always be the no-op fallback. Ordering is intentional for minimal bg subagent overhead. |
| sidecar-dispatch logs CWD before devflow_debug_set_cwd | sidecar-dispatch:34 | Message goes to Phase 1 global log, which is correct. Reordering requires restructuring guard flow for negligible value. |
| Missing normal log() in preamble | preamble | Intentionally minimal by design. Plan explicitly documents "No normal logging." |
| Dual logging systems (dbg + log) | All hooks | dbg (debug-toggle, troubleshooting) and log (always-on, operational) serve distinct purposes. By design. |
| Normal logging adds unconditional date forks | 4 new hooks | ~10-15ms overhead acceptable for always-on operational diagnostics. Consistent with existing pattern. |
| log-paths sourced earlier adds overhead | sidecar-capture:59 | Intentional trade-off: log() must be available for decisions scanner section. Documented in code comment. |

## Deferred to Tech Debt
| Issue | File:Line | Risk Factor |
|-------|-----------|-------------|
| Repetitive debug boilerplate across 7 hooks | All 7 hooks | An init-hook helper would reduce 4-line ceremony but introduces coupling. Follow-up refactor PR. |
| sidecar-evaluate at 496 lines with 7-level nesting | sidecar-evaluate | Pre-existing complexity exacerbated by debug lines. Warrants decomposition in its own PR. |
