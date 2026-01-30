---
name: typescript
description: TypeScript patterns. Use when user works with .ts/.tsx files, asks about "generics", "type guards", "utility types", or type safety.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# TypeScript Patterns

Reference for TypeScript-specific patterns, type safety, and idioms.

## Iron Law

> **UNKNOWN OVER ANY**
>
> Never use `any`. Use `unknown` with type guards instead. `any` disables TypeScript's
> entire value proposition. If you need flexibility, use generics. If you need to handle
> arbitrary data, use `unknown` and validate. `any` is giving up.

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
// BAD: function parse(json: string): any { return JSON.parse(json); }

// GOOD: unknown requires type checking
function parse(json: string): unknown { return JSON.parse(json); }
if (isUser(data)) console.log(data.name); // Type-safe after guard
```

### Strict Null Checks

```typescript
// BAD: function getName(user: User | null): string { return user.name; }
// GOOD: function getName(user: User | null): string { return user?.name ?? 'Anonymous'; }
```

### Exhaustive Checks

```typescript
type Status = 'pending' | 'running' | 'completed' | 'failed';
function handleStatus(status: Status): string {
  switch (status) {
    case 'pending': return 'Waiting...';
    case 'running': return 'In progress...';
    case 'completed': return 'Done!';
    case 'failed': return 'Error occurred';
    default:
      const _exhaustive: never = status;
      throw new Error(`Unhandled: ${_exhaustive}`);
  }
}
```

---

## Generic Patterns

```typescript
// Basic generic function
function first<T>(items: T[]): T | undefined { return items[0]; }

// With constraints
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] { return obj[key]; }

// Generic interface
interface Repository<T, ID = string> {
  findById(id: ID): Promise<T | null>;
  save(entity: T): Promise<T>;
}
```

---

## Utility Types

| Type | Usage |
|------|-------|
| `Partial<T>` | All properties optional |
| `Required<T>` | All properties required |
| `Pick<T, K>` | Select specific properties |
| `Omit<T, K>` | Exclude properties |
| `Record<K, V>` | Object with key/value types |
| `Readonly<T>` | Immutable properties |
| `NonNullable<T>` | Remove null/undefined |
| `ReturnType<F>` | Function return type |
| `Parameters<F>` | Function parameter types |

---

## Type Guards

```typescript
// typeof guard
function process(value: string | number): string {
  if (typeof value === 'string') return value.toUpperCase();
  return value.toFixed(2);
}

// Custom type guard
interface Admin { type: 'admin'; permissions: string[]; }
interface User { type: 'user'; }
type Person = User | Admin;

function isAdmin(person: Person): person is Admin {
  return person.type === 'admin';
}
```

---

## Discriminated Unions

```typescript
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function handleResult<T>(result: Result<T, Error>): T {
  if (result.ok) return result.value;
  throw result.error;
}
```

---

## Anti-Patterns

| Pattern | Bad | Good |
|---------|-----|------|
| Using `any` | `data: any` | `data: unknown` or generics |
| Unsafe assertion | `data as User` | Type guard: `if (isUser(data))` |
| Non-null abuse | `user!.name!` | `user?.name` with check |
| Unsafe index | `obj[key]` | `obj[key as keyof typeof obj]` |

---

## Extended References

For additional patterns and examples:
- `references/patterns.md` - Extended TypeScript patterns
- `references/utility-types.md` - Custom utility type examples
- `references/type-guards.md` - Advanced type guard patterns
- `references/async.md` - Async TypeScript patterns

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
