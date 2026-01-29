---
name: devflow-test-design
description: Test quality enforcement. Use when user asks to "write tests", "fix failing test", or tests have complex setup, mocking, or boilerplate.
user-invocable: false
allowed-tools: Read, Grep, Glob, AskUserQuestion
---

# Test Design Skill

## Iron Law

> **COMPLEX TESTS INDICATE BAD DESIGN**
>
> If tests require >10 lines of setup, the production code is wrong. Fix the architecture,
> not the tests. Complex mocking means tight coupling. Test helpers mean API problems.
> Simple tests are a symptom of good design. STOP and refactor before writing complex tests.

## Purpose

Enforce test quality standards that indicate good software design:
1. **Simple test setup** - Complex setup indicates design problems
2. **Minimal boilerplate** - Repetition indicates API problems
3. **Easy mocking** - Difficult mocking indicates coupling problems
4. **Behavior validation** - Tests should verify outcomes, not implementation

## When This Skill Activates

- New test files are being created
- Existing tests are being modified
- Test failures occur during development
- Mock objects or stubs are being added
- Setup/teardown code is being written

---

## Test Quality Red Flags

### 1. Complex Setup

**RED FLAG**: Test setup >10 lines means the design is wrong.

```typescript
// VIOLATION: Too many dependencies
beforeEach(async () => {
  mockDb = new MockDatabase();
  await mockDb.connect();
  mockCache = new MockCache();
  // ... 10+ more lines
  service = new UserService(mockDb, mockCache, mockLogger, mockConfig);
});

// CORRECT: Simple setup
it('should return Ok with valid data', () => {
  const result = createUser({ name: 'test', email: 'test@example.com' });
  expect(result.ok).toBe(true);
});
```

**Detection**: `beforeEach` >10 lines, multiple mocks, async setup, database seeding

### 2. Repetitive Boilerplate

**RED FLAG**: Same pattern repeated >3 times means the API is wrong.

```typescript
// VIOLATION: Try/catch everywhere
try { await api.createUser(data); fail(); } catch (e) { expect(e.status).toBe(400); }

// CORRECT: Result types eliminate repetition
const result = createUser(invalidData);
expect(result.ok).toBe(false);
expect(result.error.type).toBe('ValidationError');
```

**Detection**: Try/catch in multiple tests, helper functions wrapping basic operations

### 3. Difficult Mocking

**RED FLAG**: Mock setup >20 lines means dependencies are wrong.

```typescript
// VIOLATION: Nested mock structures
mockDb = { transaction: jest.fn(), orders: { create: jest.fn(), update: jest.fn() } };

// CORRECT: Pure functions need no mocking
const result = processOrder(order);
expect(result.ok).toBe(true);
```

**Detection**: Mock objects with >5 methods, `jest.fn()` used >10 times per file

### 4. Implementation Testing

**RED FLAG**: Testing internals means tests are fragile.

```typescript
// VIOLATION: Spying on private methods
const spy = jest.spyOn(cart as any, 'updateTotal');
expect(spy).toHaveBeenCalled();

// CORRECT: Test observable behavior
expect(cart.getTotal()).toBe(10);
```

**Detection**: `jest.spyOn` on private methods, accessing `as any` properties

---

## Extended References

For extended examples and templates:
- **violations.md** - Extended violation examples with root cause analysis
- **patterns.md** - Correct patterns demonstrating good design
- **report-template.md** - Full report format for documenting issues

---

## Quality Gates

Tests pass design review when:
- [ ] Setup code <10 lines per test file
- [ ] No repetitive try/catch or error handling patterns
- [ ] Mocking requires <5 lines of setup
- [ ] No spying on private methods or internal state
- [ ] Tests verify behavior, not implementation details
- [ ] Pure business logic testable without mocks

---

## Test Suite Safety

Configure tests to run safely:

```typescript
// vitest.config.ts / jest.config.js
{ fileParallelism: false, maxWorkers: 1, testTimeout: 10000 }
```

```bash
NODE_OPTIONS="--max-old-space-size=512" npm test
```

**Safety Checklist**:
- [ ] Sequential execution configured
- [ ] Memory limits set
- [ ] Cleanup hooks in beforeAll/afterAll
- [ ] Separate unit/integration/e2e suites

---

## Integration Points

- **devflow-core-patterns**: Detects architectural issues causing test complexity
- **devflow-code-smell**: Identifies workarounds in test code
