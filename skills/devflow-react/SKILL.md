---
name: devflow-react
description: React patterns. Use when user works with React components, asks about "hooks", "state management", "JSX", or performance optimization.
user-invocable: false
allowed-tools: Read, Grep, Glob
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
