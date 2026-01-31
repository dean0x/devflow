# Extended Violation Examples

Additional code smell patterns and violations beyond the core examples in SKILL.md.

---

## Result Types - Extended Violations

### Try/Catch in Business Logic

```typescript
// VIOLATION: Try/catch in business logic
function calculate(items: Item[]): number {
  try {
    return items.reduce((sum, i) => sum + i.price, 0);
  } catch {
    return 0;  // Silent failure - BAD
  }
}

// VIOLATION: Nested try/catch
async function processOrder(id: string): Promise<Order> {
  try {
    const order = await fetchOrder(id);
    try {
      await validateOrder(order);
    } catch {
      // Swallowed validation error
    }
    return order;
  } catch {
    return null;  // Silent failure
  }
}

// VIOLATION: Error type erasure
function parseConfig(raw: string): Config {
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('Parse failed');  // Lost original error context
  }
}
```

### Implicit Error States

```typescript
// VIOLATION: Using null/undefined for errors
function findUser(id: string): User | null {
  // Caller can't distinguish "not found" from "error occurred"
  return null;
}

// VIOLATION: Using sentinel values
function calculateDiscount(userId: string): number {
  // Returns -1 for errors - magic value
  if (!userId) return -1;
  return computeDiscount(userId);
}

// VIOLATION: Throwing in async without Result
async function fetchData(url: string): Promise<Data> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Fetch failed');  // Should return Result
  }
  return response.json();
}
```

---

## Dependency Injection - Extended Violations

### Hidden Dependencies

```typescript
// VIOLATION: Hidden dependencies via imports
import { config } from './config';  // Global config
import { analytics } from './analytics';  // Global analytics

class UserService {
  createUser(data: UserData) {
    // Uses global config - can't test with different config
    if (config.features.requireEmailVerification) {
      // ...
    }
    // Uses global analytics - can't mock in tests
    analytics.track('user_created', data);
  }
}

// VIOLATION: Static method dependencies
class OrderService {
  processOrder(order: Order) {
    // Can't mock static methods
    const tax = TaxCalculator.calculate(order.total);
    const shipping = ShippingService.getRate(order.address);
  }
}

// VIOLATION: Service locator anti-pattern
class PaymentService {
  process(payment: Payment) {
    // Runtime dependency resolution - untestable
    const gateway = ServiceLocator.resolve<PaymentGateway>('paymentGateway');
    return gateway.charge(payment);
  }
}
```

### Partial Injection

```typescript
// VIOLATION: Some dependencies injected, others not
class ReportService {
  constructor(private db: Database) {}  // Injected

  generate(reportId: string) {
    const data = this.db.query(reportId);
    // But logger is global
    logger.info('Report generated');  // BAD
    // And config is imported
    if (config.features.pdfExport) {  // BAD
      // ...
    }
  }
}
```

---

## Immutability - Extended Violations

### Array Mutations

```typescript
// VIOLATION: In-place array modifications
function processItems(items: Item[]): Item[] {
  items.push({ id: 'new' });  // BAD - mutates input
  items.splice(0, 1);  // BAD - mutates input
  items.reverse();  // BAD - mutates in place
  items.fill({ id: 'default' });  // BAD - mutates in place
  return items;
}

// VIOLATION: Sorting without copy
function getSortedUsers(users: User[]): User[] {
  return users.sort((a, b) => a.name.localeCompare(b.name));  // Mutates original!
}

// VIOLATION: Using forEach for transformation
function transformItems(items: Item[]): Item[] {
  items.forEach(item => {
    item.processed = true;  // BAD - mutation
  });
  return items;
}
```

### Object Mutations

```typescript
// VIOLATION: Nested object mutation
function updateAddress(user: User, city: string): User {
  user.address.city = city;  // BAD - nested mutation
  return user;
}

// VIOLATION: Object.assign mutating first argument
function mergeConfig(base: Config, overrides: Partial<Config>): Config {
  return Object.assign(base, overrides);  // BAD - mutates base
}

// VIOLATION: Deleting properties
function removeField(obj: Record<string, unknown>, field: string) {
  delete obj[field];  // BAD - mutation
  return obj;
}
```

---

## Pure Functions - Extended Violations

### Side Effect Patterns

```typescript
// VIOLATION: Accessing global state
let counter = 0;
function getNextId(): string {
  return `id-${counter++}`;  // BAD - global state modification
}

// VIOLATION: Date/time dependency
function isExpired(expiry: Date): boolean {
  return new Date() > expiry;  // BAD - depends on current time
}

// VIOLATION: Random values
function generateToken(): string {
  return Math.random().toString(36);  // BAD - non-deterministic
}

// VIOLATION: Environment access
function getApiUrl(): string {
  return process.env.API_URL || 'http://localhost';  // BAD - env dependency
}
```

### Hidden I/O

```typescript
// VIOLATION: Caching with side effects
const cache = new Map();
function expensiveCalculation(input: string): number {
  if (cache.has(input)) return cache.get(input);  // BAD - reads global state
  const result = compute(input);
  cache.set(input, result);  // BAD - writes global state
  return result;
}

// VIOLATION: Lazy initialization
let initialized = false;
function ensureInitialized(): void {
  if (!initialized) {
    performSetup();  // BAD - side effect
    initialized = true;  // BAD - global state
  }
}
```

---

## Type Safety - Extended Violations

### Type Assertions Abuse

```typescript
// VIOLATION: Unsafe type assertion
const user = data as User;  // No runtime check

// VIOLATION: Non-null assertion
const name = user!.profile!.name!;  // Assumes non-null

// VIOLATION: Any escape hatch
function process(data: unknown) {
  return (data as any).property.nested;  // BAD
}

// VIOLATION: Type assertion to bypass checks
const items: Item[] = response.data as Item[];  // No validation
```

### Incomplete Discrimination

```typescript
// VIOLATION: Default case hiding missing patterns
function handleEvent(event: Event): void {
  switch (event.type) {
    case 'click':
      handleClick(event);
      break;
    default:
      // Silently ignores new event types
      break;
  }
}

// VIOLATION: Using if/else instead of exhaustive switch
function getLabel(status: Status): string {
  if (status === 'pending') return 'Waiting';
  if (status === 'active') return 'Running';
  return 'Unknown';  // BAD - misses new status types
}
```

---

## Resource Cleanup - Extended Violations

### Connection Leaks

```typescript
// VIOLATION: Connection not released on error
async function queryDatabase(sql: string) {
  const conn = await pool.getConnection();
  const result = await conn.query(sql);  // If this throws, connection leaks
  conn.release();
  return result;
}

// VIOLATION: Stream not closed
function readFile(path: string) {
  const stream = fs.createReadStream(path);
  stream.on('data', chunk => process(chunk));
  // No close handler - stream never closed on error
}

// VIOLATION: Subscription not unsubscribed
function setupListener(emitter: EventEmitter) {
  emitter.on('event', handler);
  // No cleanup - memory leak
}
```

### Timer Leaks

```typescript
// VIOLATION: Interval not cleared
function startPolling() {
  setInterval(() => {
    fetchData();
  }, 1000);
  // No way to stop polling
}

// VIOLATION: Timeout not cleared on early exit
async function withTimeout(promise: Promise<unknown>, ms: number) {
  const timeout = setTimeout(() => { throw new Error('Timeout'); }, ms);
  const result = await promise;  // If this resolves, timeout still pending
  return result;
}
```

---

## API Consistency - Extended Violations

### Mixed Error Handling

```typescript
// VIOLATION: Mixed error handling in same module
class UserRepository {
  // Returns null for not found
  findById(id: string): User | null { ... }

  // Throws for not found
  getById(id: string): User {
    const user = this.findById(id);
    if (!user) throw new NotFoundError();  // Inconsistent!
    return user;
  }

  // Returns Result
  findByEmail(email: string): Result<User, Error> { ... }  // Third pattern!
}
```

### Mixed Async Patterns

```typescript
// VIOLATION: Mixing callbacks and promises
function fetchUser(id: string, callback?: (err: Error, user: User) => void): Promise<User> {
  const promise = api.get(`/users/${id}`);
  if (callback) {
    promise.then(user => callback(null, user)).catch(err => callback(err, null));
  }
  return promise;
}

// VIOLATION: Fire-and-forget async
async function processOrder(order: Order) {
  saveOrder(order);  // Missing await - fire and forget
  await sendEmail(order.email);  // This one awaits
  logAnalytics(order);  // Missing await again
}
```
