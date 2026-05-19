# Consistency Review Report

**Branch**: feat/restore-companion-skill-loading -> main
**Date**: 2026-05-12
**Incremental**: from b973e9d (prior review base)

## Issues in Your Changes (BLOCKING)

### MEDIUM

**Worktree Support section ordering not fully standardized across orch skills** - `shared/skills/implement:orch/SKILL.md:92`
**Confidence**: 85%
- Problem: The PR's stated goal is to standardize section ordering so "Load Companion Skills" comes before "Worktree Support." This was applied to `debug:orch` (moved from line 21 to line 25) and `plan:orch` (moved from line 21 to line 25). However, `implement:orch` still has "Worktree Support" buried at line 92 (between Phase 3 and Phase 4), far from the top-of-file placement used in the two fixed files. The PR title says "standardize orch skill ordering" but the standardization is incomplete. Similarly, `explore:orch` (line 131) and `research:orch` (line 160) have "Worktree Support" at the bottom of their phase listings, not near the top.
- Fix: Move the "Worktree Support" section in `implement:orch` to line 25 (right after "Load Companion Skills"), matching the pattern established in `debug:orch` and `plan:orch`. Consider whether `explore:orch` and `research:orch` should also be moved for full consistency (those don't have companion skills, but the section could still be placed early, right after the Iron Law).

### MEDIUM

**New test does not verify section ordering -- only skill list content** - `tests/skill-references.test.ts:1007`
**Confidence**: 82%
- Problem: The new test "companion skill lists are consistent across catalog, orch skills, and commands" validates that the companion skill *names* match between the catalog, orch skills, and commands. This is valuable. However, the PR's main change was about section *ordering* (Load Companion Skills before Worktree Support), and the test does not verify ordering at all. A future change could reorder sections incorrectly and the test would still pass.
- Fix: Consider adding a lightweight ordering assertion that verifies in orch skills containing both sections, "Load Companion Skills" appears before "Worktree Support":
```typescript
// For each orch skill that has both sections, verify ordering
const orchSkillsWithBoth = ['debug:orch', 'plan:orch', 'implement:orch'];
for (const skill of orchSkillsWithBoth) {
  const content = readFileSync(path.join(ROOT, 'shared', 'skills', skill, 'SKILL.md'), 'utf-8');
  const companionIdx = content.indexOf('## Load Companion Skills');
  const worktreeIdx = content.indexOf('## Worktree Support');
  if (companionIdx !== -1 && worktreeIdx !== -1) {
    expect(companionIdx, `${skill}: Companion Skills must precede Worktree Support`).toBeLessThan(worktreeIdx);
  }
}
```

## Issues in Code You Touched (Should Fix)

(none)

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Inconsistent Worktree Support placement across orch skills without companion skills** - `shared/skills/explore:orch/SKILL.md:131`, `shared/skills/research:orch/SKILL.md:160`
**Confidence**: 80%
- Problem: Orch skills that lack companion skills have "Worktree Support" placed at the very end of their phase listings (explore:orch line 131, research:orch line 160), while those with companion skills now have it near the top (debug:orch line 25, plan:orch line 25). There is no single convention for where "Worktree Support" lives relative to phases -- it appears early in some skills and late in others. This creates a two-tier inconsistency that may cause confusion.
- Fix: Consider a follow-up PR to standardize all "Worktree Support" sections to appear immediately after Iron Law (or after Load Companion Skills when present), before any phases. This is informational only.

## Suggestions (Lower Confidence)

- **Test assertion precision** - `tests/skill-references.test.ts:1024` (Confidence: 65%) -- `expect(orchTable.size).toBeGreaterThanOrEqual(5)` could be `expect(orchTable.size).toBe(5)` since the regex alternation only matches exactly 5 intents. The >= is not wrong, but `.toBe(5)` would catch catalog drift earlier if an intent were accidentally removed.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Consistency Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The PR successfully standardizes companion skill ordering in debug:orch and plan:orch, adds useful CLAUDE.md documentation, and introduces a well-structured consistency test. However, the standardization is incomplete: implement:orch still has "Worktree Support" at line 92 (between phases 3 and 4), breaking the pattern the PR establishes. The new test validates skill list consistency but does not enforce the section ordering that this PR is specifically about. Fixing the implement:orch ordering and optionally adding an ordering assertion to the test would make this change fully consistent.
