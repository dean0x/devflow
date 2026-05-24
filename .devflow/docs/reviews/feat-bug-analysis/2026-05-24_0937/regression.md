# Regression Review Report

**Branch**: feat/bug-analysis -> main
**Date**: 2026-05-24

## Issues in Your Changes (BLOCKING)

### HIGH

**Inconsistent scan limit between resolve.md and resolve:orch for review directory discovery** - `shared/skills/resolve:orch/SKILL.md:29` vs `plugins/devflow-resolve/commands/resolve.md:71`
**Confidence**: 85%
- Problem: `resolve:orch` Phase 1 (line 29) now scans "the 10 most recent" review directories, but `resolve.md` Step 0c (line 71) still uses "select the latest" with no scan limit. The 10-directory limit was applied consistently for the bug-analysis fallback scan in both files, but the primary review directory scan only received it in resolve:orch. This means `/resolve` (full command) scans all review directories for the primary path, while resolve:orch (ambient) limits to 10. If a user has >10 resolved review directories and the 11th most recent is the only unresolved one, resolve:orch would miss it while `/resolve` would find it. This behavioral divergence between the two resolve paths is a regression risk.
- Fix: Either (a) add the same 10-directory scan limit to `resolve.md` Step 0c step 3 for consistency, or (b) remove the limit from `resolve:orch` Phase 1 line 29 to match resolve.md. The limit makes sense as a performance bound, so option (a) is recommended:
```markdown
# resolve.md line 71, change:
3. **Otherwise:** sort directories by name (timestamps are naturally sortable), select the latest that contains `review-summary.md` (complete review)
# to:
3. **Otherwise:** sort directories by name descending (timestamps are naturally sortable), scan the 10 most recent directories only. Select the first that contains `review-summary.md` (complete review)
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**BugAnalyzer severity-to-category mapping conflates code location with severity** - `shared/agents/bug-analyzer.md:114-116`
**Confidence**: 82%
- Problem: The category mapping maps severity levels to the 3-category structure: CRITICAL/HIGH -> "Issues in Your Changes (BLOCKING)", MEDIUM -> "Issues in Code You Touched (Should Fix)", LOW -> "Pre-existing Issues (Not Blocking)". However, the Reviewer agent determines these categories based on *where* the issue occurs (in your changes vs same function vs untouched code), not severity. A CRITICAL bug in untouched code should still go to "Pre-existing Issues" per the review methodology. The BugAnalyzer uses severity as a proxy for location, which means a LOW severity bug found in newly added code would be categorized as "Pre-existing (Not Blocking)" when it should be "Blocking". This is a semantic mismatch with the Reviewer's 3-category model (applies ADR-004 -- bug-analysis is a separate workflow, but it must remain compatible with `/resolve` parsing).
- Fix: Document that BugAnalyzer focuses only on changed code (diff-first principle per line 124: "Only report bugs in changed code, unless CRITICAL severity"), so the severity-to-category mapping is a reasonable approximation since all reported bugs are in changed code. Add a clarifying comment in the category mapping section:
```markdown
**Category mapping** (for `/resolve` compatibility — approximation since BugAnalyzer focuses on diff-changed code):
```

## Pre-existing Issues (Not Blocking)

(No pre-existing regression issues found.)

## Suggestions (Lower Confidence)

- **resolve.md Step 0c step 4 logic gap for "latest directory already resolved"** - `plugins/devflow-resolve/commands/resolve.md:72` (Confidence: 72%) -- Step 4 says "If latest directory already has `resolution-summary.md`: the review is resolved -- check bug-analysis fallback (step 5b)." But this only checks the *latest* directory. If the latest is resolved but a previous one is unresolved, that unresolved review is skipped in favor of the bug-analysis fallback. This is the pre-existing behavior (not introduced by this PR), but the edge case table change at line 330 now explicitly documents this path, making the gap more visible.

- **BugAnalyzer lacks MEDIUM/LOW subsection headers inside "Should Fix" and "Pre-existing"** - `shared/agents/bug-analyzer.md:162-172` (Confidence: 65%) -- The Reviewer agent output template in the system prompt uses `### MEDIUM` and `### LOW` subsection headers within their respective categories. The BugAnalyzer template omits these severity subsection headers for the Should Fix and Pre-existing sections, using only the category-level `##` headers. If `/resolve` parsing relies on `###` severity subsection headers to extract severity, this could cause the resolver to miss severity classification. However, the resolver extracts severity from the issue metadata (`**Severity**: CRITICAL`), not from section headers, so this is likely benign.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 1 | - |
| Pre-existing | - | - | 0 | 0 |

**Regression Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The primary blocking issue is the inconsistent scan limit between `resolve.md` and `resolve:orch`. The behavior divergence is small but real -- the two resolve paths should agree on directory scanning behavior. The severity-to-category mapping in the BugAnalyzer is a design approximation that works in practice (since BugAnalyzer focuses on changed code) but should be documented. No removed exports, no removed CLI options, no broken return types, no incomplete migrations detected. The output format change from `## Bugs Found` to the 3-category structure is properly aligned with the Reviewer format and `/resolve` parsing expectations. All tests pass (104/104).
