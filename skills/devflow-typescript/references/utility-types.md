# Custom Utility Types

Extended utility type patterns for TypeScript.

## Property Manipulation

### RequiredProps / OptionalProps

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

---

## Deep Transformations

### DeepPartial

```typescript
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
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
  cache: {
    enabled: boolean;
    ttl: number;
  };
}

type PartialConfig = DeepPartial<Config>;
// All nested properties become optional
```

### DeepReadonly

```typescript
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

// Prevents mutation at any depth
const config: DeepReadonly<Config> = { ... };
config.database.host = 'new';  // Error: Cannot assign to readonly property
```

### DeepRequired

```typescript
type DeepRequired<T> = {
  [P in keyof T]-?: T[P] extends object ? DeepRequired<T[P]> : T[P];
};
```

---

## Nullable Helpers

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

---

## Key Manipulation

### KeysOfType

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

type StringKeys = KeysOfType<User, string>;  // 'id' | 'name'
type NumberKeys = KeysOfType<User, number>;  // 'age'
type BooleanKeys = KeysOfType<User, boolean>;  // 'active'
```

### PickByType

```typescript
// Pick properties by value type
type PickByType<T, V> = {
  [K in keyof T as T[K] extends V ? K : never]: T[K];
};

type StringProps = PickByType<User, string>;
// { id: string; name: string }
```

### OmitByType

```typescript
// Omit properties by value type
type OmitByType<T, V> = {
  [K in keyof T as T[K] extends V ? never : K]: T[K];
};

type NonStringProps = OmitByType<User, string>;
// { age: number; active: boolean }
```

---

## Function Utilities

### AsyncReturnType

```typescript
// Get return type of async function (unwraps Promise)
type AsyncReturnType<T extends (...args: any[]) => Promise<any>> =
  T extends (...args: any[]) => Promise<infer R> ? R : never;

async function fetchUser(id: string): Promise<User> { ... }
type UserType = AsyncReturnType<typeof fetchUser>;  // User
```

### FirstArgument / LastArgument

```typescript
// Get first argument type
type FirstArgument<T extends (...args: any[]) => any> =
  T extends (first: infer F, ...rest: any[]) => any ? F : never;

// Get last argument type
type LastArgument<T extends (...args: any[]) => any> =
  T extends (...args: [...any[], infer L]) => any ? L : never;
```

---

## Tuple Utilities

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

// Length
type Length<T extends any[]> = T['length'];

// Usage
type Tuple = [string, number, boolean];
type First = Head<Tuple>;   // string
type Rest = Tail<Tuple>;    // [number, boolean]
type End = Last<Tuple>;     // boolean
```

---

## String Utilities

```typescript
// Capitalize first letter
type Capitalize<S extends string> = S extends `${infer F}${infer R}`
  ? `${Uppercase<F>}${R}`
  : S;

// Uncapitalize first letter
type Uncapitalize<S extends string> = S extends `${infer F}${infer R}`
  ? `${Lowercase<F>}${R}`
  : S;

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
type Parts = Split<'a.b.c', '.'>;  // ['a', 'b', 'c']
type Joined = Join<['a', 'b', 'c'], '-'>;  // 'a-b-c'
```

---

## Object Path Types

```typescript
// Get nested property type by path
type PathValue<T, P extends string> =
  P extends `${infer K}.${infer Rest}`
    ? K extends keyof T
      ? PathValue<T[K], Rest>
      : never
    : P extends keyof T
      ? T[P]
      : never;

interface Config {
  database: {
    connection: {
      host: string;
      port: number;
    };
  };
}

type Host = PathValue<Config, 'database.connection.host'>;  // string
type Port = PathValue<Config, 'database.connection.port'>;  // number
```

---

## Branded Types

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

## Exhaustive Check Helper

```typescript
// Ensures all union cases are handled
function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unexpected value: ${value}`);
}

// Usage in switch
type Status = 'pending' | 'active' | 'completed';

function handleStatus(status: Status): string {
  switch (status) {
    case 'pending':
      return 'Waiting';
    case 'active':
      return 'Running';
    case 'completed':
      return 'Done';
    default:
      return assertNever(status);  // Compile error if case missing
  }
}
```
