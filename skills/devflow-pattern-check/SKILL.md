---
name: devflow-pattern-check
description: Automatically validate architectural patterns and detect violations when code changes are made. Use when implementing new functionality, refactoring existing code, or when Result types, dependency injection, or immutability patterns might be violated.
allowed-tools: Read, Grep, Glob, AskUserQuestion
---

# Pattern Check Skill

## Purpose

Enforce core architectural patterns defined in project guidelines:
1. **Result types** instead of exceptions
2. **Dependency injection** instead of internal instantiation
3. **Immutability** instead of mutation
4. **Pure functions** instead of side-effect-heavy code

## When This Skill Activates

Automatically triggers when:
- New functions or methods are being added
- Error handling code is being written
- Class constructors are being modified
- Data structures are being updated
- Refactoring is in progress

## Pattern Validation Process

### 1. Result Type Pattern Check

**CRITICAL**: Business logic must NEVER throw exceptions directly.

Search for violations:
```typescript
// ❌ VIOLATION
function createUser(data: unknown): User {
  if (!valid(data)) {
    throw new ValidationError();  // VIOLATION: throwing exception
  }
  return user;
}

// ✅ CORRECT
function createUser(data: unknown): Result<User, ValidationError> {
  if (!valid(data)) {
    return { ok: false, error: new ValidationError() };
  }
  return { ok: true, value: user };
}
```

**Detection patterns:**
- `throw new Error` inside business logic functions
- `try/catch` blocks wrapping business operations (except at boundaries)
- Functions returning data types without Result wrapper
- Missing error handling in function signatures

### 2. Dependency Injection Pattern Check

**CRITICAL**: Dependencies must be injected, not instantiated internally.

Search for violations:
```typescript
// ❌ VIOLATION
class UserService {
  private db = new Database();  // VIOLATION: creating dependency

  async getUser(id: string) {
    return this.db.query(id);
  }
}

// ✅ CORRECT
class UserService {
  constructor(private db: Database) {}  // Injected dependency

  async getUser(id: string) {
    return this.db.query(id);
  }
}
```

**Detection patterns:**
- `new SomeClass()` inside constructors or methods
- Direct file system imports for services
- Hardcoded configuration values
- Singleton patterns without DI container

### 3. Immutability Pattern Check

**CRITICAL**: Data structures must return new objects, not mutate existing ones.

Search for violations:
```typescript
// ❌ VIOLATION
function updateUser(user: User, name: string): User {
  user.name = name;  // VIOLATION: mutating input
  return user;
}

// ✅ CORRECT
function updateUser(user: User, name: string): User {
  return { ...user, name };  // New object
}
```

**Detection patterns:**
- Direct property assignment on parameters
- Array mutation methods: `push`, `pop`, `splice`, `sort` (without returning new array)
- Object property mutations on inputs
- Missing `const` declarations for data structures

### 4. Pure Function Pattern Check

**CRITICAL**: Business logic should be pure; side effects isolated.

Search for violations:
```typescript
// ❌ VIOLATION
function calculateTotal(items: Item[]): number {
  console.log('Calculating...');  // VIOLATION: side effect
  logToDatabase('calculation');    // VIOLATION: side effect
  return items.reduce((sum, item) => sum + item.price, 0);
}

// ✅ CORRECT
function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);  // Pure
}

// Wrapper handles side effects
async function processOrder(items: Item[]): Promise<Result<number, Error>> {
  logToDatabase('calculation');  // Side effect in wrapper
  const total = calculateTotal(items);  // Pure function call
  return { ok: true, value: total };
}
```

**Detection patterns:**
- I/O operations inside pure business logic
- Console logs in calculation functions
- Database calls mixed with business logic
- File system access in data transformations

## Violation Report Format

When violations are found, report using this format:

```markdown
⚠️ ARCHITECTURAL PATTERN VIOLATIONS DETECTED

## 🔴 CRITICAL - Result Type Violations
**File**: src/services/user.ts:45
**Issue**: Function throws exception instead of returning Result type
**Current**:
```typescript
throw new ValidationError('Invalid email');
```
**Fix Required**:
```typescript
return { ok: false, error: new ValidationError('Invalid email') };
```
**Impact**: Breaks error handling consistency, makes errors invisible to type system

## 🔴 CRITICAL - Dependency Injection Violations
**File**: src/services/order.ts:12
**Issue**: Service instantiates database directly
**Current**:
```typescript
private db = new Database();
```
**Fix Required**:
```typescript
constructor(private db: Database) {}
```
**Impact**: Makes testing impossible, creates tight coupling

## 🟡 HIGH - Immutability Violations
**File**: src/models/cart.ts:23
**Issue**: Mutating input parameter
**Current**:
```typescript
cart.items.push(newItem);
return cart;
```
**Fix Required**:
```typescript
return { ...cart, items: [...cart.items, newItem] };
```
**Impact**: Creates hidden side effects, breaks referential transparency

## 📊 Summary
- **Critical**: 5 violations
- **High**: 3 violations
- **Files affected**: 4
- **Estimated fix time**: 30 minutes

## 🛠️ Next Steps
1. Fix Result type violations first (breaks consistency)
2. Apply dependency injection (enables testing)
3. Remove mutations (prevents bugs)
4. Verify with pattern-check after fixes
```

## Integration with Workflow

After detecting violations:

1. **STOP implementation** - Do not proceed with current changes
2. **Report violations** - Use format above
3. **Propose fixes** - Show correct patterns
4. **Wait for approval** - Get explicit user confirmation
5. **Apply fixes** - Implement corrections systematically
6. **Re-validate** - Run pattern-check again

## Red Flags - Immediate Stop

Stop immediately and report if you detect:
- Multiple Result type violations in same file
- Systematic lack of dependency injection
- Widespread mutation patterns
- Business logic mixed with I/O throughout codebase

These indicate architectural issues requiring design discussion, not quick fixes.

## Success Criteria

Code passes pattern-check when:
- ✅ All business functions return Result types
- ✅ All dependencies are injected
- ✅ All data updates return new objects
- ✅ Pure functions contain no side effects
- ✅ Side effects isolated in wrapper functions

## Example Usage

User implements new feature → pattern-check automatically triggers → validates patterns → reports violations if any → blocks merge until fixed.

This creates automatic quality gates without requiring explicit invocation.
