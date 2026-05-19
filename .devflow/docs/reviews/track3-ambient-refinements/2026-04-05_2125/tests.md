# Tests Review Report

**Branch**: track3/ambient-refinements -> main
**Date**: 2026-04-05

## Issues in Your Changes (BLOCKING)

### CRITICAL

(none)

### HIGH

**`hasRequiredSkills()` uses `.includes()` substring matching -- false positives for short skill names** - `tests/integration/helpers.ts:220-223`
**Confidence**: 95%
- Problem: `hasRequiredSkills` checks `result.skills.some((s) => s.includes(name))`. When `required` contains a short name like `'implement'`, it would match both `'implement:orch'` and plain `'implement'` indiscriminately. Similarly, `'review'` matches `'review:orch'`, `'review-methodology'`, `'self-review'`, etc. While the uncommitted changes already update test data to use `'implement:orch'` in ORCHESTRATED tests, the GUIDED tests still use short names like `['explore']` (line 48 of ambient-activation.test.ts committed version) as `expected` values in soft assertions -- these pass trivially via substring match against `'explore:orch'`, hiding whether the model actually loaded the exact skill expected.
- Fix: Use exact match or a bounded match. The simplest correct approach:
```typescript
export function hasRequiredSkills(result: StreamResult, required: string[]): boolean {
  return required.every((name) =>
    result.skills.some((s) => s === name || s.endsWith(`:${name}`) || s === `devflow:${name}`),
  );
}
```
Alternatively, if substring matching is intentional for flexible matching, document this explicitly and add a test that verifies `hasRequiredSkills(result, ['review'])` does NOT match when the only loaded skill is `'review-methodology'`.

### MEDIUM

**`skill-references.test.ts` OLD_SKILL_NAMES list does not include track3 short names** - `tests/skill-references.test.ts:721-737`
**Confidence**: 90%
- Problem: The "no old V2-renamed skill names" test guards against stale skill names leaking into test data. It lists 10 old names (e.g., `core-patterns`, `git-safety`). However, the track3 rename introduced 7 new old names: `implement`, `debug`, `plan`, `review`, `resolve`, `explore`, `pipeline` (bare, without `:orch`). These were orchestration skill names that are now renamed to `implement:orch`, etc. Without adding them to OLD_SKILL_NAMES, if someone writes `'implement'` in a test string literal (meaning the old skill, not the command), this test will not catch it. The COMMAND_REFS set does include `implement`, `debug`, etc., so `devflow:implement` references are filtered out by the `filterNonSkillRefs` function -- but bare `'implement'` as a string literal in test data (e.g., `hasRequiredSkills(r, ['implement'])`) would not be caught.
- Fix: Add the 7 track3 old short names to OLD_SKILL_NAMES with appropriate regexes that exclude COMMAND_REFS contexts and the `SHADOW_RENAMES` allowlist. This requires careful regex construction to avoid false positives with command refs. At minimum, add `'implementation-orchestration'`, `'debug-orchestration'`, `'plan-orchestration'`, `'review-orchestration'`, `'resolve-orchestration'`, `'pipeline-orchestration'` -- these are unambiguously old names with no command-ref overlap:
```typescript
['implementation-orchestration', /(?<![\w])implementation-orchestration(?![\w])/g],
['debug-orchestration', /(?<![\w])debug-orchestration(?![\w])/g],
['plan-orchestration', /(?<![\w])plan-orchestration(?![\w])/g],
['review-orchestration', /(?<![\w])review-orchestration(?![\w])/g],
['resolve-orchestration', /(?<![\w])resolve-orchestration(?![\w])/g],
['pipeline-orchestration', /(?<![\w])pipeline-orchestration(?![\w])/g],
['ambient-router', /(?<![\w])ambient-router(?![\w])/g],
['implementation-patterns', /(?<!devflow-)(?<![\w])implementation-patterns(?![\w])/g],
['search-first', /(?<![\w])search-first(?![\w])/g],
```

**Missing `prefixSkillName`/`unprefixSkillName` test cases for colon-containing names** - `tests/skill-namespace.test.ts:28-69`
**Confidence**: 88%
- Problem: The skill namespace tests (`prefixSkillName`, `unprefixSkillName`, roundtrip) only test simple hyphenated names (`software-design`, `typescript`, `go`). The track3 rename introduces names with colons (`implement:orch`, `debug:orch`, etc.) -- these are the first skill names with internal colons beyond the `devflow:` namespace prefix. The `prefixSkillName('implement:orch')` should produce `'devflow:implement:orch'` and `unprefixSkillName('devflow:implement:orch')` should produce `'implement:orch'`. The implementation works (prefix check is `startsWith('devflow:')`, strip is `slice(7)`), so this is correct by inspection -- but there are no explicit tests asserting this.
- Fix: Add test cases:
```typescript
it('handles colon-containing skill names', () => {
  expect(prefixSkillName('implement:orch')).toBe('devflow:implement:orch');
  expect(prefixSkillName('review:orch')).toBe('devflow:review:orch');
});
// In unprefixSkillName:
it('handles colon-containing skill names', () => {
  expect(unprefixSkillName('devflow:implement:orch')).toBe('implement:orch');
  expect(unprefixSkillName('devflow:pipeline:orch')).toBe('pipeline:orch');
});
// In roundtrip:
it('roundtrips colon-containing names', () => {
  for (const name of ['implement:orch', 'debug:orch', 'review:orch']) {
    expect(unprefixSkillName(prefixSkillName(name))).toBe(name);
  }
});
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**`DEVFLOW_PREAMBLE` in helpers.ts says `State: Devflow:` but `CLASSIFICATION_PATTERN` regex is case-insensitive** - `tests/integration/helpers.ts:3,23`
**Confidence**: 82%
- Problem: The `DEVFLOW_PREAMBLE` uses `State: Devflow: INTENT/DEPTH` (capitalized "Devflow") while the preamble hook uses the same casing. The `CLASSIFICATION_PATTERN` regex is `devflow:\s*...` with the `/i` flag, so this works. However, the `hasDevFlowBranding` function at line 212 also uses a case-insensitive regex. The test at ambient.test.ts line 349 asserts `hasDevFlowBranding(textResult('Devflow: IMPLEMENT/GUIDED...'))`. This is fine functionally, but there is no test that verifies the `CLASSIFICATION_PATTERN` actually matches the exact casing that the preamble hook instructs the model to output (`Devflow:` with capital D). If the regex were accidentally changed to case-sensitive, the test would still pass but real-world classification detection would break for models that output `Devflow:` vs `devflow:`.
- Fix: Add a targeted test:
```typescript
it('classification pattern matches exact casing from preamble', () => {
  // The preamble instructs: "State: Devflow: INTENT/DEPTH"
  const exact = 'Devflow: IMPLEMENT/GUIDED. Loading: devflow:router.';
  expect(hasClassification(textResult(exact))).toBe(true);
});
```

**`build.test.ts` has no explicit test for colon-containing skill directories** - `tests/build.test.ts:27-43`
**Confidence**: 80%
- Problem: `build.test.ts` verifies that every skill in `getAllSkillNames()` has a matching `shared/skills/{name}` directory and `SKILL.md`. This implicitly covers `implement:orch` etc. since those names are now in the registry. However, there is no explicit assertion that the filesystem handles colons in directory names correctly on the current platform. On macOS (darwin), colons are technically allowed in directory names but some tools may mishandle them. The existing test does pass (confirmed via test run), but an explicit test would serve as a smoke test for cross-platform compatibility.
- Fix: Low priority. The existing dynamic test `every skill referenced in plugins exists in shared/skills/` already covers this. Consider adding a comment noting that `:orch` names exercise colon-in-path handling. No code change needed.

## Pre-existing Issues (Not Blocking)

### MEDIUM

**`isFirstToolASkill` is functionally identical to `hasSkillInvocations`** - `tests/integration/helpers.ts:188-192`
**Confidence**: 92%
- Problem: `isFirstToolASkill()` was added as a "primary assertion for GUIDED/ORCHESTRATED classification" but its implementation is just `return result.skills.length > 0`, which is identical to `hasSkillInvocations()`. It does not actually verify that the first tool_use event is a Skill invocation (as its JSDoc claims). This is dead/misleading code.
- Fix: Either implement the "first tool" logic properly by tracking tool_use order in `runClaudeStreaming`, or remove `isFirstToolASkill` and use `hasSkillInvocations` directly.

**`init-logic.test.ts` shadow rename test only covers `core-patterns -> software-design`** - `tests/init-logic.test.ts:776-854`
**Confidence**: 85%
- Problem: The shadow migration ordering test uses only one rename pair (`core-patterns` -> `software-design`). It does not cover the new `:orch` rename pairs (e.g., `implement` -> `implement:orch`, `debug-orchestration` -> `debug:orch`). These colon-containing target names are novel and could theoretically fail in filesystem operations.
- Fix: Add a parallel test case using an `:orch` rename pair to verify shadow migration handles colons in target directory names.

## Suggestions (Lower Confidence)

- **No negative test for `hasRequiredSkills` false positives** - `tests/integration/helpers.ts:220` (Confidence: 72%) -- There is no test that `hasRequiredSkills({ skills: ['review-methodology'] }, ['review'])` returns `false`, which would reveal the substring-match issue.

- **ORCHESTRATED tests assert short names in committed version, `:orch` names only in uncommitted** - `tests/integration/ambient-activation.test.ts` (Confidence: 65%) -- The committed version uses `['implement', 'patterns']` while uncommitted fixes this to `['implement:orch', 'patterns']`. These are integration tests requiring API calls, so the committed version may have been testing against pre-rename skill names. Ensure the uncommitted changes are included in the final commit.

- **No test for `removeLegacyAmbientHook` edge case: settings with both old AND new hooks plus non-hook keys** - `tests/ambient.test.ts:162-204` (Confidence: 60%) -- The `removeLegacyAmbientHook` tests cover basic cases but don't test preserving non-UserPromptSubmit hook types alongside legacy removal.

## Summary
| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 2 | 0 |
| Pre-existing | 0 | 0 | 2 | 0 |

**Tests Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The test suite is well-structured with 590 passing tests and excellent coverage infrastructure (skill-references integrity tests, build validation, namespace tests). The primary concern is the `hasRequiredSkills()` substring-match behavior which can mask incorrect skill loading in integration tests. The missing OLD_SKILL_NAMES entries reduce the stale-name detection safety net for the track3 renames. The missing `prefixSkillName`/`unprefixSkillName` tests for colon-containing names are a coverage gap for a novel naming pattern introduced in this branch.
