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

Reference for React-specific patterns, component design, hooks, and performance optimization.

## Iron Law

> **COMPOSITION OVER PROPS**
>
> Use children and compound components, not prop drilling. If a component has >5 props,
> it's doing too much. Split it. If you're passing data through 3+ levels, use context
> or composition. Props are for configuration, not data plumbing.

## When This Skill Activates

- Working with React codebases
- Creating components and hooks
- Managing state and side effects
- Optimizing render performance

---

## Component Patterns

### Functional Component Structure

```tsx
export function UserCard({ user, className }: UserCardProps) {
  const [isExpanded, setIsExpanded] = useState(false); // 1. Hooks first
  const displayName = user.firstName + ' ' + user.lastName; // 2. Derived state
  const handleToggle = () => setIsExpanded((prev) => !prev); // 3. Handlers
  return ( // 4. Render
    <div className={cn('user-card', className)}>
      <h3>{displayName}</h3>
      {isExpanded && <UserDetails user={user} />}
      <button onClick={handleToggle}>{isExpanded ? 'Collapse' : 'Expand'}</button>
    </div>
  );
}
```

### Composition Over Props

```tsx
function Card({ children }: { children: React.ReactNode }) {
  return <div className="card">{children}</div>;
}
Card.Header = ({ children }) => <div className="card-header">{children}</div>;
Card.Body = ({ children }) => <div className="card-body">{children}</div>;

// Usage - flexible, not rigid props
<Card>
  <Card.Header><h2>Title</h2></Card.Header>
  <Card.Body><p>Content</p></Card.Body>
</Card>
```

---

## Hook Patterns

```tsx
function useLocalStorage<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : initialValue;
  });
  useEffect(() => localStorage.setItem(key, JSON.stringify(value)), [key, value]);
  return [value, setValue] as const;
}
```

---

## State Management

```tsx
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const login = async (creds: Credentials) => setUser(await authApi.login(creds));
  const logout = () => { authApi.logout(); setUser(null); };
  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

---

## Performance

```tsx
function UserList({ users, filter }: { users: User[]; filter: string }) {
  const filtered = useMemo(() => users.filter((u) => u.name.includes(filter)), [users, filter]);
  const onClick = useCallback(() => console.log('Clicked'), []);
  return <ul>{filtered.map((u) => <MemoItem key={u.id} user={u} onClick={onClick} />)}</ul>;
}
const MemoItem = memo(({ user }: { user: User }) => <li>{user.name}</li>);
```

---

## Async Parallelization

```tsx
// CORRECT: Independent fetches run in parallel
async function loadDashboard(userId: string) {
  const [user, orders, preferences] = await Promise.all([
    fetchUser(userId),
    fetchOrders(userId),
    fetchPreferences(userId),
  ]);
  return { user, orders, preferences };
}

// VIOLATION: Sequential fetches (3x slower)
async function loadDashboardSlow(userId: string) {
  const user = await fetchUser(userId);
  const orders = await fetchOrders(userId);
  const preferences = await fetchPreferences(userId);
  return { user, orders, preferences };
}
```

---

## Bundle Size

```tsx
// CORRECT: Direct imports (tree-shakable)
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';

// VIOLATION: Barrel imports (imports entire library)
import { Button, Card } from '@/components';

// CORRECT: Dynamic import for heavy components
const Chart = lazy(() => import('./Chart'));
const Editor = lazy(() => import('./Editor'));

function Dashboard() {
  return (
    <Suspense fallback={<Skeleton />}>
      {showChart && <Chart data={data} />}
    </Suspense>
  );
}
```

---

## Re-render Optimization

```tsx
// CORRECT: Primitive deps (stable references)
useEffect(() => {
  fetchData(userId, isActive);
}, [userId, isActive]); // primitives don't cause unnecessary runs

// VIOLATION: Object/array deps (new reference every render)
useEffect(() => {
  fetchData(options);
}, [options]); // { page: 1 } !== { page: 1 }

// CORRECT: Stable callback with useCallback
const handleClick = useCallback((id: string) => {
  setSelected(id);
}, []); // no deps = stable reference

// VIOLATION: Inline function (new reference every render)
<List onItemClick={(id) => setSelected(id)} />
```

---

## Image Optimization

```tsx
// CORRECT: Optimized image with all attributes
<img
  src={url}
  alt={description}
  width={400}
  height={300}
  loading="lazy"
  decoding="async"
  style={{ aspectRatio: '4/3' }}
/>

// VIOLATION: Unoptimized image
<img src={url} />  // No dimensions, no lazy loading, layout shift
```

---

## Data Structure Performance

```tsx
// CORRECT: Set for O(1) membership checks
const selectedIds = new Set(selected);
const isSelected = (id: string) => selectedIds.has(id);

// VIOLATION: Array.includes is O(n)
const isSelected = (id: string) => selected.includes(id);

// CORRECT: Map for key-value lookups
const usersById = new Map(users.map(u => [u.id, u]));
const getUser = (id: string) => usersById.get(id);

// VIOLATION: Array.find is O(n)
const getUser = (id: string) => users.find(u => u.id === id);
```

---

## Anti-Patterns

```tsx
// BAD: Derived state in useState | GOOD: useMemo
const filtered = useMemo(() => items.filter(i => i.active), [items]);

// BAD: Missing dependency | GOOD: Include all deps
useEffect(() => { fetchData(userId); }, [userId]);

// BAD: State update in render | GOOD: Use effect
useEffect(() => { setState(value); }, [value]);
```

---

## Extended References

- `references/patterns.md` - Render props, reducers, virtualization, lazy loading
- `references/hooks.md` - useQuery, useDebouncedValue, usePrevious, useClickOutside
- `references/forms.md` - Controlled forms, validation hooks, multi-step forms
- `references/error-handling.md` - Error boundaries, async error handling

---

## Checklist

- [ ] Hooks at top level only
- [ ] All useEffect deps included
- [ ] useCallback for handlers passed to children
- [ ] useMemo for expensive computations
- [ ] Context at appropriate level
- [ ] Error boundaries around risky components
- [ ] Keys on list items (not index)
- [ ] Loading/error states handled
- [ ] Accessibility (aria-*, role)
- [ ] Independent fetches parallelized with Promise.all
- [ ] No barrel imports (direct imports for tree-shaking)
- [ ] Large components lazy-loaded
- [ ] Object/array deps avoided in useEffect (use primitives)
- [ ] Set/Map used for lookups instead of Array.includes/find
- [ ] Images have dimensions, lazy loading, and aspect-ratio
