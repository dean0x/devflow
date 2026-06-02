# Documentation Review Report

**Branch**: refactor/remove-ambient-commands-rule -> main
**PR**: #233
**Date**: 2026-06-01_2352
**Focus**: Doc-heavy sweep — verify accuracy and completeness of the commands-rule removal sweep

## Scope Verified

Ground-truth checks performed against current code/filesystem:
- `shared/rules/*.md` count = **12** (commands.md removed) — confirms the "12 rules" target.
- JSDoc on `COMMANDS_RULE_PATH`, `removeLegacyCommandsRule`, `addAmbientHook`, `removeAmbientHook` in `src/cli/commands/ambient.ts`.
- Repo-wide grep for "command awareness", "commands rule", "13 rules".
- KNOWLEDGE.md `referencedFiles` and "12 rules" body claims.

---

## Issues in Your Changes (BLOCKING)

### HIGH
**Stale rule count: README.md still says "13 rules"** — `README.md:56`
**Confidence**: 98%
- Problem: The PR description states "13→12 rules in two places," but `README.md:56` was not updated:
  > "**Always-on rules.** 13 ultra-condensed engineering principles (~10 lines each) load on every prompt..."
  Every other doc was correctly updated to 12 (CLAUDE.md:65, CLAUDE.md:82, KNOWLEDGE.md lines 30/249, cli-reference, plugin.json). This single line is now the only place claiming 13, directly contradicting the actual `shared/rules/` count (12) and the rest of the sweep. README is the user-facing front door, so this is the most visible drift.
- Impact: Actively misleading — users reading the headline feature list get a wrong count that conflicts with `devflow rules --list`.
- Fix: Change "13 ultra-condensed engineering principles" → "12 ultra-condensed engineering principles".
- Category: Blocking (line is part of the doc sweep this PR owns, even though the diff did not touch it; the sweep's stated goal was to fix all rule-count mentions).
- Note: `README.md:67` ("3 MCPs 2 rules" in the HUD sample) is a per-project *installed-count* example, NOT the total. It is correct and should not be changed.

---

## Issues in Code You Touched (Should Fix)

### MEDIUM
**Inaccurate PF citation in KNOWLEDGE.md** — `.devflow/features/cli-rules/KNOWLEDGE.md:241`
**Confidence**: 90%
- Problem: New gotcha line added in this PR states:
  > "The workflow-bucket predicate is `commands.length > 0` — the language-bucket comment notes this implicit contract is **PF-007** (source only; not enforced by types)."
  Two inaccuracies: (1) the actual source comment in `src/cli/plugins.ts:732-735` makes **no PF reference at all** — it just describes the implicit contract in plain English; (2) **PF-007** in `.devflow/decisions/pitfalls.md:60` is "Editing globally installed hook scripts directly instead of source + rebuild + reinstall" — an unrelated topic. The citation points the reader to a pitfall that has nothing to do with plugin-bucket partitioning.
- Impact: A future maintainer who follows the "PF-007" pointer to understand the partition contract lands on an unrelated hook-editing pitfall — code-comment drift / wrong cross-reference. (Note: PF-007 is not in this review's DECISIONS_CONTEXT index; verified directly against pitfalls.md.)
- Fix: Either (a) drop the "is PF-007" claim and just say "documented as an inline comment in `plugins.ts`", or (b) if a pitfall genuinely covers this, cite the correct PF number. Also verify the parenthetical "the language-bucket comment notes..." matches what `plugins.ts` actually says.
- Category: Should-Fix (file authored in this PR; not user-facing, but it is consumed automatically as FEATURE_KNOWLEDGE by every workflow, so inaccuracy propagates).

---

## Pre-existing Issues (Not Blocking)

None identified relevant to this focus.

---

## Verified Accurate (no action needed)

These were explicitly checked against ground truth and are correct:

1. **CLAUDE.md Ambient Mode section (line 49)** — Now "Single-component system," describes only the `preamble` plan-detection hook plus the auto-removal of the legacy `commands.md` rule. Internally consistent, no self-contradiction, no remaining claim that a live commands rule exists. Accurate.
2. **Rule count = 12 everywhere except README:56** — CLAUDE.md:65, CLAUDE.md:82 (project-structure tree), KNOWLEDGE.md:30/249, cli-reference.md:59, plugin.json, ambient README all correctly say 12 / drop the "+1 ambient-managed (commands)" clause.
3. **JSDoc accuracy** — `COMMANDS_RULE_PATH` (ambient.ts:15-21) correctly states the path now exists only to purge the legacy file; `removeLegacyCommandsRule` (58-62) accurately documents idempotency and ENOENT-only swallowing; `addAmbientHook` (71-77) and `removeAmbientHook` (109-115) accurately document the unconditional pre-early-return purge. Matches implementation.
4. **KNOWLEDGE.md `referencedFiles`** — Never listed `shared/rules/commands.md` (lists the 4 core rules + source files); adds `src/cli/commands/ambient.ts`. No permanent-staleness risk from a removed referenced file.
5. **No doc tells users a commands-awareness rule exists** — All surviving `commands.md` mentions are either (a) intentional descriptions of the auto-purge of the *legacy* file, (b) the unrelated `docs/commands.md` / `references/commands.md` files, or (c) historical "Related" context in KNOWLEDGE.md:266. None present it as a current feature.
6. **plugin.json keywords** — `"commands"` and `"awareness"` removed; description reduced to "Plan auto-detection." Accurate.
7. **README.md:19 / :44 and docs/commands.md:173 / ambient README** — All "two-component"/"command awareness" prose correctly reduced to single plan-detection component.

---

## Suggestions (Lower Confidence)

None.

---

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Documentation Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The sweep is ~95% complete and high quality — CLAUDE.md, plugin.json, cli-reference, ambient README, and most of KNOWLEDGE.md are accurate and self-consistent, and the JSDoc faithfully reflects the new purge-only behavior. Two fixes block approval: (1) one missed rule-count instance in the user-facing README (13→12), and (2) an inaccurate PF-007 cross-reference in the cli-rules knowledge base.
