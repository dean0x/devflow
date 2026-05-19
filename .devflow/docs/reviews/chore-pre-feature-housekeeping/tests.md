# Tests Review Report

**Branch**: chore/pre-feature-housekeeping -> main
**Date**: 2026-03-20

## Issues in Your Changes (BLOCKING)

### HIGH

**Skimmer test uses shared mutable state across `it()` blocks via test-ordering dependency** - `tests/skimmer-agent.test.ts:22-26`
**Confidence**: 90%
- Problem: The `content` and `tools` variables are declared as `let` at suite scope (line 22-23), then assigned inside the first `it('loads the agent file')` block (lines 23-25). All subsequent tests (lines 28-56) depend on those variables being populated. Vitest runs tests in definition order by default, but this creates an implicit ordering dependency between test cases. If any test is run in isolation (e.g., `.only`), or if the suite is ever configured with `shuffle: true`, 5 of 6 tests will fail with `undefined` values. This is a classic brittle test pattern — tests should be independently executable.
- Fix: Move the file loading to a `beforeAll` or `beforeEach` block:

```typescript
describe('skimmer agent', () => {
  let content: string;
  let tools: string[];

  beforeAll(async () => {
    content = await fs.readFile(AGENT_PATH, 'utf-8');
    tools = parseToolsFromFrontmatter(content);
  });

  it('has tools restricted to Bash and Read only', () => {
    expect(tools).toHaveLength(2);
    expect(tools).toContain('Bash');
    expect(tools).toContain('Read');
  });

  // ... remaining tests use content/tools directly
});
```

This removes the load test (whose only purpose was side-effect setup) and makes all tests independently runnable.

### MEDIUM

**Skimmer test "loads the agent file" conflates setup with assertion** - `tests/skimmer-agent.test.ts:23-26`
**Confidence**: 85%
- Problem: The `it('loads the agent file')` test exists purely as a setup step — it has no assertion of its own. This violates the Arrange-Act-Assert pattern; a test should verify something meaningful. If the file fails to load, the error will appear as a generic failure in this test, with the 5 downstream tests failing silently with `undefined` rather than meaningful errors.
- Fix: This is resolved by the HIGH issue fix above (moving load to `beforeAll`). If a dedicated "file exists" assertion is desired, keep it as a separate test that reads independently:

```typescript
it('agent file exists and has frontmatter', async () => {
  const content = await fs.readFile(AGENT_PATH, 'utf-8');
  expect(content).toMatch(/^---\n/);
});
```

**Audit-claude multiselect test duplicates production filter logic** - `tests/plugins.test.ts:161-170`
**Confidence**: 82%
- Problem: The test on line 163-164 manually re-implements the exact same filter expression from `init.ts:171`. If the filter logic in `init.ts` changes (e.g., adding another excluded plugin), the test must be updated in lockstep. This tests the filter expression itself rather than the behavior (that audit-claude does not appear in choices). A more resilient approach would import or call the actual production code path, or at minimum test the behavioral contract without duplicating the filter.
- Fix: While extracting the filter into a shared function would be ideal, a simpler improvement is to document the coupling explicitly and add a guard:

```typescript
it('audit-claude is excluded from init multiselect choices', () => {
  // NOTE: This filter mirrors init.ts multiselect logic — update both together
  const multiselectPlugins = DEVFLOW_PLUGINS.filter(
    pl => pl.name !== 'devflow-core-skills' && pl.name !== 'devflow-ambient' && pl.name !== 'devflow-audit-claude',
  );
  const names = multiselectPlugins.map(pl => pl.name);
  expect(names).not.toContain('devflow-audit-claude');
  expect(names).not.toContain('devflow-core-skills');
  expect(names).not.toContain('devflow-ambient');
  // Verify it still exists in registry
  expect(DEVFLOW_PLUGINS.find(p => p.name === 'devflow-audit-claude')).toBeDefined();
});
```

Or better, extract the filter to a named function in `init.ts` and import it in the test.

## Issues in Code You Touched (Should Fix)

No issues found.

## Pre-existing Issues (Not Blocking)

No critical pre-existing test issues found in the reviewed files.

## Suggestions (Lower Confidence)

- **No tests for statusline version badge logic** - `scripts/statusline.sh:172-218` (Confidence: 70%) — The new `statusline.sh` version update notification feature (~50 lines of non-trivial shell logic including version comparison, cache TTL, and background npm refresh) has no corresponding tests. The existing codebase does not appear to have shell script tests, so this may be by convention, but the `sort -V` version comparison and 24h cache expiry logic are easy to get wrong.

- **Skimmer "does NOT use root scan" test has a narrow regex** - `tests/skimmer-agent.test.ts:39-40` (Confidence: 65%) — The test checks code blocks for `npx rskim .` and `npx rskim\s+--` but would miss other root-scan variants like `npx rskim ./` or `npx rskim /`. The current agent file does not contain these, so no false negative today, but the test may miss future regressions.

- **`parseToolsFromFrontmatter` only handles single-line `tools:` arrays** - `tests/skimmer-agent.test.ts:14` (Confidence: 62%) — The regex `^tools:\s*\[([^\]]*)\]/m` requires the tools array to fit on one line. If the agent file ever reformats tools to multiline YAML, this parser silently returns `[]` and the tool-restriction test would fail with a misleading "expected length 2, received 0" error rather than a clear parse failure.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 2 | 0 |
| Should Fix | 0 | 0 | 0 | 0 |
| Pre-existing | 0 | 0 | 0 | 0 |

**Tests Score**: 7/10
**Recommendation**: CHANGES_REQUESTED

The new `skimmer-agent.test.ts` file is a good addition — it validates the agent's behavioral contract (tool restrictions, workflow steps, root-scan safety) rather than testing implementation details. However, the inter-test ordering dependency via shared mutable state should be fixed before merge, as it makes 5 of 6 tests fragile. The `plugins.test.ts` addition is clean and focused. The lack of test coverage for the statusline version badge is noted but not blocking given the project's convention of not testing shell scripts.
