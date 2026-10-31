---
name: react
description: This skill should be used when the user works with React components (.tsx/.jsx), asks about "hooks", "state management", "memo optimization", or discusses component composition.
user-invocable: false
allowed-tools: Read, Grep, Glob
activation:
  file-patterns:
    - "**/*.tsx"
    - "**/*.jsx"
  exclude:
    - "node_modules/**"
    - "**/*.test.*"
    - "**/*.spec.*"
---

# React Patterns

Sources in `references/sources.md`.

## Iron Law

> **COMPOSITION OVER PROPS** [2][4][12]
>
> Use children and compound components, not prop drilling. If a component has >5 props,
> it's doing too much. Split it. If you're passing data through 3+ levels, use context
> or composition. Props are for configuration, not data plumbing.
> "Before You memo(), try solving it with composition." — Dan Abramov [4]

## Component Structure

- Order a functional component: hooks → derived state → handlers → return.
- Share structure through compound components and `children` (`Card` with `Card.Header`), not props.
- Use context for shared state across distant components, at the level that needs it. Its hook throws outside the provider: `if (!ctx) throw new Error('useAuth must be used within AuthProvider')`.
- Use stable unique IDs as list keys, not the index.
- Put error boundaries around risky components, and handle loading and error states.
- Accessibility: `aria-*`, `role`, labels on form inputs.

## Hooks

Hooks must be called at the top level — never inside conditions, loops, or nested functions.
Effects synchronize with external systems; they are not lifecycle methods.
Every effect that subscribes must return a cleanup function. Deps must be complete — never omit to suppress warnings.

See `references/hooks.md` for rules of hooks, custom hooks, useReducer, and effect anti-patterns.

## Performance

The React Compiler handles many memoizations automatically. For manual optimization, follow this priority:

1. Composition first — "before you memo(), try passing children down"
2. Extract primitives for `useEffect` deps — avoid object/array literals
3. `useMemo` for expensive computations; `useCallback` for stable handlers to memoized children
4. `React.memo` only when parent has stable, memoized callbacks
5. Virtualize long lists (react-window); lazy-load heavy components

- Compute derived state during render with `useMemo`, not with `useState` + `useEffect`.
- Parallelize independent fetches: `await Promise.all([fetchUser(id), fetchOrders(id)])`.
- Use a `Set` or `Map` from `useMemo` for O(1) lookups, not `Array.find`/`includes` in render loops.
- Use direct named imports (tree-shakable), not barrel imports.
- Give images explicit dimensions, lazy loading, and aspect-ratio.

## State Architecture

| Pattern | When to Use |
|---------|-------------|
| `useState` | Simple, independent values |
| `useReducer` | Complex state with multiple transitions |
| Context | Shared state across distant components |
| Server Components | Server-only data; zero bundle impact |

Server Components render on the server and stream to the client — no `useEffect`
or API route required for data fetching.

## Extended References

- `references/sources.md` — Full bibliography
- `references/patterns.md` — Extended correct patterns with citations
- `references/violations.md` — Extended violation examples with citations
- `references/hooks.md` — Hook rules, custom hooks, useEffect deep-dive, utilities
- `references/forms.md` — Controlled/uncontrolled, validation, Server Actions
- `references/error-handling.md` — Error boundaries, Suspense, async error states
