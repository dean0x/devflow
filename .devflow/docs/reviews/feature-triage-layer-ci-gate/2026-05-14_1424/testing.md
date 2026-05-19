# Testing Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**Missing negative test: `extractDepth` no longer matches old `INTENT/DEPTH` format** - `tests/integration/helpers.ts:5-6`, `tests/ambient.test.ts:414-417`
**Confidence**: 85%
- Problem: The `extractDepth` function was refactored from parsing `CLASSIFICATION_PATTERN` (which matched `Devflow: INTENT/DEPTH`) to a new `SCOPE_PATTERN` (which matches `Scope: GUIDED|ORCHESTRATED`). The test `'extracts depth from triage output'` only tests the positive case with the new format. There is no test verifying that the old format (`Devflow: IMPLEMENT/GUIDED`) is **not** parsed by `extractDepth` — confirming the intentional breaking change. Without this, a regression that re-introduces the old pattern could silently change behavior. (applies ADR-001 — clean break philosophy means the old format should be explicitly non-functional.)
- Fix: Add a negative assertion in the `'extracts depth from triage output'` test:
```typescript
it('extracts depth from triage output', () => {
  expect(extractDepth(textResult('Scope: GUIDED'))).toBe('GUIDED');
  expect(extractDepth(textResult('Scope: ORCHESTRATED'))).toBe('ORCHESTRATED');
  // Old INTENT/DEPTH format should NOT be parsed (clean break — ADR-001)
  expect(extractDepth(textResult('Devflow: IMPLEMENT/GUIDED'))).toBeNull();
});
```

### MEDIUM

**Integration tests assume deterministic triage-then-skill ordering without testing triage-only failures** - `tests/integration/ambient-activation.test.ts:67-151`
**Confidence**: 82%
- Problem: All GUIDED-tier integration tests now require **three** skills in sequence: `['router', '{intent}:triage', '{intent}:guided']`. If the triage skill runs but decides ORCHESTRATED instead of GUIDED (or vice versa), the test fails with a generic `expect(passed).toBe(true)` without diagnosing *which* skill was missing. The test names say "GUIDED" but the prompts are not guaranteed to trigger GUIDED vs ORCHESTRATED from the triage skill — they depend on LLM classification. The tests lack a diagnostic assertion showing whether the triage skill itself loaded but routed differently than expected.
- Fix: Add a fallback diagnostic when `passed` is false — log which of the three required skills were present/absent:
```typescript
if (!passed) {
  const skills = getSkillInvocations(result);
  const missing = ['router', `${intent}:triage`, `${intent}:guided`].filter(
    s => !hasRequiredSkills(result, [s])
  );
  console.warn(`Missing skills: [${missing.join(', ')}]. Got: [${skills.join(', ')}]`);
}
```
This already exists for ORCHESTRATED tests (`if (!passed) console.warn(...)`) but is missing from all GUIDED tests.

**No test for `CLASSIFICATION_PATTERN` rejection of old slash-delimited format** - `tests/integration/helpers.ts:5`
**Confidence**: 83%
- Problem: `CLASSIFICATION_PATTERN` changed from matching `INTENT/DEPTH` (with `/`) to matching `INTENT.` (with `.`). The CLASSIFICATION_PATTERN variation tests at `tests/ambient.test.ts:424-433` test the new format but do not verify the old format is rejected. Since the regex changed fundamentally (from capturing two groups with `/` separator to matching a period after intent), there should be at least one negative test confirming `Devflow: IMPLEMENT/GUIDED` no longer matches `hasClassification`.
- Fix: Add to the `'CLASSIFICATION_PATTERN matches model output variations'` test:
```typescript
// Old INTENT/DEPTH format must NOT match (clean break)
expect(hasClassification(textResult('Devflow: IMPLEMENT/GUIDED'))).toBe(false);
expect(hasClassification(textResult('Devflow: DEBUG/ORCHESTRATED'))).toBe(false);
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`parseWorkflowTable` regex accepts any two-column pipe row, including headers/separators** - `tests/ambient.test.ts:511`
**Confidence**: 80%
- Problem: The simplified regex `/^\|\s*(\w+)\s*\|\s*(.+?)\s*\|$/` matches any row with two pipe-delimited columns. The only filter is `match[1] === 'Intent'` which skips the header row, but the markdown separator row `| --- | --- |` would also match (with `---` as intent and `---` as skill). While this doesn't currently cause a test failure because `---` is not in the intent list being checked, it makes the parser fragile.
- Fix: Add a guard to skip separator rows:
```typescript
if (!match || match[1] === 'Intent' || match[1].startsWith('-')) continue;
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**Integration test helper `runClaudeStreamingWithRetry` uses hardcoded model names** - `tests/integration/helpers.ts:183-193`
**Confidence**: 80%
- Problem: The function hardcodes `'haiku'` and `'sonnet'` as model names. If model naming changes (e.g., versioned model names), these will silently fail. This is a pre-existing pattern, not introduced by this PR.

## Suggestions (Lower Confidence)

- **Missing test for RELEASE intent in `extractIntent`** - `tests/ambient.test.ts:405-412` (Confidence: 70%) — The `extractIntent` test covers IMPLEMENT, DEBUG, REVIEW, PLAN, RESOLVE, and RESEARCH but omits RELEASE (and EXPLORE, PIPELINE, CHAT). While the regex covers them via alternation, RELEASE is a new addition to the CLASSIFICATION_PATTERN and deserves explicit coverage.

- **No unit test for triage skill `Scope:` output format contract** - `tests/ambient.test.ts:581-594` (Confidence: 65%) — The `'all 7 triage skills exist with correct frontmatter'` test validates frontmatter fields but does not verify that each triage skill's content contains the `Scope: GUIDED` / `Scope: ORCHESTRATED` output format that `extractDepth` depends on. A drift between the triage skill output format and the `SCOPE_PATTERN` regex would not be caught.

- **ORCHESTRATED integration tests lack diagnostic for triage-vs-orch misroute** - `tests/integration/ambient-activation.test.ts:156-269` (Confidence: 65%) — The orchestrated tests now require `['{intent}:triage', '{intent}:orch']` but if triage routes to :guided instead, the test just says "FAIL" without explaining the misroute. Adding `extractDepth(result)` to the `console.warn` would clarify whether triage ran but chose wrong depth.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 1 | 0 |

**Testing Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The test changes are well-structured and correctly reflect the architectural shift from router-level depth classification to per-intent triage skills. Tests pass, structural validation is strong (the new `'all 7 triage skills exist with correct frontmatter'` test is excellent), and the integration tests properly require the triage skill in the invocation chain. The main gap is the absence of negative tests confirming the old `INTENT/DEPTH` format is no longer recognized — important for a clean-break refactor (applies ADR-001, avoids PF-001). The GUIDED-tier integration tests also lack the diagnostic `console.warn` that ORCHESTRATED tests have, making failures harder to triage.
