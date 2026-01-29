# TypeScript Violation Examples

Extended violation patterns for TypeScript reviews. Reference from main SKILL.md.

## Type Safety Violations

### Using `any` Type

**Direct any usage**
```typescript
// VIOLATION: any disables type checking
function parse(json: string): any {
  return JSON.parse(json);
}

// VIOLATION: any parameter
function process(data: any) {
  console.log(data.name);  // No type safety
}

// VIOLATION: any in generics
function wrap<T = any>(value: T) {
  return { value };
}
```

**Implicit any**
```typescript
// VIOLATION: Implicit any on parameter
function greet(name) {  // name is implicitly any
  return `Hello, ${name}`;
}

// VIOLATION: Implicit any in catch
try {
  riskyOperation();
} catch (e) {  // e is any
  console.log(e.message);
}
```

### Type Assertions Without Validation

**Unsafe casts**
```typescript
// VIOLATION: Casting without checking
const user = data as User;  // data could be anything
user.name.toUpperCase();    // Runtime error if data is wrong

// VIOLATION: Double assertion bypass
const value = data as unknown as SpecificType;  // Bypasses type checking

// VIOLATION: Non-null assertion on nullable
function getName(user: User | null): string {
  return user!.name;  // Will crash if user is null
}
```

**Object index without type safety**
```typescript
// VIOLATION: Accessing unknown keys
const value = obj[key];  // value is any

// VIOLATION: No validation on dynamic access
function getField(obj: object, field: string) {
  return (obj as any)[field];  // Unsafe dynamic access
}
```

### Non-Exhaustive Pattern Matching

**Missing switch cases**
```typescript
type Status = 'pending' | 'active' | 'completed' | 'failed';

// VIOLATION: Non-exhaustive switch
function handleStatus(status: Status): string {
  switch (status) {
    case 'pending':
      return 'Waiting';
    case 'active':
      return 'Running';
    // Missing: 'completed' and 'failed'
  }
  return 'Unknown';  // Hides missing cases
}
```

**Incomplete discriminated union handling**
```typescript
type Result<T> = { ok: true; value: T } | { ok: false; error: Error };

// VIOLATION: Only handling success
function process<T>(result: Result<T>): T {
  if (result.ok) {
    return result.value;
  }
  // Missing error handling - TypeScript won't catch this without strictness
}
```

---

## Type Guard Violations

### Missing Type Narrowing

**Trusting unvalidated input**
```typescript
// VIOLATION: No runtime validation
function processUser(data: unknown) {
  const user = data as User;  // Assumes data is User
  console.log(user.name);     // Runtime error if not User
}

// VIOLATION: Checking only one property
function isUser(obj: unknown): obj is User {
  return typeof obj === 'object' && obj !== null && 'name' in obj;
  // Missing: doesn't check 'name' is string, or other required properties
}
```

**Incorrect type predicate**
```typescript
// VIOLATION: Predicate doesn't match check
function isString(value: unknown): value is string {
  return value !== null;  // Wrong check - doesn't verify it's a string!
}

// VIOLATION: Predicate allows invalid state
function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number';  // Doesn't check positive
}
```

### Unsafe instanceof Usage

**instanceof with primitives**
```typescript
// VIOLATION: instanceof doesn't work with primitives
function isNumber(value: unknown): value is number {
  return value instanceof Number;  // Fails for primitive numbers!
}

// VIOLATION: Cross-realm instanceof issues
function isArray(value: unknown): value is unknown[] {
  return value instanceof Array;  // Fails across iframes/realms
}
```

### Missing Null Checks

**Trusting optional properties**
```typescript
// VIOLATION: No null check on optional
interface Config {
  timeout?: number;
}

function getTimeout(config: Config): number {
  return config.timeout * 1000;  // Error: possibly undefined
}

// VIOLATION: Chained optional access without handling
function getCity(user: User): string {
  return user.address.city;  // Error if address is undefined
}
```

---

## Utility Type Violations

### Manual Type Manipulation

**Rewriting built-in utility types**
```typescript
// VIOLATION: Reinventing Partial<T>
type MyPartial<T> = {
  [P in keyof T]?: T[P];
};

// VIOLATION: Reinventing Pick<T, K>
type MyPick<T, K extends keyof T> = {
  [P in K]: T[P];
};

// VIOLATION: Manual readonly mapping
type MyReadonly<T> = {
  readonly [P in keyof T]: T[P];
};
```

**Redundant type definitions**
```typescript
// VIOLATION: Duplicating existing type
interface CreateUserInput {
  name: string;
  email: string;
}

interface UpdateUserInput {  // Nearly identical to CreateUserInput
  name?: string;
  email?: string;
}

// Should use: type UpdateUserInput = Partial<CreateUserInput>
```

### Incorrect Generic Constraints

**Missing constraints**
```typescript
// VIOLATION: No constraint on key access
function getProperty<T, K>(obj: T, key: K) {
  return obj[key];  // Error: K is not constrained to keyof T
}

// VIOLATION: Unconstrained generic with method call
function callToString<T>(value: T): string {
  return value.toString();  // Works but loses type info
}
```

**Over-constrained generics**
```typescript
// VIOLATION: Constraint too narrow
function merge<T extends { id: string }>(a: T, b: T): T {
  return { ...a, ...b };
}
// Can't merge objects without 'id' property even when not needed
```

### Improper Mapped Types

**Losing optional/readonly modifiers**
```typescript
// VIOLATION: Removes optionality
type Transformed<T> = {
  [P in keyof T]: string;  // Loses optional modifiers from T
};

// VIOLATION: Loses readonly
type Mutable<T> = {
  [P in keyof T]: T[P];  // Doesn't remove readonly, just copies
};
```

---

## Async Pattern Violations

### Unhandled Promises

**Fire-and-forget async calls**
```typescript
// VIOLATION: Promise ignored
async function processData() {
  saveToDatabase(data);  // No await, no .catch()
  console.log('Saved!'); // Lies - may not be saved
}

// VIOLATION: forEach with async
ids.forEach(async (id) => {
  await processItem(id);  // forEach doesn't wait!
});
// Code continues before any processing completes
```

**Missing error handling**
```typescript
// VIOLATION: No catch on promise
async function loadUser(id: string): Promise<User> {
  const response = await fetch(`/api/users/${id}`);
  return response.json();  // No error handling for fetch failure
}

// VIOLATION: catch swallows error
async function process() {
  try {
    await riskyOperation();
  } catch (e) {
    console.log('Error');  // Error details lost
  }
}
```

### Race Conditions

**Stale closure**
```typescript
// VIOLATION: Closure captures stale value
function createCounter() {
  let count = 0;

  return async () => {
    count++;
    await delay(100);
    console.log(count);  // May not be the expected value
  };
}
// Multiple calls will all log the same final value
```

**Uncancelled previous requests**
```typescript
// VIOLATION: Race condition with sequential requests
class DataLoader {
  async load(id: string) {
    const data = await fetch(`/api/${id}`);
    this.data = await data.json();  // Older slow request may overwrite newer fast one
  }
}
```

### Improper Async Iteration

**await in loop when parallel is safe**
```typescript
// VIOLATION: Sequential when parallel is possible
async function processAll(items: Item[]) {
  const results = [];
  for (const item of items) {
    results.push(await process(item));  // Unnecessarily sequential
  }
  return results;
}

// VIOLATION: Blocking Promise.all with unbounded concurrency
async function processAll(items: Item[]) {
  return Promise.all(items.map(item => fetchData(item)));
  // Could overwhelm server with 1000s of concurrent requests
}
```

**Mixing async patterns**
```typescript
// VIOLATION: Callback inside async function
async function getData() {
  fs.readFile('data.json', (err, data) => {
    return JSON.parse(data);  // This return does nothing!
  });
}

// VIOLATION: Not returning promise in .then()
fetchData()
  .then(data => {
    processAsync(data);  // Should return this promise
  })
  .then(() => {
    console.log('Done');  // Runs before processAsync completes
  });
```

### Improper Promise Construction

**Promise constructor anti-pattern**
```typescript
// VIOLATION: Wrapping async in Promise constructor
function fetchData(): Promise<Data> {
  return new Promise(async (resolve, reject) => {
    const data = await fetch('/api/data');
    resolve(data);
  });
  // Async executor is an anti-pattern - errors won't be caught properly
}

// VIOLATION: Unnecessary Promise wrapping
function getValue(): Promise<number> {
  return new Promise((resolve) => {
    resolve(42);  // Just return Promise.resolve(42)
  });
}
```

**Missing rejection handling**
```typescript
// VIOLATION: Unhandled rejection in Promise.all
async function loadAll(ids: string[]) {
  const results = await Promise.all(ids.map(id => fetch(`/api/${id}`)));
  return results;
  // One failure rejects entire batch, no partial results
}
```

---

## Module Violations

### Circular Dependencies

**Direct circular import**
```typescript
// a.ts
import { B } from './b';
export class A { b = new B(); }

// b.ts
import { A } from './a';  // Circular!
export class B { a = new A(); }
```

**Export-time side effects**
```typescript
// VIOLATION: Code runs on import
export const config = loadConfig();  // Runs when imported

// VIOLATION: Initializing singletons at module level
export const db = new Database(connectionString);  // Can't be tested
```

### Import Anti-patterns

**Importing everything**
```typescript
// VIOLATION: Import entire module
import * as utils from './utils';
utils.formatDate(date);  // No tree-shaking

// VIOLATION: Re-exporting with namespace
export * as helpers from './helpers';  // Harder to trace dependencies
```

**Dynamic import abuse**
```typescript
// VIOLATION: Dynamic import with variable path
const module = await import(modulePath);  // Not statically analyzable

// VIOLATION: Conditional static import
if (condition) {
  import { feature } from './feature';  // Syntax error - can't use in block
}
```
