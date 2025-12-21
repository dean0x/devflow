---
name: devflow-test-design
description: Automatically review test quality and design when writing or modifying tests. Use when tests require complex setup, have repetitive boilerplate, or when mocking becomes difficult. Enforces behavior testing over implementation testing.
allowed-tools: Read, Grep, Glob, AskUserQuestion
---

# Test Design Skill

## Purpose

Enforce test quality standards that indicate good software design:
1. **Simple test setup** - Complex setup indicates design problems
2. **Minimal boilerplate** - Repetition indicates API problems
3. **Easy mocking** - Difficult mocking indicates coupling problems
4. **Behavior validation** - Tests should verify outcomes, not implementation

## When This Skill Activates

Automatically triggers when:
- New test files are being created
- Existing tests are being modified
- Test failures occur during development
- Mock objects or stubs are being added
- Setup/teardown code is being written

## Test Quality Red Flags

### 1. Complex Setup Detection

**RED FLAG**: If test setup takes >10 lines, the design is wrong.

```typescript
// ❌ VIOLATION: Complex setup indicates design problem
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

// ✅ CORRECT: Simple setup indicates good design
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

**Detection patterns:**
- `beforeEach` blocks >10 lines
- Multiple mock objects required for single test
- Complex async setup with awaits
- Database seeding in test setup
- Environment variable manipulation

### 2. Repetitive Boilerplate Detection

**RED FLAG**: If tests have repetitive patterns, the API is wrong.

```typescript
// ❌ VIOLATION: Repetitive error handling indicates API problem
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

  // ... repeated pattern 10+ times
});

// ✅ CORRECT: Consistent API eliminates repetition
describe('API endpoints', () => {
  it('should return validation error for invalid user', () => {
    const result = createUser(invalidData);
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('ValidationError');
  });

  it('should return validation error for invalid order', () => {
    const result = createOrder(invalidData);
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('ValidationError');
  });
});
```

**Detection patterns:**
- Try/catch blocks in multiple tests
- Same assertion patterns repeated >3 times
- Helper functions that wrap basic operations
- Repeated setup code across test files
- Explicit error handling in every test

### 3. Difficult Mocking Detection

**RED FLAG**: If mocking is hard, dependencies are wrong.

```typescript
// ❌ VIOLATION: Complex mocking indicates tight coupling
describe('OrderProcessor', () => {
  let mockDb: any;
  let mockEmailService: any;
  let mockPaymentGateway: any;

  beforeEach(() => {
    // Complex mock setup required
    mockDb = {
      transaction: jest.fn((callback) => callback(mockDb)),
      orders: {
        create: jest.fn(),
        update: jest.fn(),
        findById: jest.fn()
      },
      users: {
        findById: jest.fn(),
        update: jest.fn()
      },
      inventory: {
        decrement: jest.fn()
      }
    };

    mockEmailService = {
      send: jest.fn(),
      queue: jest.fn(),
      retry: jest.fn()
    };

    // ... 20+ more lines of mock setup
  });

  it('should process order', async () => {
    // Test requires manipulating all these mocks
  });
});

// ✅ CORRECT: Easy mocking indicates good design
describe('processOrder', () => {
  it('should return Ok with valid order', () => {
    const order = { id: '1', items: [], total: 100 };
    const result = processOrder(order);
    expect(result.ok).toBe(true);
  });

  // Pure function needs no mocking
  // Side effects handled in separate wrapper (tested separately)
});
```

**Detection patterns:**
- Mock objects with >5 methods
- Nested mock object structures
- Mock setup >20 lines
- `jest.fn()` or `sinon.stub()` used >10 times per file
- Mocking internal implementation details

### 4. Implementation Testing Detection

**RED FLAG**: Tests should verify behavior, not implementation.

```typescript
// ❌ VIOLATION: Testing implementation details
describe('ShoppingCart', () => {
  it('should call updateTotal after addItem', () => {
    const cart = new ShoppingCart();
    const spy = jest.spyOn(cart as any, 'updateTotal');
    cart.addItem({ id: '1', price: 10 });
    expect(spy).toHaveBeenCalled();  // Testing implementation!
  });

  it('should set internal state correctly', () => {
    const cart = new ShoppingCart();
    cart.addItem({ id: '1', price: 10 });
    expect((cart as any).internalState.total).toBe(10);  // Testing internals!
  });
});

// ✅ CORRECT: Testing behavior
describe('ShoppingCart', () => {
  it('should calculate correct total after adding item', () => {
    const cart = new ShoppingCart();
    cart.addItem({ id: '1', price: 10 });
    expect(cart.getTotal()).toBe(10);  // Testing observable behavior
  });

  it('should return all added items', () => {
    const cart = new ShoppingCart();
    const item = { id: '1', price: 10 };
    cart.addItem(item);
    expect(cart.getItems()).toContain(item);  // Testing behavior
  });
});
```

**Detection patterns:**
- `jest.spyOn` on private methods
- Accessing private properties with `as any`
- Testing method call counts
- Verifying internal state changes
- Testing order of operations

## Test Quality Report Format

When quality issues are found:

```markdown
⚠️ TEST DESIGN ISSUES DETECTED

## 🔴 CRITICAL - Complex Setup (Design Problem)
**File**: src/services/user.test.ts:15-45
**Issue**: Test setup requires 35 lines with multiple mocks
**Root Cause**: UserService has too many dependencies (6 injected services)
**Symptom**:
```typescript
beforeEach(async () => {
  // 35 lines of mock setup
});
```
**Correct Design**:
```typescript
// Split UserService into smaller, focused services
// Use composition instead of monolithic service
// Test pure functions separately from side effects
```
**Action Required**: Refactor UserService architecture before writing more tests

## 🔴 CRITICAL - Repetitive Boilerplate (API Problem)
**File**: src/api/endpoints.test.ts
**Issue**: Try/catch pattern repeated in 15 tests
**Root Cause**: API throws exceptions instead of returning Results
**Symptom**:
```typescript
try { await api.createUser(data); } catch (e) { expect(e)... }
```
**Correct Design**:
```typescript
// Change API to return Result types
const result = await api.createUser(data);
expect(result.ok).toBe(false);
```
**Action Required**: Migrate API to Result pattern before adding more endpoints

## 🟡 HIGH - Difficult Mocking (Coupling Problem)
**File**: src/processors/order.test.ts:10-50
**Issue**: 40 lines of mock setup for single test
**Root Cause**: OrderProcessor directly depends on database structure
**Symptom**:
```typescript
mockDb = { transaction: ..., orders: { create: ..., update: ... }, users: ... }
```
**Correct Design**:
```typescript
// Separate pure business logic from I/O
function calculateOrderTotal(items: Item[]): number { ... }
// Test pure function (no mocks needed)
```
**Action Required**: Extract pure logic from OrderProcessor

## 🟡 HIGH - Implementation Testing (Fragile Tests)
**File**: src/models/cart.test.ts:25
**Issue**: Testing private method calls
**Root Cause**: Tests coupled to implementation details
**Symptom**:
```typescript
const spy = jest.spyOn(cart as any, 'updateTotal');
expect(spy).toHaveBeenCalled();
```
**Correct Design**:
```typescript
// Test observable behavior only
expect(cart.getTotal()).toBe(expectedTotal);
```
**Action Required**: Rewrite tests to verify behavior, not implementation

## 📊 Summary
- **Critical**: 4 issues (block implementation)
- **High**: 3 issues (refactor needed)
- **Files affected**: 6 test files
- **Root cause**: Architecture violates design principles

## 🛑 STOP - Design Issues Detected

These test problems indicate fundamental design flaws:
1. UserService has too many responsibilities (SRP violation)
2. API uses exceptions instead of Result types (pattern violation)
3. Business logic mixed with I/O (separation violation)

**DO NOT work around these issues in tests.**
**DO NOT add more complex test helpers.**
**DO NOT mock more things to make tests pass.**

## ✅ Next Steps

1. **STOP writing tests** - Current design cannot be tested simply
2. **ANALYZE root cause** - Identify architectural issue
3. **PROPOSE redesign** - Show correct pattern
4. **GET APPROVAL** - User confirms design changes
5. **IMPLEMENT redesign** - Fix architecture first
6. **WRITE SIMPLE TESTS** - Tests should be trivial after redesign
```

## Change Process

When test design issues are detected:

1. **STOP** - Do not continue with current test approach
2. **ANALYZE** - What architectural issue causes complex tests?
3. **PROPOSE** - What correct design would make tests simple?
4. **COMMUNICATE** - Present design change proposal to user
5. **IMPLEMENT** - Fix design first, then tests become simple

## Quality Gates

Tests pass design review when:
- ✅ Setup code <10 lines per test file
- ✅ No repetitive try/catch or error handling patterns
- ✅ Mocking requires <5 lines of setup
- ✅ No spying on private methods or internal state
- ✅ Tests verify behavior, not implementation details
- ✅ Pure business logic testable without mocks

## Integration Points

This skill works with:
- **pattern-check**: Detects architectural issues causing test complexity
- **code-smell**: Identifies workarounds in test code
- **error-handling**: Ensures Result types simplify testing

## Example Scenario

```
User: "Write tests for UserService"
→ test-design activates
→ Analyzes UserService dependencies
→ Detects 6 constructor parameters
→ Reports: "STOP - UserService has too many dependencies"
→ Proposes: "Split into focused services: UserValidation, UserPersistence, UserNotification"
→ Waits for approval
→ After redesign: Tests become 5 lines each
```

This prevents writing complex tests that work around bad design.
