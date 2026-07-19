---
name: react
description: This skill should be used when the user works with React components (.tsx/.jsx), asks about "hooks", "state management", "context providers", "memo optimization", "useEffect", or discusses component composition and rendering performance. Provides patterns for hooks, state, effects, memoization, and React-specific architecture.
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

Reference for React-specific patterns with citations. Sources in `references/sources.md`.

## Iron Law

> **COMPOSITION OVER PROPS** [2][4][12]
>
> Use children and compound components, not prop drilling. If a component has >5 props,
> it's doing too much. Split it. If you're passing data through 3+ levels, use context
> or composition. Props are for configuration, not data plumbing.
> "Before You memo(), try solving it with composition." — Dan Abramov [4]

## When This Skill Activates

- Working with React codebases (.tsx, .jsx) — components, hooks, contexts, performance

---

## Component Structure [1][2]

**Functional component order**: hooks → derived state → handlers → return. [1]

**Compound components** share structure through children, not props: [2][4]

```tsx
function Card({ children }: { children: React.ReactNode }) {
  return <div className="card">{children}</div>;
}
Card.Header = ({ children }: { children: React.ReactNode }) =>
  <div className="card-header">{children}</div>;
```

**Context** for shared state across distant components — eliminates prop drilling: [1][2]

```tsx
const AuthContext = createContext<AuthContextValue | null>(null);
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

---

## Hooks [3][16][24]

Hooks must be called at the **top level** — never inside conditions, loops, or nested functions. [16][24]
Effects synchronize with external systems; they are not lifecycle methods. [3]
Every effect that subscribes must return a cleanup function. Deps must be complete — never omit to suppress warnings. [3]

See `references/hooks.md` for rules of hooks, custom hooks, useReducer, and effect anti-patterns.

---

## Performance [3][4][5][17]

The React Compiler (2024) handles many memoizations automatically [17]. For manual
optimization, follow this priority: [4]

1. **Composition first** — "before you memo(), try passing children down" [4]
2. **Extract primitives** for `useEffect` deps — avoid object/array literals [3]
3. **`useMemo`** for expensive computations; **`useCallback`** for stable handlers [3]
4. **`React.memo`** only when parent has stable, memoized callbacks [4]
5. **Virtualize** long lists (react-window) [5]; **lazy-load** heavy components [5]

```tsx
const [user, orders] = await Promise.all([fetchUser(id), fetchOrders(id)]); // parallel [1]
const filtered = useMemo(() => users.filter(u => u.name.includes(q)), [users, q]); // derived [13]
const selectedSet = useMemo(() => new Set(selected), [selected]); // O(1) lookup [5]
```

---

## State Architecture [1][14]

| Pattern | When to Use | Source |
|---------|-------------|--------|
| `useState` | Simple, independent values | [1] |
| `useReducer` | Complex state with multiple transitions | [14] |
| Context | Shared state across distant components | [1][2] |
| Server Components | Server-only data; zero bundle impact | [6][7] |

Server Components render on the server and stream to the client — no `useEffect`
or API route required for data fetching. [6][7]

---

## Key Anti-Patterns [3][13]

| Anti-Pattern | Correct Approach | Source |
|-------------|-----------------|--------|
| Derived state in `useState` + `useEffect` | Compute with `useMemo` during render | [13] |
| Object/array literal in `useEffect` deps | Extract to primitives | [3] |
| Missing cleanup in `useEffect` | Always return cleanup function | [3] |
| Prop drilling (3+ levels) | Context or composition | [2][4] |
| Barrel imports | Direct named imports (tree-shakable) | [5] |
| `Array.find`/`includes` in render loops | `Map`/`Set` via `useMemo` | [5] |
| Index as list key | Use stable unique IDs | [1] |

---

## Extended References

- `references/sources.md` — Full bibliography (24 sources)
- `references/patterns.md` — Extended correct patterns with citations
- `references/violations.md` — Extended violation examples with citations
- `references/hooks.md` — Hook rules, custom hooks, useEffect deep-dive, utilities
- `references/forms.md` — Controlled/uncontrolled, validation, Server Actions
- `references/error-handling.md` — Error boundaries, Suspense, async error states

---

## Checklist

- [ ] Hooks at top level — no conditions or loops [16][24]
- [ ] All `useEffect` deps included; cleanup returned [3]
- [ ] `useCallback` for handlers to memoized children; `useMemo` for expensive values [4]
- [ ] Context at appropriate level — no prop drilling [2]
- [ ] Error boundaries around risky components [1]
- [ ] Unique stable keys on list items — not index [1]
- [ ] Loading and error states handled [13]
- [ ] Accessibility: `aria-*`, `role`, labels on form inputs [21][22]
- [ ] Independent fetches parallelized with `Promise.all` [1]
- [ ] Direct imports — no barrel imports; lazy-load heavy components [5]
- [ ] `Set`/`Map` for O(1) lookups instead of `Array.includes`/`find` [5]
- [ ] Images have explicit dimensions, lazy loading, and aspect-ratio [23]
