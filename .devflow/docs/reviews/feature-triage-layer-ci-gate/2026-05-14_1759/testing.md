# Testing Review Report

**Branch**: feature/triage-layer-ci-gate -> main
**Date**: 2026-05-14

## Issues in Your Changes (BLOCKING)

(none)

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Missing negative test for `extractIntent` with old INTENT/DEPTH format** - `tests/ambient.test.ts:405-409`
**Confidence**: 82%
- Problem: The new test at line 405 correctly verifies that `hasClassification` rejects the old `INTENT/DEPTH` format (applies ADR-001). However, `extractIntent` is not tested against the same old-format strings. Since `extractIntent` uses the same `CLASSIFICATION_PATTERN`, it should also return `null` for these inputs. The `hasClassification` negative test covers the shared regex, but `extractIntent` has its own code path (`match[1].toUpperCase()`) that deserves explicit verification to lock in the contract.
- Fix: Add a companion test case in the `extractIntent` section:
```typescript
it('returns null for old INTENT/DEPTH format', () => {
  expect(extractIntent(textResult('Devflow: IMPLEMENT/ORCHESTRATED'))).toBeNull();
  expect(extractIntent(textResult('Devflow: DEBUG/GUIDED'))).toBeNull();
});
```

**No test coverage for CI Status Gate behavior across orchestration skills** - `shared/skills/implement:orch/SKILL.md:155-165`, `shared/skills/resolve:orch/SKILL.md:115-129`
**Confidence**: 80%
- Problem: The CI Status Gate is a new phase added to both `implement:orch` and `resolve:orch`. The existing `phase protocol structural validation` tests at line 738 verify that checklist item count matches phase count, and that every orch skill has `Produces:/Requires:` annotations. These structural tests do cover the new phase indirectly (phase count includes the new Phase 7). However, there is no test verifying the CI Status Gate's `SYNC` marker consistency across the three files that share it (`implement:orch`, `resolve:orch`, `resolve-teams.md`). The `<!-- SYNC: ci-status-gate -->` markers were added specifically for cross-file drift prevention, but no test validates that the content between the markers is identical across files.
- Fix: Add a structural validation test:
```typescript
it('CI Status Gate content is synchronized across orch skills and commands', async () => {
  const syncMarker = /<!-- SYNC: ci-status-gate -->([\s\S]*?)<!-- \/SYNC: ci-status-gate -->/;
  
  const files = [
    path.resolve(__dirname, '../shared/skills/implement:orch/SKILL.md'),
    path.resolve(__dirname, '../shared/skills/resolve:orch/SKILL.md'),
    // Add command files that also have the marker
  ];
  
  const contents = await Promise.all(files.map(f => fs.readFile(f, 'utf-8')));
  const blocks = contents.map((c, i) => {
    const match = c.match(syncMarker);
    expect(match, `${files[i]} missing SYNC: ci-status-gate markers`).not.toBeNull();
    return match![1].trim();
  });
  
  for (let i = 1; i < blocks.length; i++) {
    expect(blocks[i], `CI Status Gate drifted between ${files[0]} and ${files[i]}`).toBe(blocks[0]);
  }
});
```

## Pre-existing Issues (Not Blocking)

### MEDIUM

**No test for `extractDepth` with new triage output format edge cases** - `tests/ambient.test.ts:420-423`
**Confidence**: 80%
- Problem: The `extractDepth` tests only check the canonical `Scope: GUIDED` and `Scope: ORCHESTRATED` outputs. The new triage skills emit this exact format, but there are no tests for edge cases such as extra whitespace (`Scope:  GUIDED`), lowercase (`scope: guided`), or the old depth format embedded in intent strings (`IMPLEMENT/ORCHESTRATED` should not extract a depth). The `CLASSIFICATION_PATTERN` tests at line 430 already validate whitespace/casing robustness for classification, suggesting this was intentionally explored for that regex but not for `SCOPE_PATTERN`.
- Fix: Add edge case coverage:
```typescript
it('extractDepth handles casing and whitespace variations', () => {
  expect(extractDepth(textResult('scope: guided'))).toBe('GUIDED');
  expect(extractDepth(textResult('Scope:  ORCHESTRATED'))).toBe('ORCHESTRATED');
});

it('extractDepth does not match old slash format', () => {
  expect(extractDepth(textResult('Devflow: IMPLEMENT/ORCHESTRATED'))).toBeNull();
});
```

**Triage skill content validation is structural only** - `tests/ambient.test.ts:587-600`
**Confidence**: 80%
- Problem: The test `all 7 triage skills exist with correct frontmatter` validates that each triage skill has the right frontmatter (`name`, `user-invocable: false`, `Skill` in allowed-tools) and references both `:guided` and `:orch` targets. This is good structural coverage. However, there is no test validating the functional contract of triage skills: specifically, that each triage skill contains a `Scope Assessment` section (the section that performs the actual routing logic) and an `Orchestration Hint Override` section (the keyword override mechanism). These are the two behavioral pillars of the triage layer.
- Fix: Add to the existing `all 7 triage skills exist with correct frontmatter` test:
```typescript
expect(content, `${intent}:triage must have Scope Assessment section`).toContain('## Scope Assessment');
expect(content, `${intent}:triage must have Orchestration Hint Override`).toContain('## Orchestration Hint Override');
```

## Suggestions (Lower Confidence)

- **Missing test for CHAT removal from CLASSIFICATION_PATTERN against full intent list** - `tests/integration/helpers.ts:5` (Confidence: 70%) -- The `CLASSIFICATION_PATTERN` regex was updated to remove CHAT, but the existing `router covers all non-CHAT intents` test validates the router table, not the regex itself. A test asserting that every non-CHAT intent from classification-rules matches `CLASSIFICATION_PATTERN` would prevent future drift between the regex and the rules file.

- **No integration test for triage-to-orch skill chain** - `tests/integration/ambient-activation.test.ts` (Confidence: 65%) -- The integration tests were updated in the initial commit to match the new triage format, but the existing tests verify classification and router loading. There is no integration test verifying the full triage chain: classification -> router -> triage skill -> target orch/guided skill. This is a deeper integration concern and may be intentionally deferred.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 0 | 0 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Testing Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The test changes in this PR are well-executed. The negative test for the old INTENT/DEPTH format (applies ADR-001 -- clean break philosophy: explicitly verify old format is not matched) is a strong addition that locks in the format migration. The removal of the dead CHAT variant from `CLASSIFICATION_PATTERN` is clean and correct. The existing structural validation tests (`phase protocol structural validation`, `router structural validation`, `all 7 triage skills exist`) provide good coverage for the new triage skills and phase renumbering.

The two should-fix items are incremental improvements: (1) extending the negative format test to `extractIntent` for completeness, and (2) adding a SYNC marker drift test to leverage the newly introduced `<!-- SYNC: ci-status-gate -->` markers. Neither is blocking, but both would strengthen the test suite's ability to catch regressions in the areas this PR specifically modified.
