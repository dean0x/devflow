# Extended Violation Examples

Additional code smell patterns and violations beyond the core examples in SKILL.md.
All violations cite `references/sources.md`.

---

## Result Types — Extended Violations [1][10]

### Try/Catch in Business Logic [1][11]

Throwing in business logic is the core violation of Railway Oriented Programming [1].
Functional Core, Imperative Shell mandates that only the shell catches exceptions [11].

```typescript
// VIOLATION: Try/catch in business logic [1]
function calculate(items: Item[]): number {
  try {
    return items.reduce((sum, i) => sum + i.price, 0);
  } catch {
    return 0;  // Silent failure — caller has no idea [10]
  }
}

// VIOLATION: Nested try/catch swallowing errors [10]
async function processOrder(id: string): Promise<Order> {
  try {
    const order = await fetchOrder(id);
    try {
      await validateOrder(order);
    } catch {
      // Swallowed validation error — BAD [10]
    }
    return order;
  } catch {
    return null;  // Silent failure [10]
  }
}

// VIOLATION: Error type erasure [1]
function parseConfig(raw: string): Config {
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error('Parse failed');  // Lost original error context [1]
  }
}
```

### Implicit Error States [1][2]

```typescript
// VIOLATION: null/undefined for errors — caller can't distinguish "not found" from "error" [1]
function findUser(id: string): User | null {
  return null;
}

// VIOLATION: Sentinel values as error signal [2]
function calculateDiscount(userId: string): number {
  if (!userId) return -1;  // Magic -1 means error — see sources.md [9] for proper approach
  return computeDiscount(userId);
}

// VIOLATION: Throwing in async without Result [1]
async function fetchData(url: string): Promise<Data> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Fetch failed');  // Should return Result [1]
  }
  return response.json();
}
```

---

## Dependency Injection — Extended Violations [3]

### Hidden Dependencies [3]

Fowler's canonical DI article [3] identifies these as the anti-patterns that DI solves.

```typescript
// VIOLATION: Hidden dependencies via imports [3]
import { config } from './config';     // Global config
import { analytics } from './analytics'; // Global analytics

class UserService {
  createUser(data: UserData) {
    if (config.features.requireEmailVerification) { /* can't test with different config */ }
    analytics.track('user_created', data);  // Can't mock in tests [3]
  }
}

// VIOLATION: Static method dependencies — can't mock [3]
class OrderService {
  processOrder(order: Order) {
    const tax = TaxCalculator.calculate(order.total);    // Static — untestable [3]
    const shipping = ShippingService.getRate(order.address); // Static — untestable [3]
  }
}

// VIOLATION: Service locator anti-pattern [3]
class PaymentService {
  process(payment: Payment) {
    const gateway = ServiceLocator.resolve<PaymentGateway>('paymentGateway');
    return gateway.charge(payment);
  }
}
```

### Partial Injection [3]

```typescript
// VIOLATION: Some dependencies injected, others not — inconsistent [3]
class ReportService {
  constructor(private db: Database) {}  // Injected

  generate(reportId: string) {
    const data = this.db.query(reportId);
    logger.info('Report generated');   // BAD — global logger [3]
    if (config.features.pdfExport) {   // BAD — global config [3]
      // ...
    }
  }
}
```

---

## Immutability — Extended Violations [7][14]

### Array Mutations [14]

Rich Hickey's "Value of Values" [14] explains why mutation destroys referential transparency.

```typescript
// VIOLATION: In-place array modifications [14]
function processItems(items: Item[]): Item[] {
  items.push({ id: 'new' });   // Mutates input [14]
  items.splice(0, 1);          // Mutates input [14]
  items.reverse();             // Mutates in place [14]
  return items;
}

// VIOLATION: Sorting without copy [14]
function getSortedUsers(users: User[]): User[] {
  return users.sort((a, b) => a.name.localeCompare(b.name));  // Mutates original! [14]
}

// VIOLATION: forEach with mutations [14]
function transformItems(items: Item[]): Item[] {
  items.forEach(item => {
    item.processed = true;  // Mutation [14]
  });
  return items;
}
```

### Object Mutations [7][14]

```typescript
// VIOLATION: Nested object mutation [7]
function updateAddress(user: User, city: string): User {
  user.address.city = city;  // Nested mutation [7]
  return user;
}

// VIOLATION: Object.assign mutating first argument [14]
function mergeConfig(base: Config, overrides: Partial<Config>): Config {
  return Object.assign(base, overrides);  // Mutates base [14]
}

// VIOLATION: Deleting properties [14]
function removeField(obj: Record<string, unknown>, field: string) {
  delete obj[field];  // Mutation [14]
  return obj;
}
```

---

## Pure Functions — Extended Violations [8][11]

### Side Effect Patterns [11]

Bernhardt's "Functional Core, Imperative Shell" [11] identifies these as imperative shell concerns leaking into the functional core.

```typescript
// VIOLATION: Accessing global state [15]
let counter = 0;
function getNextId(): string {
  return `id-${counter++}`;  // Global state modification [15]
}

// VIOLATION: Date/time dependency — non-deterministic [8]
function isExpired(expiry: Date): boolean {
  return new Date() > expiry;  // Inject clock instead [8]
}

// VIOLATION: Random values — non-deterministic [8]
function generateToken(): string {
  return Math.random().toString(36);  // Inject RNG instead [8]
}
```

### Hidden I/O [11]

```typescript
// VIOLATION: Caching with side effects in pure function [11]
const cache = new Map();
function expensiveCalculation(input: string): number {
  if (cache.has(input)) return cache.get(input);  // Global read [11]
  const result = compute(input);
  cache.set(input, result);  // Global write [11]
  return result;
}
```

---

## Type Safety — Extended Violations [4][2][21]

### Type Assertions Abuse [4][21]

Making illegal states representable is the opposite of [4].

```typescript
// VIOLATION: Unsafe type assertion — no runtime check [4]
const user = data as User;

// VIOLATION: Non-null assertion — assumes non-null [21]
const name = user!.profile!.name!;

// VIOLATION: any escape hatch [22]
function process(data: unknown) {
  return (data as any).property.nested;  // Bypasses type system [22]
}
```

### Incomplete Discrimination [4][21]

```typescript
// VIOLATION: Default case hiding missing patterns [21]
function handleEvent(event: Event): void {
  switch (event.type) {
    case 'click':
      handleClick(event);
      break;
    default:
      // Silently ignores new event types — compile-time safety lost [21]
      break;
  }
}

// VIOLATION: if/else instead of exhaustive switch [4]
function getLabel(status: Status): string {
  if (status === 'pending') return 'Waiting';
  if (status === 'active') return 'Running';
  return 'Unknown';  // New status values silently fall through [4]
}
```

---

## Resource Cleanup — Extended Violations [7]

### Connection Leaks [7]

SICP's emphasis on resource management [7] applies equally to OS resources.

```typescript
// VIOLATION: Connection not released on error [7]
async function queryDatabase(sql: string) {
  const conn = await pool.getConnection();
  const result = await conn.query(sql);  // If this throws, connection leaks [7]
  conn.release();
  return result;
}

// VIOLATION: Stream not closed on error [7]
function readFile(path: string) {
  const stream = fs.createReadStream(path);
  stream.on('data', chunk => process(chunk));
  // No error handler — stream never closed on error [7]
}
```

### Timer Leaks [7]

```typescript
// VIOLATION: Interval not cleared [7]
function startPolling() {
  setInterval(() => {
    fetchData();
  }, 1000);
  // No way to stop polling — resource leak [7]
}
```

---

## API Consistency — Extended Violations [1][3]

### Mixed Error Handling [1]

Inconsistency violates Railway Oriented Programming's one-track model [1].

```typescript
// VIOLATION: Three different error patterns in same class [1]
class UserRepository {
  findById(id: string): User | null { ... }       // Pattern 1: null

  getById(id: string): User {
    const user = this.findById(id);
    if (!user) throw new NotFoundError();          // Pattern 2: throw [1]
    return user;
  }

  findByEmail(email: string): Result<User, Error> { ... }  // Pattern 3: Result
}
```

### Mixed Async Patterns [3]

```typescript
// VIOLATION: Mixing callbacks and promises [3]
function fetchUser(id: string, callback?: (err: Error, user: User) => void): Promise<User> {
  const promise = api.get(`/users/${id}`);
  if (callback) {
    promise.then(user => callback(null, user)).catch(err => callback(err, null));
  }
  return promise;
}

// VIOLATION: Fire-and-forget async [10]
async function processOrder(order: Order) {
  saveOrder(order);           // Missing await [10]
  await sendEmail(order.email);
  logAnalytics(order);        // Missing await [10]
}
```
