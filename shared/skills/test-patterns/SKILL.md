---
name: test-patterns
description: Test quality enforcement and analysis. Use when writing tests, fixing failing tests, or reviewing test quality. Detects coverage gaps, brittle tests, poor test design.
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

# Test Patterns

## Iron Law

> **TESTS VALIDATE BEHAVIOR, NOT IMPLEMENTATION**
>
> A test should fail when behavior breaks, not when implementation changes. If refactoring
> breaks tests without changing behavior, the tests are wrong. Mock boundaries, not internals.
> Test the contract, not the code. If tests are hard to write, the design is wrong — fix the
> architecture, not the tests.

---

## Test Design Red Flags

### 1. Complex Setup

**RED FLAG**: Test setup >10 lines means the design is wrong.

```typescript
// VIOLATION: Too many dependencies
beforeEach(async () => {
  mockDb = new MockDatabase();
  await mockDb.connect();
  mockCache = new MockCache();
  // ... 10+ more lines
  service = new UserService(mockDb, mockCache, mockLogger, mockConfig);
});

// CORRECT: Simple setup
it('should return Ok with valid data', () => {
  const result = createUser({ name: 'test', email: 'test@example.com' });
  expect(result.ok).toBe(true);
});
```

**Detection**: `beforeEach` >10 lines, multiple mocks, async setup, database seeding

### 2. Repetitive Boilerplate

**RED FLAG**: Same pattern repeated >3 times means the API is wrong.

```typescript
// VIOLATION: Try/catch everywhere
try { await api.createUser(data); fail(); } catch (e) { expect(e.status).toBe(400); }

// CORRECT: Result types eliminate repetition
const result = createUser(invalidData);
expect(result.ok).toBe(false);
expect(result.error.type).toBe('ValidationError');
```

### 3. Difficult Mocking

**RED FLAG**: Mock setup >20 lines means dependencies are wrong.

```typescript
// VIOLATION: Nested mock structures
mockDb = { transaction: jest.fn(), orders: { create: jest.fn(), update: jest.fn() } };

// CORRECT: Pure functions need no mocking
const result = processOrder(order);
expect(result.ok).toBe(true);
```

### 4. Implementation Testing

**RED FLAG**: Testing internals means tests are fragile.

```typescript
// VIOLATION: Spying on private methods
const spy = jest.spyOn(cart as any, 'updateTotal');
expect(spy).toHaveBeenCalled();

// CORRECT: Test observable behavior
expect(cart.getTotal()).toBe(10);
```

---

## Coverage & Review

### Coverage Issues

- **Untested new code**: New functions/branches without corresponding tests
- **Missing edge cases**: Only happy path tested, no error paths
- **Missing error paths**: `throw`/`reject` in source without matching test assertions

### Test Quality Issues

- **Brittle tests**: Testing HOW (mock call verification) not WHAT (outcome)
- **Unclear test names**: `it('test1')` instead of `it('validates email format on creation')`
- **Missing AAA structure**: Mixed arrange/act/assert without clear separation

### Mocking Issues

- **Over-mocking**: Everything mocked, nothing actually tested
- **Mocking third-party internals**: Mock at your own interface boundary instead

---

## Severity Guidelines

| Severity | Criteria |
|----------|----------|
| **CRITICAL** | Tests pass but don't verify behavior; critical paths untested; tests mock everything |
| **HIGH** | Missing error path coverage; flaky tests; extremely slow (>10s); >10 line setup |
| **MEDIUM** | Some edge cases missing; weak assertions; unclear structure |
| **LOW** | Organization could improve; naming could be clearer |

---

## Test Suite Safety

```typescript
// vitest.config.ts / jest.config.js
{ fileParallelism: false, maxWorkers: 1, testTimeout: 10000 }
```

```bash
NODE_OPTIONS="--max-old-space-size=512" npm test
```

---

## Extended References

For comprehensive examples and detection patterns:

| Reference | Contents |
|-----------|----------|
| `references/violations.md` | Full violation examples for all categories |
| `references/patterns.md` | Correct test patterns and organization |
| `references/detection.md` | Bash commands for automated detection |
| `references/report-template.md` | Full report format for documenting issues |

---

## Quality Gates

Tests pass design review when:
- [ ] Setup code <10 lines per test file
- [ ] No repetitive try/catch or error handling patterns
- [ ] Mocking requires <5 lines of setup
- [ ] No spying on private methods or internal state
- [ ] Tests verify behavior, not implementation details
- [ ] Pure business logic testable without mocks
- [ ] New code has corresponding tests
- [ ] All branches covered (happy path + errors + edge cases)
- [ ] Test names describe expected behavior
- [ ] Tests follow Arrange-Act-Assert structure
- [ ] No real delays (use mocked timers)
- [ ] No flaky patterns (race conditions, timing dependencies)

---

## Review Checklist

- [ ] New code has corresponding tests
- [ ] All branches covered (happy path + errors + edge cases)
- [ ] Tests verify behavior, not implementation
- [ ] Test names describe expected behavior
- [ ] Tests follow Arrange-Act-Assert structure
- [ ] No real delays (use mocked timers)
- [ ] Assertions are specific and meaningful
- [ ] Mocking limited to boundaries (not internals)
- [ ] No flaky patterns (race conditions, timing dependencies)
