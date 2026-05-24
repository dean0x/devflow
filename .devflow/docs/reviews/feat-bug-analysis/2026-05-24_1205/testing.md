# Testing Review Report

**Branch**: feat/bug-analysis -> main
**Date**: 2026-05-24

## Issues in Your Changes (BLOCKING)

### HIGH

**Unsafe `.slice(.search())` pattern can silently pass when anchor is missing** - `tests/resolve/bug-analysis-fallback.test.ts:126`
**Confidence**: 90%
- Problem: The test at line 126 uses `phase1.slice(phase1.search(/bug.analysis/i))` to extract the bug-analysis portion of Phase 1. If `bug.analysis` is not found, `.search()` returns `-1`, and `.slice(-1)` returns the last character of the string. The subsequent `.toMatch(/10\s+(most recent|directories)|scan.*10|10.*scan/i)` assertion could silently pass if the last character happens to contain part of a match, or would fail with a confusing error message rather than indicating the real problem (missing anchor).
- Impact: The test could pass even when the bug-analysis fallback text is absent from Phase 1, making it a false-passing test. Currently the source content does contain the anchor (confirmed), so this is not an active false positive — but it is a latent defect that would mask a future regression.
- Fix: Add an explicit assertion that the search succeeds before slicing:
```typescript
it('Phase 1 bug-analysis fallback also scans at most 10 most recent directories', () => {
  const phase1 = extractSection(content, '## Phase 1:', '## Phase 2:');
  const bugAnalysisIdx = phase1.search(/bug.analysis/i);
  expect(bugAnalysisIdx, 'Phase 1 should contain bug-analysis reference').not.toBe(-1);
  const bugAnalysisPart = phase1.slice(bugAnalysisIdx);
  expect(bugAnalysisPart).toMatch(/10\s+(most recent|directories)|scan.*10|10.*scan/i);
});
```
- Note: The same pattern exists in the pre-existing test at `tests/resolve/bug-analysis-fallback.test.ts:42` (Group 1, "fallback excludes directories"), but that test was not modified in this PR so it is classified as pre-existing.

**`plugins.test.ts` does not verify newly added skills in bug-analysis plugin** - `tests/plugins.test.ts:251-266`
**Confidence**: 85%
- Problem: The existing test `devflow-bug-analysis declares correct agents, skills, and command` (line 251) only checks for `agent-teams`, `worktree-support`, and `apply-feature-knowledge`. This PR added 5 new skills to the plugin (`apply-decisions`, `complexity`, `consistency`, `regression`, `reliability`, `security`) but the test was not updated to cover them. The test will pass but does not pin the new structural contract.
- Impact: A future change could silently remove one of the newly added skills (e.g., `security` or `regression`) without any test catching it. These skills are declared in the bug-analyzer agent frontmatter, so their absence from the plugin manifest would cause runtime skill resolution failures.
- Fix: Add assertions for the new skills:
```typescript
it('devflow-bug-analysis declares correct agents, skills, and command', () => {
  const bugAnalysis = DEVFLOW_PLUGINS.find(p => p.name === 'devflow-bug-analysis');
  expect(bugAnalysis, 'devflow-bug-analysis should exist in registry').toBeDefined();
  expect(bugAnalysis!.agents).toContain('git');
  expect(bugAnalysis!.agents).toContain('bug-analyzer');
  expect(bugAnalysis!.agents).toContain('synthesizer');
  expect(bugAnalysis!.skills).toContain('agent-teams');
  expect(bugAnalysis!.skills).toContain('worktree-support');
  expect(bugAnalysis!.skills).toContain('apply-feature-knowledge');
  // New skills matching bug-analyzer.md frontmatter declarations
  expect(bugAnalysis!.skills).toContain('apply-decisions');
  expect(bugAnalysis!.skills).toContain('security');
  expect(bugAnalysis!.skills).toContain('reliability');
  expect(bugAnalysis!.skills).toContain('regression');
  expect(bugAnalysis!.skills).toContain('consistency');
  expect(bugAnalysis!.skills).toContain('complexity');
  expect(bugAnalysis!.commands).toContain('/bug-analysis');
  expect(bugAnalysis!.optional).toBeFalsy();
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Frontmatter skill assertions (Group 8) do not cover all declared skills** - `tests/bug-analysis/structural.test.ts:298-312`
**Confidence**: 82%
- Problem: Group 8 tests that the bug-analyzer frontmatter declares `devflow:regression`, `devflow:consistency`, and `devflow:complexity`, but the agent frontmatter also declares `devflow:security`, `devflow:reliability`, `devflow:worktree-support`, `devflow:apply-decisions`, and `devflow:apply-feature-knowledge`. The test covers 3 of 8 frontmatter skills. While the other 5 may be considered "obvious" dependencies, incomplete coverage means a future refactor removing `devflow:security` from the bug-analyzer frontmatter would not be caught.
- Impact: Partial structural coverage. The 3 tested skills were the ones added in this PR's batch-2 commit, so the omission is understandable (testing what changed), but the describe block title "frontmatter skill declarations" implies comprehensive coverage.
- Fix: Either expand to cover all 8 frontmatter skills, or rename the describe block to "frontmatter declares batch-2 skill additions" to set accurate expectations.

**Repeated `extractSection` calls in Group 5 (resolve:orch)** - `tests/resolve/bug-analysis-fallback.test.ts:114-148`
**Confidence**: 80%
- Problem: The `resolve:orch SKILL.md` test group (Group 5) calls `extractSection(content, '## Phase 1:', '## Phase 2:')` four times (lines 114, 119, 124, 147) and `extractSection(content, '## Phase 3:', '## Phase 4:')` twice (lines 131, 136). This is the exact pattern that the prior resolution cycle fixed in Groups 1-4 of the same file — hoisting `loadFile` and `extractSection` calls to describe scope.
- Impact: Not a correctness issue, but it contradicts the refactoring pattern established in the same PR (commit `eb12a02` — "deduplicate file loads and section extractions"). The inconsistency suggests the Group 5 tests were added after the deduplication pass.
- Fix: Hoist the repeated extractions to describe scope:
```typescript
describe('resolve:orch SKILL.md — bug-analysis fallback (Phase 1)', () => {
  const content = loadFile('shared/skills/resolve:orch/SKILL.md');
  const phase1 = extractSection(content, '## Phase 1:', '## Phase 2:');
  const phase3 = extractSection(content, '## Phase 3:', '## Phase 4:');

  it('Phase 1 contains bug-analysis fallback path', () => {
    expect(phase1).toMatch(/bug.analysis/i);
  });
  // ... remaining tests use phase1 / phase3 directly
});
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Same unsafe `.slice(.search())` pattern in pre-existing test** - `tests/resolve/bug-analysis-fallback.test.ts:42`
**Confidence**: 88%
- Problem: Line 42 (`const fallbackSection = step0c.slice(step0c.search(/5b|bug.analysis fallback/i))`) has the same `-1` risk as the new test at line 126. This line was not modified in this PR (only the surrounding `step0c` extraction was hoisted), so it is pre-existing.
- Fix: Same guard — assert the search index is not `-1` before slicing.

## Suggestions (Lower Confidence)

- **Missing negative/boundary tests for `extractSection` with bad anchors** - `tests/resolve/bug-analysis-fallback.test.ts` (Confidence: 65%) — The `extractSection` helper throws on missing anchors, but no test in this PR verifies that behavior for the new section boundaries (`## Phase 1:` / `## Phase 2:`, `## Error Handling` / `## Phase Completion Checklist`). If the source file restructures these headings, tests would throw cryptic errors rather than clear failures.

- **Group 7 severity-to-category mapping tests use `.` which matches any character** - `tests/bug-analysis/structural.test.ts:272-280` (Confidence: 70%) — The regex `/CRITICAL.*BLOCKING|HIGH.*BLOCKING/s` uses `.*` which spans across any content. This means it would pass if "CRITICAL" and "BLOCKING" appeared in completely unrelated sections. The assertion validates presence in the full agent content, not proximity. Given that these are structural contract tests (not behavioral), this is acceptable but weaker than section-scoped assertions.

- **No test verifies `plugin.json` and `plugins.ts` skills arrays are in sync** - `tests/build.test.ts` (Confidence: 72%) — Both `plugin.json` and `plugins.ts` now list the same 9 skills for `devflow-bug-analysis`, but no test enforces that they stay synchronized. The build system distributes based on `plugin.json`, while the CLI uses `plugins.ts`. A drift between them could cause skills to be distributed but not listed (or vice versa). This applies to all plugins, not just bug-analysis.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 2 | 0 | - |
| Should Fix | - | 0 | 2 | - |
| Pre-existing | - | - | 1 | 0 |

**Testing Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The test changes are well-structured and follow established patterns (behavior-focused structural contract tests, Arrange-Act-Assert, clear naming). The deduplication refactor in Groups 1-4 is a genuine quality improvement. The new Group 5 (resolve:orch) and Groups 7-8 (bug-analyzer) provide meaningful coverage. However, the unsafe `.slice(.search())` pattern in Group 5 is a latent defect that should be addressed, and the `plugins.test.ts` should be updated to pin the newly added skills. The inconsistent deduplication in Group 5 is minor but worth fixing while the code is fresh. Applies ADR-004 — the separate test file structure for bug-analysis (`tests/bug-analysis/`) correctly mirrors the architectural decision to keep bug-analysis as a completely independent workflow.
