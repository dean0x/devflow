---
name: typescript
description: This skill should be used when the user works with TypeScript files (.ts/.tsx), asks about "generics", "type guards", "utility types", "discriminated unions", or discusses type safety.
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

> **Unknown over any**
>
> Never use `any`. Use `unknown` with type guards instead. `any` disables TypeScript's
> entire value proposition — if you need flexibility, use generics; if you need to handle
> arbitrary data, use `unknown` and validate. `any` is giving up.

## Type Safety

- Return `unknown` from untyped sources (`JSON.parse`), then narrow with a type guard (`if (isUser(data))`), not a cast (`data as User`).
- Handle null and undefined explicitly: `user?.name ?? fallback`, not `user!.name!`.
- End a switch over a union with an exhaustive check, `default: const _: never = status;`, not `default: 'unknown'`.
- Use type-only imports (`import type`).
- Use a strict tsconfig: `strict`, `noUncheckedIndexedAccess`.

## Generic Patterns

- Use generics for flexibility: `first<T>(items: T[]): T | undefined`.
- Constrain key access: `getProperty<T, K extends keyof T>(obj: T, key: K): T[K]`.
- Give a generic interface a default parameter: `Repository<T, ID = string>`.

## Discriminated Unions

Make illegal states unrepresentable: encode each variant in the type, for results and request states.

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

## Branded Types

Structural typing treats `UserId` and `OrderId` (both `string`) as identical.
Brand IDs and amounts for nominal distinction with zero runtime cost.

```typescript
declare const brand: unique symbol;
type Brand<T, B> = T & { [brand]: B };
type UserId = Brand<string, 'UserId'>; // getUser(orderId) is a compile error
```

## Conditional & Mapped Types

- Unwrap with `infer`: `T extends (...args: any[]) => Promise<infer R> ? R : never`.
- Remap keys with `as`: `{ [K in keyof T as T[K] extends V ? K : never]: T[K] }`.
- Recurse for deep forms: `DeepReadonly<T> = { readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P] }`.

## Extended References

- `references/sources.md` — Full bibliography
- `references/patterns.md` — Extended patterns with citations
- `references/violations.md` — Violation examples with citations
- `references/utility-types.md` — Utility types, branded types, template literals
- `references/type-guards.md` — Advanced type guard patterns
- `references/async.md` — Async TypeScript patterns
