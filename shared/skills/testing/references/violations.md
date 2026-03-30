# Test Pattern Violations — Extended Examples

Reference for common test quality violations. All citations reference `sources.md`.

---

## Complex Setup Violations [4][8]

### Multi-Dependency Service Setup [8]

Khorikov: complex `beforeEach` is a code smell — it means the production class
has too many responsibilities or the test is coupled to too many internals [8].
Google SWE Book: if setup feels burdensome, the code is hard to maintain [4]:

```typescript
// VIOLATION: Complex setup reveals poor design [8]
describe('UserService', () => {
  let service: UserService;
  let mockDb: MockDatabase;
  let mockCache: MockCache;
  let mockLogger: MockLogger;
  let mockConfig: MockConfig;

  beforeEach(async () => {
    mockDb = new MockDatabase();
    await mockDb.connect();
    await mockDb.seed();
    mockCache = new MockCache();
    mockCache.clear();
    mockLogger = new MockLogger();
    mockConfig = new MockConfig();
    mockConfig.set('env', 'test');
    // ... 10+ more lines
    service = new UserService(mockDb, mockCache, mockLogger, mockConfig);
  });

  it('creates user', async () => {
    const result = await service.createUser({ name: 'test' });
    expect(result.ok).toBe(true);
  });
});
```

**Root Cause**: `UserService` has too many dependencies — violates Single Responsibility [8]

**Fix**: Split into focused services; use `InMemoryUserRepo` (fake) instead of mocking DB [1][4]

---

## Repetitive Boilerplate Violations [8][4]

### Try/Catch Pattern Repetition [8]

Khorikov: repetitive try/catch in tests signals that the API throws exceptions
instead of returning Results — the API design is wrong [8]:

```typescript
// VIOLATION: Repetitive error handling indicates API problem [8]
describe('API endpoints', () => {
  it('handles user creation error', async () => {
    try {
      await api.createUser(invalidData);
      fail('Should have thrown');
    } catch (error) {
      expect(error.status).toBe(400);
      expect(error.message).toContain('validation');
    }
  });

  it('handles missing fields', async () => {
    try {
      await api.createUser({});
      fail('Should have thrown');
    } catch (error) {
      expect(error.status).toBe(400);  // Same pattern, repeated 10+ times
    }
  });
});
```

**Root Cause**: API throws exceptions; tests must wrap every call in try/catch [8]

**Fix**: Migrate API to Result pattern — error handling becomes one line [4]

---

## Difficult Mocking Violations [3][9][1]

### Nested Mock Object Structures [1][3]

Meszaros: mocks that require deep nesting reveal that the subject under test
depends on too much of the dependency's interface [1]. Freeman & Pryce: "listen
to your tests" — hard-to-mock code is telling you the design is wrong [3]:

```typescript
// VIOLATION: Complex mocking indicates tight coupling [1][3]
beforeEach(() => {
  mockDb = {
    transaction: jest.fn((callback) => callback(mockDb)),
    orders: { create: jest.fn(), update: jest.fn(), findById: jest.fn() },
    users: { findById: jest.fn(), update: jest.fn() },
    inventory: { decrement: jest.fn(), check: jest.fn(), reserve: jest.fn() }
  };
  // 5+ more mock objects...
});
```

**Root Cause**: `OrderProcessor` directly accesses multiple DB namespaces — Law of Demeter violation [3]

**Fix**: Extract a `PlaceOrderPort` interface; use an in-memory fake [1][9]

### Mocking Third-Party Libraries [3][9]

Fowler: mock at boundaries you own — mocking third-party internals locks you
to their implementation [9]. Freeman & Pryce: define your own interface, mock that [3]:

```typescript
// VIOLATION: Mocking axios internals [9]
jest.mock('axios');
(axios.get as jest.Mock).mockResolvedValue({ data: { id: 1 }, status: 200 });

// CORRECT: Mock your own HttpClient interface [3][9]
const client = new FakeHttpClient();
client.setResponse('/users/1', { id: 1, name: 'Alice' });
const service = new UserService(client);
```

---

## Implementation Testing Violations [4][8]

### Spying on Private Methods [8][4]

Khorikov: testing implementation details creates fragile tests — any internal
refactoring breaks the test even when behavior is unchanged [8].
Google SWE Book: test observable outcomes, not how they are produced [4]:

```typescript
// VIOLATION: Tests private implementation — breaks on any refactor [8]
it('calls updateTotal after addItem', () => {
  const cart = new ShoppingCart();
  const spy = jest.spyOn(cart as any, 'updateTotal');
  cart.addItem({ id: '1', price: 10 });
  expect(spy).toHaveBeenCalled();  // Tests HOW, not WHAT [8]
});

// CORRECT: Tests observable behavior — survives refactoring [4]
it('increases total when item is added', () => {
  const cart = new ShoppingCart();
  cart.addItem({ id: '1', price: 10 });
  expect(cart.getTotal()).toBe(10);  // Tests WHAT [4]
});
```

### Asserting on Intermediate State [8]

```typescript
// VIOLATION: Coupled to internal state changes [8]
it('processes payment', async () => {
  await service.processPayment(order);
  expect(order.status).toBe('processing');  // Intermediate state
  expect(order.paymentId).toBeDefined();    // Internal detail
});

// CORRECT: Assert on final observable outcome [4]
it('marks order as paid', async () => {
  const result = await service.processPayment(order);
  expect(result.ok).toBe(true);
  const persisted = await orderRepo.findById(order.id);
  expect(persisted.status).toBe('paid');
});
```

---

## Coverage Violations [4]

### Missing Edge Cases [4]

Google SWE Book: happy-path-only tests provide false confidence [4]:

```typescript
// INCOMPLETE: Only happy path [4]
describe('divide', () => {
  it('divides two numbers', () => {
    expect(divide(10, 2)).toBe(5);
  });
});

// COMPLETE: All branches covered [4]
describe('divide', () => {
  it('divides two positive numbers', () => { expect(divide(10, 2)).toBe(5); });
  it('handles division by zero', () => { expect(divide(10, 0)).toBe(Infinity); });
  it('handles negative numerator', () => { expect(divide(-10, 2)).toBe(-5); });
  it('handles decimal results', () => { expect(divide(10, 3)).toBeCloseTo(3.333, 2); });
});
```

### Unclear Test Names [4][17]

```typescript
// UNCLEAR: What behavior does this verify? [17]
it('test1', () => { /* ... */ });
it('should work', () => { /* ... */ });

// CLEAR: Describes the expected behavior [4]
it('rejects email without @ symbol', () => { /* ... */ });
it('rejects passwords shorter than 8 characters', () => { /* ... */ });
```

---

## Flaky Test Violations [11][18]

Google's research: async issues cause the majority of test flakiness [11].
Luo et al.: order-dependent and timing-related failures are the most common root causes [18]:

### Race Conditions [11][18]

```typescript
// FLAKY: Callback may not have fired when assertion runs [11]
subscribe(callback);
emit('update', { value: 1 });
expect(callback).toHaveBeenCalled();  // Non-deterministic [18]

// STABLE: Make async explicit [19]
const received = new Promise(resolve => subscribe(data => resolve(data)));
emit('update', { value: 1 });
const data = await received;
expect(data.value).toBe(1);
```

### Real Timers in Tests [19][11]

```typescript
// SLOW AND FLAKY: Depends on wall-clock time [11]
it('retries after 1 second', async () => {
  const result = await fetchWithRetry(url);  // Waits real 1000ms × N retries
  expect(result.ok).toBe(true);
}, 10000);

// FAST AND STABLE: Fake timers [19]
it('retries after delay', async () => {
  vi.useFakeTimers();
  const promise = fetchWithRetry(url);
  vi.advanceTimersByTime(3000);
  const result = await promise;
  expect(result.ok).toBe(true);
  vi.useRealTimers();
});
```

### Order-Dependent Tests [11][4]

```typescript
// VIOLATION: Test 2 depends on state set by test 1 [11]
it('creates admin user', async () => {
  await db.users.insert({ id: '1', role: 'admin' });
});

it('lists admin users', async () => {
  const admins = await db.users.findByRole('admin');
  expect(admins).toHaveLength(1);  // Fails if tests run in different order [11]
});

// CORRECT: Each test is self-contained [4]
it('lists admin users', async () => {
  const repo = new InMemoryUserRepo();
  await repo.insert({ id: '1', role: 'admin' });
  const service = new UserService(repo);
  const admins = await service.listAdmins();
  expect(admins).toHaveLength(1);
});
```

---

## Test Design Violations [8][4]

### Over-Mocking [1][4]

Meszaros: tests that mock everything test nothing — they only verify that mocks
were called in a certain order [1]. Use fakes (real implementations) instead [1][9]:

```typescript
// OVER-MOCKED: Tests only that mocks were called [1]
const mockValidator = { validate: jest.fn().mockReturnValue(true) };
const mockHasher = { hash: jest.fn().mockReturnValue('hashed') };
const mockRepo = { create: jest.fn().mockResolvedValue({ id: '1' }) };
// What was actually tested? Nothing meaningful. [1]

// BETTER: Use real implementations where feasible [1][4]
const repo = new InMemoryUserRepo();
const service = new UserService(new RealValidator(), new RealHasher(), repo);
await service.createUser({ email: 'test@test.com', password: 'password123' });
const saved = await repo.findByEmail('test@test.com');
expect(await bcrypt.compare('password123', saved.passwordHash)).toBe(true);
```

### Environment Manipulation [4]

```typescript
// VIOLATION: Mutating global environment causes test pollution [4]
beforeEach(() => {
  process.env = { ...process.env, DATABASE_URL: 'postgres://test', API_KEY: 'test-key' };
});
```

**Fix**: Inject configuration as a dependency — `new MyService({ dbUrl, apiKey })` [4]

### Database State Dependencies [4][20]

```typescript
// VIOLATION: Tests depend on specific seeded state [4]
beforeAll(async () => {
  await db.users.insert([/* hardcoded records */]);
  await db.orders.insert([/* hardcoded records */]);
  // Other tests that run before this may corrupt state [11]
});
```

**Fix**: Use in-memory fakes with fresh state per test; separate data access from logic [1][20]
