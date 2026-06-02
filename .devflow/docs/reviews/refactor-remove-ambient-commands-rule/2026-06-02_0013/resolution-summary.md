# Resolution Summary

**Branch**: refactor/remove-ambient-commands-rule -> main
**Date**: 2026-06-02_0013
**Review**: .devflow/docs/reviews/refactor-remove-ambient-commands-rule/2026-06-02_0013
**Command**: /resolve

## Decisions Citations

(none — fixes were mechanical test/metadata corrections; no ADR/PF bodies cited)

## Statistics
| Metric | Value |
|--------|-------|
| Total Issues | 3 |
| Fixed | 3 |
| False Positive | 0 |
| Deferred | 0 |
| Blocked | 0 |

## Fixed Issues
| Issue | File:Line | Commit |
|-------|-----------|--------|
| Missing symmetric ordering-invariant test for `removeAmbientHook` early-return path — `removeLegacyCommandsRule()` runs at ambient.ts:128 before the early-return at :130, but no test asserted the purge fires on that path (a regression moving it after the early-return would have passed all tests). Added mirror test `purges legacy rule even when nothing to remove (ordering invariant)`. | tests/ambient.test.ts:~258 | 9024222 |
| Brittle re-stub in the `addAmbientHook` ordering test — `vi.restoreAllMocks()`+re-stub discarded `beforeEach` isolation and coupled to the first call's side effect. Replaced with `vi.clearAllMocks()` (preserves the stub, resets counts). | tests/ambient.test.ts:98 | 9024222 |
| Stale `referencedFiles` entry — `.devflow/features/index.json` cli-rules entry still listed the deleted `shared/rules/commands.md` (skews git-log staleness detection) and kept `commands.md` in the description keywords. Removed the dead path; replaced the keyword with `removeLegacyCommandsRule` to match KNOWLEDGE.md. | .devflow/features/index.json:26 | 9024222 |

## False Positives
(none)

## Deferred to Tech Debt
(none)

## Blocked
(none)

## Notes
- Cycle 2 of review→resolve. All 3 review findings (1 HIGH testing, 1 MEDIUM testing, 1 MEDIUM consistency) fixed directly — no tech debt deferred.
- Two LOW-confidence (65-70%) suggestions in testing.md were explicitly classified by the reviewer as "acceptable, not a defect" (EACCES is a representative non-ENOENT case for the bare `catch {}`; fs.unlink spy is the correct seam) — not actioned, no change warranted.
- Test count: 40 → 41 (`npx vitest run tests/ambient.test.ts` passes). index.json validated as well-formed JSON.
- Commit `9024222` staged only `tests/ambient.test.ts` and `.devflow/features/index.json`; runtime `.devflow/decisions/` + `.devflow/docs/` artifacts and the two stray junk files left unstaged.
- The 8 other reviewers (security, architecture, performance, complexity, regression, reliability, typescript, documentation) returned clean APPROVED — no issues to resolve.
