---
name: devflow-typescript
description: Automatically activate when working with .ts or .tsx files, or when TypeScript patterns are needed. Triggers on type safety questions, generic implementations, utility type usage, or type guard creation in TypeScript codebases.
allowed-tools: Read, Grep, Glob
---

# TypeScript Patterns

Reference for TypeScript-specific patterns, type safety, and idioms.

## When This Skill Activates

- Working with TypeScript codebases
- Designing type-safe APIs
- Using generics and utility types
- Creating type guards
- Handling strict mode requirements

---

## Type Safety Fundamentals

### Prefer Unknown Over Any

```typescript
// ❌ BAD: any disables type checking
function parse(json: string): any {
  return JSON.parse(json);
}

// ✅ GOOD: unknown requires type checking
function parse(json: string): unknown {
  return JSON.parse(json);
}

// Usage requires narrowing
const data = parse(input);
if (isUser(data)) {
  console.log(data.name); // Now type-safe
}
```

### Use Strict Null Checks

```typescript
// tsconfig.json: "strictNullChecks": true

// ❌ BAD: Assumes value exists
function getName(user: User | null): string {
  return user.name; // Error: user might be null
}

// ✅ GOOD: Handle null case
function getName(user: User | null): string {
  if (!user) {
    return 'Anonymous';
  }
  return user.name;
}

// ✅ ALSO GOOD: Optional chaining + nullish coalescing
function getName(user: User | null): string {
  return user?.name ?? 'Anonymous';
}
```

### Exhaustive Checks

```typescript
type Status = 'pending' | 'running' | 'completed' | 'failed';

function handleStatus(status: Status): string {
  switch (status) {
    case 'pending':
      return 'Waiting...';
    case 'running':
      return 'In progress...';
    case 'completed':
      return 'Done!';
    case 'failed':
      return 'Error occurred';
    default:
      // This ensures all cases are handled
      const _exhaustive: never = status;
      throw new Error(`Unhandled status: ${_exhaustive}`);
  }
}
```

---

## Generic Patterns

### Generic Functions

```typescript
// Basic generic function
function first<T>(items: T[]): T | undefined {
  return items[0];
}

// With constraints
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

// Multiple type parameters
function map<T, U>(items: T[], fn: (item: T) => U): U[] {
  return items.map(fn);
}

// Default type parameter
function createState<T = string>(initial: T): [T, (value: T) => void] {
  let state = initial;
  return [state, (value: T) => { state = value; }];
}
```

### Generic Interfaces

```typescript
// Generic result type
interface Result<T, E = Error> {
  ok: boolean;
  value?: T;
  error?: E;
}

// Generic repository
interface Repository<T, ID = string> {
  findById(id: ID): Promise<T | null>;
  findAll(): Promise<T[]>;
  save(entity: T): Promise<T>;
  delete(id: ID): Promise<void>;
}

// Generic with constraints
interface Identifiable {
  id: string;
}

interface CRUDRepository<T extends Identifiable> {
  findById(id: string): Promise<T | null>;
  save(entity: T): Promise<T>;
}
```

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
}

// Usage
const userCache = new Cache<User>();
userCache.set('user-1', user, 60000);
```

---

## Utility Types

### Built-in Utility Types

```typescript
interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  createdAt: Date;
}

// Partial - all properties optional
type UserUpdate = Partial<User>;
// { id?: string; name?: string; ... }

// Required - all properties required
type CompleteUser = Required<User>;

// Pick - select specific properties
type UserPreview = Pick<User, 'id' | 'name'>;
// { id: string; name: string }

// Omit - exclude properties
type CreateUser = Omit<User, 'id' | 'createdAt'>;
// { name: string; email: string; role: 'admin' | 'user' }

// Record - object with specific key/value types
type UserRoles = Record<string, 'admin' | 'user'>;
// { [key: string]: 'admin' | 'user' }

// Readonly - immutable
type ImmutableUser = Readonly<User>;

// Extract - extract matching types
type AdminOrUser = Extract<User['role'], 'admin' | 'user'>;
// 'admin' | 'user'

// Exclude - exclude matching types
type NotAdmin = Exclude<User['role'], 'admin'>;
// 'user'

// NonNullable - remove null and undefined
type DefinitelyUser = NonNullable<User | null | undefined>;
// User

// ReturnType - get function return type
type UserServiceReturn = ReturnType<typeof createUser>;

// Parameters - get function parameters
type UserServiceParams = Parameters<typeof createUser>;
```

### Custom Utility Types

```typescript
// Make specific properties required
type RequiredProps<T, K extends keyof T> = T & Required<Pick<T, K>>;
type UserWithEmail = RequiredProps<Partial<User>, 'email'>;

// Make specific properties optional
type OptionalProps<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
type UserWithOptionalRole = OptionalProps<User, 'role'>;

// Deep partial
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Deep readonly
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

// Nullable type
type Nullable<T> = T | null;

// Maybe type (nullable and optional)
type Maybe<T> = T | null | undefined;
```

---

## Type Guards

### typeof Guards

```typescript
function process(value: string | number): string {
  if (typeof value === 'string') {
    return value.toUpperCase(); // value is string here
  }
  return value.toFixed(2); // value is number here
}
```

### instanceof Guards

```typescript
class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

function handleError(error: unknown): void {
  if (error instanceof ApiError) {
    console.log(`API Error ${error.statusCode}: ${error.message}`);
  } else if (error instanceof Error) {
    console.log(`Error: ${error.message}`);
  } else {
    console.log('Unknown error');
  }
}
```

### Custom Type Guards

```typescript
// Type predicate with 'is'
interface User {
  type: 'user';
  name: string;
}

interface Admin {
  type: 'admin';
  name: string;
  permissions: string[];
}

type Person = User | Admin;

function isAdmin(person: Person): person is Admin {
  return person.type === 'admin';
}

function getPermissions(person: Person): string[] {
  if (isAdmin(person)) {
    return person.permissions; // TypeScript knows person is Admin
  }
  return [];
}
```

### Assertion Functions

```typescript
function assertDefined<T>(value: T | undefined, message: string): asserts value is T {
  if (value === undefined) {
    throw new Error(message);
  }
}

function assertNonNull<T>(value: T | null, message: string): asserts value is T {
  if (value === null) {
    throw new Error(message);
  }
}

// Usage
function processUser(user: User | undefined): void {
  assertDefined(user, 'User is required');
  console.log(user.name); // user is definitely defined here
}
```

---

## Discriminated Unions

### Basic Pattern

```typescript
// Tag each variant with a literal type
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function handleResult<T>(result: Result<T, Error>): T {
  if (result.ok) {
    return result.value; // TypeScript knows value exists
  }
  throw result.error; // TypeScript knows error exists
}
```

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

## Async Patterns

### Async Function Types

```typescript
// Async function type
type AsyncFn<T, R> = (arg: T) => Promise<R>;

// Async with result
type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

// Example usage
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
  timeoutMs: number
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    ),
  ]);
}
```

---

## Common Anti-Patterns

### ❌ Using `any`

```typescript
// BAD
function process(data: any) { ... }

// GOOD
function process(data: unknown) { ... }
function process<T>(data: T) { ... }
```

### ❌ Type Assertions Without Validation

```typescript
// BAD
const user = data as User;

// GOOD
if (isUser(data)) {
  const user = data; // Properly narrowed
}
```

### ❌ Non-Null Assertion Abuse

```typescript
// BAD
const name = user!.name!;

// GOOD
if (user?.name) {
  const name = user.name;
}
```

### ❌ Object Index Without Type Safety

```typescript
// BAD
const value = obj[key]; // any

// GOOD
const value = obj[key as keyof typeof obj];
// Or
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
```

---

## Checklist

- [ ] No `any` types (use `unknown` or generics)
- [ ] All null/undefined handled explicitly
- [ ] Discriminated unions for state/variants
- [ ] Type guards for runtime type checking
- [ ] Exhaustive switch statements
- [ ] Proper generic constraints
- [ ] Type-only imports for types
- [ ] Readonly for immutable data
- [ ] Strict tsconfig options enabled
