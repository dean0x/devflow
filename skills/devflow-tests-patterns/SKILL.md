---
name: devflow-tests-patterns
description: Test quality, coverage, and effectiveness analysis. Load when reviewing test code for coverage gaps, brittle tests, or poor test design. Used by Reviewer agent with tests focus.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Tests Patterns

Domain expertise for test quality and effectiveness analysis. Use alongside `devflow-review-methodology` for complete test reviews.

## Iron Law

> **TESTS VALIDATE BEHAVIOR, NOT IMPLEMENTATION**
>
> A test should fail when behavior breaks, not when implementation changes. If refactoring
> breaks tests without changing behavior, the tests are wrong. Mock boundaries, not internals.
> Test the contract, not the code. If tests are hard to write, the design is wrong.

## Test Categories

### 1. Coverage Issues

**Untested New Code**
```typescript
// NEW CODE without tests
export function calculateDiscount(price: number, type: CustomerType): number {
  if (type === 'premium') return price * 0.2;
  if (type === 'vip') return price * 0.3;
  return price * 0.1;
}

// REQUIRED: Tests for each branch
describe('calculateDiscount', () => {
  it('returns 10% for regular customers', () => {
    expect(calculateDiscount(100, 'regular')).toBe(10);
  });

  it('returns 20% for premium customers', () => {
    expect(calculateDiscount(100, 'premium')).toBe(20);
  });

  it('returns 30% for VIP customers', () => {
    expect(calculateDiscount(100, 'vip')).toBe(30);
  });
});
```

**Missing Edge Cases**
```typescript
// CODE
function divide(a: number, b: number): number {
  return a / b;
}

// INCOMPLETE TESTS
describe('divide', () => {
  it('divides two numbers', () => {
    expect(divide(10, 2)).toBe(5);  // Happy path only
  });
});

// COMPLETE TESTS
describe('divide', () => {
  it('divides two positive numbers', () => {
    expect(divide(10, 2)).toBe(5);
  });

  it('handles division by zero', () => {
    expect(divide(10, 0)).toBe(Infinity);
  });

  it('handles negative numbers', () => {
    expect(divide(-10, 2)).toBe(-5);
  });

  it('handles decimal results', () => {
    expect(divide(10, 3)).toBeCloseTo(3.333, 2);
  });
});
```

**No Error Path Tests**
```typescript
// CODE
async function fetchUser(id: string): Promise<User> {
  const response = await api.get(`/users/${id}`);
  if (!response.ok) throw new ApiError(response.status);
  return response.json();
}

// INCOMPLETE: Only tests success
describe('fetchUser', () => {
  it('returns user data', async () => {
    api.get.mockResolvedValue({ ok: true, json: () => mockUser });
    const user = await fetchUser('123');
    expect(user).toEqual(mockUser);
  });
});

// COMPLETE: Tests error paths
describe('fetchUser', () => {
  it('returns user data on success', async () => { /* ... */ });

  it('throws ApiError on 404', async () => {
    api.get.mockResolvedValue({ ok: false, status: 404 });
    await expect(fetchUser('123')).rejects.toThrow(ApiError);
  });

  it('throws ApiError on 500', async () => {
    api.get.mockResolvedValue({ ok: false, status: 500 });
    await expect(fetchUser('123')).rejects.toThrow(ApiError);
  });

  it('handles network errors', async () => {
    api.get.mockRejectedValue(new Error('Network error'));
    await expect(fetchUser('123')).rejects.toThrow('Network error');
  });
});
```

### 2. Test Quality Issues

**Brittle Tests (Implementation Coupling)**
```typescript
// BRITTLE: Tests implementation details
describe('UserService', () => {
  it('creates user', async () => {
    const service = new UserService(mockRepo);
    await service.create({ name: 'John' });

    // Testing HOW, not WHAT
    expect(mockRepo.beginTransaction).toHaveBeenCalled();
    expect(mockRepo.insert).toHaveBeenCalledWith('users', { name: 'John' });
    expect(mockRepo.commit).toHaveBeenCalled();
  });
});

// ROBUST: Tests behavior/outcome
describe('UserService', () => {
  it('creates user and returns it', async () => {
    const service = new UserService(mockRepo);
    const user = await service.create({ name: 'John' });

    // Testing WHAT the behavior is
    expect(user.name).toBe('John');
    expect(user.id).toBeDefined();
  });

  it('persists user to repository', async () => {
    const service = new UserService(mockRepo);
    await service.create({ name: 'John' });

    const saved = await mockRepo.findByName('John');
    expect(saved).toBeDefined();
  });
});
```

**Unclear Test Names**
```typescript
// UNCLEAR: What does this test?
describe('User', () => {
  it('test1', () => { /* ... */ });
  it('should work', () => { /* ... */ });
  it('handles edge case', () => { /* ... */ });
});

// CLEAR: Describes behavior
describe('User', () => {
  it('validates email format on creation', () => { /* ... */ });
  it('rejects passwords shorter than 8 characters', () => { /* ... */ });
  it('hashes password before storing', () => { /* ... */ });
});

// PATTERN: "it [action] when [condition]" or "it [expected behavior]"
```

**Missing Arrange-Act-Assert**
```typescript
// MESSY: Mixed setup, action, assertion
it('processes order', async () => {
  const user = await createUser();
  expect(user.id).toBeDefined();
  const order = await createOrder(user.id, [{ product: 'A', qty: 2 }]);
  expect(order.status).toBe('pending');
  await processOrder(order.id);
  const updated = await getOrder(order.id);
  expect(updated.status).toBe('processed');
  expect(updated.processedAt).toBeDefined();
});

// CLEAN: Clear AAA structure
it('marks order as processed with timestamp', async () => {
  // Arrange
  const user = await createUser();
  const order = await createOrder(user.id, [{ product: 'A', qty: 2 }]);

  // Act
  await processOrder(order.id);

  // Assert
  const updated = await getOrder(order.id);
  expect(updated.status).toBe('processed');
  expect(updated.processedAt).toBeDefined();
});
```

### 3. Test Design Issues

**Slow Tests**
```typescript
// SLOW: Real delays
it('retries on failure', async () => {
  api.mockRejectedValueOnce(new Error('fail'));
  api.mockResolvedValue({ data: 'ok' });

  const result = await fetchWithRetry();  // Waits real 1000ms

  expect(result).toBe('ok');
}, 5000);

// FAST: Mock timers
it('retries on failure', async () => {
  jest.useFakeTimers();
  api.mockRejectedValueOnce(new Error('fail'));
  api.mockResolvedValue({ data: 'ok' });

  const promise = fetchWithRetry();
  jest.advanceTimersByTime(1000);
  const result = await promise;

  expect(result).toBe('ok');
});
```

**Flaky Tests**
```typescript
// FLAKY: Depends on timing
it('updates in real-time', async () => {
  subscribe(callback);
  emit('update', { value: 1 });

  // Race condition: callback might not have fired yet
  expect(callback).toHaveBeenCalled();
});

// STABLE: Explicit waiting
it('updates in real-time', async () => {
  const received = new Promise(resolve => {
    subscribe(data => resolve(data));
  });

  emit('update', { value: 1 });

  const data = await received;
  expect(data.value).toBe(1);
});
```

**Poor Assertions**
```typescript
// WEAK: Doesn't verify much
it('returns users', async () => {
  const users = await getUsers();
  expect(users).toBeDefined();  // Could be empty array, wrong shape, etc.
});

// STRONG: Specific assertions
it('returns array of users with required fields', async () => {
  const users = await getUsers();

  expect(users).toHaveLength(3);
  expect(users[0]).toMatchObject({
    id: expect.any(String),
    email: expect.stringContaining('@'),
    createdAt: expect.any(Date),
  });
});
```

### 4. Mocking Issues

**Over-Mocking**
```typescript
// OVER-MOCKED: Tests nothing real
it('creates user', async () => {
  const mockValidator = { validate: jest.fn().mockReturnValue(true) };
  const mockHasher = { hash: jest.fn().mockReturnValue('hashed') };
  const mockRepo = { create: jest.fn().mockResolvedValue({ id: '1' }) };
  const mockEvents = { emit: jest.fn() };

  const service = new UserService(mockValidator, mockHasher, mockRepo, mockEvents);
  await service.create({ email: 'test@test.com', password: 'pass' });

  // What did we actually test? Just that mocks were called.
});

// BETTER: Use real implementations where possible
it('creates user with hashed password', async () => {
  const repo = new InMemoryUserRepo();
  const service = new UserService(
    new RealValidator(),
    new RealHasher(),
    repo,
    new FakeEvents()
  );

  await service.create({ email: 'test@test.com', password: 'password123' });

  const saved = await repo.findByEmail('test@test.com');
  expect(saved.password).not.toBe('password123');  // Actually hashed
  expect(await bcrypt.compare('password123', saved.password)).toBe(true);
});
```

**Mocking What You Don't Own**
```typescript
// PROBLEM: Mocking third-party library internals
jest.mock('axios');
axios.get.mockResolvedValue({ data: mockResponse });

// BETTER: Wrap in your own interface
interface HttpClient {
  get<T>(url: string): Promise<T>;
}

class AxiosHttpClient implements HttpClient { /* ... */ }
class MockHttpClient implements HttpClient { /* ... */ }

// Test with MockHttpClient, production uses AxiosHttpClient
```

---

## Severity Guidelines

**CRITICAL** - Tests provide false confidence:
- Tests pass but don't verify behavior
- Tests mock everything, test nothing
- Critical paths have no tests
- Tests test implementation, will break on refactor

**HIGH** - Significant test quality issues:
- Missing error path coverage
- Flaky tests that sometimes fail
- Tests are extremely slow (>10s)
- Test names don't describe behavior

**MEDIUM** - Moderate test concerns:
- Some edge cases missing
- Could use better assertions
- Test structure unclear
- Minor coverage gaps

**LOW** - Minor improvements:
- Test organization could improve
- Could add a few more cases
- Naming could be clearer

---

## Detection Patterns

Search for these patterns in code:

```bash
# Tests without assertions
grep -rn "it\(.*=>" --include="*.test.ts" -A20 | grep -B20 "expect" | grep -L "expect"

# Weak assertions
grep -rn "toBeDefined\|toBeTruthy\|not.toBeNull" --include="*.test.ts"

# Implementation testing (checking mock calls)
grep -rn "toHaveBeenCalledWith\|toHaveBeenCalled" --include="*.test.ts" | wc -l

# Missing error tests
grep -rn "throw\|reject\|Error" --include="*.ts" | grep -v test | wc -l
# Compare with:
grep -rn "rejects.toThrow\|toThrow" --include="*.test.ts" | wc -l

# Slow tests (long timeouts)
grep -rn "}, [0-9][0-9][0-9][0-9][0-9])" --include="*.test.ts"
```

---

## Test Coverage Guidelines

| Code Type | Required Coverage | Test Type |
|-----------|-------------------|-----------|
| Business logic | 90%+ | Unit tests |
| API endpoints | 80%+ | Integration tests |
| UI components | 70%+ | Component tests |
| Utilities | 100% | Unit tests |
| Error paths | 100% | Unit tests |

