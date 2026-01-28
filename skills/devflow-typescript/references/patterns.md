# Extended TypeScript Patterns

Extended patterns and examples for TypeScript development.

## Generic Classes

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

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

// Usage
const userCache = new Cache<User>();
userCache.set('user-1', user, 60000);
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

## Discriminated Unions - Extended

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

---

## Generic Repository Pattern

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

---

## Builder Pattern with Types

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
