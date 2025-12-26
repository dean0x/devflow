---
name: devflow-core-patterns
description: Core engineering patterns and principles. Load when implementing new functionality, refactoring code, or when guidance on Result types, dependency injection, immutability, or error handling is needed. This is the foundation skill for all implementation work.
allowed-tools: Read, Grep, Glob, AskUserQuestion
---

# Core Engineering Patterns

The canonical source of architectural patterns and principles. All implementation agents should reference this skill for consistent, high-quality code.

## Philosophy

1. **Type Safety First** - Use strict type checking, avoid dynamic types
2. **Functional Core, Imperative Shell** - Keep business logic pure, isolate side effects
3. **Explicit Error Handling** - Use Result types instead of throwing exceptions
4. **Immutability by Default** - Return new objects, don't mutate
5. **Dependency Injection** - Inject dependencies for testability
6. **Test Behaviors** - Simple tests that validate behavior, not implementation
7. **No Fake Solutions** - Be honest about limitations and workarounds
8. **Fix Root Causes** - Never work around bad architecture

---

## Pattern 1: Result Types

**CRITICAL**: Business logic NEVER throws exceptions.

### Definition

```typescript
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// Helper constructors
const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

### Correct Usage

```typescript
// Business logic returns Result
function createUser(data: unknown): Result<User, ValidationError> {
  if (!valid(data)) {
    return Err({ type: 'ValidationFailed', details: validate(data).errors });
  }
  return Ok(buildUser(data));
}

// Caller handles result explicitly
const result = createUser(input);
if (!result.ok) {
  // Handle error - type system ensures this
  return handleError(result.error);
}
// Use result.value safely
```

### Violations to Detect

```typescript
// VIOLATION: Throwing in business logic
function getUser(id: string): User {
  if (!id) throw new Error('Invalid ID');  // BAD
  return findUser(id);
}

// VIOLATION: Try/catch in business logic
function calculate(items: Item[]): number {
  try {
    return items.reduce((sum, i) => sum + i.price, 0);
  } catch {
    return 0;  // Silent failure - BAD
  }
}
```

### Exception Boundaries

Exceptions allowed ONLY at system boundaries:

```typescript
// API boundary - converts Result to HTTP
app.post('/users', async (req, res) => {
  const result = await createUser(req.body);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  return res.json(result.value);
});

// Database boundary - converts exceptions to Result
async function saveUser(user: User): Promise<Result<void, DbError>> {
  try {
    await db.users.insert(user);
    return Ok(undefined);
  } catch (error) {
    return Err({ type: 'DatabaseError', message: error.message });
  }
}
```

---

## Pattern 2: Dependency Injection

**CRITICAL**: Dependencies must be injected, not instantiated internally.

### Correct Usage

```typescript
// Dependencies injected through constructor
class UserService {
  constructor(
    private db: Database,
    private emailer: EmailService,
    private logger: Logger
  ) {}

  async createUser(data: UserData): Promise<Result<User, UserError>> {
    // Use injected dependencies
    const user = await this.db.users.create(data);
    await this.emailer.sendWelcome(user.email);
    this.logger.info('User created', { userId: user.id });
    return Ok(user);
  }
}

// Easy to test with mocks
const service = new UserService(mockDb, mockEmailer, mockLogger);
```

### Violations to Detect

```typescript
// VIOLATION: Creating dependencies internally
class OrderService {
  private db = new Database();  // BAD - can't mock
  private logger = winston.createLogger();  // BAD - hard dependency

  async processOrder(id: string) {
    // Impossible to test without real database
  }
}

// VIOLATION: Importing singletons
import { db } from './database';  // BAD - global state
```

---

## Pattern 3: Immutability

**CRITICAL**: Return new objects, never mutate inputs.

### Correct Usage

```typescript
// Return new object
function updateUser(user: User, changes: Partial<User>): User {
  return { ...user, ...changes };
}

// Return new array
function addItem(cart: Cart, item: Item): Cart {
  return { ...cart, items: [...cart.items, item] };
}

// Use immutable array methods
const sorted = [...items].sort((a, b) => a.price - b.price);
const filtered = items.filter(i => i.active);
const mapped = items.map(i => ({ ...i, processed: true }));
```

### Violations to Detect

```typescript
// VIOLATION: Mutating input
function updateUser(user: User, name: string): User {
  user.name = name;  // BAD - mutation
  return user;
}

// VIOLATION: Mutating array
function addItem(cart: Cart, item: Item): Cart {
  cart.items.push(item);  // BAD - mutation
  return cart;
}

// VIOLATION: Sort without copy
items.sort((a, b) => a.price - b.price);  // BAD - mutates original
```

---

## Pattern 4: Pure Functions

**CRITICAL**: Business logic should be pure; side effects isolated in wrappers.

### Correct Usage

```typescript
// PURE: Same input always produces same output
function calculateTotal(items: Item[], taxRate: number): number {
  const subtotal = items.reduce((sum, i) => sum + i.price, 0);
  return subtotal * (1 + taxRate);
}

// IMPURE WRAPPER: Handles I/O, calls pure function
async function processOrder(orderId: string): Promise<Result<Receipt, Error>> {
  // I/O: fetch data
  const order = await orderRepo.findById(orderId);
  const taxRate = await taxService.getRate(order.address);

  // PURE: calculation
  const total = calculateTotal(order.items, taxRate);

  // I/O: persist
  const receipt = await receiptRepo.save({ orderId, total });
  return Ok(receipt);
}
```

### Violations to Detect

```typescript
// VIOLATION: Side effects in pure function
function calculateTotal(items: Item[]): number {
  console.log('Calculating...');  // BAD - side effect
  logToDatabase('calculation');    // BAD - side effect
  return items.reduce((sum, i) => sum + i.price, 0);
}
```

---

## Pattern 5: Type Safety

### Strict Mode Requirements

- No implicit `any` types
- Strict null checks enabled
- Strict function types
- Exhaustive pattern matching

### Correct Usage

```typescript
// Domain types prevent mixing
type UserId = string & { readonly brand: unique symbol };
type OrderId = string & { readonly brand: unique symbol };

function getOrder(userId: UserId, orderId: OrderId): Order {
  // Can't accidentally swap userId and orderId
}

// Exhaustive matching
type Status = 'pending' | 'processing' | 'completed' | 'failed';

function handleStatus(status: Status): string {
  switch (status) {
    case 'pending': return 'Waiting';
    case 'processing': return 'In progress';
    case 'completed': return 'Done';
    case 'failed': return 'Error';
    // TypeScript ensures all cases handled
  }
}
```

### Violations to Detect

```typescript
// VIOLATION: Using any
function process(data: any) { ... }  // BAD

// VIOLATION: Non-exhaustive matching
function handleStatus(status: Status): string {
  if (status === 'pending') return 'Waiting';
  return 'Unknown';  // BAD - misses cases
}
```

---

## Pattern 6: Error Type Design

### Discriminated Unions

```typescript
// Specific, actionable error types
type UserError =
  | { type: 'NotFound'; userId: string }
  | { type: 'ValidationFailed'; field: string; message: string }
  | { type: 'DuplicateEmail'; email: string }
  | { type: 'PermissionDenied'; action: string };

// Exhaustive handling
function handleError(error: UserError): Response {
  switch (error.type) {
    case 'NotFound':
      return notFound(`User ${error.userId} not found`);
    case 'ValidationFailed':
      return badRequest(`${error.field}: ${error.message}`);
    case 'DuplicateEmail':
      return conflict(`Email ${error.email} already exists`);
    case 'PermissionDenied':
      return forbidden(`Cannot ${error.action}`);
  }
}
```

---

## Anti-Patterns to Block

### Critical - Stop Immediately

1. **Fake Solutions** - Hardcoded responses simulating functionality
2. **Silent Failures** - Catch blocks that swallow errors
3. **Magic Values** - Unlabeled constants with special meaning
4. **Global State** - Mutable singletons shared across modules
5. **Tight Coupling** - Direct instantiation of dependencies

### Must Label Clearly

If any workaround is necessary, use clear comments:
- `// HACK:` - Temporary workaround
- `// TODO:` - Known improvement needed
- `// MOCK:` - Test-only implementation
- `// TEMPORARY:` - Will be replaced
- `// NOT-PRODUCTION:` - Demo/dev only

---

## Validation Checklist

Before approving code:

- [ ] All business functions return Result types
- [ ] All dependencies are injected
- [ ] All data updates return new objects
- [ ] Pure functions contain no side effects
- [ ] Side effects isolated in wrapper functions
- [ ] Specific error types (discriminated unions)
- [ ] Try/catch only at system boundaries
- [ ] No `any` types
- [ ] Exhaustive pattern matching
- [ ] No hardcoded magic values
- [ ] No silent error swallowing

---

## Integration

This skill is the foundation for:
- **Coder agent**: Follow these patterns when implementing
- **Review agents**: Check code against these patterns
- **Debug agent**: Use these patterns to identify root causes
- **Test design**: These patterns make testing trivial

When implementing, if you're unsure about a pattern, consult this skill first.
