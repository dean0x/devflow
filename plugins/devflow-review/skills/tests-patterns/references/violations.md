# Test Pattern Violations - Extended Examples

Reference examples for common test quality violations.

---

## Coverage Violations

### Missing Edge Cases

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

### No Error Path Tests

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

---

## Test Quality Violations

### Unclear Test Names

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

### Missing Arrange-Act-Assert

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

---

## Test Design Violations

### Slow Tests

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

### Flaky Tests

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

### Poor Assertions

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

---

## Mocking Violations

### Over-Mocking

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

### Mocking What You Don't Own

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
