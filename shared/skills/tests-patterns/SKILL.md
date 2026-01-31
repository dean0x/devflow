---
name: tests-patterns
description: Test quality analysis for Reviewer agent. Loaded when focus=tests. Detects coverage gaps, brittle tests, poor test design.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Tests Patterns

Domain expertise for test quality and effectiveness analysis. Use alongside `review-methodology` for complete test reviews.

## Iron Law

> **TESTS VALIDATE BEHAVIOR, NOT IMPLEMENTATION**
>
> A test should fail when behavior breaks, not when implementation changes. If refactoring
> breaks tests without changing behavior, the tests are wrong. Mock boundaries, not internals.
> Test the contract, not the code. If tests are hard to write, the design is wrong.

---

## Test Categories

### 1. Coverage Issues

**Untested New Code**: New functions/branches without corresponding tests.

```typescript
// VIOLATION: New discount logic with no tests
export function calculateDiscount(price: number, type: CustomerType): number {
  if (type === 'premium') return price * 0.2;
  if (type === 'vip') return price * 0.3;
  return price * 0.1;
}

// REQUIRED: Test each branch
describe('calculateDiscount', () => {
  it('returns 10% for regular customers', () => {
    expect(calculateDiscount(100, 'regular')).toBe(10);
  });
  it('returns 20% for premium customers', () => { /* ... */ });
  it('returns 30% for VIP customers', () => { /* ... */ });
});
```

**Missing edge cases** and **error paths** - see `references/violations.md`.

### 2. Test Quality Issues

**Brittle Tests (Implementation Coupling)**

```typescript
// VIOLATION: Testing HOW, not WHAT
it('creates user', async () => {
  await service.create({ name: 'John' });
  expect(mockRepo.beginTransaction).toHaveBeenCalled();
  expect(mockRepo.insert).toHaveBeenCalledWith('users', { name: 'John' });
});

// CORRECT: Testing behavior/outcome
it('creates user and returns it', async () => {
  const user = await service.create({ name: 'John' });
  expect(user.name).toBe('John');
  expect(user.id).toBeDefined();
});
```

**Unclear test names** and **missing AAA structure** - see `references/violations.md`.

### 3. Test Design Issues

**Slow Tests**: Real delays instead of mocked timers.

```typescript
// VIOLATION: Waits real time
const result = await fetchWithRetry();  // 1000ms delay

// CORRECT: Mock timers
jest.useFakeTimers();
const promise = fetchWithRetry();
jest.advanceTimersByTime(1000);
```

**Flaky tests** and **poor assertions** - see `references/violations.md`.

### 4. Mocking Issues

**Over-Mocking**: Testing mocks instead of behavior.

```typescript
// VIOLATION: Everything mocked, nothing tested
const mockValidator = { validate: jest.fn().mockReturnValue(true) };
const mockHasher = { hash: jest.fn().mockReturnValue('hashed') };
// ... creates service with all mocks, verifies mock calls

// CORRECT: Use real implementations where feasible
const repo = new InMemoryUserRepo();
const service = new UserService(new RealValidator(), new RealHasher(), repo);
const saved = await repo.findByEmail('test@example.com');
expect(await bcrypt.compare('password', saved.password)).toBe(true);
```

**Mocking third-party internals** - see `references/violations.md`.

---

## Extended References

For comprehensive examples and detection patterns:

| Reference | Contents |
|-----------|----------|
| `references/violations.md` | Full violation examples for all categories |
| `references/patterns.md` | Correct test patterns and organization |
| `references/detection.md` | Bash commands for automated detection |

---

## Severity Guidelines

| Severity | Criteria |
|----------|----------|
| **CRITICAL** | Tests pass but don't verify behavior; critical paths untested; tests mock everything |
| **HIGH** | Missing error path coverage; flaky tests; extremely slow (>10s); unclear names |
| **MEDIUM** | Some edge cases missing; weak assertions; unclear structure |
| **LOW** | Organization could improve; naming could be clearer |

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
