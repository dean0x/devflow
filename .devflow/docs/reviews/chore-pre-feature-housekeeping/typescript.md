# TypeScript Review Report

**Branch**: chore/pre-feature-housekeeping -> main
**Date**: 2026-03-20

## Changed TypeScript Files

| File | Type of Change |
|------|---------------|
| `src/cli/commands/init.ts` | Filter logic update (2 lines modified) |
| `tests/plugins.test.ts` | New test case added (11 lines) |
| `tests/skimmer-agent.test.ts` | New test file (57 lines) |

## Issues in Your Changes (BLOCKING)

### CRITICAL

None.

### HIGH

**Test ordering dependency: `content` and `tools` variables rely on test execution order** - `tests/skimmer-agent.test.ts:21-26`
**Confidence**: 85%
- Problem: The `content` and `tools` variables are declared with `let` at suite scope (lines 21-22), then assigned inside the first `it` block (`'loads the agent file'`, line 23-26). All subsequent tests depend on these variables being populated. If vitest runs tests in parallel within the suite, or if the first test is skipped/filtered (e.g., `it.only` on another test), the remaining tests will operate on `undefined` values and produce misleading failures rather than clear errors.
- Impact: Fragile test suite that silently passes with undefined values or produces cryptic errors when tests are run selectively.
- Fix: Move the file loading into a `beforeAll` or `beforeEach` hook so every test has guaranteed access to initialized values regardless of execution order or filtering:

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
  // ... remaining tests ...
});
```

## Issues in Code You Touched (Should Fix)

None.

## Pre-existing Issues (Not Blocking)

None.

## Suggestions (Lower Confidence)

- **Non-null assertions in test file** - `tests/plugins.test.ts:141,176` (Confidence: 65%) -- Two uses of `plugin!.optional` and `coreSkills!.skills` rely on non-null assertions. These are pre-existing (not introduced in this PR), and in test code the preceding `expect(...).toBeDefined()` guards make them safe in practice, but typed narrowing (e.g., `if (!plugin) throw ...`) would be more robust.

- **Magic string duplication in filter condition** - `src/cli/commands/init.ts:171` (Confidence: 60%) -- The filter list `'devflow-core-skills', 'devflow-ambient', 'devflow-audit-claude'` is now a three-item inline condition. As it grows, extracting to a constant (e.g., `HIDDEN_FROM_MULTISELECT`) would improve maintainability. Currently small enough that this is purely stylistic.

## Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW |
|----------|----------|------|--------|-----|
| Blocking | 0 | 1 | 0 | - |
| Should Fix | - | 0 | 0 | - |
| Pre-existing | - | - | 0 | 0 |

**TypeScript Score**: 8/10
**Recommendation**: CHANGES_REQUESTED

The TypeScript changes are minimal and type-safe. The `init.ts` modifications are straightforward filter adjustments with no type issues. The `plugins.test.ts` addition is clean and well-typed. The single blocking issue is the test-ordering dependency in the new `skimmer-agent.test.ts` file: using a `beforeAll` hook instead of an `it` block for setup is the standard vitest pattern and prevents subtle test isolation failures.
