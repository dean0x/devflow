# Test Pattern Violations - Extended Examples

Reference examples for common test quality violations across both design and review contexts.

---

## Complex Setup Violations

### Multi-Dependency Service Setup

```typescript
// VIOLATION: Complex setup indicates design problem
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

  it('should create user', async () => {
    const result = await service.createUser({ name: 'test' });
    expect(result.ok).toBe(true);
  });
});
```

**Root Cause**: UserService has too many dependencies (6+ injected services)

**Solution**: Split into focused services with single responsibility

---

## Repetitive Boilerplate Violations

### Try/Catch Pattern Repetition

```typescript
// VIOLATION: Repetitive error handling indicates API problem
describe('API endpoints', () => {
  it('should handle user creation error', async () => {
    try {
      await api.createUser(invalidData);
      fail('Should have thrown');
    } catch (error) {
      expect(error.status).toBe(400);
      expect(error.message).toContain('validation');
    }
  });

  // ... repeated pattern 10+ times
});
```

**Root Cause**: API throws exceptions instead of returning Results

**Solution**: Migrate API to Result pattern

---

## Difficult Mocking Violations

### Nested Mock Object Structures

```typescript
// VIOLATION: Complex mocking indicates tight coupling
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

**Root Cause**: OrderProcessor directly depends on too many external systems

**Solution**: Separate pure business logic from I/O; use composition

---

## Implementation Testing Violations

### Spying on Private Methods

```typescript
// VIOLATION: Testing implementation details
it('should call updateTotal after addItem', () => {
  const cart = new ShoppingCart();
  const spy = jest.spyOn(cart as any, 'updateTotal');
  cart.addItem({ id: '1', price: 10 });
  expect(spy).toHaveBeenCalled();  // Testing implementation!
});
```

**Root Cause**: Tests coupled to implementation details

**Solution**: Test observable behavior only

---

## Coverage Violations

### Missing Edge Cases

```typescript
// INCOMPLETE TESTS
describe('divide', () => {
  it('divides two numbers', () => {
    expect(divide(10, 2)).toBe(5);  // Happy path only
  });
});

// COMPLETE TESTS
describe('divide', () => {
  it('divides two positive numbers', () => { expect(divide(10, 2)).toBe(5); });
  it('handles division by zero', () => { expect(divide(10, 0)).toBe(Infinity); });
  it('handles negative numbers', () => { expect(divide(-10, 2)).toBe(-5); });
  it('handles decimal results', () => { expect(divide(10, 3)).toBeCloseTo(3.333, 2); });
});
```

### Unclear Test Names

```typescript
// UNCLEAR: What does this test?
it('test1', () => { /* ... */ });
it('should work', () => { /* ... */ });

// CLEAR: Describes behavior
it('validates email format on creation', () => { /* ... */ });
it('rejects passwords shorter than 8 characters', () => { /* ... */ });
```

---

## Test Design Violations

### Slow Tests (Real Delays)

```typescript
// SLOW: Real delays
const result = await fetchWithRetry();  // Waits real 1000ms

// FAST: Mock timers
jest.useFakeTimers();
const promise = fetchWithRetry();
jest.advanceTimersByTime(1000);
```

### Flaky Tests (Timing Dependencies)

```typescript
// FLAKY: Race condition
subscribe(callback);
emit('update', { value: 1 });
expect(callback).toHaveBeenCalled();  // Might not have fired yet

// STABLE: Explicit waiting
const received = new Promise(resolve => { subscribe(data => resolve(data)); });
emit('update', { value: 1 });
const data = await received;
expect(data.value).toBe(1);
```

### Over-Mocking

```typescript
// OVER-MOCKED: Tests nothing real
const mockValidator = { validate: jest.fn().mockReturnValue(true) };
const mockHasher = { hash: jest.fn().mockReturnValue('hashed') };
const mockRepo = { create: jest.fn().mockResolvedValue({ id: '1' }) };
// What did we actually test? Just that mocks were called.

// BETTER: Use real implementations where possible
const repo = new InMemoryUserRepo();
const service = new UserService(new RealValidator(), new RealHasher(), repo);
const saved = await repo.findByEmail('test@test.com');
expect(await bcrypt.compare('password', saved.password)).toBe(true);
```

---

## Environment & Database Violations

### Environment Manipulation

```typescript
// VIOLATION: Tests modifying environment
beforeEach(() => {
  process.env = { ...process.env, DATABASE_URL: 'postgres://test', API_KEY: 'test-key' };
});
```

**Solution**: Inject configuration as a dependency

### Database State Dependencies

```typescript
// VIOLATION: Tests depend on specific seeded data
beforeAll(async () => {
  await db.users.insert([/* ... */]);
  await db.orders.insert([/* ... */]);
});
```

**Solution**: Separate data access from business logic; test calculation separately
