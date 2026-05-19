# Tests Review Report

**Branch**: fix/ambient-skill-loading -> main
**Date**: 2026-03-20

## Issues in Your Changes (BLOCKING)

### HIGH

**Integration tests rely on non-deterministic LLM output for GUIDED/ORCHESTRATED assertions** - `tests/integration/ambient-activation.test.ts:72-91`
**Confidence**: 85%
- Problem: The new "loads skills for GUIDED classification" and "loads skills for ORCHESTRATED classification" integration tests assert that `hasClassification(output)` is true and `hasSkillLoading(output)` is true, but as the file's own `KNOWN LIMITATION` comment acknowledges, `claude -p` mode does not reliably trigger classification. These tests will be flaky in CI or any automated runner. The comment says "GUIDED/ORCHESTRATED tests may fail in -p mode" -- yet the tests are written with hard `expect(...).toBe(true)` assertions with no conditional skip.
- Impact: Flaky integration tests erode trust in the test suite. Anyone running `npm run test:integration` will get non-deterministic failures.
- Fix: Either gate these tests with a `.skip` or `.todo` annotation (as with the existing `describe.skipIf` for CLI availability), or restructure to accept that classification may not appear:
```typescript
// Option 1: Mark as skip with explanation
it.skip('loads skills for GUIDED classification (requires interactive session)', () => {
  // ...
});

// Option 2: Conditional assertion that documents the limitation
it('loads skills for GUIDED classification', () => {
  const output = runClaude('add a login form with email and password fields');
  if (hasClassification(output)) {
    expect(hasSkillLoading(output)).toBe(true);
    const skills = extractLoadedSkills(output);
    expect(skills.length).toBeGreaterThan(0);
  }
  // In -p mode, model may skip classification entirely -- not a failure
});
```

### MEDIUM

**Missing test for `formatDryRunPlan` deduplication behavior** - `tests/uninstall-logic.test.ts:68-106`
**Confidence**: 82%
- Problem: `formatDryRunPlan` explicitly deduplicates inputs with `[...new Set(assets.skills)]` (line 62 of `uninstall.ts`), but no test verifies this deduplication. If the dedup logic were removed, no test would fail.
- Impact: The deduplication is clearly intentional (protects against duplicate skill names from overlapping plugin manifests), but untested behavior can silently regress.
- Fix: Add a test case:
```typescript
it('deduplicates repeated asset names', () => {
  const plan = formatDryRunPlan({
    skills: ['core-patterns', 'core-patterns', 'typescript'],
    agents: ['coder', 'coder'],
    commands: ['/implement'],
  });
  expect(plan).toContain('Skills (2)');
  expect(plan).toContain('Agents (1)');
});
```

**Missing test coverage for EXPLORE and CHAT intents** - `tests/ambient.test.ts:200-205`
**Confidence**: 80%
- Problem: The `CLASSIFICATION_PATTERN` regex in `helpers.ts:3` supports six intents (`IMPLEMENT|DEBUG|REVIEW|PLAN|EXPLORE|CHAT`), but `extractIntent` is only tested with four: IMPLEMENT, DEBUG, REVIEW, PLAN. EXPLORE and CHAT are untested.
- Impact: If the regex were accidentally modified to drop EXPLORE or CHAT, no unit test would catch it.
- Fix: Add test cases:
```typescript
expect(extractIntent('Ambient: EXPLORE/QUICK. Loading: search-first.')).toBe('EXPLORE');
expect(extractIntent('Ambient: CHAT/QUICK.')).toBe('CHAT');
```

## Issues in Code You Touched (Should Fix)

### MEDIUM

**Duplicated AMBIENT_PREAMBLE string across hook script and test helper** - `tests/integration/helpers.ts:18-19`, `scripts/hooks/ambient-prompt:42`
**Confidence**: 82%
- Problem: The ambient preamble text is defined independently in both `scripts/hooks/ambient-prompt` (shell script, line 42) and `tests/integration/helpers.ts` (TypeScript, line 18-19). They happen to match today, but if one is updated without the other, integration tests will inject a stale preamble that no longer matches production behavior. This already nearly happened in this PR -- the preamble was updated in the hook script (adding the "If GUIDED or ORCHESTRATED, you MUST load" sentence) and the helper had to be updated separately to match.
- Impact: Silent divergence between test preamble and production preamble would make integration tests unreliable.
- Fix: Extract the preamble to a single shared constant (e.g., in a shared config file that both the build/test systems can reference), or at minimum add a test that reads the hook script and verifies the preamble substring matches:
```typescript
it('preamble matches ambient-prompt hook script', () => {
  const hookScript = readFileSync(
    path.join(__dirname, '../../scripts/hooks/ambient-prompt'),
    'utf-8',
  );
  expect(hookScript).toContain(AMBIENT_PREAMBLE);
});
```

## Pre-existing Issues (Not Blocking)

_No critical pre-existing issues identified._

## Suggestions (Lower Confidence)

- **No test for `--dry-run` commander integration** - `src/cli/commands/uninstall.ts:112-217` (Confidence: 70%) -- The `--dry-run` flag's action handler logic (scope detection, extras detection, plan formatting) is only indirectly tested via the pure `formatDryRunPlan` unit test. The wiring logic (lines 193-217) that calls `computeAssetsToRemove` and builds the `extras` array is untested. Consider a lightweight integration test.

- **Integration tests duplicate GUIDED prompt across test cases** - `tests/integration/ambient-activation.test.ts:48,74` (Confidence: 65%) -- The same prompt "add a login form with email and password fields" is used in two separate test cases (lines 48 and 74), meaning two identical API calls. Consider extracting shared prompts to a constant or reusing the result.

- **`extractLoadedSkills` strips trailing period from input but test asserts clean extraction** - `tests/ambient.test.ts:234-238` (Confidence: 60%) -- The test on line 234 passes a string ending in `.` ("typescript.") but expects `['typescript']` without the period. This works because the regex stops before `.`, but the test does not make this boundary behavior explicit. A comment or dedicated edge-case test would clarify intent.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 1 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Tests Score**: 7/10
**Recommendation**: APPROVED_WITH_CONDITIONS

The new unit tests for classification helpers and `formatDryRunPlan` are well-structured, follow Arrange-Act-Assert, and test behavior rather than implementation. The pure function extraction pattern (`formatDryRunPlan` exported separately from the commander action) is good design for testability. The main concern is the two new integration tests for GUIDED/ORCHESTRATED skill loading which will be flaky due to the known `-p` mode limitation -- these should be skipped or restructured before merge to avoid polluting integration test results.
