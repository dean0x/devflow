# Extended Correct Pattern Examples

Additional examples of correct implementations beyond the core examples in SKILL.md.

---

## Result Types - Extended Patterns

### Chaining Results

```typescript
// Chain multiple Result operations
function processUserOrder(
  userId: string,
  orderId: string
): Result<Receipt, ProcessError> {
  const userResult = getUser(userId);
  if (!userResult.ok) return userResult;

  const orderResult = getOrder(orderId);
  if (!orderResult.ok) return orderResult;

  const validationResult = validateOrder(orderResult.value, userResult.value);
  if (!validationResult.ok) return validationResult;

  return processPayment(orderResult.value);
}

// Using pipe helper
const pipe = <T, E>(...fns: Array<(r: Result<T, E>) => Result<T, E>>) =>
  (initial: Result<T, E>) => fns.reduce((r, fn) => r.ok ? fn(r) : r, initial);

// Map over Result
const map = <T, U, E>(fn: (value: T) => U) =>
  (result: Result<T, E>): Result<U, E> =>
    result.ok ? Ok(fn(result.value)) : result;

// FlatMap for Result chains
const flatMap = <T, U, E>(fn: (value: T) => Result<U, E>) =>
  (result: Result<T, E>): Result<U, E> =>
    result.ok ? fn(result.value) : result;
```

### Async Result Patterns

```typescript
// Async function returning Result
async function fetchUser(id: string): Promise<Result<User, FetchError>> {
  try {
    const response = await fetch(`/api/users/${id}`);
    if (!response.ok) {
      return Err({ type: 'HttpError', status: response.status });
    }
    const user = await response.json();
    return Ok(user);
  } catch (error) {
    return Err({ type: 'NetworkError', message: error.message });
  }
}

// Collecting multiple async Results
async function fetchAllUsers(ids: string[]): Promise<Result<User[], FetchError>> {
  const results = await Promise.all(ids.map(fetchUser));

  for (const result of results) {
    if (!result.ok) return result;  // Return first error
  }

  return Ok(results.map(r => r.value));
}

// Parallel with partial success
async function fetchUsersPartial(ids: string[]): Promise<{
  successes: User[];
  failures: Array<{ id: string; error: FetchError }>;
}> {
  const results = await Promise.all(
    ids.map(async id => ({ id, result: await fetchUser(id) }))
  );

  return {
    successes: results.filter(r => r.result.ok).map(r => r.result.value),
    failures: results
      .filter(r => !r.result.ok)
      .map(r => ({ id: r.id, error: r.result.error }))
  };
}
```

---

## Dependency Injection - Extended Patterns

### Factory Pattern with DI

```typescript
// Factory that creates configured instances
interface ServiceFactory {
  createUserService(): UserService;
  createOrderService(): OrderService;
}

class ProductionServiceFactory implements ServiceFactory {
  constructor(
    private db: Database,
    private emailer: EmailService,
    private logger: Logger
  ) {}

  createUserService(): UserService {
    return new UserService(this.db, this.emailer, this.logger);
  }

  createOrderService(): OrderService {
    return new OrderService(this.db, this.logger);
  }
}

// Test factory with mocks
class TestServiceFactory implements ServiceFactory {
  createUserService(): UserService {
    return new UserService(mockDb, mockEmailer, mockLogger);
  }

  createOrderService(): OrderService {
    return new OrderService(mockDb, mockLogger);
  }
}
```

### Functional DI Pattern

```typescript
// Dependencies as function parameters
type CreateUser = (
  db: Database,
  emailer: EmailService
) => (data: UserData) => Promise<Result<User, Error>>;

const createUser: CreateUser = (db, emailer) => async (data) => {
  const validation = validateUserData(data);
  if (!validation.ok) return validation;

  const user = await db.users.create(data);
  await emailer.sendWelcome(user.email);
  return Ok(user);
};

// Partial application for context
const createUserWithDeps = createUser(productionDb, productionEmailer);
const result = await createUserWithDeps(userData);
```

### Interface Segregation

```typescript
// Small, focused interfaces
interface UserReader {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
}

interface UserWriter {
  create(data: UserData): Promise<User>;
  update(id: string, data: Partial<UserData>): Promise<User>;
  delete(id: string): Promise<void>;
}

// Service depends only on what it needs
class UserQueryService {
  constructor(private reader: UserReader) {}  // Only needs read operations

  async getUser(id: string): Promise<Result<User, NotFoundError>> {
    const user = await this.reader.findById(id);
    return user ? Ok(user) : Err({ type: 'NotFound', id });
  }
}

class UserCommandService {
  constructor(
    private reader: UserReader,
    private writer: UserWriter
  ) {}  // Needs both for validation and writing
}
```

---

## Immutability - Extended Patterns

### Deep Updates

```typescript
// Immutable deep update
function updateNestedAddress(
  user: User,
  city: string
): User {
  return {
    ...user,
    address: {
      ...user.address,
      city
    }
  };
}

// Using immer for complex updates
import { produce } from 'immer';

function updateOrderItem(
  order: Order,
  itemId: string,
  quantity: number
): Order {
  return produce(order, draft => {
    const item = draft.items.find(i => i.id === itemId);
    if (item) item.quantity = quantity;
  });
}
```

### Immutable Collections

```typescript
// Immutable array operations
function removeItem<T>(items: T[], index: number): T[] {
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

function insertItem<T>(items: T[], index: number, item: T): T[] {
  return [...items.slice(0, index), item, ...items.slice(index)];
}

function updateItem<T>(items: T[], index: number, item: T): T[] {
  return items.map((existing, i) => i === index ? item : existing);
}

// Immutable object operations
function omit<T extends object, K extends keyof T>(
  obj: T,
  ...keys: K[]
): Omit<T, K> {
  const result = { ...obj };
  for (const key of keys) {
    delete result[key];
  }
  return result;
}

function pick<T extends object, K extends keyof T>(
  obj: T,
  ...keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    result[key] = obj[key];
  }
  return result;
}
```

---

## Pure Functions - Extended Patterns

### Dependency Injection for Impurity

```typescript
// Inject impure dependencies
interface Clock {
  now(): Date;
}

interface RandomGenerator {
  next(): number;
}

// Function becomes pure relative to its inputs
function generateToken(random: RandomGenerator, length: number): string {
  return Array.from({ length }, () =>
    Math.floor(random.next() * 36).toString(36)
  ).join('');
}

// Easy to test
const mockRandom: RandomGenerator = {
  next: () => 0.5  // Deterministic
};
const token = generateToken(mockRandom, 10);  // Always same result

// Production usage
const productionRandom: RandomGenerator = {
  next: () => Math.random()
};
```

### Separating Pure Logic

```typescript
// Pure: business logic
function calculateOrderTotal(
  items: OrderItem[],
  discount: Discount | null,
  taxRate: number
): OrderTotal {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discountAmount = discount ? applyDiscount(subtotal, discount) : 0;
  const taxableAmount = subtotal - discountAmount;
  const tax = taxableAmount * taxRate;

  return {
    subtotal,
    discount: discountAmount,
    tax,
    total: taxableAmount + tax
  };
}

// Impure: I/O wrapper
async function processOrder(orderId: string): Promise<Result<Order, Error>> {
  // I/O: fetch data
  const order = await orderRepository.findById(orderId);
  if (!order) return Err({ type: 'NotFound' });

  const discount = await discountService.getActive(order.customerId);
  const taxRate = await taxService.getRate(order.shippingAddress);

  // Pure: calculation
  const total = calculateOrderTotal(order.items, discount, taxRate);

  // I/O: persist
  const updated = await orderRepository.update(orderId, { total });
  return Ok(updated);
}
```

---

## Error Types - Extended Patterns

### Hierarchical Error Types

```typescript
// Base error type
type AppError =
  | ValidationError
  | BusinessError
  | InfrastructureError;

// Validation errors
type ValidationError =
  | { type: 'RequiredField'; field: string }
  | { type: 'InvalidFormat'; field: string; expected: string }
  | { type: 'OutOfRange'; field: string; min?: number; max?: number };

// Business errors
type BusinessError =
  | { type: 'InsufficientFunds'; available: number; required: number }
  | { type: 'ItemOutOfStock'; itemId: string; available: number }
  | { type: 'OrderCancelled'; orderId: string; reason: string };

// Infrastructure errors
type InfrastructureError =
  | { type: 'DatabaseError'; operation: string; message: string }
  | { type: 'NetworkError'; endpoint: string; status?: number }
  | { type: 'TimeoutError'; operation: string; durationMs: number };
```

### Error Conversion

```typescript
// Convert between error types at boundaries
function toHttpError(error: AppError): HttpError {
  switch (error.type) {
    // Validation -> 400
    case 'RequiredField':
    case 'InvalidFormat':
    case 'OutOfRange':
      return { status: 400, message: formatValidationError(error) };

    // Business -> 422
    case 'InsufficientFunds':
    case 'ItemOutOfStock':
    case 'OrderCancelled':
      return { status: 422, message: formatBusinessError(error) };

    // Infrastructure -> 500/503
    case 'DatabaseError':
    case 'NetworkError':
      return { status: 503, message: 'Service temporarily unavailable' };
    case 'TimeoutError':
      return { status: 504, message: 'Request timed out' };
  }
}
```

---

## Resource Cleanup - Extended Patterns

### Resource Pool Pattern

```typescript
// Connection pool with proper cleanup
class ConnectionPool {
  private connections: DbConnection[] = [];
  private available: DbConnection[] = [];

  async acquire(): Promise<DbConnection> {
    if (this.available.length > 0) {
      return this.available.pop()!;
    }
    const conn = await this.createConnection();
    this.connections.push(conn);
    return conn;
  }

  release(conn: DbConnection): void {
    this.available.push(conn);
  }

  async close(): Promise<void> {
    await Promise.all(this.connections.map(c => c.close()));
    this.connections = [];
    this.available = [];
  }
}

// Usage with automatic release
async function withConnection<T>(
  pool: ConnectionPool,
  fn: (conn: DbConnection) => Promise<T>
): Promise<T> {
  const conn = await pool.acquire();
  try {
    return await fn(conn);
  } finally {
    pool.release(conn);
  }
}
```

### Subscription Management

```typescript
// Subscription manager for cleanup
class SubscriptionManager {
  private subscriptions: Array<() => void> = [];

  add(unsubscribe: () => void): void {
    this.subscriptions.push(unsubscribe);
  }

  cleanup(): void {
    for (const unsub of this.subscriptions) {
      unsub();
    }
    this.subscriptions = [];
  }
}

// Usage in component/service lifecycle
class DataService {
  private subscriptions = new SubscriptionManager();

  initialize(): void {
    this.subscriptions.add(
      eventBus.on('user-updated', this.handleUserUpdate)
    );
    this.subscriptions.add(
      socket.on('message', this.handleMessage)
    );
  }

  dispose(): void {
    this.subscriptions.cleanup();
  }
}
```

---

## Language-Specific Patterns

### Python Result Pattern

```python
from dataclasses import dataclass
from typing import Generic, TypeVar, Union

T = TypeVar('T')
E = TypeVar('E')

@dataclass(frozen=True)
class Ok(Generic[T]):
    value: T
    ok: bool = True

@dataclass(frozen=True)
class Err(Generic[E]):
    error: E
    ok: bool = False

Result = Union[Ok[T], Err[E]]

def create_user(data: dict) -> Result[User, ValidationError]:
    validation = validate(data)
    if not validation.ok:
        return Err(ValidationError(validation.errors))
    return Ok(User(**data))
```

### Go Result Pattern

```go
// Using tuple returns (idiomatic Go)
func CreateUser(data UserData) (*User, error) {
    if err := validate(data); err != nil {
        return nil, fmt.Errorf("validation failed: %w", err)
    }
    user := buildUser(data)
    return &user, nil
}

// Custom Result type for complex cases
type Result[T any] struct {
    Value T
    Err   error
}

func (r Result[T]) IsOk() bool {
    return r.Err == nil
}

func Ok[T any](value T) Result[T] {
    return Result[T]{Value: value}
}

func Fail[T any](err error) Result[T] {
    return Result[T]{Err: err}
}
```

### Rust Result Pattern

```rust
use std::result::Result;

#[derive(Debug)]
enum UserError {
    ValidationFailed(String),
    NotFound(String),
    DatabaseError(String),
}

fn create_user(data: &UserData) -> Result<User, UserError> {
    validate(data).map_err(|e| UserError::ValidationFailed(e.to_string()))?;

    let user = User::from(data);
    Ok(user)
}

// With custom error trait
impl std::error::Error for UserError {}

impl std::fmt::Display for UserError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UserError::ValidationFailed(msg) => write!(f, "Validation failed: {}", msg),
            UserError::NotFound(id) => write!(f, "User not found: {}", id),
            UserError::DatabaseError(msg) => write!(f, "Database error: {}", msg),
        }
    }
}
```
