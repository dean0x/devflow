---
name: testing
description: This skill should be used when the user asks to "write tests", "fix failing tests", "improve test coverage", "add integration tests", "debug a flaky test", or reviews test quality. Provides behavior-focused testing patterns, coverage analysis, and detection of brittle test anti-patterns like implementation coupling and non-deterministic assertions.
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

> **TESTS VALIDATE BEHAVIOR, NOT IMPLEMENTATION** [4][8]
>
> A test should fail when behavior breaks, not when implementation changes. Mock at
> boundaries, not internals. Test the contract, not the code path. If tests are hard to
> write, the design is wrong — fix the architecture, not the tests. [3][8]

---

## Testing Shapes [6][7][10]

| Shape | Guidance |
|-------|---------|
| Pyramid [6] | Many unit → fewer integration → fewest E2E |
| Trophy [7] | Integration tests give best ROI for UI-heavy code |
| Google [4] | 70% unit / 20% integration / 10% E2E; avoid E2E excess [12] |

---

## Test Doubles Taxonomy [1][9]

| Type | When to Use | Example |
|------|------------|---------|
| **Dummy** | Fill unused parameters | `null`, empty object |
| **Stub** | Return canned data, no assertions | `getRate: () => 0.1` |
| **Spy** | Record calls, assert after | `jest.spyOn()` on public methods |
| **Mock** | Pre-programmed expectations | `expect(fn).toHaveBeenCalledWith(x)` |
| **Fake** | Working substitute (in-memory DB) | `InMemoryUserRepo` |

"Mock roles, not objects" — mock interfaces you own, never third-party internals [3][9].

---

## Test Design Red Flags

| Red Flag | Symptom | Root Cause | Fix |
|----------|---------|-----------|-----|
| Complex setup >10 lines [8] | `beforeEach` with 6+ mocks | Too many dependencies | Split service; use fakes [1][4] |
| Repetitive try/catch [8] | Same pattern >3 times | API throws, not Result | Migrate to Result types [4] |
| Nested mock structures [1][3] | `mockDb.orders.create: jest.fn()` | Tight coupling | Extract interface; use fake [9] |
| Spying on private methods [8] | `jest.spyOn(obj as any, '_method')` | Tests implementation | Assert observable output [4] |

```typescript
// VIOLATION: Tests private implementation [8]
jest.spyOn(cart as any, 'updateTotal');
expect(spy).toHaveBeenCalled();   // Tests HOW

// CORRECT: Tests observable behavior [4]
cart.addItem({ id: '1', price: 10 });
expect(cart.getTotal()).toBe(10); // Tests WHAT
```

---

## Property-Based Testing [5][14]

State invariants; let the framework generate inputs and shrink failures [5]:

```typescript
// fast-check: property must hold for all valid inputs [14]
fc.assert(fc.property(fc.string(), (s) => decode(encode(s)) === s));
```

Use for: parsers/serializers, arithmetic, sorting, state machines [5][13][14].

---

## Flaky Tests [11][18]

| Root Cause | Fix |
|-----------|-----|
| Async/timing races | Use fake timers; `await` all async ops [19] |
| Order dependencies | Each test self-contained; fresh state [4] |
| Shared mutable state | Reset in `afterEach`; use DI [4] |

Quarantine flaky tests immediately — a suite that sometimes passes is worse than no suite [11].

---

## Coverage & Severity [4][8]

| Severity | Criteria |
|----------|----------|
| **CRITICAL** | Tests don't verify behavior; critical paths untested; everything mocked [4] |
| **HIGH** | Missing error paths; flaky tests [11]; slow (>10s); setup >10 lines [8] |
| **MEDIUM** | Missing edge cases; weak assertions; unclear AAA structure [17] |
| **LOW** | Organization; naming clarity |

---

## Test Suite Safety [19]

```typescript
{ fileParallelism: false, maxWorkers: 1, testTimeout: 10000 }  // vitest / jest
```

---

## Extended References

| Reference | Contents |
|-----------|----------|
| `references/sources.md` | Full bibliography (20 sources) |
| `references/violations.md` | Extended violations with citations [1][4][8][11] |
| `references/patterns.md` | Correct patterns with citations [1][2][5][14] |
| `references/detection.md` | Bash commands for automated detection |
| `references/report-template.md` | Report format for documenting issues |

---

## Quality Gates [4][8][17]

- [ ] Setup <10 lines; use fakes over mocks for complex dependencies [1]
- [ ] No spying on private methods or internal state [8]
- [ ] Tests verify behavior, not implementation details [4]
- [ ] All branches covered: happy path + errors + edge cases
- [ ] Test names describe expected behavior [4]
- [ ] Tests follow Arrange-Act-Assert structure [17]
- [ ] No real delays — use fake timers [19]
- [ ] No flaky patterns (race conditions, timing dependencies) [11][18]
