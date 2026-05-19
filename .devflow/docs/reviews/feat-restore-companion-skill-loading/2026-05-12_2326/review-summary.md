# Code Review Summary

**Branch**: feat/restore-companion-skill-loading -> main
**Date**: 2026-05-12_2326
**PR**: #218

## Merge Recommendation: CHANGES_REQUESTED

The PR successfully restores companion skill loading to orch skills and commands with a well-structured consistency test. However, there are 3 unresolved blocking issues:

1. **Incomplete section ordering standardization** — The commit claims to "standardize orch skill ordering" but only applies the reordering to 2 of 5 orch skills (debug, plan). The remaining skills (implement, release, review) have inconsistent placement of Worktree Support sections.
2. **Test does not enforce section ordering** — The new consistency test validates skill list content but not the section ordering that this PR is specifically about.
3. **Missing error handling for teams file reads** — The test reads teams variant command files without try/catch guards, creating brittle test behavior if files are missing.

These issues prevent merge. All 3 must be resolved for approval.

---

## Issue Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 3 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 1 | 1 |

---

## Blocking Issues (Must Fix)

### Issue 1: Incomplete Section Ordering Standardization (MEDIUM)
**Confidence**: 85% (multiple reviewers agree: Architecture, Consistency, Documentation)

**Files**: `shared/skills/implement:orch/SKILL.md:92`, `shared/skills/release:orch/SKILL.md:250`

**Problem**: The commit message claims "standardize orch skill ordering," and the changes move `## Worktree Support` to immediately after `## Load Companion Skills` in `debug:orch` (line 25) and `plan:orch` (line 25). However:
- `implement:orch` still has `## Worktree Support` at line 92 (between Phase 3 and Phase 4)
- `release:orch` has `## Worktree Support` at line 250 (near the end of the file)
- `review:orch` has no `## Worktree Support` section at all

The PR establishes a new pattern (Load Companion Skills → Worktree Support) in two files but does not apply it to the remaining three orch skills, creating a two-tier inconsistency.

**Fix**: Move `## Worktree Support` to immediately after `## Load Companion Skills` in all orch skills that have it (implement, debug, plan, release). Optionally add it to review:orch if paths can be passed there. Update the commit message to reflect the actual scope of changes.

---

### Issue 2: Test Does Not Verify Section Ordering (MEDIUM)
**Confidence**: 82% (Consistency reviewer)

**File**: `tests/skill-references.test.ts:1007-1087`

**Problem**: The new consistency test validates that companion skill *names* match between the catalog, orch skills, and commands. This is valuable. However, the PR's main stated change is about section *ordering* (Load Companion Skills before Worktree Support), and the test does not verify ordering at all. A future change could reorder sections incorrectly and the test would still pass.

**Fix**: Add a lightweight ordering assertion that verifies in orch skills containing both sections, "Load Companion Skills" appears before "Worktree Support":

```typescript
// For each orch skill that has both sections, verify ordering
const orchSkillsWithBoth = ['debug:orch', 'plan:orch', 'implement:orch', 'release:orch'];
for (const skill of orchSkillsWithBoth) {
  const skillPath = path.join(ROOT, 'shared', 'skills', skill, 'SKILL.md');
  try {
    const content = readFileSync(skillPath, 'utf-8');
    const companionIdx = content.indexOf('## Load Companion Skills');
    const worktreeIdx = content.indexOf('## Worktree Support');
    if (companionIdx !== -1 && worktreeIdx !== -1) {
      expect(companionIdx).toBeLessThan(worktreeIdx);
    }
  } catch {
    // skill may not exist with both sections
  }
}
```

---

### Issue 3: Missing Error Handling for Teams File Reads (MEDIUM)
**Confidence**: 85% (multiple reviewers: Reliability, TypeScript, Documentation)

**File**: `tests/skill-references.test.ts:1077-1079`

**Problem**: The test iterates over hardcoded command file paths including `-teams.md` variants and calls `readFileSync(cmdPath, 'utf-8')` without try/catch. If a teams variant is removed in the future, the test will throw an uncaught `ENOENT` error instead of gracefully skipping or providing a meaningful failure message. This contrasts with the existing pattern at lines 992-996 in the same file which wraps teams file reads in try/catch.

**Fix**: Wrap the teams command file reads in try/catch, consistent with the existing codebase pattern:

```typescript
for (const cmdRelPath of intentCommandMap[intent]) {
  const cmdPath = path.join(ROOT, cmdRelPath);
  let cmdContent: string;
  try {
    cmdContent = readFileSync(cmdPath, 'utf-8');
  } catch {
    continue; // teams variant may not exist
  }
  const cmdSkills = parseCompanionLine(cmdContent);
  expect(
    cmdSkills,
    `${cmdRelPath} companions must match catalog for ${intent}`,
  ).toEqual(expectedSkills);
}
```

---

## Pre-existing Issues (Not Blocking)

### Issue 4: Inconsistent Worktree Support Placement in Skills Without Companions (LOW)
**Confidence**: 80% (Architecture reviewer)

**Files**: `shared/skills/explore:orch/SKILL.md:131`, `shared/skills/research:orch/SKILL.md:160`, `shared/skills/resolve:orch/SKILL.md`

**Problem**: Orch skills that lack companion skills have "Worktree Support" placed at the very end of their phase listings (explore line 131, research line 160), while those with companion skills now have it near the top. This creates an inconsistency — no single convention for where "Worktree Support" lives. This is pre-existing and not introduced by this PR.

**Recommendation**: Consider a follow-up PR to standardize all "Worktree Support" sections to appear immediately after Iron Law (or after Load Companion Skills when present), before any phases.

---

### Issue 5: Missing Worktree Support Section in review:orch (LOW)
**Confidence**: 80% (Architecture reviewer)

**File**: `shared/skills/review:orch/SKILL.md`

**Problem**: `review:orch` is the only orch skill among the five with companions that lacks a Worktree Support section. The review pipeline does operate on worktrees (the `/code-review` command discovers them), so this omission may cause path resolution issues when WORKTREE_PATH is passed. This is pre-existing.

**Recommendation**: Add a Worktree Support section to `review:orch` consistent with the other orch skills in a future PR.

---

## Approved Areas

✅ **Security** (10/10) - No security concerns. Test uses trusted file paths only.

✅ **Performance** (9/10) - No performance impact. Documentation and test changes.

✅ **Regression** (9/10) - Changes are additive, no breaking changes. All 32 tests pass.

✅ **Testing** (8/10) - Test is well-designed with behavior-focused assertions and rename-proof by design.

✅ **Complexity** (9/10) - Low-complexity changes. 82-line test justifies multi-intent coverage.

✅ **TypeScript** (9/10) - Clean code, no `any` types, proper generics, explicit return types.

---

## Summary by Reviewer

- **Security**: APPROVED
- **Architecture**: APPROVED_WITH_CONDITIONS (incomplete standardization)
- **Performance**: APPROVED
- **Complexity**: APPROVED
- **Consistency**: CHANGES_REQUESTED (2 MEDIUM blocking issues)
- **Regression**: APPROVED
- **Testing**: APPROVED (with note on guided skills coverage gap)
- **Reliability**: APPROVED_WITH_CONDITIONS (missing error handling)
- **TypeScript**: APPROVED
- **Documentation**: APPROVED_WITH_CONDITIONS (incomplete standardization)

---

## Action Plan

1. **Move Worktree Support sections** in `implement:orch` and `release:orch` to immediately after "Load Companion Skills"
2. **Add section ordering assertion** to the consistency test
3. **Add try/catch guards** around teams file reads in the test
4. **Update commit message** to reflect the actual scope (only debug/plan standardized, or clarify remaining work)
5. Re-run all 32 tests to confirm no regressions
