# Code Review Summary

**Branch**: fix-suppress-quick-classification → main
**Date**: 2026-04-19_0009

## Merge Recommendation: CHANGES_REQUESTED

This PR contains one **MEDIUM-severity blocking issue** that requires fixing before merge: the slash-command preamble filter test is missing the `hasClassification` assertion that all other QUICK-tier tests have. This inconsistency compromises test coverage of the core behavioral change (QUICK classification suppression). The fix is trivial (one line), and all other changes are solid.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|----------|----------|------|--------|-----|-------|
| **Blocking** | 0 | 0 | 1 | — | **1** |
| **Should Fix** | — | 0 | 0 | — | **0** |
| **Pre-existing** | — | — | 2 | 1 | **3** |

---

## Blocking Issues

### MEDIUM (Must Fix Before Merge)

**Missing `hasClassification` assertion in slash-command preamble filter test** — `tests/integration/ambient-activation.test.ts:57-62` (Confidence: **100%**)

- **Problem**: Three of four QUICK-tier tests received the new `expect(hasClassification(result)).toBe(false)` assertion (lines 38, 45, 53), verifying that QUICK-tier prompts suppress classification output. The fourth test ("preamble filter — slash command prefix skipped before classification") does not, despite testing the same contract: QUICK prompts should not produce a classification announcement.

- **Impact**: Incomplete test coverage of the PR's core behavioral change. If the slash-command preamble filter breaks in the future, this regression will not be caught.

- **Fix**: Add the assertion to the test:
  ```typescript
  it('preamble filter — slash command prefix skipped before classification', async () => {
    // Preamble filters prompts starting with "/" — no classification or skill loading
    const result = await runClaudeStreaming('/help with something', { timeout: 20000 });
    expect(hasSkillInvocations(result)).toBe(false);
    expect(hasClassification(result)).toBe(false);  // ← Add this line
    console.log(`preamble filter (slash command): no skills (${result.durationMs}ms)`);
  });
  ```

---

## Suggestions (Lower Confidence)

1. **Legacy fallback path architecture** — `scripts/hooks/session-start-classification:19-23` (Confidence: 65%) — The fallback correctly handles the upgrade window where the old `references/classification-rules.md` still exists. The installer's `fs.rm` at line 163 of `installer.ts` removes the entire directory before re-copying, so the orphan is cleaned on next `devflow init`. No action required; existing approach is sound.

2. **Repeated path resolution pattern** — `tests/ambient.test.ts:492`, `tests/skill-references.test.ts:706`, `tests/integration/helpers.ts:24` (Confidence: 65%) — Three test files independently construct the path to `classification-rules.md` using `path.resolve` + hardcoded relative segments. A shared constant would reduce maintenance cost if the path structure changes again, but this is not blocking.

---

## Detailed Analysis

### What This PR Does Well

- **File organization**: Moving `classification-rules.md` from `references/` to the skill root correctly reflects its role as a first-class input, not a secondary reference. Consistent with the convention that `SKILL.md` lives at the skill root.

- **Behavioral clarity**: The preamble change from unconditional to conditional router loading ("If GUIDED or ORCHESTRATED, load devflow:router") aligns with the classification rules that already state "QUICK: Do not load the router." Eliminates a contradiction in the previous design.

- **Performance improvement**: Suppressing router loading for QUICK-tier requests (the most common tier) eliminates unnecessary Skill tool invocations. Adds one negligible stat syscall per session start during the upgrade window.

- **Backward compatibility**: The legacy fallback in `session-start-classification` ensures existing installs with old file layouts continue to work during the upgrade. Proper migration strategy.

- **Test strengthening**: The new `hasClassification` assertions in 3 of 4 QUICK-tier tests establish a regression guard for the suppression behavior.

- **Path consistency**: All 5 path references across source and test files were updated correctly (`preamble`, `session-start-classification`, `tests/ambient.test.ts`, `tests/integration/helpers.ts`, `tests/skill-references.test.ts`).

### Changes Reviewed

1. **File relocation** (`shared/skills/router/references/classification-rules.md` → `shared/skills/router/classification-rules.md`) — Pure rename, zero content change.

2. **Preamble wording** (`scripts/hooks/preamble:37`) — Changed from unconditional to conditional router loading. Prompt-instruction change with no security implications.

3. **Session-start hook fallback** (`scripts/hooks/session-start-classification:18-26`) — Primary path updated; legacy fallback added for upgrade window. Cleaner than previous `awk`-based SKILL.md parsing.

4. **Test updates** (4 files, 5 path updates + 3 new assertions) — All path references updated consistently. New `hasClassification` assertions on QUICK-tier tests validate suppression behavior (except for one test).

### Security & Regression Checks

- **No injection vectors**: `$HOME` is OS-set, `CWD` only checked for emptiness, never interpolated.
- **No new dependencies**: No package changes.
- **No exports removed**: `hasClassification` is a new export, no breaking changes.
- **All consumers updated**: Verified across 5 locations.
- **PF-001 (Promise resolver naming)**: Verified. `resolve` param in `new Promise((resolve) => {...})` remains correctly named. No violation.

---

## Action Plan

1. **Add missing assertion** — Add `expect(hasClassification(result)).toBe(false);` to the slash-command preamble filter test at line 58.
2. **Re-run integration tests** — Verify all QUICK-tier tests pass with the new assertion.
3. **Merge** — PR is ready once the blocking issue is fixed.

---

## Scores by Domain

| Domain | Score | Recommendation |
|--------|-------|-----------------|
| Security | 10/10 | APPROVED |
| Architecture | 9/10 | APPROVED |
| Performance | 9/10 | APPROVED (net positive) |
| Complexity | 8/10 | APPROVED (reduces complexity) |
| Consistency | 8/10 | **CHANGES_REQUESTED** (1 missing assertion) |
| Regression | 10/10 | APPROVED |
| Testing | 8/10 | **APPROVED_WITH_CONDITIONS** (1 missing assertion) |

---

## Summary

This PR successfully refactors the classification rules architecture to improve clarity and performance. The core changes are sound: file relocation is architecturally justified, the preamble behavior is now consistent with the rules, and test coverage of the suppression behavior is strong (except for one test). The blocking issue is trivial to fix (one line) and the PR can merge immediately after that fix.
