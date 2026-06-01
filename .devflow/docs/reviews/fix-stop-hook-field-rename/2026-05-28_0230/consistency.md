# Consistency Review Report

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28

## Issues in Your Changes (BLOCKING)

### HIGH

**eval-reinforce uses unprefixed variable names unlike the other 3 eval modules** - `scripts/hooks/eval-reinforce:11,14,17,18,21`
**Confidence**: 92%
- Problem: The PR description states "Variable naming: eval modules use prefixed names (`_LEARN_`, `_DEC_`, `_KNOW_`)." This is true for eval-learning, eval-decisions, and eval-knowledge, but eval-reinforce uses unprefixed uppercase names: `LEARNING_LOG`, `LOADED_SLUGS`, `NOW_ISO`, `SLUGS_PATTERN`, `TEMP_LOG`. These are sourced into the sidecar-evaluate orchestrator's shell namespace and risk colliding with orchestrator-level variables or future eval modules.
- Fix: Prefix eval-reinforce's local variables with `_REINF_` (or similar) consistent with the convention established in the other three modules:
```bash
# eval-reinforce:11
_REINF_LOG="$LEARNING_DIR/learning-log.jsonl"
# eval-reinforce:14
_REINF_SLUGS=$(grep -oE ...)
# eval-reinforce:17
_REINF_NOW_ISO=$(date -u ...)
# eval-reinforce:18
_REINF_PATTERN=$(echo "$_REINF_SLUGS" | paste ...)
# eval-reinforce:21
_REINF_TMP="${_REINF_LOG}.tmp.$$"
```

**sidecar-evaluate feedback-loop guards and CWD check lack dbg annotations (inconsistent with sidecar-capture and sidecar-dispatch)** - `scripts/hooks/sidecar-evaluate:15-17,24,29`
**Confidence**: 85%
- Problem: The prior resolution cycle explicitly fixed this for sidecar-dispatch. Now sidecar-capture has `dbg "EXIT: bg_updater"` etc. on its guards, and sidecar-dispatch was noted as fixed in cycle 2. But sidecar-evaluate still uses bare `exit 0` without any dbg annotation on its feedback-loop guards (lines 15-17), the `_JSON_AVAILABLE` check (line 24), and the CWD validation (line 29). This is inconsistent with the pattern established in the other two sidecar hooks. Applies ADR-007 (single global debug toggle covering all hooks -- annotations are how hooks contribute visibility).
- Fix: Add dbg annotations to match sidecar-capture's pattern:
```bash
# line 15-17
if [ "${DEVFLOW_BG_LEARNER:-}" = "1" ]; then dbg "EXIT: bg_learner"; exit 0; fi
if [ "${DEVFLOW_BG_UPDATER:-}" = "1" ]; then dbg "EXIT: bg_updater"; exit 0; fi
if [ "${DEVFLOW_BG_KNOWLEDGE_REFRESH:-}" = "1" ]; then dbg "EXIT: bg_knowledge"; exit 0; fi
# line 24
if [ "$_JSON_AVAILABLE" = "false" ]; then dbg "EXIT: no json"; exit 0; fi
# line 29
if [ -z "$CWD" ] || [ ! -d "$CWD" ]; then dbg "EXIT: bad CWD"; exit 0; fi
```
Note: sidecar-evaluate's guards run before hook-bootstrap (intentionally, to minimize overhead), so dbg is still the no-op at that point. However, the `_JSON_AVAILABLE` and CWD checks on lines 24 and 29 run after hook-bootstrap, so those would produce real output.

### MEDIUM

**Feedback-loop guard ordering inconsistency between sidecar-evaluate and the other two sidecar hooks** - `scripts/hooks/sidecar-evaluate:15-17`
**Confidence**: 82%
- Problem: sidecar-capture and sidecar-dispatch both order their guards as: UPDATER, LEARNER, KNOWLEDGE_REFRESH. sidecar-evaluate orders them as: LEARNER, UPDATER, KNOWLEDGE_REFRESH. While functionally equivalent, this gratuitous ordering difference makes diff comparison harder and violates the PR's stated goal of identical patterns across hooks.
- Fix: Reorder sidecar-evaluate lines 15-17 to match sidecar-capture/sidecar-dispatch:
```bash
if [ "${DEVFLOW_BG_UPDATER:-}" = "1" ]; then exit 0; fi
if [ "${DEVFLOW_BG_LEARNER:-}" = "1" ]; then exit 0; fi
if [ "${DEVFLOW_BG_KNOWLEDGE_REFRESH:-}" = "1" ]; then exit 0; fi
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**CWD validation strictness varies across hooks: 3 hooks check only `-z` while 4 check `-z || ! -d`** - `scripts/hooks/session-start-memory:23`, `scripts/hooks/session-start-context:28`, `scripts/hooks/pre-compact-memory:26`
**Confidence**: 80%
- Problem: sidecar-capture, sidecar-dispatch, sidecar-evaluate, and preamble all validate CWD with `[ -z "$CWD" ] || [ ! -d "$CWD" ]`. However, session-start-memory, session-start-context, and pre-compact-memory only check `[ -z "$CWD" ]` without the directory existence check. The prior resolution cycle noted this was fixed, but these three hooks still use the weaker pattern. While the PR's hook-bootstrap and hook-log-init refactoring touched these files, the CWD validation was not standardized.
- Fix: Standardize all hooks to use the stricter pattern:
```bash
if [ -z "$CWD" ] || [ ! -d "$CWD" ]; then
  dbg "EXIT: bad CWD"
  exit 0
fi
```

## Pre-existing Issues (Not Blocking)

_No critical pre-existing issues detected._

## Suggestions (Lower Confidence)

- **hook-log-init uses `wc -c` for size guard while debug-trace uses `stat` via `_devflow_dbg_size_guard`** - `scripts/hooks/hook-log-init:31` (Confidence: 70%) -- Two size guard implementations exist side by side: `_devflow_dbg_size_guard` (extracted in this PR) uses `stat -f%z`/`stat -c%s` with `wc -c` fallback, while hook-log-init uses `wc -c` directly. Consider whether hook-log-init should reuse `_devflow_dbg_size_guard` for consistency, or document why the simpler approach is acceptable here (different thresholds: 2MB vs 5MB).

- **applyDebugTrace mutates the parsed object in-place before serializing** - `src/cli/commands/debug.ts:22-25` (Confidence: 65%) -- The JSDoc says "Does not mutate" (referring to the input string), but internally it parses, mutates the intermediate object, then re-serializes. The `applyFlags` function in flags.ts follows the same pattern, so this is consistent within the codebase. However, if the project ever passes pre-parsed objects, the mutation-within-function pattern would need revisiting.

- **sidecar-dispatch feedback-loop guards exit without dbg (same as sidecar-evaluate)** - `scripts/hooks/sidecar-dispatch:14-16` (Confidence: 65%) -- These guards run before hook-bootstrap, so `dbg` is the no-op fallback. sidecar-capture places its guards after hook-bootstrap and includes dbg annotations. The difference is intentional (minimizing background session overhead) but could be documented with a comment.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 1 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The DRY extraction is well-executed overall. The hook-bootstrap and hook-log-init patterns achieve the PR's stated consistency goal for 6 of the 7 hooks. The two blocking issues are (1) eval-reinforce breaking the prefix naming convention established by the other three eval modules, and (2) sidecar-evaluate's exit points missing the dbg annotations that were explicitly standardized in the other two sidecar hooks during cycle 2. The guard ordering inconsistency is minor but easy to fix alongside the others.
