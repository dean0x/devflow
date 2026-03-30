# TypeScript — Utility Types

Custom utility type patterns beyond the built-in `Partial`, `Pick`, `Omit` set.
See `sources.md` for full bibliography.

---

## Built-in Utility Types [1, Items 14–16][2]

| Type | Usage | Source |
|------|-------|--------|
| `Partial<T>` | All properties optional | [2] |
| `Required<T>` | All properties required | [2] |
| `Pick<T, K>` | Select properties | [2] |
| `Omit<T, K>` | Exclude properties | [2] |
| `Record<K, V>` | Object with key/value types | [2] |
| `Readonly<T>` | Immutable properties | [2] |
| `NonNullable<T>` | Remove null/undefined | [2] |
| `ReturnType<F>` | Function return type | [2] |
| `Parameters<F>` | Function parameter types | [2] |
| `InstanceType<C>` | Instance type of constructor | [2] |
| `Extract<T, U>` | Union members assignable to U | [2][19] |
| `Exclude<T, U>` | Union members not in U | [2][19] |

Use built-ins before reaching for custom types — they compose well [1, Item 15].

---

## Property Manipulation [6][19]

### Selective Modifiers

```typescript
// Make specific properties required — others stay as-is [6]
type RequiredProps<T, K extends keyof T> = T & Required<Pick<T, K>>;
type UserWithEmail = RequiredProps<Partial<User>, 'email'>;

// Make specific properties optional — others stay required [6]
type OptionalProps<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
type UserOptionalRole = OptionalProps<User, 'role'>;

// Remove readonly modifier with -readonly modifier [6]
type Mutable<T> = { -readonly [P in keyof T]: T[P] };

// Apply readonly to specific properties only
type ReadonlyProps<T, K extends keyof T> = Omit<T, K> & Readonly<Pick<T, K>>;
type UserReadonlyId = ReadonlyProps<User, 'id'>;
```

### Nullable Helpers [6]

```typescript
type Nullable<T> = T | null;
type Maybe<T> = T | null | undefined;

// Remove null/undefined from specific properties [6]
type NonNullableProps<T, K extends keyof T> = {
  [P in keyof T]: P extends K ? NonNullable<T[P]> : T[P];
};

interface ApiResponse { data: User | null; error: string | null; timestamp: number; }
type SuccessResponse = NonNullableProps<ApiResponse, 'data'>;
// { data: User; error: string | null; timestamp: number }
```

---

## Deep Transformations [6][19]

Recursive mapped types require TypeScript 4.1+ for correct distribution [8].

```typescript
// Deep partial — all nested properties optional [6]
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// Deep readonly — prevents mutation at any depth [6]
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

// Deep required — all nested properties required [6]
type DeepRequired<T> = {
  [P in keyof T]-?: T[P] extends object ? DeepRequired<T[P]> : T[P];
};

// Usage
interface Config {
  database: { host: string; port: number; credentials: { username: string; password: string } };
}

const config: DeepReadonly<Config> = {
  database: { host: 'localhost', port: 5432, credentials: { username: 'app', password: 'secret' } }
};
// config.database.host = 'other'; // Error: cannot assign to read only property
```

---

## Key Manipulation [6][19]

```typescript
// Get keys where value matches type V [6]
type KeysOfType<T, V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T];

interface User { id: string; name: string; age: number; active: boolean; }
type StringKeys = KeysOfType<User, string>; // 'id' | 'name'

// Pick properties by value type — key remapping with `as` clause [8]
type PickByType<T, V> = {
  [K in keyof T as T[K] extends V ? K : never]: T[K];
};
type StringProps = PickByType<User, string>; // { id: string; name: string }

// Omit by value type [6]
type OmitByType<T, V> = {
  [K in keyof T as T[K] extends V ? never : K]: T[K];
};
type NonStringProps = OmitByType<User, string>; // { age: number; active: boolean }
```

---

## Function Utilities [6][19]

```typescript
// Unwrap Promise return type via conditional infer [19]
type AsyncReturnType<T extends (...args: any[]) => Promise<any>> =
  T extends (...args: any[]) => Promise<infer R> ? R : never;

async function fetchUser(id: string): Promise<User> { ... }
type UserType = AsyncReturnType<typeof fetchUser>; // User

// First argument type [6]
type FirstArgument<T extends (...args: any[]) => any> =
  T extends (first: infer F, ...rest: any[]) => any ? F : never;

// Last argument type [6]
type LastArgument<T extends (...args: any[]) => any> =
  T extends (...args: [...any[], infer L]) => any ? L : never;
```

---

## Tuple Utilities [6][15]

Type-level tuple manipulation using variadic tuple types (TypeScript 4.0+) [8].

```typescript
type Head<T extends any[]> = T extends [infer H, ...any[]] ? H : never;
type Tail<T extends any[]> = T extends [any, ...infer R] ? R : never;
type Last<T extends any[]> = T extends [...any[], infer L] ? L : never;
type Init<T extends any[]> = T extends [...infer I, any] ? I : never;
type Concat<A extends any[], B extends any[]> = [...A, ...B];

type Tuple = [string, number, boolean];
type First = Head<Tuple>;  // string
type Rest  = Tail<Tuple>;  // [number, boolean]
type End   = Last<Tuple>;  // boolean
```

---

## String Utilities via Template Literal Types [8][20]

Template literal types (TypeScript 4.1) enable string-level type manipulation.

```typescript
// Split string type into tuple [20]
type Split<S extends string, D extends string> =
  S extends `${infer T}${D}${infer U}` ? [T, ...Split<U, D>] : [S];

type Parts = Split<'a.b.c', '.'>; // ['a', 'b', 'c']

// Join tuple back into string type [20]
type Join<T extends string[], D extends string> =
  T extends [] ? '' :
  T extends [infer F extends string] ? F :
  T extends [infer F extends string, ...infer R extends string[]] ? `${F}${D}${Join<R, D>}` :
  never;

type Joined = Join<['a', 'b', 'c'], '-'>; // 'a-b-c'

// Route parameter extraction [14]
type ExtractParams<Route extends string> =
  Route extends `${string}:${infer Param}/${infer Rest}`
    ? Param | ExtractParams<`/${Rest}`>
    : Route extends `${string}:${infer Param}`
    ? Param
    : never;

type UserParams = ExtractParams<'/users/:userId/posts/:postId'>;
// 'userId' | 'postId'
```

---

## Branded Types [1, Item 37][22]

Structural typing makes `UserId = string` and `OrderId = string` identical. Branded
types add nominal identity without runtime cost — a zero-overhead compile-time guard.

```typescript
declare const brand: unique symbol; // unique per declaration

type Brand<T, B> = T & { readonly [brand]: B };

type UserId  = Brand<string, 'UserId'>;
type OrderId = Brand<string, 'OrderId'>;
type Dollars = Brand<number, 'Dollars'>;
type Cents   = Brand<number, 'Cents'>;

// Smart constructors validate at entry point [25]
function userId(id: string): UserId {
  if (!id.match(/^usr_/)) throw new Error(`Invalid user ID: ${id}`);
  return id as UserId;
}

function dollars(amount: number): Dollars {
  if (amount < 0) throw new Error('Amount cannot be negative');
  return amount as Dollars;
}

// Usage — correct IDs cannot be mixed
function getUser(id: UserId): Promise<User> { ... }
function getOrder(id: OrderId): Promise<Order> { ... }

const uid = userId('usr_abc');
const oid = 'ord_xyz' as OrderId;

getUser(uid);  // OK
getUser(oid);  // Error: OrderId not assignable to UserId ✓
```

---

## Conditional Type Patterns [6][19]

```typescript
// Distributive conditional — applies to each union member [19]
type IsString<T> = T extends string ? true : false;
type Result = IsString<string | number>; // boolean (true | false distributed)

// infer with constraints (TypeScript 4.7+) [8]
type ElementType<T> = T extends (infer E)[] ? E : never;
type StrElement = ElementType<string[]>; // string

// Recursive conditional types [19]
type Flatten<T> = T extends Array<infer Item> ? Flatten<Item> : T;
type Deep = Flatten<string[][][]>; // string

// Awaited utility type (built-in since TypeScript 4.5) [8]
type Resolved = Awaited<Promise<Promise<string>>>; // string
```
