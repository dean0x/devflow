# Code Review Summary

**Branch**: fix/stop-hook-field-rename -> main
**Date**: 2026-05-28
**Review Cycle**: 4 of 10 (convergence mode — prior cycles fixed 10 issues with zero false positives)

## Merge Recommendation: CHANGES_REQUESTED

Multiple blocking and should-fix issues must be resolved before merge. The core architecture is sound, but specific issues in guard ordering, nesting depth, type safety, and test coverage need fixes.

---

## Decisions Citations

- applies ADR-007 — debug tracing system, single global toggle pattern
- applies ADR-007 — eval-* module namespace isolation with `_PREFIX_` guards
- applies ADR-007 — hook-bootstrap and hook-log-init shared helpers
- avoids PF-006 — field rename (response_text → last_assistant_message) completed; stop_reason filter removed
- avoids PF-006 — internal shell variable rename (RESPONSE_TEXT → ASSISTANT_MSG recommended)
- applies ADR-007 — _eval_release_lock() shared EXIT trap helper

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking | 0 | 4 | 3 | 0 | **7** |
| Should Fix | 0 | 0 | 3 | 0 | **3** |
| Pre-existing | 0 | 0 | 2 | 0 | **2** |

**Total Issues**: 12
**Prior Cycle Status**: 10 fixed, 1 deferred, 0 false positives
**False Positive Rate (Cycle 3→4)**: 0% (no issues re-raised)

---

## Blocking Issues (Must Fix)

### COMPLEXITY: HIGH — Deep nesting in eval-learning (6+ levels)
**File**: `scripts/hooks/eval-learning:91-129`
**Confidence**: 85%
**Impact**: Exceeds 5-level nesting threshold; batch-trigger code path reaches 6-9 levels

Extract inner batch-trigger logic into a helper function `_learn_write_marker()` to bring main flow to 4 levels:

```bash
_learn_write_marker() {
  local filter_lib="$1" transcript="$2" learning_dir="$3"
  _LEARN_USER_SIGNALS=""
  if [ -f "$filter_lib" ] && [ -n "$transcript" ] && [ -f "$transcript" ]; then
    _LEARN_USER_SIGNALS=$(node "$filter_lib" user-signals "$transcript" 2>/dev/null || true)
  fi
  [ -z "$_LEARN_USER_SIGNALS" ] && return 1
  _LEARN_EXISTING_IDS=$(load_existing_ids "$learning_dir/learning-log.jsonl")
  # ... marker write logic ...
}
```

### COMPLEXITY: HIGH — Deep nesting in eval-reinforce (5-7 levels)
**File**: `scripts/hooks/eval-reinforce:28-51`
**Confidence**: 82%
**Impact**: jq/node dual-path logic reaches depth 7; inline JavaScript compounds cognitive load

Extract jq-path and node-path into separate helpers:

```bash
_reinforce_via_jq() { ... }
_reinforce_via_node() { ... }

if [ "$_HAS_JQ" = "true" ]; then
  _reinforce_via_jq "$_REINF_LEARNING_LOG" "$_REINF_SLUGS_PATTERN" "$_REINF_NOW_ISO" "$_REINF_TEMP_LOG"
else
  _reinforce_via_node "$_REINF_LEARNING_LOG" "$_REINF_SLUGS_PATTERN" "$_REINF_NOW_ISO"
fi
```

### PERFORMANCE: HIGH — sidecar-capture feedback-loop guards placed after hook-bootstrap
**File**: `scripts/hooks/sidecar-capture:16-21`
**Confidence**: 92%
**Impact**: Stop hook fires on every turn; background sessions pay 5-10ms bootstrap overhead before exiting

Move feedback-loop guards BEFORE `hook-bootstrap` to match `sidecar-dispatch` and `sidecar-evaluate`:

```bash
# Before hook-bootstrap:
if [ "${DEVFLOW_BG_UPDATER:-}" = "1" ]; then exit 0; fi
if [ "${DEVFLOW_BG_LEARNER:-}" = "1" ]; then exit 0; fi
if [ "${DEVFLOW_BG_KNOWLEDGE_REFRESH:-}" = "1" ]; then exit 0; fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/hook-bootstrap" "sidecar-capture"
```

### CONSISTENCY: MEDIUM — sidecar-dispatch feedback-loop guards missing dbg annotations
**File**: `scripts/hooks/sidecar-dispatch:14-16`
**Confidence**: 90%
**Impact**: Three feedback-loop guards lack annotations; both sidecar-capture and sidecar-evaluate annotate these same guards (applies ADR-007)

Add dbg annotations:

```bash
if [ "${DEVFLOW_BG_UPDATER:-}" = "1" ]; then dbg "EXIT: bg_updater"; exit 0; fi
if [ "${DEVFLOW_BG_LEARNER:-}" = "1" ]; then dbg "EXIT: bg_learner"; exit 0; fi
if [ "${DEVFLOW_BG_KNOWLEDGE_REFRESH:-}" = "1" ]; then dbg "EXIT: bg_knowledge"; exit 0; fi
```

### DOCUMENTATION: HIGH — CLAUDE.md missing debug tracing system documentation
**File**: `CLAUDE.md:55,83`
**Confidence**: 95%
**Impact**: Debug tracing is a first-class feature (CLI command, env var toggle, shared helpers) but is not documented in project guide

Add a `**Debug Tracing**` section to Architecture Overview covering:
- `devflow debug --enable/--disable/--status` CLI command
- `DEVFLOW_HOOK_DEBUG=1` env var toggle stored in `~/.claude/settings.json` env block
- `debug-trace` shared helper sourced by all hooks via `hook-bootstrap`
- Two-phase log routing (pre-CWD global `~/.devflow/logs/.hook-debug.log`, post-CWD per-project `~/.devflow/logs/{project-slug}/.hook-debug.log`)
- 5MB size guard with 2.5MB tail retention

Also add `debug` to the CLI commands list at line 83.

### TYPESCRIPT: HIGH — Unsafe `as Record<string, string>` cast in applyDebugTrace
**File**: `src/cli/commands/debug.ts:24`
**Confidence**: 85%
**Impact**: Type cast silently allows non-string env values; differs from safety pattern in stripDebugTrace

Use `Record<string, unknown>` consistently:

```typescript
export function applyDebugTrace(settingsJson: string): string {
  const settings = JSON.parse(settingsJson) as Record<string, unknown>;
  settings.env ??= {};
  (settings.env as Record<string, unknown>).DEVFLOW_HOOK_DEBUG = '1';
  return JSON.stringify(settings, null, 2) + '\n';
}
```

### RELIABILITY: HIGH — Node fallback in load_existing_ids reads entire JSONL unbounded
**File**: `scripts/hooks/eval-helpers:53-57`
**Confidence**: 85%
**Impact**: Fallback slurps entire file into memory via readFileSync + split; no size guard; jq path streams line-by-line

Use readline for streaming in Node fallback:

```bash
node -e "
  const rl=require('readline');
  const ids=[];
  const rs=require('fs').createReadStream(process.argv[1]);
  rl.createInterface({input:rs}).on('line',l=>{
    try{const o=JSON.parse(l);if(o.id)ids.push(o.id)}catch{}
  }).on('close',()=>process.stdout.write(JSON.stringify(ids)));
" -- "\$log_file" 2>/dev/null || echo "[]"
```

---

## Should Fix (High priority, lower severity)

### TESTING: MEDIUM — Incomplete regression test for field rename
**File**: `tests/sentinel.test.ts:111-127`
**Confidence**: 82%
**Impact**: New test validates presence of `last_assistant_message` but not absence of old `response_text` field (avoids PF-006)

Add test case asserting hook ignores legacy field name:

```typescript
it('ignores legacy response_text field (avoids PF-006)', () => {
  mkMemoryDir(tmpDir);
  const memFile = path.join(tmpDir, '.devflow', 'memory', 'WORKING-MEMORY.md');
  fs.writeFileSync(memFile, '## Now\n- testing');
  const tenMinutesAgo = new Date(Date.now() - 600 * 1000);
  fs.utimesSync(memFile, tenMinutesAgo, tenMinutesAgo);
  const input = sessionInput(tmpDir, {
    stop_reason: 'end_turn',
    response_text: 'this should be ignored',
  });
  execSync(`bash "${HOOK}"`, { input, stdio: ['pipe', 'pipe', 'pipe'] });
  expect(fs.existsSync(path.join(tmpDir, '.devflow', 'memory', '.pending-turns.jsonl'))).toBe(false);
});
```

### TESTING: MEDIUM — debug-trace size guard test missing lower-bound assertion
**File**: `tests/shell-hooks.test.ts:147-176`
**Confidence**: 80%
**Impact**: Test validates upper-bound truncation but not that 2.5MB tail was retained

Add minimum size check:

```typescript
// After truncation the log should retain approximately 2.5MB of tail + the new line
expect(size).toBeGreaterThan(2 * 1024 * 1024); // at least 2MB
expect(size).toBeLessThan(5 * 1024 * 1024);
```

### DOCUMENTATION: MEDIUM — CLAUDE.md Working Memory section doesn't describe sidecar-evaluate decomposition
**File**: `CLAUDE.md:45`
**Confidence**: 82%
**Impact**: 400-line monolithic script refactored into orchestrator + 5 modules; architectural change not documented

Update sidecar-evaluate description:
> "Orchestrator that sources `eval-helpers` + 4 feature modules (`eval-reinforce`, `eval-learning`, `eval-decisions`, `eval-knowledge`) after shared setup; each module uses `${VAR:?}` fail-fast guards and `_MODULENAME_` variable prefixes for namespace isolation."

---

## Documentation Suggestions (Lower Confidence)

### DOCUMENTATION: MEDIUM — sidecar-capture internal variable RESPONSE_TEXT contradicts new field name
**File**: `scripts/hooks/sidecar-capture:44`
**Confidence**: 80%
**Impact**: Variable name implies old field `response_text`; aligns with comment but not with actual JSON field `last_assistant_message`

Rename shell variable from `RESPONSE_TEXT` to `ASSISTANT_MSG` throughout `sidecar-capture` to avoid confusion (avoids PF-006 -- legacy field name thinking).

### ARCHITECTURE: MEDIUM — Implicit orchestrator contract via shell global namespace
**File**: `scripts/hooks/sidecar-evaluate:112-116`
**Confidence**: 82%
**Impact**: eval-* modules depend on 12+ orchestrator-scoped variables; fail-fast guards mitigate but no compile-time enforcement

Add contract manifest comment block in sidecar-evaluate listing all exported names for module consumers.

### RELIABILITY: MEDIUM — eval-reinforce Node fallback reads entire JSONL unbounded
**File**: `scripts/hooks/eval-reinforce:53-77`
**Confidence**: 82%
**Impact**: Same pattern as load_existing_ids; no upper bound on memory consumption

Stream lines instead of slurping, or add line-count cap consistent with jq path.

---

## Pre-existing Issues (Not Blocking)

### SECURITY: MEDIUM — Debug trace logs may contain sensitive content
**File**: `scripts/hooks/sidecar-capture:50`
**Confidence**: 82%
**Note**: Code currently only logs length (safe), but established pattern makes accidental secret leaks easy

Add security comment:
```bash
# SECURITY: Never log INPUT or RESPONSE_TEXT content — may contain secrets.
# Only log metadata (length, keys, presence checks).
```

### RELIABILITY: MEDIUM — session-start-context reads full WORKING-MEMORY.md unbounded
**File**: `scripts/hooks/session-start-memory:59`
**Confidence**: 80%
**Note**: Pre-existing; memory agent truncates during writes but no defensive guard at read site

Add size cap: `MEMORY_CONTENT=$(head -c 65536 "$MEMORY_FILE")`

---

## Cross-Cycle Convergence Analysis

**Review Cycle History**:
- **Cycle 1**: 15 issues (not available in context)
- **Cycle 2**: 11 issues → 10 fixed + 1 deferred (Node fallback unbounded read)
- **Cycle 3**: Verified all prior fixes present; no re-raises
- **Cycle 4**: 7 blocking + 3 should-fix + 2 pre-existing = 12 total

**Convergence Pattern**:
- **Blocking (0→4)**: New HIGH findings in complexity, performance, documentation, TypeScript type safety
- **False Positive Rate**: 0% (no issues from prior cycles re-raised)
- **Deferred Tracking**: Node fallback deferral (pre-existing, bounded) correctly tracked; now blocker in eval-helpers (new code)

**Stabilization**: The review has converged on the architectural approach (decomposition, apply ADR-007, avoid PF-006). Remaining issues are tactical (nesting depth, early-exit ordering, type casts, test coverage).

---

## Recommendation Summary

### Required Actions (Before Merge)

1. **Complexity**: Extract batch-trigger helper from eval-learning (HIGH)
2. **Complexity**: Extract jq/node helpers from eval-reinforce (HIGH)
3. **Performance**: Move feedback-loop guards before hook-bootstrap in sidecar-capture (HIGH)
4. **Consistency**: Add dbg annotations to sidecar-dispatch guards (MEDIUM)
5. **Documentation**: Update CLAUDE.md with debug tracing system section (HIGH)
6. **TypeScript**: Fix type cast to use `Record<string, unknown>` (HIGH)
7. **Reliability**: Use streaming for Node fallback in load_existing_ids (HIGH)
8. **Testing**: Add regression test for old field name (MEDIUM)
9. **Testing**: Add size lower-bound assertion in debug-trace test (MEDIUM)

### Suggested Follow-Ups (Can Defer)

- Rename internal `RESPONSE_TEXT` variable to `ASSISTANT_MSG` (avoids PF-006 thinking)
- Add contract manifest comment in sidecar-evaluate
- Stream eval-reinforce Node fallback to match load_existing_ids pattern
- Add security comment on debug trace lines
- Add defensive size cap on WORKING-MEMORY.md reads

---

## Quality Assessment

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architecture | 8/10 | Decomposition is clean; fails PF-006 avoidance with variable naming |
| Complexity | 7/10 | Core logic ported without flattening; nesting extraction needed |
| Consistency | 9/10 | Patterns are uniform; one dbg annotation gap in sidecar-dispatch |
| Documentation | 6/10 | Scripts well-documented; CLAUDE.md out of sync with new debug system |
| Performance | 8/10 | Zero-overhead design; one early-exit guard ordering issue |
| Reliability | 7/10 | Strong bounds overall; Node fallback needs streaming |
| Security | 9/10 | Defensive patterns throughout; one MEDIUM log leak risk |
| Testing | 8/10 | Excellent coverage; two regression test gaps |
| TypeScript | 8/10 | Clean structure; type safety issue in one function |
| Regression | 9/10 | Field rename complete; PF-006 fully resolved |

**Overall Assessment**: Solid architectural foundation with tactical issues requiring fixes. The decomposition, namespace isolation, and fail-fast guards correctly apply ADR-007 and avoid PF-006. Guard ordering, nesting depth, and type safety issues are straightforward to fix before merge.
