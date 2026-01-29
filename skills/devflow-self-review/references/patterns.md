# Self-Review Patterns

Correct patterns for thorough self-review organized by the 9 pillars.

---

## 9-Pillar Evaluation

For each pillar, ask:

| Pillar | Key Questions |
|--------|---------------|
| Design | Does this follow existing patterns? Is it maintainable? |
| Functionality | Does it meet requirements? Handle edge cases? |
| Security | Is input validated? Auth checked? Data protected? |
| Complexity | Can someone understand this in 5 minutes? |
| Error Handling | Are errors handled with Result types? Logged? |
| Tests | Is behavior tested? Coverage adequate? |
| Naming | Are names clear, consistent, domain-aligned? |
| Consistency | Does this match existing patterns? |
| Documentation | Are complex parts explained? API documented? |

---

## Issue Classification

| Priority | Action | Examples |
|----------|--------|----------|
| P0 (CRITICAL) | Fix immediately | Security holes, data loss, broken functionality |
| P1 (HIGH) | Fix before returning | Bugs, missing validation, error handling gaps |
| P2 (MEDIUM) | Fix or document | Style, minor improvements, complexity |
| P3 (LOW) | Note for future | Nice-to-haves, minor naming |

---

## P0 Pillars (MUST Fix)

### 1. Design - Correct Patterns

**Fix Pattern**: Refactor to match existing architecture. Extract responsibilities. Use dependency injection.

```typescript
// GOOD: Repository pattern with proper layering
class UserController {
  constructor(private userService: UserService) {}

  async getUser(req, res) {
    const result = await this.userService.findById(req.params.id);
    if (!result.ok) return res.status(404).json({ error: result.error });
    return res.json(result.value);
  }
}

// GOOD: Single responsibility, focused class
class UserRepository {
  constructor(private db: Database) {}

  async findById(id: string): Promise<Result<User, Error>> {
    // Only handles user data access
  }
}

// GOOD: Dependency injection
class UserService {
  constructor(
    private repository: UserRepository,
    private logger: Logger
  ) {}
}
```

---

### 2. Functionality - Correct Patterns

**Fix Pattern**: Add null checks, use transactions for atomic operations, verify loop bounds.

```typescript
// GOOD: Proper null handling
function getDisplayName(user: User): string {
  return user.profile?.displayName ?? user.email ?? 'Anonymous';
}

// GOOD: Atomic transaction
await db.transaction(async (tx) => {
  const balance = await tx.getBalance(userId);
  if (balance < amount) {
    throw new InsufficientFundsError();
  }
  await tx.withdraw(userId, amount);
});

// GOOD: Correct loop bounds
for (let i = 0; i < array.length; i++) {
  process(array[i]);
}
```

---

### 3. Security - Correct Patterns

**Fix Pattern**: Use parameterized queries, escape user input, use environment variables, add auth middleware.

```typescript
// GOOD: Parameterized query
const user = await db.query(
  'SELECT * FROM users WHERE email = ?',
  [email]
);

// GOOD: Safe command execution
import { execFile } from 'child_process';
execFile('ls', [sanitizedPath], callback);

// GOOD: Environment variable for secrets
const API_KEY = process.env.API_KEY;
if (!API_KEY) throw new Error('API_KEY required');

// GOOD: Auth middleware
app.delete('/api/users/:id', authMiddleware, adminOnly, async (req, res) => {
  await deleteUser(req.params.id);
});
```

---

## P1 Pillars (SHOULD Fix)

### 4. Complexity - Correct Patterns

**Fix Pattern**: Extract functions, use early returns, define named constants.

```typescript
// GOOD: Early returns reduce nesting
function processItem(item: Item): Result<ProcessedItem, Error> {
  if (!item) return Err('Item required');
  if (!item.isValid) return Err('Invalid item');
  if (!item.isActive) return Err('Item not active');

  return Ok(transformItem(item));
}

// GOOD: Named constants
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const STATUS = { PENDING: 1, ACTIVE: 2, COMPLETED: 3 } as const;

setTimeout(callback, ONE_DAY_MS);
if (status === STATUS.COMPLETED) { }

// GOOD: Extracted function
function calculateTotal(items: Item[]): number {
  return items
    .filter(item => item.isActive)
    .reduce((sum, item) => sum + item.price, 0);
}
```

---

### 5. Error Handling - Correct Patterns

**Fix Pattern**: Always handle or rethrow errors, include context in messages, use try/finally for cleanup.

```typescript
// GOOD: Handle or rethrow
try {
  await riskyOperation();
} catch (e) {
  logger.error('Operation failed', { error: e, context: operationContext });
  throw new OperationError('Failed to complete operation', { cause: e });
}

// GOOD: Descriptive error message
throw new ValidationError(`Invalid email format: ${email}`, {
  field: 'email',
  value: email,
  expected: 'valid email address'
});

// GOOD: Resource cleanup with try/finally
const file = await openFile(path);
try {
  await processFile(file);
} finally {
  await file.close();
}
```

---

### 6. Tests - Correct Patterns

**Fix Pattern**: Add tests for all new functions, test behavior not mocks, cover edge cases.

```typescript
// GOOD: Testing behavior
describe('createUser', () => {
  it('returns created user with generated id', async () => {
    const result = await createUser({ name: 'Test', email: 'test@example.com' });

    expect(result.ok).toBe(true);
    expect(result.value.id).toBeDefined();
    expect(result.value.name).toBe('Test');
  });

  it('returns error for duplicate email', async () => {
    await createUser({ name: 'First', email: 'test@example.com' });
    const result = await createUser({ name: 'Second', email: 'test@example.com' });

    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('DuplicateEmail');
  });
});

// GOOD: Edge case coverage
describe('divide', () => {
  it('divides positive numbers', () => {
    expect(divide(10, 2)).toBe(5);
  });

  it('returns error for division by zero', () => {
    const result = divide(10, 0);
    expect(result.ok).toBe(false);
    expect(result.error.type).toBe('DivisionByZero');
  });

  it('handles negative numbers', () => {
    expect(divide(-10, 2)).toBe(-5);
  });
});
```

---

## P2 Pillars (FIX if Time Permits)

### 7. Naming - Correct Patterns

**Fix Pattern**: Rename to be descriptive and accurate.

```typescript
// GOOD: Descriptive names
const currentDate = new Date();
const recentItems = items.filter(item => item.timestamp > currentDate);
const totalPrice = recentItems.reduce((sum, item) => sum + item.price, 0);

// GOOD: Accurate function name
function getAllUsers(): User[] {
  return db.users.findAll();
}

function getUserById(id: string): Result<User, NotFoundError> {
  return db.users.findById(id);
}
```

---

### 8. Consistency - Correct Patterns

**Fix Pattern**: Match existing patterns, follow established conventions.

```typescript
// GOOD: Consistent with codebase pattern
// Existing code uses Result types
function existingFunction(): Result<User, Error> { }

// Your code also uses Result types
function yourFunction(): Result<Order, OrderError> {
  const validation = validateOrder(data);
  if (!validation.ok) return Err(validation.error);

  return Ok(createOrder(validation.value));
}

// GOOD: Matching import organization
// Match existing file's import order
import { z } from 'zod';

import { Result, Ok, Err } from '@/lib/result';
import { User, Order } from '@/types';
import { userRepository } from '@/repositories';
```

---

### 9. Documentation - Correct Patterns

**Fix Pattern**: Add JSDoc to public APIs, explain complex algorithms, remove outdated comments.

```typescript
// GOOD: Documented complex function
/**
 * Calculate prorated billing amount for plan changes.
 *
 * @param plan - The new plan to prorate to
 * @param start - Start date of billing period
 * @param end - End date of billing period
 * @param previous - Previous plan (for upgrade/downgrade calculation)
 * @returns Prorated amount in cents
 *
 * @example
 * const amount = calculateProratedBilling(premiumPlan, startDate, endDate, basicPlan);
 */
export function calculateProratedBilling(
  plan: Plan,
  start: Date,
  end: Date,
  previous: Plan
): number {
  // Calculate remaining days in billing period
  const remainingDays = differenceInDays(end, new Date());
  const totalDays = differenceInDays(end, start);

  // Pro-rate the price difference
  const priceDifference = plan.price - previous.price;
  return Math.round((priceDifference * remainingDays) / totalDays);
}

// GOOD: Accurate comment
// Returns the user's preferred display name, falling back to username
function getDisplayName(user: User): string {
  return user.displayName ?? user.username;
}
```

---

## Decision Tree

```
START
  |
  v
+------------------+
| Evaluate P0      |
| (Design,         |
|  Functionality,  |
|  Security)       |
+--------+---------+
         |
    Issues found?
    +----+----+
   YES       NO
    |         |
    v         |
+---------+   |
| Fixable?|   |
+----+----+   |
  +--+--+     |
 YES   NO     |
  |     |     |
  v     v     |
 FIX   STOP   |
  |   REPORT  |
  |   BLOCKER |
  |           |
  +-----+-----+
        |
        v
+------------------+
| Evaluate P1      |
| (Complexity,     |
|  Error Handling, |
|  Tests)          |
+--------+---------+
         |
    Issues found?
    +----+----+
   YES       NO
    |         |
    v         |
   FIX        |
    |         |
    +----+----+
         |
         v
+------------------+
| Evaluate P2      |
| (Naming,         |
|  Consistency,    |
|  Documentation)  |
+--------+---------+
         |
    Issues found?
    +----+----+
   YES       NO
    |         |
    v         |
 FIX IF       |
 TIME         |
    |         |
    +----+----+
         |
         v
      RETURN
   WITH REPORT
```

---

## Quick Reference

See [violations.md](violations.md) for anti-patterns and [report-template.md](report-template.md) for self-review format.
