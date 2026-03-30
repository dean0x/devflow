# Test Patterns - Correct Examples

Reference for proper test patterns and approaches.

---

## Simple Setup Patterns

### Pure Function Testing

```typescript
// CORRECT: Simple setup indicates good design
describe('createUser', () => {
  it('should return Ok with valid data', () => {
    const result = createUser({ name: 'test', email: 'test@example.com' });
    expect(result.ok).toBe(true);
    expect(result.value.name).toBe('test');
  });

  it('should return Err with invalid email', () => {
    const result = createUser({ name: 'test', email: 'invalid' });
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('ValidationError');
  });
});
```

---

## Minimal Mocking Patterns

### Single Dependency Injection

```typescript
// CORRECT: Single mock for focused test
describe('OrderCalculator', () => {
  it('should calculate total with tax', () => {
    const taxService = { getRate: () => 0.1 }; // Simple mock
    const calculator = new OrderCalculator(taxService);
    const result = calculator.calculateTotal([
      { price: 100, quantity: 2 },
      { price: 50, quantity: 1 },
    ]);
    expect(result).toBe(275);
  });
});
```

---

## Behavior-Focused Testing

```typescript
// CORRECT: Testing behavior, not implementation
describe('ShoppingCart', () => {
  it('should calculate correct total after adding items', () => {
    const cart = new ShoppingCart();
    cart.addItem({ id: '1', price: 10 });
    cart.addItem({ id: '2', price: 20 });
    expect(cart.getTotal()).toBe(30);
  });

  it('should be empty after clearing', () => {
    const cart = new ShoppingCart();
    cart.addItem({ id: '1', price: 10 });
    cart.clear();
    expect(cart.getItems()).toEqual([]);
    expect(cart.getTotal()).toBe(0);
  });
});
```

---

## Coverage Patterns

### Branch Coverage

```typescript
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
describe('fetchUser', () => {
  it('returns user data on success', async () => { /* ... */ });
  it('throws ApiError on 404', async () => {
    api.get.mockResolvedValue({ ok: false, status: 404 });
    await expect(fetchUser('123')).rejects.toThrow(ApiError);
  });
  it('handles network errors', async () => {
    api.get.mockRejectedValue(new Error('Network error'));
    await expect(fetchUser('123')).rejects.toThrow('Network error');
  });
});
```

---

## Separation of Concerns Testing

```typescript
// CORRECT: Business logic tested without I/O
describe('OrderPricing (pure logic)', () => {
  it('should calculate subtotal', () => {
    const items = [{ price: 100, quantity: 2 }, { price: 50, quantity: 1 }];
    expect(calculateSubtotal(items)).toBe(250);
  });
  it('should apply percentage discount', () => {
    expect(applyDiscount(100, { type: 'percent', value: 20 })).toBe(80);
  });
});

// Integration test for I/O wrapper
describe('OrderService (integration)', () => {
  it('should persist order and return result', async () => {
    const mockRepo = { save: jest.fn().mockResolvedValue({ id: '1' }) };
    const service = new OrderService(mockRepo);
    const result = await service.createOrder({ items: [{ price: 100, quantity: 1 }] });
    expect(result.ok).toBe(true);
  });
});
```

---

## Parameterized Testing

```typescript
describe('validateEmail', () => {
  const validEmails = ['test@example.com', 'user.name@domain.org', 'user+tag@example.co.uk'];
  const invalidEmails = ['', 'invalid', '@nodomain.com', 'spaces in@email.com'];

  test.each(validEmails)('should accept valid email: %s', (email) => {
    expect(validateEmail(email).ok).toBe(true);
  });

  test.each(invalidEmails)('should reject invalid email: %s', (email) => {
    expect(validateEmail(email).ok).toBe(false);
  });
});
```

---

## Boundary Mocking

```typescript
// CORRECT: Wrap third-party libraries in your own interface
interface HttpClient {
  get<T>(url: string): Promise<T>;
}

class MockHttpClient implements HttpClient {
  private responses: Map<string, any> = new Map();
  mockResponse(url: string, data: any) { this.responses.set(url, data); }
  async get<T>(url: string): Promise<T> { return this.responses.get(url); }
}

// Tests use MockHttpClient, production uses AxiosHttpClient
```

---

## Test Organization

```typescript
describe('UserService', () => {
  let service: UserService;
  let repo: InMemoryUserRepo;

  beforeEach(() => {
    repo = new InMemoryUserRepo();
    service = new UserService(repo);
  });

  describe('create', () => {
    it('creates user with valid data', async () => { /* ... */ });
    it('rejects invalid email', async () => { /* ... */ });
  });

  describe('update', () => {
    it('updates existing user', async () => { /* ... */ });
    it('returns error for non-existent user', async () => { /* ... */ });
  });
});
```

---

## Test Data Factories

```typescript
// CORRECT: Factories for test data, not test setup
const createTestUser = (overrides = {}): User => ({
  id: 'test-id',
  name: 'Test User',
  email: 'test@example.com',
  role: 'user',
  ...overrides,
});

describe('UserPermissions', () => {
  it('should allow admin to delete users', () => {
    const admin = createTestUser({ role: 'admin' });
    expect(canDeleteUser(admin)).toBe(true);
  });
});
```
