---
name: testing
description: This skill should be used when the user asks to "write tests", "fix failing tests", "improve test coverage" or "debug a flaky test", or reviews test quality.
user-invocable: false
allowed-tools: Read, Grep, Glob, AskUserQuestion
activation:
  file-patterns:
    - "**/*.test.*"
    - "**/*.spec.*"
    - "**/test/**"
    - "**/tests/**"
    - "**/__tests__/**"
  exclude:
    - "node_modules/**"
---

# Testing Patterns

## Iron Law

> **Tests validate behavior, not implementation.**
>
> A test should fail when behavior breaks, not when implementation changes. Mock at
> boundaries, not internals. Test the contract, not the code path. If tests are hard to
> write, the design is wrong — fix the architecture, not the tests.

## Testing Shapes

| Shape | Guidance |
|-------|---------|
| Pyramid | Many unit → fewer integration → fewest E2E |
| Trophy | Integration tests give best ROI for UI-heavy code |
| Google | 70% unit / 20% integration / 10% E2E; avoid E2E excess |

## Test Doubles Taxonomy

| Type | When to Use | Example |
|------|------------|---------|
| **Dummy** | Fill unused parameters | `null`, empty object |
| **Stub** | Return canned data, no assertions | `getRate: () => 0.1` |
| **Spy** | Record calls, assert after | `jest.spyOn()` on public methods |
| **Mock** | Pre-programmed expectations | `expect(fn).toHaveBeenCalledWith(x)` |
| **Fake** | Working substitute (in-memory DB) | `InMemoryUserRepo` |

"Mock roles, not objects" — mock interfaces you own, never third-party internals.

## Test Design Red Flags

| Red Flag | Symptom | Root Cause | Fix |
|----------|---------|-----------|-----|
| Complex setup >10 lines | `beforeEach` with 6+ mocks | Too many dependencies | Split service; use fakes |
| Repetitive try/catch | Same pattern >3 times | API throws, not Result | Migrate to Result types |
| Nested mock structures | `mockDb.orders.create: jest.fn()` | Tight coupling | Extract interface; use fake |
| Spying on private methods | `jest.spyOn(obj as any, '_method')` | Tests implementation | Assert observable output |

```typescript
// VIOLATION: Tests private implementation
jest.spyOn(cart as any, 'updateTotal');
expect(spy).toHaveBeenCalled();   // Tests HOW

// CORRECT: Tests observable behavior
cart.addItem({ id: '1', price: 10 });
expect(cart.getTotal()).toBe(10); // Tests WHAT
```

## Property-Based Testing

State invariants; let the framework generate inputs and shrink failures:

```typescript
// fast-check: property must hold for all valid inputs
fc.assert(fc.property(fc.string(), (s) => decode(encode(s)) === s));
```

Use for: parsers/serializers, arithmetic, sorting, state machines.

## Flaky Tests

| Root Cause | Fix |
|-----------|-----|
| Async/timing races | Use fake timers; `await` all async ops |
| Order dependencies | Each test self-contained; fresh state |
| Shared mutable state | Reset in `afterEach`; use DI |

Quarantine flaky tests immediately — a suite that sometimes passes is worse than no suite.

## Coverage & Severity

| Severity | Criteria |
|----------|----------|
| **CRITICAL** | Tests don't verify behavior; critical paths untested; everything mocked |
| **HIGH** | Missing error paths; flaky tests; slow (>10s); setup >10 lines |
| **MEDIUM** | Missing edge cases; weak assertions; unclear AAA structure |
| **LOW** | Organization; naming clarity |

## Test Suite Safety

```typescript
{ fileParallelism: false, maxWorkers: 1, testTimeout: 10000 }  // vitest / jest
```

## Extended References

| Reference | Contents |
|-----------|----------|
| `references/sources.md` | Full bibliography (20 sources) |
| `references/violations.md` | Extended violations with citations |
| `references/patterns.md` | Correct patterns with citations |
| `references/detection.md` | Bash commands for automated detection |
| `references/report-template.md` | Report format for documenting issues |

## Quality Gates

- [ ] Setup <10 lines; use fakes over mocks for complex dependencies
- [ ] Each new assertion would fail, not error, with the change reverted: its RED run counts, else a bad input or a temporary uncommitted revert of your own edit, never a stash
- [ ] All branches covered: happy path + errors + edge cases
- [ ] Test names describe expected behavior
- [ ] Tests follow Arrange-Act-Assert structure
- [ ] No flaky patterns
