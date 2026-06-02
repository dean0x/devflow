# Resolution Summary

**Branch**: refactor/remove-ambient-commands-rule -> main
**Date**: 2026-06-01_2352
**Review**: .devflow/docs/reviews/refactor-remove-ambient-commands-rule/2026-06-01_2352
**Command**: /resolve

## Decisions Citations

- applies ADR-001 — batch-1, batch-2 (clean-break cleanup; no migration added)
- avoids PF-007 — batch-2, cli-rules-KNOWLEDGE.md:241 (removed fabricated citation per verbatim-only rule)

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
| removeLegacyCommandsRule propagated non-ENOENT errors — could abort `devflow init` (silent catch disabled memory/HUD/flags) and crash `ambient --enable/--disable`. Made fail-safe: swallows ALL errors (best-effort cleanup of a deprecated file must never abort the caller). | src/cli/commands/ambient.ts:65-73 | 424ca9a |
| Coupled test flip: `removeLegacyCommandsRule` EACCES case re-asserted from `.rejects` to `.resolves` to pin the new fail-safe contract. | tests/ambient.test.ts:~341-345 | 424ca9a |
| Rule-count straggler: README user-facing line said "13 ultra-condensed engineering principles"; actual count is 12 (shared/rules/*.md). | README.md:56 | 424ca9a |
| Inaccurate cross-reference: gotcha cited PF-007 (about editing installed hook scripts) for the partition predicate. Dropped the fabricated citation; replaced with a plain description matching the source comment. | .devflow/features/cli-rules/KNOWLEDGE.md:241 | 424ca9a |

## False Positives
(none)

## Deferred to Tech Debt
(none)

## Blocked
(none)

## Notes
- All three review findings (1 HIGH reliability, 1 HIGH consistency/documentation, 1 MEDIUM documentation) fixed directly — no tech debt deferred.
- Two parallel Resolver batches raced on `git commit`; git serialized them into a single commit (`424ca9a`). All four file changes landed intact. The commit MESSAGE describes only the docs fixes and under-describes the bundled `ambient.ts` reliability fix + test flip — cosmetic message inaccuracy only; the diff itself is complete and correct. Commit was already pushed, so amending the message would require a force-push (not done without explicit approval).
- Verification: `npm run build` clean (reports 12 rules); `npx vitest run tests/ambient.test.ts` → 40 pass / 0 fail.
