# Test Design Correct Patterns Reference

Examples of well-designed tests that indicate good architecture.

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

  it('should return Err with empty name', () => {
    const result = createUser({ name: '', email: 'test@example.com' });
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('ValidationError');
  });
});
```

**Why This Works**: Pure function with no side effects; validates input and returns result.

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

    expect(result).toBe(275); // 250 + 10% tax
  });

  it('should apply discount before tax', () => {
    const taxService = { getRate: () => 0.1 };
    const calculator = new OrderCalculator(taxService);

    const result = calculator.calculateTotal(
      [{ price: 100, quantity: 1 }],
      { discountPercent: 20 }
    );

    expect(result).toBe(88); // 100 - 20% = 80, + 10% tax = 88
  });
});
```

**Why This Works**: Calculator has single dependency; mock is trivial.

---

## Behavior-Focused Testing

### Testing Observable Outcomes

```typescript
// CORRECT: Testing behavior, not implementation
describe('ShoppingCart', () => {
  it('should calculate correct total after adding items', () => {
    const cart = new ShoppingCart();
    cart.addItem({ id: '1', price: 10 });
    cart.addItem({ id: '2', price: 20 });
    expect(cart.getTotal()).toBe(30);
  });

  it('should return all added items', () => {
    const cart = new ShoppingCart();
    const item1 = { id: '1', price: 10 };
    const item2 = { id: '2', price: 20 };
    cart.addItem(item1);
    cart.addItem(item2);
    expect(cart.getItems()).toEqual([item1, item2]);
  });

  it('should be empty after clearing', () => {
    const cart = new ShoppingCart();
    cart.addItem({ id: '1', price: 10 });
    cart.clear();
    expect(cart.getItems()).toEqual([]);
    expect(cart.getTotal()).toBe(0);
  });

  it('should update quantity for duplicate items', () => {
    const cart = new ShoppingCart();
    cart.addItem({ id: '1', price: 10 });
    cart.addItem({ id: '1', price: 10 });
    expect(cart.getItemCount('1')).toBe(2);
    expect(cart.getTotal()).toBe(20);
  });
});
```

**Why This Works**: Tests verify what the cart does, not how it does it.

---

## Result Type Testing

### Consistent Error Handling

```typescript
// CORRECT: Consistent API eliminates repetition
describe('API endpoints', () => {
  it('should return validation error for invalid user', () => {
    const result = createUser({ name: '', email: 'invalid' });
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('ValidationError');
  });

  it('should return validation error for invalid order', () => {
    const result = createOrder({ items: [], total: -1 });
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('ValidationError');
  });

  it('should return success for valid user', () => {
    const result = createUser({ name: 'Test', email: 'test@example.com' });
    expect(result.ok).toBe(true);
    expect(result.value.id).toBeDefined();
  });

  it('should return not found error', () => {
    const result = getUser('non-existent-id');
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('NotFound');
  });
});
```

**Why This Works**: Result types make error cases explicit without try/catch.

---

## Separation of Concerns Testing

### Pure Logic Separate from I/O

```typescript
// CORRECT: Business logic tested without I/O
describe('OrderPricing (pure logic)', () => {
  it('should calculate subtotal', () => {
    const items = [
      { price: 100, quantity: 2 },
      { price: 50, quantity: 1 },
    ];
    expect(calculateSubtotal(items)).toBe(250);
  });

  it('should apply percentage discount', () => {
    expect(applyDiscount(100, { type: 'percent', value: 20 })).toBe(80);
  });

  it('should apply fixed discount', () => {
    expect(applyDiscount(100, { type: 'fixed', value: 15 })).toBe(85);
  });

  it('should calculate tax', () => {
    expect(calculateTax(100, 0.1)).toBe(10);
  });

  it('should compose total calculation', () => {
    const total = calculateOrderTotal({
      items: [{ price: 100, quantity: 1 }],
      discount: { type: 'percent', value: 10 },
      taxRate: 0.1,
    });
    expect(total).toBe(99); // 100 - 10% = 90, + 10% tax = 99
  });
});

// Integration test for I/O wrapper
describe('OrderService (integration)', () => {
  it('should persist order and return result', async () => {
    const mockRepo = { save: jest.fn().mockResolvedValue({ id: '1' }) };
    const service = new OrderService(mockRepo);

    const result = await service.createOrder({
      items: [{ price: 100, quantity: 1 }],
    });

    expect(result.ok).toBe(true);
    expect(mockRepo.save).toHaveBeenCalledTimes(1);
  });
});
```

**Why This Works**: Pure calculations are trivially testable; I/O is isolated.

---

## Configuration Injection Testing

### Testable Configuration

```typescript
// CORRECT: Configuration injected, not read from environment
describe('EmailService', () => {
  it('should use configured sender', () => {
    const config = { senderEmail: 'noreply@example.com' };
    const transport = { send: jest.fn() };
    const service = new EmailService(config, transport);

    service.sendWelcome('user@example.com');

    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'noreply@example.com' })
    );
  });

  it('should use configured template', () => {
    const config = {
      senderEmail: 'noreply@example.com',
      templates: { welcome: 'Welcome, {{name}}!' },
    };
    const transport = { send: jest.fn() };
    const service = new EmailService(config, transport);

    service.sendWelcome('user@example.com', { name: 'Alice' });

    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Welcome, Alice!' })
    );
  });
});
```

**Why This Works**: No environment variable manipulation; config is a plain object.

---

## Factory Pattern Testing

### Test Data Factories

```typescript
// CORRECT: Factories for test data, not test setup
const createTestUser = (overrides = {}): User => ({
  id: 'test-id',
  name: 'Test User',
  email: 'test@example.com',
  role: 'user',
  createdAt: new Date('2024-01-01'),
  ...overrides,
});

const createTestOrder = (overrides = {}): Order => ({
  id: 'order-1',
  userId: 'test-id',
  items: [{ productId: 'p1', price: 100, quantity: 1 }],
  status: 'pending',
  ...overrides,
});

describe('UserPermissions', () => {
  it('should allow admin to delete users', () => {
    const admin = createTestUser({ role: 'admin' });
    expect(canDeleteUser(admin)).toBe(true);
  });

  it('should deny regular user from deleting users', () => {
    const user = createTestUser({ role: 'user' });
    expect(canDeleteUser(user)).toBe(false);
  });
});

describe('OrderValidation', () => {
  it('should reject empty orders', () => {
    const order = createTestOrder({ items: [] });
    expect(validateOrder(order).ok).toBe(false);
  });

  it('should accept valid orders', () => {
    const order = createTestOrder();
    expect(validateOrder(order).ok).toBe(true);
  });
});
```

**Why This Works**: Factories create data, not service instances; setup remains simple.

---

## Parameterized Testing

### Table-Driven Tests

```typescript
// CORRECT: Parameterized tests reduce repetition
describe('validateEmail', () => {
  const validEmails = [
    'test@example.com',
    'user.name@domain.org',
    'user+tag@example.co.uk',
  ];

  const invalidEmails = [
    '',
    'invalid',
    '@nodomain.com',
    'no@.com',
    'spaces in@email.com',
  ];

  test.each(validEmails)('should accept valid email: %s', (email) => {
    expect(validateEmail(email).ok).toBe(true);
  });

  test.each(invalidEmails)('should reject invalid email: %s', (email) => {
    expect(validateEmail(email).ok).toBe(false);
  });
});

describe('calculateShipping', () => {
  const testCases = [
    { weight: 1, distance: 100, expected: 5.00 },
    { weight: 5, distance: 100, expected: 10.00 },
    { weight: 1, distance: 500, expected: 15.00 },
    { weight: 10, distance: 1000, expected: 50.00 },
  ];

  test.each(testCases)(
    'should calculate $expected for weight=$weight, distance=$distance',
    ({ weight, distance, expected }) => {
      expect(calculateShipping(weight, distance)).toBe(expected);
    }
  );
});
```

**Why This Works**: Covers many cases without repetitive test structure.
