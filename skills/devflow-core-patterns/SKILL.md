---
name: devflow-core-patterns
description: Automatically activate when implementing new functionality, refactoring code, or when guidance on Result types, dependency injection, immutability, resource cleanup, naming conventions, or architecture documentation is needed. Foundation skill for all implementation work.
allowed-tools: Read, Grep, Glob, AskUserQuestion
---

# Core Engineering Patterns

The canonical source of architectural patterns and principles. All implementation agents should reference this skill for consistent, high-quality code.

## Iron Law

> **NEVER THROW IN BUSINESS LOGIC**
>
> All operations that can fail MUST return Result types. Exceptions are allowed
> ONLY at system boundaries (API handlers, database adapters). Any `throw` statement
> in business logic is a violation. No exceptions.

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

## Pattern 7: Resource Cleanup

**CRITICAL**: Always clean up resources using proper patterns.

### Language-Specific Patterns

```typescript
// TypeScript/JavaScript: try/finally
async function processFile(path: string): Promise<Result<Data, Error>> {
  const handle = await fs.open(path);
  try {
    const content = await handle.readFile();
    return Ok(parse(content));
  } finally {
    await handle.close();  // Always runs
  }
}

// Using Disposable (TC39 proposal / Node 20+)
async function withConnection<T>(
  fn: (conn: DbConnection) => Promise<T>
): Promise<T> {
  const conn = await db.connect();
  try {
    return await fn(conn);
  } finally {
    await conn.release();
  }
}
```

```python
# Python: context managers
def process_file(path: str) -> Result[Data, Error]:
    with open(path) as f:  # Automatically closes
        content = f.read()
        return Ok(parse(content))

# Custom context manager
@contextmanager
def db_transaction(conn):
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
```

```go
// Go: defer
func processFile(path string) (Data, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer f.Close()  // Runs when function returns

    return parse(f)
}
```

```rust
// Rust: RAII (Drop trait)
fn process_file(path: &str) -> Result<Data, Error> {
    let file = File::open(path)?;  // Dropped automatically
    parse(&file)
}
```

### Violations to Detect

```typescript
// VIOLATION: No cleanup
async function processFile(path: string) {
  const handle = await fs.open(path);
  const content = await handle.readFile();  // If this throws, handle leaks
  return parse(content);
}

// VIOLATION: Cleanup in wrong place
async function processFile(path: string) {
  const handle = await fs.open(path);
  const content = await handle.readFile();
  await handle.close();  // Never runs if readFile throws
  return parse(content);
}
```

---

## Pattern 8: Architecture Documentation

**CRITICAL**: Document architectural decisions directly in code.

### Document Design Patterns

```typescript
/**
 * UserService uses CQRS pattern
 * - Commands: createUser, updateUser, deleteUser → go through EventBus
 * - Queries: getUser, listUsers → direct repository access
 *
 * Rationale: Write operations need audit trail and event sourcing
 * Trade-off: Slight complexity increase for read consistency
 */
class UserService { ... }
```

### Document Architectural Boundaries

```typescript
// ARCHITECTURE: This module MUST NOT import from ../infrastructure
// All external calls go through injected ports (interfaces)

// ARCHITECTURE: Repository methods return domain objects only
// No ORM entities or database types leak through this boundary
```

### Document Pattern Violations with Justification

```typescript
// ARCHITECTURE EXCEPTION: Direct database access for health check
// Justification: Health endpoint must work even if service layer is down
// Approved by: Tech Lead, 2024-01-15
async function healthCheck(): Promise<HealthStatus> {
  const dbOk = await db.ping();
  return { database: dbOk };
}
```

### Document Future Refactoring

```typescript
// TODO(architecture): Migrate to event-driven pattern
// Currently using direct service calls for backwards compatibility
// Target: v3.0.0
// Tracking: JIRA-1234
```

---

## Pattern 9: Naming Conventions

### Types and Classes: PascalCase

```typescript
class UserProfile { }
interface OrderManager { }
type TaskState = 'pending' | 'running';
enum HttpStatus { Ok = 200, NotFound = 404 }
```

### Constants: SCREAMING_SNAKE_CASE

```typescript
const MAX_RETRY_ATTEMPTS = 3;
const API_BASE_URL = 'https://api.example.com';
const DEFAULT_TIMEOUT_MS = 5000;
```

### Functions and Variables: camelCase

```typescript
function calculateTotal(items: Item[]): number { }
const userEmail = user.email;
let isProcessing = false;
```

### Private Members: Prefix Convention

```typescript
class Service {
  private readonly _db: Database;      // Underscore prefix (optional)
  #internalState: State;               // Private field (preferred)
}
```

### File Naming

```
// Components/Classes: PascalCase
UserProfile.tsx
OrderService.ts

// Utilities/Modules: kebab-case or camelCase
string-utils.ts
dateHelpers.ts

// Test files: Match source + suffix
UserProfile.test.tsx
OrderService.spec.ts
```

---

## Pattern 10: Performance Awareness

**CRITICAL**: Measure before optimizing. Optimize hot paths only.

### Measure First

```typescript
// Use built-in timing
console.time('operation');
await heavyOperation();
console.timeEnd('operation');

// Or explicit measurement
const start = performance.now();
await heavyOperation();
const duration = performance.now() - start;
logger.info('Operation completed', { durationMs: duration });
```

### Common Optimizations

```typescript
// Avoid N+1 queries
// BAD: Query per item
for (const order of orders) {
  order.customer = await db.customers.findById(order.customerId);
}

// GOOD: Batch query
const customerIds = orders.map(o => o.customerId);
const customers = await db.customers.findByIds(customerIds);
const customerMap = new Map(customers.map(c => [c.id, c]));
orders.forEach(o => o.customer = customerMap.get(o.customerId));
```

```typescript
// Use appropriate data structures
// BAD: Array lookup O(n)
const user = users.find(u => u.id === targetId);

// GOOD: Map lookup O(1)
const userMap = new Map(users.map(u => [u.id, u]));
const user = userMap.get(targetId);
```

```typescript
// Lazy evaluation for expensive operations
// BAD: Always compute
function getReport(data: Data): Report {
  const analysis = expensiveAnalysis(data);  // Always runs
  return { data, analysis };
}

// GOOD: Compute on demand
function getReport(data: Data): Report {
  return {
    data,
    get analysis() { return expensiveAnalysis(data); }
  };
}
```

### When to Optimize

1. **Profile first** - Identify actual bottlenecks
2. **Hot paths only** - 90% of time spent in 10% of code
3. **Benchmark changes** - Prove optimization works
4. **Document trade-offs** - Complexity vs performance

---

## API Consistency Rules

Enforce these strictly across the codebase:

1. **Result type consistency** - If one method returns Result types, ALL related methods must
2. **Dependency injection consistency** - If DI is used, apply it consistently throughout
3. **Async pattern consistency** - Stick to ONE async pattern (don't mix callback/promise/async styles)
4. **No global state** - NO global mutable state unless explicitly justified

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
- [ ] Resources cleaned up (try/finally, using, defer)
- [ ] Architecture decisions documented in code
- [ ] Naming conventions followed (PascalCase, camelCase, SCREAMING_SNAKE_CASE)
- [ ] Performance-critical code measured before optimizing

---

## Integration

This skill is the foundation for:
- **Coder agent**: Follow these patterns when implementing
- **Review agents**: Check code against these patterns
- **Debug agent**: Use these patterns to identify root causes
- **Test design**: These patterns make testing trivial

When implementing, if you're unsure about a pattern, consult this skill first.
