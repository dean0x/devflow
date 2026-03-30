# Extended Correct Pattern Examples

Additional examples of correct implementations beyond the core examples in SKILL.md.
All patterns cite `references/sources.md`.

---

## Result Types — Extended Patterns [1][5][6]

### Chaining Results [1]

The two-track railway model [1]: happy path stays on track, errors short-circuit.

```typescript
// Chain multiple Result operations — each step short-circuits on error [1]
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

// Using pipe helper for cleaner composition [1][20]
const pipe = <T, E>(...fns: Array<(r: Result<T, E>) => Result<T, E>>) =>
  (initial: Result<T, E>) => fns.reduce((r, fn) => r.ok ? fn(r) : r, initial);

// Monadic map — functor law [5][6]
const map = <T, U, E>(fn: (value: T) => U) =>
  (result: Result<T, E>): Result<U, E> =>
    result.ok ? Ok(fn(result.value)) : result;

// Monadic flatMap (bind) — monad law [5][6]
const flatMap = <T, U, E>(fn: (value: T) => Result<U, E>) =>
  (result: Result<T, E>): Result<U, E> =>
    result.ok ? fn(result.value) : result;
```

### Async Result Patterns [1][18]

```typescript
// Async function returning Result — boundary catch converts exceptions [11]
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
```

---

## Dependency Injection — Extended Patterns [3]

### Factory Pattern with DI [3]

```typescript
// Factory that creates configured instances [3]
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

// Test factory with mocks — setup is trivial with DI [3]
class TestServiceFactory implements ServiceFactory {
  createUserService(): UserService {
    return new UserService(mockDb, mockEmailer, mockLogger);
  }

  createOrderService(): OrderService {
    return new OrderService(mockDb, mockLogger);
  }
}
```

### Functional DI Pattern [3][20]

```typescript
// Dependencies as function parameters — partial application [20]
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

// Partial application for production context
const createUserWithDeps = createUser(productionDb, productionEmailer);
```

### Interface Segregation [3]

```typescript
// Small, focused interfaces — depend only on what you need [3]
interface UserReader {
  findById(id: string): Promise<User | null>;
}

interface UserWriter {
  create(data: UserData): Promise<User>;
  update(id: string, data: Partial<UserData>): Promise<User>;
}

// Query service needs only read operations
class UserQueryService {
  constructor(private reader: UserReader) {}

  async getUser(id: string): Promise<Result<User, NotFoundError>> {
    const user = await this.reader.findById(id);
    return user ? Ok(user) : Err({ type: 'NotFound', id });
  }
}
```

---

## Immutability — Extended Patterns [7][14]

### Deep Updates [7]

```typescript
// Immutable deep update — each level creates a new object [7][14]
function updateNestedAddress(user: User, city: string): User {
  return {
    ...user,
    address: {
      ...user.address,
      city
    }
  };
}
```

### Immutable Collections [14]

```typescript
// Immutable array operations — return new arrays [14]
function removeItem<T>(items: T[], index: number): T[] {
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

function insertItem<T>(items: T[], index: number, item: T): T[] {
  return [...items.slice(0, index), item, ...items.slice(index)];
}

function updateItem<T>(items: T[], index: number, item: T): T[] {
  return items.map((existing, i) => i === index ? item : existing);
}
```

---

## Pure Functions — Extended Patterns [8][11]

### Dependency Injection for Impurity [3][8]

```typescript
// Inject impure dependencies to keep the function pure relative to its inputs [3][8]
interface Clock { now(): Date; }
interface RandomGenerator { next(): number; }

function generateToken(random: RandomGenerator, length: number): string {
  return Array.from({ length }, () =>
    Math.floor(random.next() * 36).toString(36)
  ).join('');
}

// Deterministic in tests — no mocking framework needed [8]
const mockRandom: RandomGenerator = { next: () => 0.5 };
const token = generateToken(mockRandom, 10);
```

### Separating Pure Logic [11]

```typescript
// PURE CORE: all business logic, no I/O [11]
function calculateOrderTotal(
  items: OrderItem[],
  discount: Discount | null,
  taxRate: number
): OrderTotal {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discountAmount = discount ? applyDiscount(subtotal, discount) : 0;
  const taxableAmount = subtotal - discountAmount;
  const tax = taxableAmount * taxRate;
  return { subtotal, discount: discountAmount, tax, total: taxableAmount + tax };
}

// IMPERATIVE SHELL: I/O wrapper [11]
async function processOrder(orderId: string): Promise<Result<Order, Error>> {
  const order = await orderRepository.findById(orderId);
  if (!order) return Err({ type: 'NotFound' });

  const discount = await discountService.getActive(order.customerId);
  const taxRate = await taxService.getRate(order.shippingAddress);

  // Pure calculation — testable without any I/O setup
  const total = calculateOrderTotal(order.items, discount, taxRate);
  const updated = await orderRepository.update(orderId, { total });
  return Ok(updated);
}
```

---

## Error Types — Extended Patterns [1][2]

### Hierarchical Error Types [2]

Constrained types make invalid errors impossible [2].

```typescript
// Base error union — exhaustive [1][2]
type AppError =
  | ValidationError
  | BusinessError
  | InfrastructureError;

type ValidationError =
  | { type: 'RequiredField'; field: string }
  | { type: 'InvalidFormat'; field: string; expected: string }
  | { type: 'OutOfRange'; field: string; min?: number; max?: number };

type BusinessError =
  | { type: 'InsufficientFunds'; available: number; required: number }
  | { type: 'ItemOutOfStock'; itemId: string; available: number };

type InfrastructureError =
  | { type: 'DatabaseError'; operation: string; message: string }
  | { type: 'NetworkError'; endpoint: string; status?: number };
```

### Error Conversion at Boundaries [11]

```typescript
// Convert domain errors to HTTP at the boundary — only place that throws [11]
function toHttpError(error: AppError): HttpError {
  switch (error.type) {
    case 'RequiredField':
    case 'InvalidFormat':
    case 'OutOfRange':
      return { status: 400, message: formatValidationError(error) };
    case 'InsufficientFunds':
    case 'ItemOutOfStock':
      return { status: 422, message: formatBusinessError(error) };
    case 'DatabaseError':
    case 'NetworkError':
      return { status: 503, message: 'Service temporarily unavailable' };
  }
}
```

---

## Language-Specific Patterns

### Python Result Pattern [17][8]

```python
from dataclasses import dataclass
from typing import Generic, TypeVar, Union

T = TypeVar('T')
E = TypeVar('E')

@dataclass(frozen=True)  # Immutable by default [7]
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

### Go Result Pattern [9]

```go
// Idiomatic Go: tuple returns express success/failure without exceptions [9]
func CreateUser(data UserData) (*User, error) {
    if err := validate(data); err != nil {
        return nil, fmt.Errorf("validation failed: %w", err)
    }
    user := buildUser(data)
    return &user, nil
}
```

### Rust Result Pattern [8]

```rust
#[derive(Debug)]
enum UserError {
    ValidationFailed(String),
    NotFound(String),
}

fn create_user(data: &UserData) -> Result<User, UserError> {
    validate(data).map_err(|e| UserError::ValidationFailed(e.to_string()))?;
    Ok(User::from(data))
}
```
