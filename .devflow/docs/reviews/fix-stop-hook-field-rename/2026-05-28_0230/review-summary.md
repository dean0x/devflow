# Code Review Summary

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28_0230
**Cycle**: 3 (convergence check)

## Merge Recommendation: CHANGES_REQUESTED

**Rationale**: 5 blocking HIGH issues across consistency, architecture, and performance domains require fixes before merge. All are straightforward corrections to align patterns already established elsewhere in this PR. Convergence is strong — cycle 2 deferred items (hook-bootstrap, hook-log-init DRY extraction) are now complete and correct, but missed the opportunity to complete secondary consistency fixes they enabled.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking | 0 | 5 | 2 | 0 | 7 |
| Should Fix | 0 | 0 | 3 | 0 | 3 |
| Pre-existing | 0 | 0 | 1 | 0 | 1 |

**Convergence Status** (cycle 2→3):
- Cycle 2 fixed: 15 issues ✓ (remaining in code)
- Cycle 3 blocks: 5 issues (new findings from decomposition scope)
- False positive ratio: 2/22 = 9% (cycle 2) → 0/5 = 0% (cycle 3, high confidence)
- No re-raised false positives from cycle 2

---

## Blocking Issues

### HIGH (5 total)

**1. eval-reinforce uses unprefixed variables, breaking naming convention** - `scripts/hooks/eval-reinforce:11-21`
**Confidence**: 92% | **Impact**: Namespace collision risk | **Effort**: 5 min
- **Problem**: eval-learning, eval-decisions, eval-knowledge all use `_LEARN_`, `_DEC_`, `_KNOW_` prefixes. eval-reinforce uses unprefixed uppercase: `LEARNING_LOG`, `LOADED_SLUGS`, `NOW_ISO`, `SLUGS_PATTERN`, `TEMP_LOG`. Since these are sourced into the same shell namespace, risk of collision with future modules.
- **Fix**: Apply `_REINF_` prefix to all 5 variables:
```bash
_REINF_LOG="$LEARNING_DIR/learning-log.jsonl"
_REINF_SLUGS=$(grep -oE ...)
_REINF_NOW_ISO=$(date -u ...)
_REINF_PATTERN=$(echo "$_REINF_SLUGS" | paste ...)
_REINF_TMP="${_REINF_LOG}.tmp.$$"
```
- **Consistency**: Applies ADR-007 — all modules in the same namespace follow identical naming discipline

**2. hook-log-init size guard uses wc subprocess instead of stat** - `scripts/hooks/hook-log-init:31`
**Confidence**: 85% | **Impact**: Performance + consistency | **Effort**: 3 min
- **Problem**: New `_devflow_dbg_size_guard` in debug-trace uses `stat` with fallback (commits 83bd685, 298c97f). hook-log-init (written fresh in this PR) uses `wc -c` directly, forking subprocess on every hook invocation. Inconsistency within the same PR.
- **Fix**: Apply stat cascade from debug-trace:
```bash
_LOG_SIZE=$(stat -f%z "$LOG_FILE" 2>/dev/null) \
  || _LOG_SIZE=$(stat -c%s "$LOG_FILE" 2>/dev/null) \
  || _LOG_SIZE=$(wc -c < "$LOG_FILE" 2>/dev/null) \
  || _LOG_SIZE=0
if [ "${_LOG_SIZE:-0}" -gt 2097152 ]; then
```
- **Flags**: Raised by 3 reviewers (performance, reliability, security) — high confidence

**3. sidecar-evaluate missing dbg annotations on exit guards** - `scripts/hooks/sidecar-evaluate:15-17,24,29`
**Confidence**: 85% | **Impact**: Observability/consistency | **Effort**: 2 min
- **Problem**: sidecar-capture has dbg annotations (cycle 2 fix). sidecar-dispatch was fixed in cycle 2. sidecar-evaluate still uses bare `exit 0` on feedback-loop guards and CWD validation. Inconsistent pattern for global debug toggle (ADR-007).
- **Fix**: Add dbg annotations:
```bash
if [ "${DEVFLOW_BG_UPDATER:-}" = "1" ]; then dbg "EXIT: bg_updater"; exit 0; fi
if [ "${DEVFLOW_BG_LEARNER:-}" = "1" ]; then dbg "EXIT: bg_learner"; exit 0; fi
if [ "${DEVFLOW_BG_KNOWLEDGE_REFRESH:-}" = "1" ]; then dbg "EXIT: bg_knowledge"; exit 0; fi
if [ "$_JSON_AVAILABLE" = "false" ]; then dbg "EXIT: no json"; exit 0; fi
if [ -z "$CWD" ] || [ ! -d "$CWD" ]; then dbg "EXIT: bad CWD"; exit 0; fi
```
- **Note**: Lines 15-17 run before hook-bootstrap (intentional for minimal overhead), so dbg is no-op. Lines 24 and 29 run after bootstrap, so produce real output.

**4. Implicit coupling between eval modules and orchestrator (missing fail-fast guards)** - `scripts/hooks/eval-*.sh:1-11`
**Confidence**: 82% | **Impact**: Silent failure risk | **Effort**: 8 min
- **Problem**: Each eval-* module documents required variables in header comments but lacks `${VAR:?}` fail-fast guards. hook-bootstrap and hook-log-init correctly use these, but eval modules do not. If orchestrator refactoring removes/renames variables, modules fail silently downstream rather than failing fast.
- **Fix**: Add guards at top of each eval module:
```bash
: "${SIDECAR_DIR:?eval-decisions: SIDECAR_DIR must be set by orchestrator}"
: "${DECISIONS_DIR_DATA:?eval-decisions: DECISIONS_DIR_DATA must be set by orchestrator}"
: "${LEARNING_ENABLED:?eval-decisions: LEARNING_ENABLED must be set}"
```
(Pattern from hook-bootstrap, applies ADR-007)

**5. EXIT trap collision between eval-reinforce and eval-learning (trap overwrite in shared process)** - `scripts/hooks/eval-reinforce:20`, `scripts/hooks/eval-learning:70`
**Confidence**: 82% (Reliability) / 92% (Architecture) | **Impact**: Lock release safety | **Effort**: 12 min
- **Problem**: Both modules set `trap '...' EXIT` to release their locks when acquired. These are sourced sequentially into the same shell process (sidecar-evaluate under `set -e`). If eval-reinforce exits with held lock (line 20 trap active) and eval-learning later sets its own EXIT trap (line 70), eval-learning's trap overwrites eval-reinforce's, potentially orphaning the reinforce lock on unexpected exit.
- **Root cause**: Global trap namespace in sourced modules vs. per-module scoping needs
- **Fix Options**:
  - **Option A (subshell isolation)**: Source eval modules in subshells: `(source "$SCRIPT_DIR/eval-learning")` — eliminates trap clobbering but adds 5ms/module fork overhead
  - **Option B (helper function)**: Extract lock release + trap clear into shared helper in eval-helpers, called from both normal and EXIT paths:
```bash
_eval_release_lock() {
  local lock_dir="$1"
  sidecar_lock_release "$lock_dir"
  trap - EXIT
}
```
  - **Option C (documented invariant)**: Document strict ordering constraint: each module must pair `trap ... EXIT` with explicit `trap - EXIT` before returning, and note that lines 20 and 70 represent different lock contexts that will collide if the second fires between the first's set and its clear.
- **Recommendation**: Option B (helper) is safest and lowest overhead. Adds 3 lines to eval-helpers, saves complexity in orchestrator.
- **Applies ADR-007** (single shared namespace means explicit guards)

### MEDIUM (2 total)

**1. Feedback-loop guard ordering differs between sidecar-evaluate and sidecar-capture/dispatch** - `scripts/hooks/sidecar-evaluate:15-17`
**Confidence**: 82% | **Impact**: Code review friction | **Effort**: 1 min
- **Problem**: sidecar-capture and sidecar-dispatch order guards as: UPDATER, LEARNER, KNOWLEDGE. sidecar-evaluate orders them as: LEARNER, UPDATER, KNOWLEDGE. Functionally identical but inconsistent, making diff review harder.
- **Fix**: Reorder sidecar-evaluate to match the other two:
```bash
if [ "${DEVFLOW_BG_UPDATER:-}" = "1" ]; then dbg "EXIT: bg_updater"; exit 0; fi
if [ "${DEVFLOW_BG_LEARNER:-}" = "1" ]; then dbg "EXIT: bg_learner"; exit 0; fi
if [ "${DEVFLOW_BG_KNOWLEDGE_REFRESH:-}" = "1" ]; then dbg "EXIT: bg_knowledge"; exit 0; fi
```

**2. Misleading test name contradicts test body** - `tests/debug.test.ts:166`
**Confidence**: 85% | **Impact**: Test clarity | **Effort**: 1 min
- **Problem**: Test named "disable from missing file -- no-op (no file written)" but calls `fs.writeFile()`. Name claims "no file written" while code writes one.
- **Fix**: Rename to reflect actual assertion:
```typescript
it('disable from missing file -- stripDebugTrace({}) produces no env key', async () => {
```

### LOW (0 blocking)

---

## Should-Fix Issues

### MEDIUM (3 total)

**1. CWD validation strictness varies: 3 hooks check only `-z` while 4 check `-z || ! -d`** - `scripts/hooks/session-start-memory:23`, `scripts/hooks/session-start-context:28`, `scripts/hooks/pre-compact-memory:26`
**Confidence**: 80% | **Category**: Should Fix | **Effort**: 3 min
- **Problem**: sidecar-capture, sidecar-dispatch, sidecar-evaluate all validate `[ -z "$CWD" ] || [ ! -d "$CWD" ]`. But session-start-memory, session-start-context, pre-compact-memory only check `[ -z "$CWD" ]`. No directory existence test. Inconsistent robustness.
- **Fix**: Standardize all to stricter pattern:
```bash
if [ -z "$CWD" ] || [ ! -d "$CWD" ]; then
  dbg "EXIT: bad CWD"
  exit 0
fi
```

**2. readDebugStatus missing malformed JSON test** - `tests/debug.test.ts:92`
**Confidence**: 82% | **Category**: Should Fix | **Effort**: 3 min
- **Problem**: applyDebugTrace and stripDebugTrace both have malformed JSON tests, but readDebugStatus does not. The three functions are presented as a parallel set (applies ADR-007) yet one lacks the error-path test.
- **Fix**: Add test:
```typescript
it('throws on malformed JSON', () => {
  expect(() => readDebugStatus('not json')).toThrow(SyntaxError);
});
```

**3. load_existing_ids() has zero test coverage** - `scripts/hooks/eval-helpers:41-58`
**Confidence**: 80% | **Category**: Should Fix | **Effort**: 15 min
- **Problem**: New eval-helpers exports three functions. First two have dedicated tests. load_existing_ids (jq + node fallback branches, handles missing/empty/malformed JSONL) has no tests. Critical data-integrity function used by eval-learning and eval-decisions.
- **Fix**: Add 3-case tests (missing file, valid JSONL, empty file)

---

## Pre-existing Issues

### MEDIUM (1 total)

**Node fallback in load_existing_ids slurps entire file into memory** - `scripts/hooks/eval-helpers:51-56`
**Confidence**: 80% | **Impact**: Unbounded allocation | **Severity**: Low (files typically <100 lines)
- **Problem**: jq path streams line-by-line (safe). Node fallback uses `readFileSync` to load entire file, then parses each line. Unbounded allocation for large JSONL.
- **Applies ADR-007**: Code was extracted from monolith, but all hooks now use it.
- **Fix**: Use Node readline or cap file size before slurping. Low urgency given file size constraints elsewhere.

---

## Convergence Analysis

### Cycle 2 → Cycle 3

**Deferred items from cycle 2 that are now complete:**
- `devflow_debug_bootstrap` helper (4-line debug boilerplate): ✓ Delivered as `hook-bootstrap` (extracted pattern)
- `devflow_log_init` helper (log() definition): ✓ Delivered as `hook-log-init` (extracted pattern)
- Sidecar-evaluate decomposition (496-line monolith): ✓ Delivered (5 focused eval-* modules)
- CWD ordering fix in sidecar-capture: ✓ Fixed in commit 40058bf (phase 2 called before validation)

**New convergence issues (secondary alignment opportunities missed):**
- **eval-reinforce naming**: Deferred boilerplate DRY now complete, but eval module names inconsistent
- **hook-log-init size guard**: Both new helpers extracted, but inconsistent patterns (stat vs wc)
- **sidecar-evaluate guards**: Other hooks fixed for consistency, this one missed
- **eval module guards**: helper-bootstrap/log-init added fail-fast guards, eval modules still lack them

**False positive ratio improving:**
- Cycle 2: 2/22 = 9% FP
- Cycle 3: 0/5 = 0% FP (all issues confirmed HIGH across ≥2 reviewers)

---

## Risk Assessment

| Risk | Mitigation | Residual |
|------|------------|----------|
| Variable namespace collision (eval-reinforce unprefixed) | Apply _REINF_ prefix, add ${VAR:?} guards to all eval-* | LOW |
| Silent failures on orchestrator refactoring | Add ${VAR:?} fail-fast guards to all eval-* modules | LOW |
| EXIT trap clobbering between eval modules | Implement lock-release helper or subshell isolation | LOW (trap works in happy path, risk is maintenance) |
| Inconsistent size guard performance | Apply stat cascade to hook-log-init (already proven in debug-trace) | LOW |
| Test asymmetry (readDebugStatus) | Add malformed JSON test case | LOW |
| Observability gaps (missing dbg annotations) | Add 5 annotations to sidecar-evaluate guards | LOW |

---

## Action Plan

**Priority 1 (Consistency + Critical Path):**
1. Add _REINF_ prefix to 5 variables in eval-reinforce
2. Apply stat cascade to hook-log-init size guard
3. Add dbg annotations to sidecar-evaluate guards (3 fixes: feedback-loop, JSON check, CWD)

**Priority 2 (Safety):**
4. Add ${VAR:?} fail-fast guards to eval-learning, eval-decisions, eval-knowledge, eval-reinforce
5. Implement lock-release helper in eval-helpers + update eval-reinforce/eval-learning to use it

**Priority 3 (Alignment):**
6. Reorder feedback-loop guards in sidecar-evaluate (UPDATER first)
7. Standardize CWD validation in session-start-* hooks

**Priority 4 (Test Coverage):**
8. Add readDebugStatus malformed JSON test
9. Add load_existing_ids test cases
10. Rename misleading debug.test.ts test

---

## Quality Scores

| Domain | Score | Notes |
|--------|-------|-------|
| Architecture | 7/10 | Strong decomposition, but implicit coupling and trap collision need guards |
| Testing | 8/10 | Good pure function extraction, missing edge case coverage |
| Performance | 8/10 | Positive refactor with one consistency gap (wc vs stat) |
| Reliability | 8/10 | Improved overall, trap pairing needs documentation or helper |
| Regression | 9/10 | Excellent decomposition fidelity, no behavioral regressions |
| TypeScript | 9/10 | Clean pure function pattern, proper type guards |
| Security | 8/10 | Good patterns preserved, one TOCTOU consistency fix |
| Complexity | 7/10 | 7-level nesting preserved from monolith (deferred opportunity) |
| Consistency | 7/10 | DRY extraction successful, secondary alignment gaps |

**Overall**: **7.8/10**

---

## Next Steps

1. Implement 10 fixes above (estimated 45 min work)
2. Re-run cycle 4 review to confirm convergence (expect 0-2 remaining issues)
3. Merge on approval

All fixes are straightforward pattern applications already established elsewhere in the codebase. No architectural changes required.
