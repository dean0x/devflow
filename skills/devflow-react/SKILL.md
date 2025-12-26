---
name: devflow-react
description: Automatically activate when working with React components, hooks, or .jsx/.tsx files containing JSX. Triggers on component creation, hook implementation, state management, or React performance optimization tasks.
allowed-tools: Read, Grep, Glob
---

# React Patterns

Reference for React-specific patterns, component design, hooks, and performance optimization.

## When This Skill Activates

- Working with React codebases
- Creating components and hooks
- Managing state and side effects
- Optimizing render performance
- Handling forms and validation

---

## Component Patterns

### Functional Component Structure

```tsx
// Standard component structure
interface UserCardProps {
  user: User;
  onEdit?: (user: User) => void;
  className?: string;
}

export function UserCard({ user, onEdit, className }: UserCardProps) {
  // 1. Hooks first
  const [isExpanded, setIsExpanded] = useState(false);
  const { theme } = useTheme();

  // 2. Derived state / computations
  const displayName = user.firstName + ' ' + user.lastName;
  const canEdit = onEdit !== undefined;

  // 3. Event handlers
  const handleToggle = () => {
    setIsExpanded((prev) => !prev);
  };

  const handleEdit = () => {
    onEdit?.(user);
  };

  // 4. Render
  return (
    <div className={cn('user-card', className)}>
      <h3>{displayName}</h3>
      {isExpanded && <UserDetails user={user} />}
      <button onClick={handleToggle}>
        {isExpanded ? 'Collapse' : 'Expand'}
      </button>
      {canEdit && <button onClick={handleEdit}>Edit</button>}
    </div>
  );
}
```

### Composition Over Props

```tsx
// ❌ BAD: Prop drilling and rigid structure
function Card({ title, subtitle, content, footer, onClose }) {
  return (
    <div>
      <h2>{title}</h2>
      <p>{subtitle}</p>
      <div>{content}</div>
      <footer>{footer}</footer>
      <button onClick={onClose}>X</button>
    </div>
  );
}

// ✅ GOOD: Composable with children
function Card({ children }: { children: React.ReactNode }) {
  return <div className="card">{children}</div>;
}

Card.Header = function CardHeader({ children }: { children: React.ReactNode }) {
  return <div className="card-header">{children}</div>;
};

Card.Body = function CardBody({ children }: { children: React.ReactNode }) {
  return <div className="card-body">{children}</div>;
};

Card.Footer = function CardFooter({ children }: { children: React.ReactNode }) {
  return <div className="card-footer">{children}</div>;
};

// Usage
<Card>
  <Card.Header>
    <h2>Title</h2>
    <CloseButton onClick={onClose} />
  </Card.Header>
  <Card.Body>
    <p>Content goes here</p>
  </Card.Body>
  <Card.Footer>
    <Button>Save</Button>
  </Card.Footer>
</Card>
```

### Render Props Pattern

```tsx
// When you need to share logic but customize rendering
interface DataFetcherProps<T> {
  url: string;
  children: (data: T | null, loading: boolean, error: Error | null) => React.ReactNode;
}

function DataFetcher<T>({ url, children }: DataFetcherProps<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    fetch(url)
      .then((res) => res.json())
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, [url]);

  return <>{children(data, loading, error)}</>;
}

// Usage
<DataFetcher<User> url="/api/user">
  {(user, loading, error) => {
    if (loading) return <Spinner />;
    if (error) return <ErrorMessage error={error} />;
    if (!user) return <NotFound />;
    return <UserProfile user={user} />;
  }}
</DataFetcher>
```

---

## Hook Patterns

### Custom Hook Structure

```tsx
// Extract reusable logic into hooks
function useLocalStorage<T>(key: string, initialValue: T) {
  // State initialization
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : initialValue;
  });

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  // Return tuple like useState
  return [value, setValue] as const;
}

// Usage
const [theme, setTheme] = useLocalStorage('theme', 'light');
```

### Data Fetching Hook

```tsx
interface UseQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | undefined;
  refetch: () => void;
}

function useQuery<T>(url: string): UseQueryResult<T> {
  const [data, setData] = useState<T>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error>();

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch');
      const json = await response.json();
      setData(json);
    } catch (e) {
      setError(e as Error);
    } finally {
      setIsLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}

// Usage
function UserList() {
  const { data: users, isLoading, error, refetch } = useQuery<User[]>('/api/users');

  if (isLoading) return <Spinner />;
  if (error) return <Error message={error.message} onRetry={refetch} />;

  return <ul>{users?.map(user => <li key={user.id}>{user.name}</li>)}</ul>;
}
```

### Debounced Value Hook

```tsx
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}

// Usage
function SearchInput() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 300);

  useEffect(() => {
    if (debouncedQuery) {
      searchApi(debouncedQuery);
    }
  }, [debouncedQuery]);

  return <input value={query} onChange={(e) => setQuery(e.target.value)} />;
}
```

### Previous Value Hook

```tsx
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}

// Usage
function Counter({ count }: { count: number }) {
  const prevCount = usePrevious(count);

  return (
    <div>
      Current: {count}, Previous: {prevCount ?? 'N/A'}
    </div>
  );
}
```

---

## State Management Patterns

### Context for Shared State

```tsx
// 1. Create context with type
interface AuthContextValue {
  user: User | null;
  login: (credentials: Credentials) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// 2. Create provider
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check for existing session
    checkSession().then(setUser).finally(() => setIsLoading(false));
  }, []);

  const login = async (credentials: Credentials) => {
    const user = await authApi.login(credentials);
    setUser(user);
  };

  const logout = () => {
    authApi.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

// 3. Create hook with type safety
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

// 4. Usage
function UserMenu() {
  const { user, logout } = useAuth();

  if (!user) return <LoginButton />;

  return (
    <div>
      <span>{user.name}</span>
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

### Reducer for Complex State

```tsx
// Define state and actions
interface FormState {
  values: Record<string, string>;
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  isSubmitting: boolean;
}

type FormAction =
  | { type: 'SET_VALUE'; field: string; value: string }
  | { type: 'SET_ERROR'; field: string; error: string }
  | { type: 'SET_TOUCHED'; field: string }
  | { type: 'SUBMIT_START' }
  | { type: 'SUBMIT_END' }
  | { type: 'RESET' };

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'SET_VALUE':
      return {
        ...state,
        values: { ...state.values, [action.field]: action.value },
        errors: { ...state.errors, [action.field]: '' },
      };
    case 'SET_ERROR':
      return {
        ...state,
        errors: { ...state.errors, [action.field]: action.error },
      };
    case 'SET_TOUCHED':
      return {
        ...state,
        touched: { ...state.touched, [action.field]: true },
      };
    case 'SUBMIT_START':
      return { ...state, isSubmitting: true };
    case 'SUBMIT_END':
      return { ...state, isSubmitting: false };
    case 'RESET':
      return initialFormState;
    default:
      return state;
  }
}

// Usage
function useForm() {
  const [state, dispatch] = useReducer(formReducer, initialFormState);

  const setValue = (field: string, value: string) => {
    dispatch({ type: 'SET_VALUE', field, value });
  };

  const setTouched = (field: string) => {
    dispatch({ type: 'SET_TOUCHED', field });
  };

  return { ...state, setValue, setTouched };
}
```

---

## Performance Patterns

### Memoization

```tsx
// Memoize expensive computations
function UserList({ users, filter }: { users: User[]; filter: string }) {
  // Only recalculate when users or filter change
  const filteredUsers = useMemo(() => {
    return users.filter((user) =>
      user.name.toLowerCase().includes(filter.toLowerCase())
    );
  }, [users, filter]);

  return (
    <ul>
      {filteredUsers.map((user) => (
        <UserItem key={user.id} user={user} />
      ))}
    </ul>
  );
}

// Memoize callbacks
function ParentComponent() {
  const [count, setCount] = useState(0);

  // Stable reference - won't cause child re-renders
  const handleClick = useCallback(() => {
    console.log('Clicked');
  }, []);

  return <ChildComponent onClick={handleClick} />;
}

// Memoize components
const UserItem = memo(function UserItem({ user }: { user: User }) {
  return <li>{user.name}</li>;
});
```

### Virtualization for Long Lists

```tsx
// Use react-window or similar for long lists
import { FixedSizeList } from 'react-window';

function VirtualizedList({ items }: { items: Item[] }) {
  return (
    <FixedSizeList
      height={400}
      width="100%"
      itemCount={items.length}
      itemSize={50}
    >
      {({ index, style }) => (
        <div style={style}>
          <ItemRow item={items[index]} />
        </div>
      )}
    </FixedSizeList>
  );
}
```

### Lazy Loading

```tsx
// Lazy load components
const HeavyComponent = lazy(() => import('./HeavyComponent'));

function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <HeavyComponent />
    </Suspense>
  );
}

// Lazy load on interaction
function Dashboard() {
  const [showChart, setShowChart] = useState(false);

  return (
    <div>
      <button onClick={() => setShowChart(true)}>Show Chart</button>
      {showChart && (
        <Suspense fallback={<ChartSkeleton />}>
          <LazyChart />
        </Suspense>
      )}
    </div>
  );
}
```

---

## Form Patterns

### Controlled Form

```tsx
interface FormData {
  email: string;
  password: string;
}

function LoginForm({ onSubmit }: { onSubmit: (data: FormData) => void }) {
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: '',
  });
  const [errors, setErrors] = useState<Partial<FormData>>({});

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const validate = (): boolean => {
    const newErrors: Partial<FormData> = {};
    if (!formData.email) newErrors.email = 'Email required';
    if (!formData.password) newErrors.password = 'Password required';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSubmit(formData);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <input
          name="email"
          type="email"
          value={formData.email}
          onChange={handleChange}
          aria-invalid={!!errors.email}
        />
        {errors.email && <span role="alert">{errors.email}</span>}
      </div>
      <div>
        <input
          name="password"
          type="password"
          value={formData.password}
          onChange={handleChange}
          aria-invalid={!!errors.password}
        />
        {errors.password && <span role="alert">{errors.password}</span>}
      </div>
      <button type="submit">Login</button>
    </form>
  );
}
```

---

## Error Handling

### Error Boundary

```tsx
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error caught:', error, info);
    // Log to error reporting service
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? <DefaultErrorFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}

// Usage
<ErrorBoundary fallback={<ErrorPage />}>
  <App />
</ErrorBoundary>
```

---

## Anti-Patterns to Avoid

### ❌ State for Derived Data

```tsx
// BAD: Storing computed values
const [filteredItems, setFilteredItems] = useState([]);
useEffect(() => {
  setFilteredItems(items.filter(i => i.active));
}, [items]);

// GOOD: Derive during render
const filteredItems = useMemo(
  () => items.filter(i => i.active),
  [items]
);
```

### ❌ Missing Dependencies

```tsx
// BAD: Missing dependency
useEffect(() => {
  fetchData(userId);
}, []); // userId missing!

// GOOD: Include all dependencies
useEffect(() => {
  fetchData(userId);
}, [userId]);
```

### ❌ State Updates in Render

```tsx
// BAD: State update during render
function Component({ value }) {
  const [state, setState] = useState(value);
  if (value !== state) {
    setState(value); // Causes infinite loop!
  }
}

// GOOD: Update in effect
function Component({ value }) {
  const [state, setState] = useState(value);
  useEffect(() => {
    setState(value);
  }, [value]);
}
```

---

## Checklist

- [ ] Hooks called at top level (not in conditions/loops)
- [ ] All useEffect dependencies included
- [ ] Event handlers use useCallback when passed to children
- [ ] Expensive computations wrapped in useMemo
- [ ] Context providers at appropriate level
- [ ] Error boundaries around risky components
- [ ] Keys on list items (not index unless static)
- [ ] Forms handle validation and errors
- [ ] Loading and error states handled
- [ ] Accessibility attributes (aria-*, role, etc.)
