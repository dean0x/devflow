# Resolution Summary

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-27
**Review**: .devflow/docs/reviews/fix-stop-hook-field-rename/2026-05-27_1900
**Command**: /resolve

## Decisions Citations

- applies ADR-001 — batch-1, debug.ts clean-break pure-function extraction (no backward compat shim)
- applies ADR-007 — batch-2, debug-trace size guard is the single authoritative locus for tracing reliability
- avoids PF-003 — batch-5, all edits in source files (not installed copies)
- avoids PF-007 — batch-5, edits in scripts/hooks/ source, not ~/.devflow/scripts/hooks/

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 22 |
| Fixed | 15 |
| False Positive | 2 |
| Deferred | 5 |
| Blocked | 0 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| debug.ts breaks pure-function pattern (inline settings mutation) | debug.ts:19-81 | 2a1fcd1 |
| Test file duplicates production logic instead of importing it | debug.test.ts:24-89 | 2a1fcd1 |
| Unsafe as Record<string,string> without value verification | debug.ts:39 | 2a1fcd1 |
| Mutating original rawEnv reference without spreading | debug.ts:39-44 | 2a1fcd1 |
| CLI option processing order differs from conventions | debug.ts:42-77 | 2a1fcd1 |
| Missing malformed settings.json test for disable path | debug.test.ts:269-292 | 2a1fcd1 |
| Phase 2 per-project debug log missing 5MB size guard | debug-trace:46-59 | 83bd685 |
| Size guard wc -c subprocess on every debug invocation | debug-trace:33 | 83bd685 |
| devflow_debug_set_cwd called before CWD validation | sidecar-capture:48 | 40058bf |
| log-paths sourced before MEMORY_ENABLED gate (perf regression) | sidecar-capture:59-62 | 40058bf |
| Feedback-loop guard syntax inconsistency in sidecar-evaluate | sidecar-evaluate:13-15 | 156d4b4 |
| sidecar-dispatch missing dbg exit annotations | sidecar-dispatch:26,36 | 156d4b4 |
| CWD validation strictness varies (sidecar-evaluate) | sidecar-evaluate:29 | 156d4b4 |
| /tmp fallback with predictable filenames (6 hooks) | 6 hooks log init | 298c97f |
| Normal log files have no size bounds (6 hooks) | 6 hooks log init | 298c97f |

## False Positives
| Issue | File:Line | Reasoning |
|-------|-----------|-----------|
| debug.ts TOCTOU on settings.json | debug.ts:25-45 | Pre-existing pattern shared with flags.ts, ambient.ts, hud.ts. Not unique to this PR — all settings-mutating commands have the same read-modify-write cycle. Low practical risk (single-user interactive CLI). |
| New log-paths sourcing added to 4 hooks (perf overhead) | session-start-memory:38, session-start-context:47, pre-compact-memory:41, sidecar-dispatch:45 | Conscious design trade-off for operational observability. These hooks already source json-parse and other helpers with comparable overhead. devflow_log_dir cache mitigates repeated calls. |

## Deferred to Tech Debt
| Issue | File:Line | Risk Factor |
|-------|-----------|-------------|
| Repeated 4-line debug boilerplate across 7 hooks | All 7 hooks | Coupling concern — any init protocol change requires 7 file edits. Deferred from prior cycle. Follow-up refactor PR to add devflow_debug_bootstrap helper. |
| Repeated log() definition pattern across 5 hooks | 5 hooks with logging | Same coupling class as debug boilerplate. A shared devflow_log_init helper would collapse 4 lines to 1 per hook. |
| Dual logging system (dbg + log) message overlap | All hooks | dbg (debug-toggle) and log (always-on) serve distinct purposes. Overlap is real but by design. Deferred from prior cycle. |
| sidecar-evaluate at 496 lines with 7-level nesting | sidecar-evaluate | Pre-existing monolith handling 3 independent features. Warrants decomposition in its own PR. Deferred from prior cycle. |
| sidecar-evaluate EXIT trap handling asymmetry | sidecar-evaluate:177,234-235 | Only reinforcement section uses EXIT trap for lock cleanup; other sections rely on reaching sidecar_lock_release. Mitigated by 30s stale-lock breaker. Pre-existing. |
