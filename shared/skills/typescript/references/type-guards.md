# TypeScript — Type Guards

Advanced type guard patterns for runtime type narrowing. These patterns bridge
the gap between TypeScript's compile-time types and JavaScript's runtime values.
See `sources.md` for full bibliography.

---

## Type Guard Fundamentals [2][1, Item 22]

TypeScript narrows types using **control flow analysis** — it tracks which branches
of code are reachable given the checks performed [2]. Type guards are functions that
return a type predicate (`value is Type`), extending this analysis to custom logic.

"A type guard is a way of informing TypeScript's type system about your runtime
knowledge." — TypeScript Handbook [2]

---

## Built-in Narrowing [2]

```typescript
// typeof narrows primitives
function process(value: string | number): string {
  if (typeof value === 'string') return value.toUpperCase();
  return value.toFixed(2);
}

// instanceof narrows class instances
function handleError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// in operator narrows object shapes
interface Admin { role: 'admin'; permissions: string[] }
interface User  { role: 'user' }
function isAdmin(person: Admin | User): person is Admin {
  return 'permissions' in person;
}

// Equality narrowing — literal types
function handleStatus(status: 'active' | 'inactive'): void {
  if (status === 'active') {
    // status: 'active' here
  }
}
```

---

## Custom Type Guards [2][6]

### Primitive Guards

```typescript
// Reusable, composable primitive guards [7]
const isString  = (v: unknown): v is string  => typeof v === 'string';
const isNumber  = (v: unknown): v is number  => typeof v === 'number' && !Number.isNaN(v);
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isNull    = (v: unknown): v is null    => v === null;
const isNullish = (v: unknown): v is null | undefined => v == null;
const isObject  = (v: unknown): v is object  => typeof v === 'object' && v !== null;
const isArray   = (v: unknown): v is unknown[] => Array.isArray(v);
const isFunction = (v: unknown): v is (...args: unknown[]) => unknown => typeof v === 'function';
```

### Object Shape Guards [6]

```typescript
// Check single property presence
function hasProperty<K extends string>(
  obj: unknown, key: K
): obj is { [P in K]: unknown } {
  return typeof obj === 'object' && obj !== null && key in obj;
}

// Check property presence AND type
function hasTypedProperty<K extends string, V>(
  obj: unknown, key: K, guard: (v: unknown) => v is V
): obj is { [P in K]: V } {
  return hasProperty(obj, key) && guard((obj as Record<K, unknown>)[key]);
}

// Check multiple properties at once
function hasProperties<K extends string>(
  obj: unknown, ...keys: K[]
): obj is { [P in K]: unknown } {
  return typeof obj === 'object' && obj !== null && keys.every(k => k in obj);
}

// Usage
function processData(data: unknown): void {
  if (hasProperty(data, 'id') && hasTypedProperty(data, 'name', isString)) {
    console.log(data.id, data.name.toUpperCase());
  }
}
```

### Discriminated Union Guards [1, Item 28][6]

```typescript
// Generic discriminant checker — uses Extract to narrow union [19]
function isVariant<T extends { type: string }, K extends T['type']>(
  obj: T, type: K
): obj is Extract<T, { type: K }> {
  return obj.type === type;
}

type Event =
  | { type: 'click';    x: number; y: number }
  | { type: 'keypress'; key: string }
  | { type: 'scroll';   offset: number };

function handleEvent(event: Event): void {
  if (isVariant(event, 'click')) {
    // event: { type: 'click'; x: number; y: number }
    console.log(`Clicked at ${event.x}, ${event.y}`);
  } else if (isVariant(event, 'keypress')) {
    console.log(`Key: ${event.key}`);
  }
}
```

### Array Guards [6]

```typescript
// Non-empty array — preserves tuple first-element type
function isNonEmpty<T>(arr: T[]): arr is [T, ...T[]] {
  return arr.length > 0;
}

// All elements match predicate — narrows element type
function allMatch<T, S extends T>(arr: T[], guard: (item: T) => item is S): arr is S[] {
  return arr.every(guard);
}

// Usage
const items: (string | number)[] = ['a', 'b', 'c'];
if (allMatch(items, isString)) {
  items.forEach(s => console.log(s.toUpperCase())); // items: string[]
}
```

---

## Assertion Functions [2]

Assertion functions use `asserts` in their return type. They throw on failure and
narrow the type for subsequent code — like a guard, but imperative [2].

```typescript
function assertDefined<T>(value: T | undefined, message: string): asserts value is T {
  if (value === undefined) throw new Error(message);
}

function assertExists<T>(value: T | null | undefined, message: string): asserts value is T {
  if (value == null) throw new Error(message);
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Usage — type narrows after assertion
function processUser(user: User | undefined): void {
  assertDefined(user, 'User is required');
  console.log(user.name); // user: User here
}
```

---

## Error Type Guards [1, Item 47]

`catch` clauses give `unknown` (correct since TypeScript 4.0 with `useUnknownInCatchVariables`).
These guards extract meaningful error information safely.

```typescript
function isErrorWithMessage(error: unknown): error is { message: string } {
  return (
    typeof error === 'object' && error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  );
}

function isErrorWithCode(error: unknown): error is { code: string | number } {
  return (
    typeof error === 'object' && error !== null &&
    'code' in error &&
    (typeof (error as { code: unknown }).code === 'string' ||
     typeof (error as { code: unknown }).code === 'number')
  );
}

// Usage
try {
  riskyOperation();
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message); // preferred — stdlib type
  } else if (isErrorWithMessage(error)) {
    console.error(error.message); // non-Error throwable with message
  }
  if (isErrorWithCode(error) && error.code === 'ENOENT') {
    console.error('File not found');
  }
}
```

---

## Composable Guards [6]

Guards are just functions — they compose with standard functional combinators.

```typescript
// Logical AND composition
function and<A, B extends A>(
  guardA: (v: unknown) => v is A, guardB: (v: A) => v is B
): (v: unknown) => v is B {
  return (v): v is B => guardA(v) && guardB(v);
}

// Logical OR composition
function or<A, B>(
  guardA: (v: unknown) => v is A, guardB: (v: unknown) => v is B
): (v: unknown) => v is A | B {
  return (v): v is A | B => guardA(v) || guardB(v);
}

// Negation
function not<T>(guard: (v: unknown) => v is T): (v: unknown) => v is Exclude<unknown, T> {
  return (v): v is Exclude<unknown, T> => !guard(v);
}

// Array element guard
function arrayOf<T>(guard: (v: unknown) => v is T): (v: unknown) => v is T[] {
  return (v): v is T[] => Array.isArray(v) && v.every(guard);
}

// Usage
const isStringOrNumber = or(isString, isNumber);
const isStringArray = arrayOf(isString);
const isNonNullObject = and(isObject, (v): v is Record<string, unknown> => true);
```

---

## API Response Guards [6]

```typescript
interface SuccessResponse<T> { status: 'success'; data: T }
interface ErrorResponse { status: 'error'; error: { code: string; message: string } }
type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

function isSuccess<T>(r: ApiResponse<T>): r is SuccessResponse<T> {
  return r.status === 'success';
}

function isError<T>(r: ApiResponse<T>): r is ErrorResponse {
  return r.status === 'error';
}

// Usage
async function fetchData<T>(url: string): Promise<Result<T, Error>> {
  const response: ApiResponse<T> = await fetch(url).then(r => r.json());
  if (isError(response)) {
    return { ok: false, error: new Error(response.error.message) };
  }
  return { ok: true, value: response.data };
}
```

---

## Schema-Backed Guards [12][25]

For complex shapes, prefer schema validation over hand-written guards. The schema IS the
guard — no drift between the check and the type [12][25].

```typescript
import { z } from 'zod';

const UserSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  email: z.string().email(),
});

type User = z.infer<typeof UserSchema>;

// Zod gives you the guard for free
function isUser(value: unknown): value is User {
  return UserSchema.safeParse(value).success;
}

// Or parse and get a typed result
function parseUser(value: unknown): Result<User, z.ZodError> {
  const result = UserSchema.safeParse(value);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: result.error };
}
```

---

## Guard Violations [2][6]

```typescript
// VIOLATION: Predicate doesn't match check [6]
function isString(value: unknown): value is string {
  return value !== null; // wrong — null passes, non-strings pass
}

// VIOLATION: Incomplete object guard — checks presence but not type [2]
function isUser(obj: unknown): obj is User {
  return typeof obj === 'object' && obj !== null && 'name' in obj;
  // Missing: name must be string, all required properties checked
}

// VIOLATION: instanceof for primitives [7]
function isNumber(value: unknown): value is number {
  return value instanceof Number; // fails for primitive 42
}

// VIOLATION: instanceof across realms [7]
function isArray(value: unknown): value is unknown[] {
  return value instanceof Array; // use Array.isArray() instead
}
```
