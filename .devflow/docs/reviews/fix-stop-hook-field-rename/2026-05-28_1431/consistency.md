# Consistency Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28

## Issues in Your Changes (BLOCKING)

### MEDIUM

**sidecar-dispatch feedback-loop guards lack dbg annotations** - `scripts/hooks/sidecar-dispatch:14-16`
**Confidence**: 90%
- Problem: sidecar-dispatch's three feedback-loop guards (`DEVFLOW_BG_UPDATER`, `DEVFLOW_BG_LEARNER`, `DEVFLOW_BG_KNOWLEDGE_REFRESH`) use bare `exit 0` without `dbg "EXIT: bg_*"` annotations. Both sidecar-capture (lines 19-21) and sidecar-evaluate (lines 17-19) annotate these same guards with `dbg "EXIT: bg_updater"`, `dbg "EXIT: bg_learner"`, `dbg "EXIT: bg_knowledge"`. The comment on line 15-16 of sidecar-evaluate explicitly documents this as a consistency pattern: "dbg() is the pre-bootstrap no-op here; annotations are safe but silent without debug active." applies ADR-007
- Fix: Add dbg annotations to match sidecar-capture and sidecar-evaluate:
```bash
# Before (sidecar-dispatch:14-16)
if [ "${DEVFLOW_BG_UPDATER:-}" = "1" ]; then exit 0; fi
if [ "${DEVFLOW_BG_LEARNER:-}" = "1" ]; then exit 0; fi
if [ "${DEVFLOW_BG_KNOWLEDGE_REFRESH:-}" = "1" ]; then exit 0; fi

# After
if [ "${DEVFLOW_BG_UPDATER:-}" = "1" ]; then dbg "EXIT: bg_updater"; exit 0; fi
if [ "${DEVFLOW_BG_LEARNER:-}" = "1" ]; then dbg "EXIT: bg_learner"; exit 0; fi
if [ "${DEVFLOW_BG_KNOWLEDGE_REFRESH:-}" = "1" ]; then dbg "EXIT: bg_knowledge"; exit 0; fi
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

(none)

## Suggestions (Lower Confidence)

(none)

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 1 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 9/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The PR demonstrates excellent consistency overall. The hook infrastructure introduced in this PR is highly uniform: all 7 hooks follow the same `dbg() { :; }` -> `set -e` -> `SCRIPT_DIR` -> `hook-bootstrap` -> `hook-log-init` -> `dbg "=== HOOK COMPLETE ==="` skeleton. The extracted `eval-*` modules consistently use `_PREFIX_` variable namespaces (`_REINF_`, `_LEARN_`, `_DEC_`, `_KNOW_`), fail-fast `VAR:?` guards naming the module and variable, and the shared `_eval_release_lock()` EXIT trap pattern. CWD validation (`[ -z "$CWD" ] || [ ! -d "$CWD" ]`) is now uniform across all 7 hooks. Guard ordering (UPDATER/LEARNER/KNOWLEDGE) is consistent across all three sidecar hooks. The `debug.ts` CLI command follows the `applyFlags`/`stripFlags` pure function pattern from `flags.ts` and matches the `status -> enable -> disable` option processing order from `learn.ts` and `decisions.ts`. The single finding is a minor dbg annotation gap in sidecar-dispatch's pre-bootstrap feedback-loop guards. All prior cycle-3 resolution fixes (prefix namespace, guard ordering, CWD validation, dbg annotations) have been verified as correctly applied and are not re-raised. avoids PF-006
