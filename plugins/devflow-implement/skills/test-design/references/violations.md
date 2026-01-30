# Test Design Violations Reference

Extended examples of test anti-patterns that indicate architectural problems.

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

  it('should handle order creation error', async () => {
    try {
      await api.createOrder(invalidData);
      fail('Should have thrown');
    } catch (error) {
      expect(error.status).toBe(400);
      expect(error.message).toContain('validation');
    }
  });

  it('should handle payment creation error', async () => {
    try {
      await api.createPayment(invalidData);
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
describe('OrderProcessor', () => {
  let mockDb: any;
  let mockEmailService: any;
  let mockPaymentGateway: any;
  let mockInventory: any;
  let mockShipping: any;

  beforeEach(() => {
    // Complex mock setup required
    mockDb = {
      transaction: jest.fn((callback) => callback(mockDb)),
      orders: {
        create: jest.fn(),
        update: jest.fn(),
        findById: jest.fn(),
        findByUserId: jest.fn(),
        delete: jest.fn()
      },
      users: {
        findById: jest.fn(),
        update: jest.fn(),
        updateBalance: jest.fn()
      },
      inventory: {
        decrement: jest.fn(),
        check: jest.fn(),
        reserve: jest.fn()
      }
    };

    mockEmailService = {
      send: jest.fn(),
      queue: jest.fn(),
      retry: jest.fn(),
      cancel: jest.fn()
    };

    mockPaymentGateway = {
      charge: jest.fn(),
      refund: jest.fn(),
      verify: jest.fn(),
      getStatus: jest.fn()
    };

    mockInventory = {
      reserve: jest.fn(),
      release: jest.fn(),
      check: jest.fn()
    };

    mockShipping = {
      createLabel: jest.fn(),
      getQuote: jest.fn(),
      track: jest.fn()
    };
  });

  it('should process order', async () => {
    // Test requires manipulating all these mocks
    mockDb.users.findById.mockResolvedValue({ id: '1', balance: 100 });
    mockDb.inventory.check.mockResolvedValue({ available: true });
    mockPaymentGateway.charge.mockResolvedValue({ success: true });
    mockInventory.reserve.mockResolvedValue({ reserved: true });
    mockShipping.createLabel.mockResolvedValue({ trackingId: 'ABC123' });
    mockEmailService.send.mockResolvedValue({ sent: true });

    const processor = new OrderProcessor(
      mockDb,
      mockEmailService,
      mockPaymentGateway,
      mockInventory,
      mockShipping
    );

    const result = await processor.process(order);
    expect(result.success).toBe(true);
  });
});
```

**Root Cause**: OrderProcessor directly depends on too many external systems

**Solution**: Separate pure business logic from I/O; use composition

---

## Implementation Testing Violations

### Spying on Private Methods

```typescript
// VIOLATION: Testing implementation details
describe('ShoppingCart', () => {
  it('should call updateTotal after addItem', () => {
    const cart = new ShoppingCart();
    const spy = jest.spyOn(cart as any, 'updateTotal');
    cart.addItem({ id: '1', price: 10 });
    expect(spy).toHaveBeenCalled();  // Testing implementation!
  });

  it('should call validateItem before adding', () => {
    const cart = new ShoppingCart();
    const spy = jest.spyOn(cart as any, 'validateItem');
    cart.addItem({ id: '1', price: 10 });
    expect(spy).toHaveBeenCalledWith({ id: '1', price: 10 });
  });

  it('should set internal state correctly', () => {
    const cart = new ShoppingCart();
    cart.addItem({ id: '1', price: 10 });
    expect((cart as any).internalState.total).toBe(10);  // Testing internals!
    expect((cart as any).internalState.itemCount).toBe(1);
  });

  it('should call notifyObservers after state change', () => {
    const cart = new ShoppingCart();
    const spy = jest.spyOn(cart as any, 'notifyObservers');
    cart.addItem({ id: '1', price: 10 });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
```

**Root Cause**: Tests coupled to implementation details

**Solution**: Test observable behavior only

---

## Test Helper Abuse

### Helpers Masking API Problems

```typescript
// VIOLATION: Test helpers hiding bad API design
const createTestUser = async (overrides = {}) => {
  const mockDb = new MockDatabase();
  await mockDb.connect();
  const mockCache = new MockCache();
  const mockLogger = new MockLogger();
  const mockAuth = new MockAuth();
  const mockValidator = new MockValidator();

  const service = new UserService(mockDb, mockCache, mockLogger, mockAuth, mockValidator);

  return service.createUser({
    name: 'Test User',
    email: 'test@example.com',
    ...overrides
  });
};

// Every test uses this helper
describe('UserService', () => {
  it('should create user', async () => {
    const user = await createTestUser();
    expect(user).toBeDefined();
  });

  it('should create admin user', async () => {
    const user = await createTestUser({ role: 'admin' });
    expect(user.role).toBe('admin');
  });

  // 50 more tests using the helper
});
```

**Root Cause**: Helper hides the fact that UserService requires complex setup

**Solution**: Refactor UserService to reduce dependencies

---

## Environment Manipulation

### Tests Modifying Environment

```typescript
// VIOLATION: Environment manipulation in tests
describe('ConfigService', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = {
      ...process.env,
      DATABASE_URL: 'postgres://test:test@localhost/test',
      REDIS_URL: 'redis://localhost:6379',
      API_KEY: 'test-key-12345',
      SECRET_KEY: 'test-secret',
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      FEATURE_FLAG_NEW_CHECKOUT: 'true',
      FEATURE_FLAG_BETA: 'false',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load config', () => {
    const config = new ConfigService();
    expect(config.databaseUrl).toBe('postgres://test:test@localhost/test');
  });
});
```

**Root Cause**: ConfigService reads from environment directly

**Solution**: Inject configuration as a dependency

---

## Database State Dependencies

### Tests Requiring Seeded Data

```typescript
// VIOLATION: Tests depend on specific database state
describe('ReportService', () => {
  beforeAll(async () => {
    await db.connect();
    await db.migrate();
    // Seed specific data structure
    await db.users.insert([
      { id: '1', name: 'Alice', role: 'admin' },
      { id: '2', name: 'Bob', role: 'user' },
      { id: '3', name: 'Carol', role: 'user' },
    ]);
    await db.orders.insert([
      { id: '1', userId: '1', total: 100, status: 'completed' },
      { id: '2', userId: '2', total: 200, status: 'completed' },
      { id: '3', userId: '2', total: 50, status: 'pending' },
      { id: '4', userId: '3', total: 300, status: 'cancelled' },
    ]);
    await db.products.insert([/* 20 products */]);
    await db.categories.insert([/* 5 categories */]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('should generate sales report', async () => {
    const service = new ReportService(db);
    const report = await service.generateSalesReport();
    expect(report.totalRevenue).toBe(300); // Depends on seeded data
  });
});
```

**Root Cause**: ReportService coupled to database structure

**Solution**: Separate data access from report logic; test calculation separately
