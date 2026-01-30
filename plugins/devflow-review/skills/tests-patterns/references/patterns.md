# Test Patterns - Correct Examples

Reference for proper test patterns and approaches.

---

## Coverage Patterns

### Branch Coverage

```typescript
// CODE with multiple branches
export function calculateDiscount(price: number, type: CustomerType): number {
  if (type === 'premium') return price * 0.2;
  if (type === 'vip') return price * 0.3;
  return price * 0.1;
}

// CORRECT: Test each branch
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

### Error Path Coverage

```typescript
// CORRECT: Full error path coverage
describe('fetchUser', () => {
  it('returns user data on success', async () => {
    api.get.mockResolvedValue({ ok: true, json: () => mockUser });
    const user = await fetchUser('123');
    expect(user).toEqual(mockUser);
  });

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

## Test Quality Patterns

### Behavior-Focused Tests

```typescript
// CORRECT: Tests behavior/outcome, not implementation
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

### Clear Test Names

```typescript
// CORRECT: Descriptive names following patterns
describe('User', () => {
  // Pattern: "it [action] when [condition]"
  it('validates email format on creation', () => { /* ... */ });
  it('rejects passwords shorter than 8 characters', () => { /* ... */ });

  // Pattern: "it [expected behavior]"
  it('hashes password before storing', () => { /* ... */ });
  it('generates unique ID for new users', () => { /* ... */ });
});
```

### Arrange-Act-Assert Structure

```typescript
// CORRECT: Clear AAA structure
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

## Test Design Patterns

### Fast Tests with Mocked Timers

```typescript
// CORRECT: Mock timers for speed
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

### Stable Async Tests

```typescript
// CORRECT: Explicit waiting for async operations
it('updates in real-time', async () => {
  const received = new Promise(resolve => {
    subscribe(data => resolve(data));
  });

  emit('update', { value: 1 });

  const data = await received;
  expect(data.value).toBe(1);
});
```

### Strong Assertions

```typescript
// CORRECT: Specific, meaningful assertions
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

## Mocking Patterns

### Boundary Mocking

```typescript
// CORRECT: Mock at boundaries, use real implementations inside
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

### Wrapper Pattern for External Dependencies

```typescript
// CORRECT: Wrap third-party libraries in your own interface
interface HttpClient {
  get<T>(url: string): Promise<T>;
}

class AxiosHttpClient implements HttpClient {
  async get<T>(url: string): Promise<T> {
    const response = await axios.get(url);
    return response.data;
  }
}

class MockHttpClient implements HttpClient {
  private responses: Map<string, any> = new Map();

  mockResponse(url: string, data: any) {
    this.responses.set(url, data);
  }

  async get<T>(url: string): Promise<T> {
    return this.responses.get(url);
  }
}

// Tests use MockHttpClient, production uses AxiosHttpClient
describe('UserApi', () => {
  it('fetches user by id', async () => {
    const client = new MockHttpClient();
    client.mockResponse('/users/123', { id: '123', name: 'John' });

    const api = new UserApi(client);
    const user = await api.getUser('123');

    expect(user.name).toBe('John');
  });
});
```

---

## Test Organization Patterns

### Test File Structure

```typescript
describe('UserService', () => {
  // Shared setup
  let service: UserService;
  let repo: InMemoryUserRepo;

  beforeEach(() => {
    repo = new InMemoryUserRepo();
    service = new UserService(repo);
  });

  // Group by functionality
  describe('create', () => {
    it('creates user with valid data', async () => { /* ... */ });
    it('rejects invalid email', async () => { /* ... */ });
    it('rejects duplicate email', async () => { /* ... */ });
  });

  describe('update', () => {
    it('updates existing user', async () => { /* ... */ });
    it('returns error for non-existent user', async () => { /* ... */ });
  });

  describe('delete', () => {
    it('removes user from repository', async () => { /* ... */ });
    it('returns error for non-existent user', async () => { /* ... */ });
  });
});
```

### Test Helpers

```typescript
// Factory functions for test data
function createTestUser(overrides: Partial<User> = {}): User {
  return {
    id: 'test-id',
    name: 'Test User',
    email: 'test@example.com',
    createdAt: new Date(),
    ...overrides,
  };
}

// Setup helpers
async function setupWithUser(): Promise<{ service: UserService; user: User }> {
  const repo = new InMemoryUserRepo();
  const service = new UserService(repo);
  const user = await service.create(createTestUser());
  return { service, user };
}

// Usage in tests
it('updates user name', async () => {
  const { service, user } = await setupWithUser();

  const updated = await service.update(user.id, { name: 'New Name' });

  expect(updated.name).toBe('New Name');
});
```
