# TypeScript — Violations

Extended violation patterns with literature citations.
See `sources.md` for full bibliography.

---

## Type Safety Violations

### Using `any` Type [1, Item 43][4][17]

"`any` is not just a hole in the type system — it's a hole that spreads."
— Effective TypeScript [1, Item 43]. Every `any` disables checking for all
values flowing through it.

**Direct any usage**
```typescript
// VIOLATION: any disables type checking [1, Item 43]
function parse(json: string): any { return JSON.parse(json); }

// VIOLATION: any parameter — no safety downstream [4]
function process(data: any) { console.log(data.name); }

// VIOLATION: any default in generic [17]
function wrap<T = any>(value: T) { return { value }; }
```

**Implicit any**
```typescript
// VIOLATION: Implicit any on parameter (fails with noImplicitAny) [16]
function greet(name) { return `Hello, ${name}`; }

// VIOLATION: Implicit any in catch [1, Item 47]
try { riskyOperation(); } catch (e) { console.log(e.message); }
```

### Type Assertions Without Validation [1, Item 9]

```typescript
// VIOLATION: Casting without narrowing [1, Item 9]
const user = data as User;  // data could be anything

// VIOLATION: Double-assertion bypass — opts out of entire type system
const value = data as unknown as SpecificType;

// VIOLATION: Non-null assertion on nullable [4]
function getName(user: User | null): string { return user!.name; }
```

### Non-Exhaustive Pattern Matching [1, Item 33]

```typescript
type Status = 'pending' | 'active' | 'completed' | 'failed';

// VIOLATION: Missing cases hidden by default [1, Item 33]
function handleStatus(status: Status): string {
  switch (status) {
    case 'pending': return 'Waiting';
    case 'active':  return 'Running';
    // Missing: 'completed' and 'failed'
  }
  return 'Unknown'; // hides compile error when union grows
}

// VIOLATION: Only handling success branch [1, Item 28]
function process<T>(result: Result<T>): T {
  if (result.ok) return result.value;
  // error branch silently falls off — TypeScript won't error without strictNullChecks
}
```

---

## Type Guard Violations [2][6]

### Missing or Incorrect Narrowing

```typescript
// VIOLATION: Trusting unvalidated input [1, Item 43][25]
function processUser(data: unknown) {
  const user = data as User; // assumes shape, no check
  console.log(user.name);    // runtime error if wrong
}

// VIOLATION: Incomplete predicate — checks presence but not type [2]
function isUser(obj: unknown): obj is User {
  return typeof obj === 'object' && obj !== null && 'name' in obj;
  // Missing: typeof obj.name === 'string', other required properties
}

// VIOLATION: Predicate doesn't match its check [6]
function isString(value: unknown): value is string {
  return value !== null; // wrong — null passes, non-strings pass
}
```

### Unsafe `instanceof` Usage [7]

```typescript
// VIOLATION: instanceof fails for primitive types [7]
function isNumber(value: unknown): value is number {
  return value instanceof Number; // fails for primitive 42
}

// VIOLATION: instanceof fails across iframes/realms [7]
function isArray(value: unknown): value is unknown[] {
  return value instanceof Array; // use Array.isArray instead
}
```

### Missing Null Checks [4][16]

```typescript
// VIOLATION: Optional property accessed without check [4]
function getTimeout(config: { timeout?: number }): number {
  return config.timeout * 1000; // Error: possibly undefined
}

// VIOLATION: Chained access without null safety
function getCity(user: User): string {
  return user.address.city; // runtime error if address is undefined
}
```

---

## Utility Type Violations [1, Items 14–16]

### Manual Reimplementation of Built-ins [1, Item 15]

```typescript
// VIOLATION: Reinventing Partial<T> [1, Item 15]
type MyPartial<T> = { [P in keyof T]?: T[P] };

// VIOLATION: Duplicating types instead of using Partial [1, Item 14]
interface CreateUserInput { name: string; email: string; }
interface UpdateUserInput { name?: string; email?: string; }
// Should be: type UpdateUserInput = Partial<CreateUserInput>
```

### Incorrect Generic Constraints [1, Item 50][6]

```typescript
// VIOLATION: No constraint — property access is unsafe [1, Item 50]
function getProperty<T, K>(obj: T, key: K) { return obj[key]; }

// VIOLATION: Over-constrained — prevents legitimate callers [1, Item 29]
function merge<T extends { id: string }>(a: T, b: T): T {
  return { ...a, ...b }; // can't merge objects without 'id' even when not needed
}
```

### Improper Mapped Types [6][19]

```typescript
// VIOLATION: Silently drops optional modifiers [6]
type Transformed<T> = { [P in keyof T]: string };
// All properties become required strings — original optionality lost

// VIOLATION: Doesn't remove readonly — looks like Mutable but isn't [6]
type Mutable<T> = { [P in keyof T]: T[P] };
// Must use { -readonly [P in keyof T]: T[P] }
```

---

## Branded Type Omission [1, Item 37][22]

Structural typing means two `string` aliases are interchangeable by default. Without
branding, incorrect ID substitution compiles silently.

```typescript
// VIOLATION: Structural collision — UserId and OrderId both string [1, Item 37]
type UserId  = string;
type OrderId = string;

function getUser(id: UserId): User { ... }

declare const orderId: OrderId;
getUser(orderId); // compiles! No protection against wrong-ID bugs

// CORRECT: Branded types prevent silent substitution [1, Item 37][22]
type UserId  = Brand<string, 'UserId'>;
type OrderId = Brand<string, 'OrderId'>;
getUser(orderId); // Error: OrderId not assignable to UserId
```

---

## Async Pattern Violations [1, Item 25][2]

### Unhandled Promises

```typescript
// VIOLATION: Fire-and-forget — error silently lost [1, Item 25]
async function processData() {
  saveToDatabase(data); // no await, no .catch()
  console.log('Saved!'); // lie — may not be saved
}

// VIOLATION: forEach with async — outer loop doesn't wait [6]
ids.forEach(async (id) => { await processItem(id); });
```

### Missing Error Handling

```typescript
// VIOLATION: No catch on fetch — network errors unhandled [2]
async function loadUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  return response.json(); // throws on network failure, no type guard on JSON
}

// VIOLATION: Catch swallows error details [1, Item 47]
try {
  await riskyOperation();
} catch (e) {
  console.log('Error'); // e is unknown, message lost
}
```

### Improper Async Patterns

```typescript
// VIOLATION: Sequential when parallel is possible [6]
async function processAll(items: Item[]) {
  const results = [];
  for (const item of items) {
    results.push(await process(item)); // one at a time unnecessarily
  }
  return results;
}

// VIOLATION: Unbounded Promise.all — overwhelms server [6]
async function processAll(items: Item[]) {
  return Promise.all(items.map(item => fetchData(item)));
  // 1000 items → 1000 concurrent requests
}

// VIOLATION: Promise constructor anti-pattern [6]
function fetchData(): Promise<Data> {
  return new Promise(async (resolve, reject) => {
    // async executor — errors in the async body don't reject the promise
    const data = await fetch('/api/data');
    resolve(data);
  });
}

// VIOLATION: Callback inside async — inner return does nothing [6]
async function getData() {
  fs.readFile('data.json', (err, data) => {
    return JSON.parse(data); // this return is discarded
  });
}
```

---

## Module Violations [4][2]

### Circular Dependencies

```typescript
// a.ts
import { B } from './b';
export class A { b = new B(); }

// b.ts
import { A } from './a'; // circular — loading order undefined
export class B { a = new A(); }
```

### Import Anti-patterns [4]

```typescript
// VIOLATION: Importing entire module — no tree-shaking [4]
import * as utils from './utils';
utils.formatDate(date);

// VIOLATION: Side effects at module level — untestable [4]
export const db = new Database(connectionString); // runs on every import

// VIOLATION: Value import for type-only usage — increases bundle [4]
import { User } from './user'; // use: import type { User }
```
