# TypeScript Correct Patterns

Extended correct patterns for TypeScript development. Reference from main SKILL.md.

## Type Safety Patterns

### Using Unknown with Type Guards

```typescript
// CORRECT: unknown requires type checking
function parse(json: string): unknown {
  return JSON.parse(json);
}

// Usage requires narrowing
const data = parse(input);
if (isUser(data)) {
  console.log(data.name);  // Now type-safe
}

// CORRECT: Typed catch clause
try {
  riskyOperation();
} catch (e) {
  if (e instanceof Error) {
    console.log(e.message);
  }
}
```

### Exhaustive Pattern Matching

```typescript
// CORRECT: Exhaustive switch with never check
type Status = 'pending' | 'active' | 'completed' | 'failed';

function handleStatus(status: Status): string {
  switch (status) {
    case 'pending':
      return 'Waiting';
    case 'active':
      return 'Running';
    case 'completed':
      return 'Done';
    case 'failed':
      return 'Error';
    default:
      // Compile error if case missing
      const _exhaustive: never = status;
      throw new Error(`Unhandled status: ${_exhaustive}`);
  }
}

// CORRECT: Exhaustive discriminated union helper
function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${value}`);
}
```

### Safe Property Access

```typescript
// CORRECT: Typed property access
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

// CORRECT: Optional chaining with nullish coalescing
function getName(user: User | null): string {
  return user?.name ?? 'Anonymous';
}

// CORRECT: Optional property with default
interface Config {
  timeout?: number;
}

function getTimeout(config: Config): number {
  return (config.timeout ?? 5000) * 1000;
}
```

---

## Type Guard Patterns

### Assertion Functions

```typescript
// Assert value is defined (not undefined)
function assertDefined<T>(value: T | undefined, message: string): asserts value is T {
  if (value === undefined) {
    throw new Error(message);
  }
}

// Assert value is non-null
function assertNonNull<T>(value: T | null, message: string): asserts value is T {
  if (value === null) {
    throw new Error(message);
  }
}

// Assert value exists (not null or undefined)
function assertExists<T>(value: T | null | undefined, message: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
}

// Usage
function processUser(user: User | undefined): void {
  assertDefined(user, 'User is required');
  console.log(user.name);  // user is definitely defined here
}
```

### Primitive Type Guards

```typescript
// Reusable primitive guards
const isString = (value: unknown): value is string =>
  typeof value === 'string';

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && !Number.isNaN(value);

const isBoolean = (value: unknown): value is boolean =>
  typeof value === 'boolean';

const isNull = (value: unknown): value is null =>
  value === null;

const isUndefined = (value: unknown): value is undefined =>
  value === undefined;

const isNullish = (value: unknown): value is null | undefined =>
  value === null || value === undefined;

const isFunction = (value: unknown): value is Function =>
  typeof value === 'function';

const isObject = (value: unknown): value is object =>
  typeof value === 'object' && value !== null;

const isArray = (value: unknown): value is unknown[] =>
  Array.isArray(value);
```

### Array Type Guards

```typescript
// Check if array is non-empty
function isNonEmpty<T>(arr: T[]): arr is [T, ...T[]] {
  return arr.length > 0;
}

// Check if all elements match predicate
function allMatch<T, S extends T>(
  arr: T[],
  guard: (item: T) => item is S
): arr is S[] {
  return arr.every(guard);
}

// Usage
const items: (string | number)[] = ['a', 'b', 'c'];

if (allMatch(items, (x): x is string => typeof x === 'string')) {
  // items is string[] here
  items.forEach(s => console.log(s.toUpperCase()));
}
```

### Object Shape Guards

```typescript
// Check if object has specific property
function hasProperty<K extends string>(
  obj: unknown,
  key: K
): obj is { [P in K]: unknown } {
  return typeof obj === 'object' && obj !== null && key in obj;
}

// Check if object has property of specific type
function hasTypedProperty<K extends string, V>(
  obj: unknown,
  key: K,
  guard: (value: unknown) => value is V
): obj is { [P in K]: V } {
  return hasProperty(obj, key) && guard(obj[key]);
}

// Check multiple properties
function hasProperties<K extends string>(
  obj: unknown,
  ...keys: K[]
): obj is { [P in K]: unknown } {
  return typeof obj === 'object' && obj !== null && keys.every(k => k in obj);
}

// Usage
function processData(data: unknown): void {
  if (hasProperty(data, 'id') && hasProperty(data, 'name')) {
    console.log(data.id, data.name);
  }
}
```

### Discriminated Union Guards

```typescript
// Generic discriminant checker
function isVariant<T extends { type: string }, K extends T['type']>(
  obj: T,
  type: K
): obj is Extract<T, { type: K }> {
  return obj.type === type;
}

// Usage
type Event =
  | { type: 'click'; x: number; y: number }
  | { type: 'keypress'; key: string }
  | { type: 'scroll'; offset: number };

function handleEvent(event: Event): void {
  if (isVariant(event, 'click')) {
    console.log(`Clicked at ${event.x}, ${event.y}`);
  } else if (isVariant(event, 'keypress')) {
    console.log(`Pressed ${event.key}`);
  }
}
```

### Error Type Guards

```typescript
// Check if error has specific shape
function isErrorWithMessage(error: unknown): error is { message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  );
}

// Check if error has code
function isErrorWithCode(error: unknown): error is { code: string | number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (typeof (error as { code: unknown }).code === 'string' ||
     typeof (error as { code: unknown }).code === 'number')
  );
}

// Usage
try {
  riskyOperation();
} catch (error) {
  if (isErrorWithMessage(error)) {
    console.error(error.message);
  }
  if (isErrorWithCode(error) && error.code === 'ENOENT') {
    console.error('File not found');
  }
}
```

### Composable Guards

```typescript
// Combine guards with AND
function and<A, B extends A>(
  guardA: (v: unknown) => v is A,
  guardB: (v: A) => v is B
): (v: unknown) => v is B {
  return (v: unknown): v is B => guardA(v) && guardB(v);
}

// Combine guards with OR
function or<A, B>(
  guardA: (v: unknown) => v is A,
  guardB: (v: unknown) => v is B
): (v: unknown) => v is A | B {
  return (v: unknown): v is A | B => guardA(v) || guardB(v);
}

// Usage
const isStringOrNumber = or(isString, isNumber);
const isNonNullObject = and(isObject, (v): v is object => v !== null);
```

### API Response Guards

```typescript
interface SuccessResponse<T> {
  status: 'success';
  data: T;
}

interface ErrorResponse {
  status: 'error';
  error: {
    code: string;
    message: string;
  };
}

type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

function isSuccess<T>(
  response: ApiResponse<T>
): response is SuccessResponse<T> {
  return response.status === 'success';
}

function isError<T>(
  response: ApiResponse<T>
): response is ErrorResponse {
  return response.status === 'error';
}

// Usage
async function fetchData<T>(url: string): Promise<T> {
  const response: ApiResponse<T> = await fetch(url).then(r => r.json());

  if (isError(response)) {
    throw new Error(response.error.message);
  }

  return response.data;
}
```

---

## Utility Type Patterns

### Property Manipulation

```typescript
// Make specific properties required
type RequiredProps<T, K extends keyof T> = T & Required<Pick<T, K>>;
type UserWithEmail = RequiredProps<Partial<User>, 'email'>;

// Make specific properties optional
type OptionalProps<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
type UserWithOptionalRole = OptionalProps<User, 'role'>;

// Make specific properties mutable (remove readonly)
type Mutable<T> = { -readonly [P in keyof T]: T[P] };
type MutableUser = Mutable<Readonly<User>>;

// Make specific properties readonly
type ReadonlyProps<T, K extends keyof T> = Omit<T, K> & Readonly<Pick<T, K>>;
type UserWithReadonlyId = ReadonlyProps<User, 'id'>;
```

### Deep Transformations

```typescript
// Deep partial - all nested properties optional
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Deep readonly - prevents mutation at any depth
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

// Deep required - all nested properties required
type DeepRequired<T> = {
  [P in keyof T]-?: T[P] extends object ? DeepRequired<T[P]> : T[P];
};

// Usage
interface Config {
  database: {
    host: string;
    port: number;
    credentials: {
      username: string;
      password: string;
    };
  };
}

type PartialConfig = DeepPartial<Config>;
const config: DeepReadonly<Config> = { ... };
```

### Nullable Helpers

```typescript
// Nullable type
type Nullable<T> = T | null;

// Maybe type (nullable and optional)
type Maybe<T> = T | null | undefined;

// NonNullableProps - remove null/undefined from specific properties
type NonNullableProps<T, K extends keyof T> = {
  [P in keyof T]: P extends K ? NonNullable<T[P]> : T[P];
};

// Example
interface ApiResponse {
  data: User | null;
  error: string | null;
  timestamp: number;
}

type SuccessResponse = NonNullableProps<ApiResponse, 'data'>;
// { data: User; error: string | null; timestamp: number }
```

### Key Manipulation

```typescript
// Get keys where value is of specific type
type KeysOfType<T, V> = {
  [K in keyof T]: T[K] extends V ? K : never;
}[keyof T];

interface User {
  id: string;
  name: string;
  age: number;
  active: boolean;
}

type StringKeys = KeysOfType<User, string>;   // 'id' | 'name'
type NumberKeys = KeysOfType<User, number>;   // 'age'

// Pick properties by value type
type PickByType<T, V> = {
  [K in keyof T as T[K] extends V ? K : never]: T[K];
};

type StringProps = PickByType<User, string>;
// { id: string; name: string }

// Omit properties by value type
type OmitByType<T, V> = {
  [K in keyof T as T[K] extends V ? never : K]: T[K];
};

type NonStringProps = OmitByType<User, string>;
// { age: number; active: boolean }
```

### Function Utilities

```typescript
// Get return type of async function (unwraps Promise)
type AsyncReturnType<T extends (...args: any[]) => Promise<any>> =
  T extends (...args: any[]) => Promise<infer R> ? R : never;

async function fetchUser(id: string): Promise<User> { ... }
type UserType = AsyncReturnType<typeof fetchUser>;  // User

// Get first argument type
type FirstArgument<T extends (...args: any[]) => any> =
  T extends (first: infer F, ...rest: any[]) => any ? F : never;

// Get last argument type
type LastArgument<T extends (...args: any[]) => any> =
  T extends (...args: [...any[], infer L]) => any ? L : never;
```

### Tuple Utilities

```typescript
// Head - first element
type Head<T extends any[]> = T extends [infer H, ...any[]] ? H : never;

// Tail - all but first
type Tail<T extends any[]> = T extends [any, ...infer R] ? R : never;

// Last - last element
type Last<T extends any[]> = T extends [...any[], infer L] ? L : never;

// Init - all but last
type Init<T extends any[]> = T extends [...infer I, any] ? I : never;

// Concat
type Concat<A extends any[], B extends any[]> = [...A, ...B];

// Usage
type Tuple = [string, number, boolean];
type First = Head<Tuple>;   // string
type Rest = Tail<Tuple>;    // [number, boolean]
type End = Last<Tuple>;     // boolean
```

### String Utilities

```typescript
// Split string
type Split<S extends string, D extends string> =
  S extends `${infer T}${D}${infer U}` ? [T, ...Split<U, D>] : [S];

// Join array to string
type Join<T extends string[], D extends string> =
  T extends [] ? '' :
  T extends [infer F extends string] ? F :
  T extends [infer F extends string, ...infer R extends string[]] ? `${F}${D}${Join<R, D>}` :
  never;

// Usage
type Parts = Split<'a.b.c', '.'>;     // ['a', 'b', 'c']
type Joined = Join<['a', 'b', 'c'], '-'>;  // 'a-b-c'
```

### Branded Types

```typescript
// Create nominal types that are structurally different
declare const brand: unique symbol;

type Brand<T, B> = T & { [brand]: B };

// Usage
type UserId = Brand<string, 'UserId'>;
type OrderId = Brand<string, 'OrderId'>;

function getUser(id: UserId): User { ... }
function getOrder(id: OrderId): Order { ... }

const userId = 'abc' as UserId;
const orderId = 'xyz' as OrderId;

getUser(userId);   // OK
getUser(orderId);  // Error: OrderId not assignable to UserId
```

---

## Async Patterns

### Async Function Types

```typescript
// Async function type
type AsyncFn<T, R> = (arg: T) => Promise<R>;

// Async with multiple args
type AsyncFn2<T1, T2, R> = (arg1: T1, arg2: T2) => Promise<R>;

// Async with result
type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

// Async void function
type AsyncVoidFn<T> = (arg: T) => Promise<void>;
```

### Result-Based Async

```typescript
// Basic async result pattern
async function fetchUser(id: string): AsyncResult<User> {
  try {
    const user = await db.users.findById(id);
    if (!user) {
      return { ok: false, error: new Error('User not found') };
    }
    return { ok: true, value: user };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

// Wrapping async operations
async function tryCatch<T>(
  fn: () => Promise<T>
): Promise<Result<T, Error>> {
  try {
    const value = await fn();
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

// Usage
const result = await tryCatch(() => fetchUserFromApi(id));
if (!result.ok) {
  console.error('Failed:', result.error.message);
}
```

### Promise Utilities

```typescript
// Wait for all, but handle errors individually
async function settleAll<T>(
  promises: Promise<T>[]
): Promise<Array<Result<T, Error>>> {
  const results = await Promise.allSettled(promises);
  return results.map((result) =>
    result.status === 'fulfilled'
      ? { ok: true as const, value: result.value }
      : { ok: false as const, error: result.reason }
  );
}

// Timeout wrapper
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = 'Operation timed out'
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), timeoutMs)
    ),
  ]);
}

// Retry with exponential backoff
interface RetryOptions {
  attempts: number;
  delayMs: number;
  backoff?: 'linear' | 'exponential';
  onRetry?: (error: Error, attempt: number) => void;
}

async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { attempts, delayMs, backoff = 'linear', onRetry } = options;
  let lastError: Error;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      onRetry?.(lastError, i + 1);

      if (i < attempts - 1) {
        const delay = backoff === 'exponential'
          ? delayMs * Math.pow(2, i)
          : delayMs;
        await sleep(delay);
      }
    }
  }

  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Concurrent Execution

```typescript
// Controlled concurrency
async function pMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (let i = 0; i < items.length; i++) {
    const promise = fn(items[i], i).then(result => {
      results[i] = result;
    });

    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
      executing.splice(
        executing.findIndex(p => p === promise),
        1
      );
    }
  }

  await Promise.all(executing);
  return results;
}

// Batch processing
async function batch<T, R>(
  items: T[],
  batchSize: number,
  fn: (batch: T[]) => Promise<R[]>
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await fn(batch);
    results.push(...batchResults);
  }

  return results;
}
```

### Cancellation

```typescript
interface Cancellable<T> {
  promise: Promise<T>;
  cancel: () => void;
}

function cancellable<T>(
  fn: (signal: AbortSignal) => Promise<T>
): Cancellable<T> {
  const controller = new AbortController();

  const promise = fn(controller.signal);

  return {
    promise,
    cancel: () => controller.abort()
  };
}

// Usage
const { promise, cancel } = cancellable(async (signal) => {
  const response = await fetch(url, { signal });
  return response.json();
});

// Cancel if takes too long
setTimeout(cancel, 5000);

try {
  const data = await promise;
} catch (error) {
  if (error.name === 'AbortError') {
    console.log('Request cancelled');
  }
}
```

### Debounce / Throttle

```typescript
// Debounce
function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delayMs);
  };
}

// Throttle
function throttle<T extends (...args: any[]) => any>(
  fn: T,
  limitMs: number
): (...args: Parameters<T>) => void {
  let lastRun = 0;
  let timeoutId: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    const now = Date.now();

    if (now - lastRun >= limitMs) {
      lastRun = now;
      fn(...args);
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastRun = Date.now();
        timeoutId = null;
        fn(...args);
      }, limitMs - (now - lastRun));
    }
  };
}
```

### Lazy Async

```typescript
class LazyAsync<T> {
  private promise: Promise<T> | null = null;
  private value: T | null = null;
  private resolved = false;

  constructor(private factory: () => Promise<T>) {}

  async get(): Promise<T> {
    if (this.resolved) return this.value!;

    if (!this.promise) {
      this.promise = this.factory().then(v => {
        this.value = v;
        this.resolved = true;
        return v;
      });
    }

    return this.promise;
  }

  isResolved(): boolean {
    return this.resolved;
  }

  reset(): void {
    this.promise = null;
    this.value = null;
    this.resolved = false;
  }
}

// Usage
const config = new LazyAsync(async () => {
  const response = await fetch('/config');
  return response.json();
});

// First call fetches
const cfg1 = await config.get();

// Subsequent calls return cached
const cfg2 = await config.get();
```

---

## Module Patterns

### Barrel Exports

```typescript
// src/models/index.ts
export { User } from './user';
export { Order } from './order';
export { Product } from './product';
export type { UserDTO, CreateUserInput } from './user';

// Usage
import { User, Order, type UserDTO } from './models';
```

### Type-Only Exports

```typescript
// Separate type exports for clarity
export type { User, UserDTO, CreateUserInput };
export { createUser, updateUser, deleteUser };

// Type-only imports (won't be in JS output)
import type { User } from './user';
import { createUser } from './user';
```

### Dependency Injection Pattern

```typescript
// Define interface
interface Logger {
  info(message: string, context?: object): void;
  error(message: string, context?: object): void;
}

// Implementation
class ConsoleLogger implements Logger {
  info(message: string, context?: object): void {
    console.log(message, context);
  }
  error(message: string, context?: object): void {
    console.error(message, context);
  }
}

// Service depends on interface
class UserService {
  constructor(
    private readonly logger: Logger,
    private readonly repository: UserRepository
  ) {}

  async createUser(input: CreateUserInput): Promise<Result<User, Error>> {
    this.logger.info('Creating user', { email: input.email });
    // ...
  }
}

// Composition root
const logger = new ConsoleLogger();
const repository = new PostgresUserRepository(db);
const userService = new UserService(logger, repository);
```

---

## Generic Patterns

### Generic Classes

```typescript
class Cache<T> {
  private store = new Map<string, { value: T; expiry: number }>();

  set(key: string, value: T, ttlMs: number): void {
    this.store.set(key, {
      value,
      expiry: Date.now() + ttlMs,
    });
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return false;
    }
    return true;
  }
}

// Usage
const userCache = new Cache<User>();
userCache.set('user-1', user, 60000);
```

### Generic Repository Pattern

```typescript
interface Repository<T, ID = string> {
  findById(id: ID): Promise<T | null>;
  findAll(): Promise<T[]>;
  findMany(query: Partial<T>): Promise<T[]>;
  save(entity: T): Promise<T>;
  update(id: ID, changes: Partial<T>): Promise<T>;
  delete(id: ID): Promise<void>;
  exists(id: ID): Promise<boolean>;
  count(query?: Partial<T>): Promise<number>;
}

// With constraints
interface Identifiable {
  id: string;
}

interface Timestamped {
  createdAt: Date;
  updatedAt: Date;
}

interface CRUDRepository<T extends Identifiable & Timestamped> {
  findById(id: string): Promise<T | null>;
  save(entity: Omit<T, 'id' | 'createdAt' | 'updatedAt'>): Promise<T>;
  update(id: string, changes: Partial<Omit<T, 'id' | 'createdAt'>>): Promise<T>;
}
```

### Builder Pattern with Types

```typescript
class QueryBuilder<T> {
  private conditions: Array<(item: T) => boolean> = [];
  private sortFn?: (a: T, b: T) => number;
  private limitCount?: number;

  where<K extends keyof T>(key: K, value: T[K]): this {
    this.conditions.push((item) => item[key] === value);
    return this;
  }

  whereIn<K extends keyof T>(key: K, values: T[K][]): this {
    this.conditions.push((item) => values.includes(item[key]));
    return this;
  }

  orderBy<K extends keyof T>(key: K, direction: 'asc' | 'desc' = 'asc'): this {
    this.sortFn = (a, b) => {
      const aVal = a[key];
      const bVal = b[key];
      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    };
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  execute(items: T[]): T[] {
    let result = items.filter((item) =>
      this.conditions.every((condition) => condition(item))
    );
    if (this.sortFn) {
      result = [...result].sort(this.sortFn);
    }
    if (this.limitCount !== undefined) {
      result = result.slice(0, this.limitCount);
    }
    return result;
  }
}

// Usage
const activeAdmins = new QueryBuilder<User>()
  .where('status', 'active')
  .where('role', 'admin')
  .orderBy('createdAt', 'desc')
  .limit(10)
  .execute(users);
```

---

## Discriminated Unions

### State Machines

```typescript
type RequestState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error };

function renderRequest<T>(state: RequestState<T>): string {
  switch (state.status) {
    case 'idle':
      return 'Ready to fetch';
    case 'loading':
      return 'Loading...';
    case 'success':
      return `Data: ${JSON.stringify(state.data)}`;
    case 'error':
      return `Error: ${state.error.message}`;
  }
}
```

### Event Types

```typescript
type AppEvent =
  | { type: 'USER_LOGIN'; userId: string }
  | { type: 'USER_LOGOUT'; userId: string }
  | { type: 'PAGE_VIEW'; path: string }
  | { type: 'CLICK'; elementId: string };

function handleEvent(event: AppEvent): void {
  switch (event.type) {
    case 'USER_LOGIN':
      console.log(`User ${event.userId} logged in`);
      break;
    case 'USER_LOGOUT':
      console.log(`User ${event.userId} logged out`);
      break;
    case 'PAGE_VIEW':
      console.log(`Page viewed: ${event.path}`);
      break;
    case 'CLICK':
      console.log(`Element clicked: ${event.elementId}`);
      break;
  }
}
```

### Form State

```typescript
type FormState<T> =
  | { status: 'pristine'; values: T }
  | { status: 'dirty'; values: T; touched: Set<keyof T> }
  | { status: 'submitting'; values: T }
  | { status: 'submitted'; values: T; result: unknown }
  | { status: 'error'; values: T; errors: Partial<Record<keyof T, string>> };
```
