---
name: typescript
description: This skill should be used when the user works with TypeScript files (.ts/.tsx), asks about "generics", "type guards", "utility types", "strict typing", "discriminated unions", or discusses type safety and inference. Provides patterns for Result types, exhaustive checks, branded types, and type-safe API contracts.
user-invocable: false
allowed-tools: Read, Grep, Glob
activation:
  file-patterns:
    - "**/*.ts"
    - "**/*.tsx"
  exclude:
    - "node_modules/**"
    - "**/*.d.ts"
---

# TypeScript Patterns

## Iron Law

> **UNKNOWN OVER ANY**
>
> Never use `any`. Use `unknown` with type guards instead. `any` disables TypeScript's
> entire value proposition — if you need flexibility, use generics; if you need to handle
> arbitrary data, use `unknown` and validate. `any` is giving up. [1, Item 43]

## When This Skill Activates

- Working with TypeScript codebases or designing type-safe APIs
- Using generics, type guards, branded types, or conditional types

---

## Type Safety Fundamentals

### Prefer Unknown Over Any [1, Item 43]

Types are sets of values [1, Item 7]. `any` opts out entirely; `unknown` forces narrowing.

```typescript
// BAD: disables all type checking [4][17]
function parse(json: string): any { return JSON.parse(json); }
// GOOD: unknown forces narrowing before use [1, Item 43]
function parse(json: string): unknown { return JSON.parse(json); }
if (isUser(data)) console.log(data.name); // type-safe after guard
```

### Exhaustive Checks [1, Item 33][13]

```typescript
type Status = 'pending' | 'running' | 'completed' | 'failed';
function handleStatus(status: Status): string {
  switch (status) {
    case 'pending': return 'Waiting...';
    case 'running': return 'In progress...';
    case 'completed': return 'Done!';
    case 'failed': return 'Error occurred';
    default: const _: never = status; throw new Error(`Unhandled: ${_}`);
  }
}
```

---

## Generic Patterns [2][6]

```typescript
function first<T>(items: T[]): T | undefined { return items[0]; }
// Constrained key access [1, Item 54]
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] { return obj[key]; }
interface Repository<T, ID = string> { findById(id: ID): Promise<T | null>; save(entity: T): Promise<T>; }
```

---

## Discriminated Unions [1, Item 28][24]

Make illegal states unrepresentable — encode variants in the type [24].

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
type RequestState<T> =
  | { status: 'idle' } | { status: 'loading' }
  | { status: 'success'; data: T } | { status: 'error'; error: Error };
```

---

## Branded Types [1, Item 37][22]

Structural typing treats `UserId` and `OrderId` (both `string`) as identical.
Brands add nominal distinction with zero runtime cost.

```typescript
declare const brand: unique symbol;
type Brand<T, B> = T & { [brand]: B };
type UserId  = Brand<string, 'UserId'>;
type OrderId = Brand<string, 'OrderId'>;

function getUser(id: UserId): User { ... }
// getUser(orderId) → Error: OrderId not assignable to UserId
```

---

## Conditional & Mapped Types [2][19]

```typescript
// Unwrap Promise return type via infer [19]
type AsyncReturnType<T extends (...args: any[]) => Promise<any>> =
  T extends (...args: any[]) => Promise<infer R> ? R : never;
// Pick by value type — key remapping with `as` [6][8]
type PickByType<T, V> = { [K in keyof T as T[K] extends V ? K : never]: T[K] };
// Recursive deep readonly [6]
type DeepReadonly<T> = { readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P] };
```

---

## Anti-Patterns

| Bad | Good | Source |
|-----|------|--------|
| `data: any` | `data: unknown` + guard | [1, Item 43] |
| `data as User` | `if (isUser(data))` | [1, Item 9] |
| `user!.name!` | `user?.name ?? default` | [4] |
| `default: 'unknown'` | `const _: never = x` | [1, Item 33] |
| two IDs as `string` | branded types | [1, Item 37] |

---

## Extended References

- `references/sources.md` — Full bibliography [25 sources]
- `references/patterns.md` — Extended patterns with citations
- `references/violations.md` — Violation examples with citations
- `references/utility-types.md` — Utility types, branded types, template literals [6][15]
- `references/type-guards.md` — Advanced type guard patterns [2][6]
- `references/async.md` — Async TypeScript patterns [1, Item 25]

---

## Checklist

- [ ] No `any` types — `unknown` or generics [1, Item 43]
- [ ] Null/undefined handled explicitly [4]
- [ ] Discriminated unions for state variants [1, Item 28]
- [ ] Type guards narrow at runtime [2]
- [ ] Exhaustive switch with `never` [1, Item 33]
- [ ] Branded types for IDs and amounts [1, Item 37]
- [ ] Type-only imports (`import type`) [4]
- [ ] Strict tsconfig: `strict`, `noUncheckedIndexedAccess` [16]
