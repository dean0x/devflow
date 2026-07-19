# TypeScript — Correct Patterns

Extended correct patterns for TypeScript development with literature citations.
See `sources.md` for full bibliography.

---

## Type Safety Patterns

### Using Unknown with Type Guards [1, Item 43][2]

`unknown` is the type-safe counterpart to `any`. It forces narrowing before use — the
type system guarantees safety after every guard [1, Item 43].

```typescript
// CORRECT: unknown requires narrowing before use
function parse(json: string): unknown {
  return JSON.parse(json);
}

const data = parse(input);
if (isUser(data)) {
  console.log(data.name);  // type-safe
}

// CORRECT: catch clause narrowing [1, Item 47]
try {
  riskyOperation();
} catch (e) {
  if (e instanceof Error) {
    console.log(e.message);
  }
}
```

### Exhaustive Pattern Matching [1, Item 33][13]

Using `never` in the default branch causes a compile error when a union member is added
but the switch is not updated — the compiler enforces completeness.

```typescript
type Status = 'pending' | 'active' | 'completed' | 'failed';

function handleStatus(status: Status): string {
  switch (status) {
    case 'pending': return 'Waiting';
    case 'active': return 'Running';
    case 'completed': return 'Done';
    case 'failed': return 'Error';
    default:
      const _exhaustive: never = status; // compile error if case missing
      throw new Error(`Unhandled status: ${_exhaustive}`);
  }
}

// Reusable assertNever helper [6]
function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${value}`);
}
```

### Safe Property Access [1, Item 54][4]

```typescript
// Typed property access via constraint
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

// Optional chaining with nullish coalescing [2]
function getName(user: User | null): string {
  return user?.name ?? 'Anonymous';
}

function getTimeout(config: { timeout?: number }): number {
  return (config.timeout ?? 5000) * 1000;
}
```

---

## Type Guard Patterns [2][6]

### Assertion Functions [2]

```typescript
function assertDefined<T>(value: T | undefined, message: string): asserts value is T {
  if (value === undefined) throw new Error(message);
}

function assertExists<T>(value: T | null | undefined, message: string): asserts value is T {
  if (value == null) throw new Error(message);
}
```

### Primitive Type Guards [2][7]

```typescript
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && !Number.isNaN(value);
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isNullish = (value: unknown): value is null | undefined =>
  value === null || value === undefined;
const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;
const isArray = (value: unknown): value is unknown[] => Array.isArray(value);
```

### Array Type Guards [6]

```typescript
// Non-empty tuple guard — preserves first-element type
function isNonEmpty<T>(arr: T[]): arr is [T, ...T[]] {
  return arr.length > 0;
}

// All-match guard — narrows array element type
function allMatch<T, S extends T>(arr: T[], guard: (item: T) => item is S): arr is S[] {
  return arr.every(guard);
}
```

### Object Shape Guards [6]

```typescript
function hasProperty<K extends string>(obj: unknown, key: K): obj is { [P in K]: unknown } {
  return typeof obj === 'object' && obj !== null && key in obj;
}

function hasTypedProperty<K extends string, V>(
  obj: unknown, key: K, guard: (v: unknown) => v is V
): obj is { [P in K]: V } {
  return hasProperty(obj, key) && guard(obj[key]);
}
```

### Discriminated Union Guards [1, Item 28][6]

```typescript
// Generic discriminant checker — Extract narrows the union [19]
function isVariant<T extends { type: string }, K extends T['type']>(
  obj: T, type: K
): obj is Extract<T, { type: K }> {
  return obj.type === type;
}
```

### Error Type Guards [1, Item 47]

```typescript
function isErrorWithMessage(error: unknown): error is { message: string } {
  return (
    typeof error === 'object' && error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  );
}
```

### Composable Guards [6]

```typescript
function and<A, B extends A>(
  guardA: (v: unknown) => v is A, guardB: (v: A) => v is B
): (v: unknown) => v is B {
  return (v): v is B => guardA(v) && guardB(v);
}

function or<A, B>(
  guardA: (v: unknown) => v is A, guardB: (v: unknown) => v is B
): (v: unknown) => v is A | B {
  return (v): v is A | B => guardA(v) || guardB(v);
}
```

---

## Utility Type Patterns [1, Items 14–16][6]

### Property Manipulation

```typescript
// Make specific properties required [2]
type RequiredProps<T, K extends keyof T> = T & Required<Pick<T, K>>;

// Make specific properties optional
type OptionalProps<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

// Remove readonly modifier from mapped type [6]
type Mutable<T> = { -readonly [P in keyof T]: T[P] };
```

### Deep Transformations [6][19]

```typescript
// Deep partial — all nested properties optional
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Deep readonly — prevents mutation at any depth
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

// Deep required — all nested properties required
type DeepRequired<T> = {
  [P in keyof T]-?: T[P] extends object ? DeepRequired<T[P]> : T[P];
};
```

### Key Manipulation via Mapped Types [6][19]

```typescript
// Get keys where value matches type V — uses conditional type distribution
type KeysOfType<T, V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T];

// Pick by value type — key remapping with `as` clause [8]
type PickByType<T, V> = {
  [K in keyof T as T[K] extends V ? K : never]: T[K];
};

// Omit by value type
type OmitByType<T, V> = {
  [K in keyof T as T[K] extends V ? never : K]: T[K];
};
```

### Function Utilities [6][19]

```typescript
// Unwrap Promise return type using conditional type + infer [19]
type AsyncReturnType<T extends (...args: any[]) => Promise<any>> =
  T extends (...args: any[]) => Promise<infer R> ? R : never;

// First/last argument types [6]
type FirstArgument<T extends (...args: any[]) => any> =
  T extends (first: infer F, ...rest: any[]) => any ? F : never;
```

### Tuple Utilities [6][15]

```typescript
type Head<T extends any[]> = T extends [infer H, ...any[]] ? H : never;
type Tail<T extends any[]> = T extends [any, ...infer R] ? R : never;
type Last<T extends any[]> = T extends [...any[], infer L] ? L : never;
type Concat<A extends any[], B extends any[]> = [...A, ...B];
```

### Template Literal Type Utilities [8][20]

```typescript
// Split string type into tuple [20]
type Split<S extends string, D extends string> =
  S extends `${infer T}${D}${infer U}` ? [T, ...Split<U, D>] : [S];

// Join tuple into string type
type Join<T extends string[], D extends string> =
  T extends [] ? '' :
  T extends [infer F extends string] ? F :
  T extends [infer F extends string, ...infer R extends string[]] ? `${F}${D}${Join<R, D>}` :
  never;
```

### Branded Types [1, Item 37][22]

```typescript
declare const brand: unique symbol;
type Brand<T, B> = T & { [brand]: B };

type UserId  = Brand<string, 'UserId'>;
type OrderId = Brand<string, 'OrderId'>;

function getUser(id: UserId): User { ... }
function getOrder(id: OrderId): Order { ... }

const userId  = 'abc' as UserId;
const orderId = 'xyz' as OrderId;
getUser(userId);   // OK
getUser(orderId);  // Error: OrderId not assignable to UserId
```

---

## Async Patterns [1, Item 25][2]

### Result-Based Async [1, Item 25]

```typescript
type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

async function fetchUser(id: string): AsyncResult<User> {
  try {
    const user = await db.users.findById(id);
    if (!user) return { ok: false, error: new Error('User not found') };
    return { ok: true, value: user };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

// Generic tryCatch wrapper [6]
async function tryCatch<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}
```

### Promise Utilities [6]

```typescript
// Settle all — individual Result per item
async function settleAll<T>(promises: Promise<T>[]): Promise<Array<Result<T, Error>>> {
  const results = await Promise.allSettled(promises);
  return results.map(r =>
    r.status === 'fulfilled'
      ? { ok: true as const, value: r.value }
      : { ok: false as const, error: r.reason }
  );
}

// Timeout wrapper [6]
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms)),
  ]);
}
```

### Controlled Concurrency [6]

```typescript
async function pMap<T, R>(
  items: T[], fn: (item: T, index: number) => Promise<R>, concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];
  for (let i = 0; i < items.length; i++) {
    const promise = fn(items[i], i).then(r => { results[i] = r; });
    executing.push(promise);
    if (executing.length >= concurrency) await Promise.race(executing);
  }
  await Promise.all(executing);
  return results;
}
```

---

## Generic Class Patterns [1, Items 50–51][2]

### Generic Repository [1, Item 51]

```typescript
interface Repository<T, ID = string> {
  findById(id: ID): Promise<T | null>;
  findAll(): Promise<T[]>;
  save(entity: T): Promise<T>;
  update(id: ID, changes: Partial<T>): Promise<T>;
  delete(id: ID): Promise<void>;
}
```

### Builder Pattern [6]

```typescript
class QueryBuilder<T> {
  private conditions: Array<(item: T) => boolean> = [];

  where<K extends keyof T>(key: K, value: T[K]): this {
    this.conditions.push(item => item[key] === value);
    return this;
  }

  execute(items: T[]): T[] {
    return items.filter(item => this.conditions.every(c => c(item)));
  }
}
```

---

## Module Patterns [4][2]

### Type-Only Imports [4]

```typescript
// Type-only import — erased at runtime, no circular reference risk
import type { User, UserDTO } from './user';
import { createUser } from './user';

// Barrel export
export { User } from './user';
export type { UserDTO } from './user';
```

### Dependency Injection via Interface [1, Item 63]

```typescript
interface Logger {
  info(message: string, context?: object): void;
  error(message: string, context?: object): void;
}

class UserService {
  constructor(private readonly logger: Logger, private readonly repo: UserRepository) {}

  async createUser(input: CreateUserInput): Promise<Result<User, Error>> {
    this.logger.info('Creating user', { email: input.email });
    // ...
  }
}
```

---

## Discriminated Union State Machines [1, Item 28][24]

```typescript
type RequestState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error };

// Exhaustive renderer — compiler enforces all variants handled [13]
function render<T>(state: RequestState<T>): string {
  switch (state.status) {
    case 'idle':    return 'Ready';
    case 'loading': return 'Loading...';
    case 'success': return `Data: ${JSON.stringify(state.data)}`;
    case 'error':   return `Error: ${state.error.message}`;
  }
}
```
