# Test Patterns — Correct Examples

Reference for proper test patterns and approaches. All citations reference `sources.md`.

---

## Simple Setup Patterns

### Pure Function Testing [8][4]

Simple tests signal correct design — if setup is hard, the design is wrong [8]:

```typescript
// CORRECT: Simple setup indicates good design [4][8]
describe('createUser', () => {
  it('returns Ok with valid data', () => {
    const result = createUser({ name: 'test', email: 'test@example.com' });
    expect(result.ok).toBe(true);
    expect(result.value.name).toBe('test');
  });

  it('returns Err with invalid email', () => {
    const result = createUser({ name: 'test', email: 'invalid' });
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('ValidationError');
  });
});
```

---

## Test Doubles — Right Tool for the Job [1][9]

Meszaros taxonomy: use the simplest double that satisfies the test [1]:

```typescript
// Stub: returns canned data, no assertions [1][9]
const taxService = { getRate: () => 0.1 };
const calculator = new OrderCalculator(taxService);
expect(calculator.calculateTotal([{ price: 100, quantity: 2 }])).toBe(220);

// Fake: working in-memory implementation — preferred over mocks [1][3]
const repo = new InMemoryUserRepo();
const service = new UserService(repo);
const result = await service.createUser({ name: 'Alice', email: 'alice@test.com' });
expect(result.ok).toBe(true);
expect(await repo.findByEmail('alice@test.com')).toBeDefined();

// Spy: assert on public-boundary calls — never private methods [1][9]
const emailSpy = jest.spyOn(emailService, 'send');
await service.createUser(userData);
expect(emailSpy).toHaveBeenCalledWith(expect.objectContaining({ to: userData.email }));
```

"Mock roles, not objects" — define an interface, mock the interface, never the class [3].

---

## Behavior-Focused Testing [4][8]

Google SWE Book Ch.12: test observable behavior, not implementation details [4]:

```typescript
// CORRECT: Testing behavior, not implementation [4]
describe('ShoppingCart', () => {
  it('calculates correct total after adding items', () => {
    const cart = new ShoppingCart();
    cart.addItem({ id: '1', price: 10 });
    cart.addItem({ id: '2', price: 20 });
    expect(cart.getTotal()).toBe(30);
  });

  it('is empty after clearing', () => {
    const cart = new ShoppingCart();
    cart.addItem({ id: '1', price: 10 });
    cart.clear();
    expect(cart.getItems()).toEqual([]);
    expect(cart.getTotal()).toBe(0);
  });
});
```

---

## Property-Based Testing [5][14]

QuickCheck (2000) introduced the pattern: state properties, let the framework
generate inputs [5]. fast-check ports this to TypeScript [14]:

```typescript
import fc from 'fast-check';

// Property: encode then decode always recovers original [14]
fc.assert(fc.property(
  fc.string(),
  (s) => decode(encode(s)) === s
));

// Property: sorted array is always ordered [5][14]
fc.assert(fc.property(
  fc.array(fc.integer()),
  (arr) => {
    const sorted = sort(arr);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i] > sorted[i + 1]) return false;
    }
    return true;
  }
));

// Property: total always equals sum of line items [14]
fc.assert(fc.property(
  fc.array(fc.record({ price: fc.integer({ min: 0 }), qty: fc.integer({ min: 1 }) })),
  (items) => {
    const order = new Order(items);
    const expected = items.reduce((s, i) => s + i.price * i.qty, 0);
    return order.total() === expected;
  }
));
```

Use property tests for: parsers/serializers, arithmetic, sorting/filtering,
state machines, encoding/decoding [5][13][14].

---

## Coverage Patterns [4]

### Branch Coverage

Every conditional path needs a test [4]:

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
  it('returns 0 for unknown tier', () => {
    expect(calculateDiscount(100, 'unknown')).toBe(0);
  });
});
```

### Error Path Coverage [4]

Error paths are first-class behaviors; test them explicitly [4]:

```typescript
describe('fetchUser', () => {
  it('returns user data on success', async () => { /* ... */ });
  it('returns Err on 404', async () => {
    api.get.mockResolvedValue({ ok: false, status: 404 });
    const result = await fetchUser('123');
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('NotFound');
  });
  it('returns Err on network failure', async () => {
    api.get.mockRejectedValue(new Error('Network error'));
    const result = await fetchUser('123');
    expect(result.ok).toBe(false);
  });
});
```

---

## Separation of Concerns [4][20]

Rainsberger: split collaboration tests (with mocks) from contract tests (real
behavior) to avoid integrated-test explosion [20]:

```typescript
// Pure business logic — no mocking needed [4][8]
describe('OrderPricing (unit)', () => {
  it('calculates subtotal', () => {
    const items = [{ price: 100, quantity: 2 }, { price: 50, quantity: 1 }];
    expect(calculateSubtotal(items)).toBe(250);
  });
  it('applies percentage discount', () => {
    expect(applyDiscount(100, { type: 'percent', value: 20 })).toBe(80);
  });
});

// I/O wrapper — minimal real mock at boundary [1][3]
describe('OrderService (integration)', () => {
  it('persists order and returns result', async () => {
    const repo = new InMemoryOrderRepo();  // Fake, not mock [1]
    const service = new OrderService(repo);
    const result = await service.createOrder({ items: [{ price: 100, quantity: 1 }] });
    expect(result.ok).toBe(true);
    expect(await repo.count()).toBe(1);
  });
});
```

---

## Parameterized Testing [4][17]

Reduce duplication while maintaining clear test names [4][17]:

```typescript
describe('validateEmail', () => {
  const validEmails = ['test@example.com', 'user.name@domain.org', 'user+tag@example.co.uk'];
  const invalidEmails = ['', 'invalid', '@nodomain.com', 'spaces in@email.com'];

  test.each(validEmails)('accepts valid email: %s', (email) => {
    expect(validateEmail(email).ok).toBe(true);
  });

  test.each(invalidEmails)('rejects invalid email: %s', (email) => {
    expect(validateEmail(email).ok).toBe(false);
  });
});
```

---

## Boundary Mocking [3][9]

Wrap third-party libraries in your own interface — mock the interface, not the library [3][9]:

```typescript
// Define your boundary interface [3]
interface HttpClient {
  get<T>(url: string): Promise<Result<T, HttpError>>;
}

// Fake for tests — implements real interface [1]
class FakeHttpClient implements HttpClient {
  private responses = new Map<string, unknown>();
  setResponse(url: string, data: unknown) { this.responses.set(url, data); }
  async get<T>(url: string): Promise<Result<T, HttpError>> {
    const data = this.responses.get(url);
    return data ? Ok(data as T) : Err({ type: 'NotFound', url });
  }
}

// Production code uses AxiosHttpClient — tests use FakeHttpClient [9]
```

---

## Flaky Test Prevention [11][18][19]

Google found async issues are the #1 cause of flakiness [11]:

```typescript
// FLAKY: Race condition — event may not have fired [11][18]
subscribe(callback);
emit('update', { value: 1 });
expect(callback).toHaveBeenCalled();

// STABLE: Wait for the event explicitly [19]
const received = new Promise(resolve => subscribe(data => resolve(data)));
emit('update', { value: 1 });
const data = await received;
expect(data.value).toBe(1);

// STABLE: Use fake timers for time-dependent code [19]
vi.useFakeTimers();
const promise = fetchWithRetry();
vi.advanceTimersByTime(1000);
await promise;
```

---

## Characterization Tests for Legacy Code [16]

Before modifying untested code, lock down current behavior first [16]:

```typescript
// Characterization test: documents what code currently does [16]
// IMPORTANT: This may not be the CORRECT behavior — verify before removing
it('returns -1 for unknown status (characterization test)', () => {
  expect(parseStatus('UNKNOWN_CODE')).toBe(-1);
});
```

These tests are safety nets during refactoring — they catch regressions
regardless of whether the original behavior was intentional [16].

---

## Test Organization [4][17]

Nested `describe` blocks scope setup and communicate intent [4]:

```typescript
describe('UserService', () => {
  let service: UserService;
  let repo: InMemoryUserRepo;

  beforeEach(() => {
    repo = new InMemoryUserRepo();     // Fake — not mock [1]
    service = new UserService(repo);
  });

  describe('create', () => {
    it('creates user with valid data', async () => { /* ... */ });
    it('rejects invalid email', async () => { /* ... */ });
    it('rejects duplicate email', async () => { /* ... */ });
  });

  describe('update', () => {
    it('updates existing user', async () => { /* ... */ });
    it('returns Err for non-existent user', async () => { /* ... */ });
  });
});
```

---

## Test Data Factories [4][8]

Builder pattern for test data avoids setup bloat [4][8]:

```typescript
// Factory with sensible defaults and overrides
const createTestUser = (overrides: Partial<User> = {}): User => ({
  id: 'test-id',
  name: 'Test User',
  email: 'test@example.com',
  role: 'user',
  createdAt: new Date('2024-01-01'),
  ...overrides,
});

describe('UserPermissions', () => {
  it('allows admin to delete users', () => {
    const admin = createTestUser({ role: 'admin' });
    expect(canDeleteUser(admin)).toBe(true);
  });
  it('prevents regular user from deleting users', () => {
    const user = createTestUser({ role: 'user' });
    expect(canDeleteUser(user)).toBe(false);
  });
});
```
