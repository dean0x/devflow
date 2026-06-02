# Code Review Summary

**Branch**: refactor/remove-ambient-commands-rule -> main (PR #233)
**Date**: 2026-06-02_0013

## Merge Recommendation: CHANGES_REQUESTED

The branch is well-executed overall (8 of 10 reviewers approved cleanly, all prior-cycle fixes verified), but **two testing gaps must be closed before merge**: the missing symmetric test for `removeAmbientHook`'s early-return purge path (HIGH confidence), and the brittle mock dance in the existing test (MEDIUM confidence). Additionally, one metadata sync in the feature knowledge index (consistency, MEDIUM confidence). All three are low-risk and straightforward to fix.

## Issue Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| Blocking | 0 | 0 | 0 | - | 0 |
| Should Fix | - | 1 | 1 | - | 2 |
| Pre-existing | - | - | 1 | 0 | 1 |

## Blocking Issues

None. The deletion/refactor of the ambient rule is architecturally sound, properly cleaned up, and introduces no security, performance, regression, or reliability concerns.

## Should-Fix Issues (Changes You Touched)

All issues are in `tests/ambient.test.ts`. Testing coverage for the fail-safe cleanup is incomplete.

### HIGH — Missing symmetric ordering-invariant test for `removeAmbientHook` early-return path

**Location**: `tests/ambient.test.ts:251` (should add mirror test)
**Confidence**: 90%
**Category**: Testing
**Problem**:
- The new ordering-invariant test (line 94-104) proves `addAmbientHook` purges the legacy rule even when taking its early-return path (when the preamble hook already exists).
- But `removeAmbientHook` has the *same* structure: it calls `removeLegacyCommandsRule()` at `ambient.ts:128` *before* its early-return at `ambient.ts:130`.
- No test asserts that `fs.unlink` is called on this path for `removeAmbientHook`. The closest test ("is idempotent — safe to call when not present") only asserts `result === input` and does NOT assert the purge ran.
- **Risk**: A regression that moved `removeLegacyCommandsRule()` *after* the early-return in `removeAmbientHook` would silently pass all current tests.

**Fix**:
Add a mirror test in the `removeAmbientHook` suite (the `beforeEach` already stubs `fs.unlink`):
```typescript
it('purges legacy rule even when nothing to remove (ordering invariant)', async () => {
  // No ambient/classification hooks → removeAmbientHook takes the early-return path.
  // removeLegacyCommandsRule MUST still run so stale commands.md files are cleaned up.
  const input = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'stop.sh' }] }] } });
  const result = await removeAmbientHook(input);
  expect(result).toBe(input);                       // early-return preserved
  expect(fs.unlink).toHaveBeenCalledWith(COMMANDS_RULE_PATH); // purge still ran
});
```

---

### MEDIUM — Brittle mock restore/re-stub dance

**Location**: `tests/ambient.test.ts:98-100`
**Confidence**: 82%
**Category**: Testing
**Problem**:
- The ordering-invariant test calls `vi.restoreAllMocks()` then re-stubs `fs.unlink` to "assert on the second call."
- This approach works but is brittle: it discards call-count isolation and couples the test to the fact that the *first* `addAmbientHook` also calls `unlink`.
- A cleaner assertion reasons only about the second call without tearing down and rebuilding the spy.
- **Impact**: Readability and robustness nit; the test does correctly prove the invariant, but future maintainers may break it accidentally.

**Fix**:
Avoid the restore/re-stub dance. Use `vi.clearAllMocks()` (preserves the stub implementation) instead of `vi.restoreAllMocks()` (removes it), or capture and assert the call-count delta:
```typescript
// Before the second addAmbientHook:
const callsBefore = (fs.unlink as Mock).mock.calls.length;
await addAmbientHook(withHook, withoutHook, { rules: [], knowledge: false, decisions: false });
expect((fs.unlink as Mock).mock.calls.length).toBeGreaterThan(callsBefore);
```

---

## Pre-existing Issues (Not Blocking)

### MEDIUM — Stale `referencedFiles` entry in feature knowledge index

**Location**: `.devflow/features/index.json:26` (and line 6 keyword list)
**Confidence**: 90%
**Category**: Consistency
**Problem**:
- This PR deletes `shared/rules/commands.md`, but the committed feature knowledge index entry for `cli-rules` still lists `"shared/rules/commands.md"` in its `referencedFiles` array.
- The `description` keyword list on line 6 also still includes `commands.md`.
- The companion `KNOWLEDGE.md` was correctly updated, so the index and KNOWLEDGE.md are now out of sync with each other and with the source tree.
- **Risk**: `referencedFiles` drives staleness detection via `git log` against those paths. A deleted path can never produce a meaningful diff, so the entry is dead. It's an internal inconsistency — every other doc artifact in the sweep was updated, but this metadata file was missed.

**Fix**:
In `.devflow/features/index.json`, remove `"shared/rules/commands.md"` from the `cli-rules.referencedFiles` array, and drop `commands.md` from the `description` keyword list (replace with `removeLegacyCommandsRule` to match KNOWLEDGE.md frontmatter line 4).

---

## Suggestions (Lower Confidence)

None above 60% confidence that change normal development flow.

---

## Cross-Cycle Verification

**Cycle 1** (2026-06-01_2352): Fixed 3 issues — fail-safe error handling, README count 13→12, removed fabricated PF-007 citation.

**Cycle 2 Verification**:
- ✅ Fail-safe error handling (`ambient.ts:66-72`) — present and correct; all reviewers (security, reliability, testing, typescript) re-verified
- ✅ README rule count → 12 — verified in `CLAUDE.md:65`, `README.md:56`, `KNOWLEDGE.md`; no survivor "13 rules"
- ✅ PF-007 citation removed — no fabricated or invalid ADR/PF citations remain in any changed doc
- ✅ No regressions: All prior fixes hold in current code

**False Positive Ratio from Cycle 1**: 0/3 = 0% (all 3 prior issues were real and fixed)

**Assessment**: First cycle identified real issues; second cycle converging well. This is a normal two-cycle pattern for a documentation-heavy refactor.

---

## Convergence Status

**Cycle**: 2
**Prior Resolution**: Available (3 issues fixed in Cycle 1)
**Prior FP Ratio**: 0/3 = 0%
**Assessment**: Converging. Cycle 1 found and fixed 3 real issues with zero false positives. Cycle 2 identified 2 testing gaps (orthogonal to Cycle 1 fixes) and 1 metadata sync issue (pre-existing, informational). The branch quality is solid; the remaining 3 items are straightforward fixes.

---

## Action Plan

1. **Add mirror ordering-invariant test for `removeAmbientHook`** (HIGH) — 5 min, tests/ambient.test.ts
2. **Simplify test mock setup** (MEDIUM) — 5 min, tests/ambient.test.ts  
3. **Update `.devflow/features/index.json`** (MEDIUM, pre-existing) — 2 min, remove stale referencedFiles entry and update keywords

**Merge gate**: Complete items 1-2 (blocking). Item 3 (pre-existing metadata) may be deferred to a follow-up if preferred.
