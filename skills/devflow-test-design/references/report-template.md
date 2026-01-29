# Test Quality Report Template

Use this template when reporting test design issues.

---

## Report Format

```markdown
## Test Design Issues Detected

## [SEVERITY] - [Category] ([Root Cause Type])
**File**: path/to/file.test.ts:line-range
**Issue**: Brief description of the problem
**Root Cause**: What architectural issue causes this
**Symptom**:
```code
// The problematic code snippet
```
**Correct Design**:
```code
// What good design looks like
```
**Action Required**: Specific action to fix

## Summary
- **Critical**: N issues (block implementation)
- **High**: N issues (refactor needed)
- **Files affected**: N test files
- **Root cause**: Brief architectural diagnosis

## STOP - Design Issues Detected

[List fundamental design flaws discovered]

**DO NOT work around these issues in tests.**
**DO NOT add more complex test helpers.**
**DO NOT mock more things to make tests pass.**

## Next Steps

1. **STOP writing tests** - Current design cannot be tested simply
2. **ANALYZE root cause** - Identify architectural issue
3. **PROPOSE redesign** - Show correct pattern
4. **GET APPROVAL** - User confirms design changes
5. **IMPLEMENT redesign** - Fix architecture first
6. **WRITE SIMPLE TESTS** - Tests should be trivial after redesign
```

---

## Severity Levels

### CRITICAL (Block Implementation)

Use for issues that indicate fundamental design flaws:

- Complex setup (>10 lines, multiple mocks)
- Repetitive boilerplate (same pattern >3 times)
- Mock objects with >5 methods
- Testing private methods or internal state

**Example**:
```markdown
## CRITICAL - Complex Setup (Design Problem)
**File**: src/services/user.test.ts:15-45
**Issue**: Test setup requires 35 lines with multiple mocks
**Root Cause**: UserService has too many dependencies (6 injected services)
```

### HIGH (Refactor Needed)

Use for issues that complicate maintenance:

- Difficult mocking (20+ lines setup)
- Implementation testing (spying on methods)
- Environment manipulation
- Database seeding in tests

**Example**:
```markdown
## HIGH - Difficult Mocking (Coupling Problem)
**File**: src/processors/order.test.ts:10-50
**Issue**: 40 lines of mock setup for single test
**Root Cause**: OrderProcessor directly depends on database structure
```

### MEDIUM (Improvement Recommended)

Use for issues that reduce test clarity:

- Test helper abuse
- Inconsistent assertion patterns
- Missing edge case coverage

---

## Category Labels

| Category | Root Cause Type | Indicates |
|----------|-----------------|-----------|
| Complex Setup | Design Problem | Too many dependencies |
| Repetitive Boilerplate | API Problem | Inconsistent error handling |
| Difficult Mocking | Coupling Problem | Tight coupling to externals |
| Implementation Testing | Fragile Tests | Tests coupled to internals |
| Environment Manipulation | DI Problem | Direct environment access |
| Database Seeding | Separation Problem | Logic mixed with data access |

---

## Full Example Report

```markdown
## Test Design Issues Detected

## CRITICAL - Complex Setup (Design Problem)
**File**: src/services/user.test.ts:15-45
**Issue**: Test setup requires 35 lines with multiple mocks
**Root Cause**: UserService has too many dependencies (6 injected services)
**Symptom**:
```typescript
beforeEach(async () => {
  mockDb = new MockDatabase();
  await mockDb.connect();
  await mockDb.seed();
  mockCache = new MockCache();
  mockCache.clear();
  // ... 30 more lines
});
```
**Correct Design**:
```typescript
// Split UserService into smaller, focused services
// Use composition instead of monolithic service
// Test pure functions separately from side effects
```
**Action Required**: Refactor UserService architecture before writing more tests

## CRITICAL - Repetitive Boilerplate (API Problem)
**File**: src/api/endpoints.test.ts
**Issue**: Try/catch pattern repeated in 15 tests
**Root Cause**: API throws exceptions instead of returning Results
**Symptom**:
```typescript
try {
  await api.createUser(data);
  fail('Should have thrown');
} catch (e) {
  expect(e.status).toBe(400);
}
```
**Correct Design**:
```typescript
// Change API to return Result types
const result = await api.createUser(data);
expect(result.ok).toBe(false);
expect(result.error.type).toBe('ValidationError');
```
**Action Required**: Migrate API to Result pattern before adding more endpoints

## HIGH - Difficult Mocking (Coupling Problem)
**File**: src/processors/order.test.ts:10-50
**Issue**: 40 lines of mock setup for single test
**Root Cause**: OrderProcessor directly depends on database structure
**Symptom**:
```typescript
mockDb = {
  transaction: jest.fn((callback) => callback(mockDb)),
  orders: { create: jest.fn(), update: jest.fn(), findById: jest.fn() },
  users: { findById: jest.fn(), update: jest.fn() },
  inventory: { decrement: jest.fn() }
};
```
**Correct Design**:
```typescript
// Separate pure business logic from I/O
function calculateOrderTotal(items: Item[]): number { ... }
// Test pure function (no mocks needed)
```
**Action Required**: Extract pure logic from OrderProcessor

## HIGH - Implementation Testing (Fragile Tests)
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

## Summary
- **Critical**: 2 issues (block implementation)
- **High**: 2 issues (refactor needed)
- **Files affected**: 4 test files
- **Root cause**: Architecture violates design principles

## STOP - Design Issues Detected

These test problems indicate fundamental design flaws:
1. UserService has too many responsibilities (SRP violation)
2. API uses exceptions instead of Result types (pattern violation)
3. Business logic mixed with I/O (separation violation)
4. Tests verify implementation instead of behavior

**DO NOT work around these issues in tests.**
**DO NOT add more complex test helpers.**
**DO NOT mock more things to make tests pass.**

## Next Steps

1. **STOP writing tests** - Current design cannot be tested simply
2. **ANALYZE root cause** - Identify architectural issue
3. **PROPOSE redesign** - Show correct pattern
4. **GET APPROVAL** - User confirms design changes
5. **IMPLEMENT redesign** - Fix architecture first
6. **WRITE SIMPLE TESTS** - Tests should be trivial after redesign
```

---

## Change Process

When test design issues are detected:

1. **STOP** - Do not continue with current test approach
2. **ANALYZE** - What architectural issue causes complex tests?
3. **PROPOSE** - What correct design would make tests simple?
4. **COMMUNICATE** - Present design change proposal to user
5. **IMPLEMENT** - Fix design first, then tests become simple

---

## Test Suite Safety Configuration

### Full Configuration Examples

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    fileParallelism: false,  // Run files sequentially
    maxWorkers: 1,           // Single worker
    pool: 'forks',           // Isolate tests
    testTimeout: 10000,      // Reasonable timeout
  }
});

// jest.config.js
module.exports = {
  maxWorkers: 1,
  runInBand: true,  // Sequential execution
  testTimeout: 10000,
};
```

```python
# pytest.ini
[pytest]
addopts = -n 0 --maxprocesses=1
```

```bash
# Go
go test -p 1 ./...

# Rust
cargo test -- --test-threads=1
```

### Memory Limits

```bash
# Node.js
NODE_OPTIONS="--max-old-space-size=512" npm test

# Python
ulimit -v 1048576 && pytest

# Go
GOMEMLIMIT=512MiB go test ./...
```

### Resource Cleanup Patterns

```typescript
// Always clean up before AND after tests
beforeAll(async () => {
  await cleanupTempFiles();
  await resetTestDatabase();
});

afterAll(async () => {
  await closeConnections();
  await cleanupTempFiles();
});

afterEach(async () => {
  // Reset state between tests
  await resetMocks();
});
```

### Test Isolation

```typescript
// Separate test suites in package.json
{
  "scripts": {
    "test": "npm run test:unit && npm run test:integration",
    "test:unit": "vitest run src/**/*.test.ts",
    "test:integration": "vitest run tests/integration/**/*.test.ts",
    "test:e2e": "playwright test"
  }
}
```

---

## Integration Points

This report format works with:
- **devflow-core-patterns**: Reference for correct architectural patterns
- **devflow-code-smell**: Identifies workarounds in test code
- **devflow-review-methodology**: Aligns with standard review severity levels
