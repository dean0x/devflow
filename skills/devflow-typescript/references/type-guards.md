# Advanced Type Guard Patterns

Extended type guard examples for TypeScript.

## Assertion Functions

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
  console.log(user.name); // user is definitely defined here
}
```

---

## Array Type Guards

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

// Check if any element matches predicate
function someMatch<T, S extends T>(
  arr: T[],
  guard: (item: T) => item is S
): boolean {
  return arr.some(guard);
}

// Usage
const items: (string | number)[] = ['a', 'b', 'c'];

if (allMatch(items, (x): x is string => typeof x === 'string')) {
  // items is string[] here
  items.forEach(s => console.log(s.toUpperCase()));
}
```

---

## Object Shape Guards

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

---

## Discriminated Union Guards

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

---

## Primitive Type Guards

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

---

## Schema-Based Guards

```typescript
// Define schema shape
interface Schema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
}

// Create type guard from schema
function createGuard<T>(schema: Schema): (value: unknown) => value is T {
  return (value: unknown): value is T => {
    return validateSchema(value, schema);
  };
}

function validateSchema(value: unknown, schema: Schema): boolean {
  switch (schema.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value) &&
        (!schema.items || value.every(v => validateSchema(v, schema.items!)));
    case 'object':
      if (typeof value !== 'object' || value === null) return false;
      const obj = value as Record<string, unknown>;
      const required = schema.required ?? [];
      if (!required.every(key => key in obj)) return false;
      if (!schema.properties) return true;
      return Object.entries(schema.properties).every(
        ([key, propSchema]) => !(key in obj) || validateSchema(obj[key], propSchema)
      );
    default:
      return false;
  }
}

// Usage
const userSchema: Schema = {
  type: 'object',
  required: ['id', 'name'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    age: { type: 'number' }
  }
};

const isUser = createGuard<User>(userSchema);

if (isUser(data)) {
  console.log(data.name);
}
```

---

## Composable Guards

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

// Negate a guard
function not<T>(
  guard: (v: unknown) => v is T
): (v: unknown) => boolean {
  return (v: unknown): boolean => !guard(v);
}

// Usage
const isStringOrNumber = or(isString, isNumber);
const isNonNullObject = and(isObject, (v): v is object => v !== null);
```

---

## Error Type Guards

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

// Check for specific error class
function isInstanceOf<T>(
  cls: new (...args: any[]) => T
): (error: unknown) => error is T {
  return (error: unknown): error is T => error instanceof cls;
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

---

## API Response Guards

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
