# React Correct Patterns

Extended correct patterns for React development. Reference from main SKILL.md.

## Component Patterns

### Composition with Compound Components

```tsx
// CORRECT: Flexible composition through children
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

// Usage - flexible, composable
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
// CORRECT: Share logic, customize rendering
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

### Context for Shared State

```tsx
// CORRECT: Avoid prop drilling with context
interface AuthContextValue {
  user: User | null;
  login: (credentials: Credentials) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
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

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
```

### Virtualization for Long Lists

```tsx
// CORRECT: Only render visible items
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

### Lazy Loading Components

```tsx
// CORRECT: Load heavy components on demand
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

## Hooks Patterns

### Data Fetching Hook

```tsx
// CORRECT: Reusable data fetching logic
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
// CORRECT: Debounce rapid value changes
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
// CORRECT: Track previous value for comparisons
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

### Toggle Hook

```tsx
// CORRECT: Simple boolean state toggle
function useToggle(initialValue = false): [boolean, () => void] {
  const [value, setValue] = useState(initialValue);
  const toggle = useCallback(() => setValue(v => !v), []);
  return [value, toggle];
}

// Usage
function Modal() {
  const [isOpen, toggleOpen] = useToggle();

  return (
    <>
      <button onClick={toggleOpen}>Toggle Modal</button>
      {isOpen && <ModalContent onClose={toggleOpen} />}
    </>
  );
}
```

### Media Query Hook

```tsx
// CORRECT: Responsive component logic
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches);

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

// Usage
function ResponsiveComponent() {
  const isMobile = useMediaQuery('(max-width: 768px)');

  return isMobile ? <MobileLayout /> : <DesktopLayout />;
}
```

### Click Outside Hook

```tsx
// CORRECT: Detect clicks outside element
function useClickOutside<T extends HTMLElement>(
  callback: () => void
): React.RefObject<T> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        callback();
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [callback]);

  return ref;
}

// Usage
function Dropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useClickOutside<HTMLDivElement>(() => setIsOpen(false));

  return (
    <div ref={dropdownRef}>
      <button onClick={() => setIsOpen(true)}>Open</button>
      {isOpen && <DropdownMenu />}
    </div>
  );
}
```

### Reducer for Complex State

```tsx
// CORRECT: Manage complex state transitions
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

## Forms Patterns

### Controlled Form with Validation

```tsx
// CORRECT: Full validation, accessibility, error display
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

### Form with Validation Hook

```tsx
// CORRECT: Reusable form handling logic
interface UseFormOptions<T> {
  initialValues: T;
  validate: (values: T) => Partial<Record<keyof T, string>>;
  onSubmit: (values: T) => void | Promise<void>;
}

function useForm<T extends Record<string, unknown>>({
  initialValues,
  validate,
  onSubmit,
}: UseFormOptions<T>) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (name: keyof T) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    setValues((prev) => ({ ...prev, [name]: e.target.value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleBlur = (name: keyof T) => () => {
    setTouched((prev) => ({ ...prev, [name]: true }));
    const fieldErrors = validate(values);
    if (fieldErrors[name]) {
      setErrors((prev) => ({ ...prev, [name]: fieldErrors[name] }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationErrors = validate(values);
    setErrors(validationErrors);
    setTouched(
      Object.keys(values).reduce(
        (acc, key) => ({ ...acc, [key]: true }),
        {} as Record<keyof T, boolean>
      )
    );

    if (Object.keys(validationErrors).length === 0) {
      setIsSubmitting(true);
      try {
        await onSubmit(values);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const reset = () => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
  };

  return {
    values,
    errors,
    touched,
    isSubmitting,
    handleChange,
    handleBlur,
    handleSubmit,
    reset,
    setValues,
  };
}

// Usage
function SignupForm() {
  const form = useForm({
    initialValues: { name: '', email: '', password: '' },
    validate: (values) => {
      const errors: Partial<typeof values> = {};
      if (!values.name) errors.name = 'Name required';
      if (!values.email) errors.email = 'Email required';
      if (values.password.length < 8) errors.password = 'Min 8 characters';
      return errors;
    },
    onSubmit: async (values) => {
      await api.signup(values);
    },
  });

  return (
    <form onSubmit={form.handleSubmit}>
      <input
        value={form.values.name}
        onChange={form.handleChange('name')}
        onBlur={form.handleBlur('name')}
      />
      {form.touched.name && form.errors.name && (
        <span role="alert">{form.errors.name}</span>
      )}
      {/* ... other fields */}
      <button type="submit" disabled={form.isSubmitting}>
        {form.isSubmitting ? 'Submitting...' : 'Sign Up'}
      </button>
    </form>
  );
}
```

### Multi-Step Form

```tsx
// CORRECT: Manage state across form steps
interface StepProps {
  next: () => void;
  prev: () => void;
  data: FormData;
  updateData: (updates: Partial<FormData>) => void;
}

function MultiStepForm() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<FormData>({
    name: '',
    email: '',
    address: '',
    payment: '',
  });

  const updateData = (updates: Partial<FormData>) => {
    setData((prev) => ({ ...prev, ...updates }));
  };

  const next = () => setStep((s) => Math.min(s + 1, steps.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const steps = [
    <PersonalInfo {...{ next, prev, data, updateData }} />,
    <AddressInfo {...{ next, prev, data, updateData }} />,
    <PaymentInfo {...{ next, prev, data, updateData }} />,
    <Confirmation {...{ next, prev, data, updateData }} />,
  ];

  return (
    <div>
      <StepIndicator current={step} total={steps.length} />
      {steps[step]}
    </div>
  );
}
```

### Uncontrolled Form with FormData

```tsx
// CORRECT: Use native FormData API
function UncontrolledForm({ onSubmit }: { onSubmit: (data: FormData) => void }) {
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formRef.current) {
      const formData = new FormData(formRef.current);
      onSubmit(formData);
    }
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      <input name="email" type="email" required />
      <input name="password" type="password" required />
      <button type="submit">Submit</button>
    </form>
  );
}
```

---

## Error Handling Patterns

### Error Boundary Component

```tsx
// CORRECT: Catch render errors
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

### Error Boundary with Reset

```tsx
// CORRECT: Allow recovery from errors
interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

class ResettableErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset);
      }
      return (
        <div>
          <h2>Something went wrong</h2>
          <button onClick={this.reset}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Usage
<ResettableErrorBoundary
  fallback={(error, reset) => (
    <div>
      <h2>Error: {error.message}</h2>
      <button onClick={reset}>Retry</button>
    </div>
  )}
  onError={(error) => logErrorToService(error)}
>
  <App />
</ResettableErrorBoundary>
```

### Async Error Handling Hook

```tsx
// CORRECT: Handle async operation states
interface UseAsyncState<T> {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
}

function useAsync<T>(
  asyncFn: () => Promise<T>,
  deps: unknown[] = []
): UseAsyncState<T> & { execute: () => Promise<void> } {
  const [state, setState] = useState<UseAsyncState<T>>({
    data: null,
    error: null,
    isLoading: false,
  });

  const execute = useCallback(async () => {
    setState({ data: null, error: null, isLoading: true });
    try {
      const result = await asyncFn();
      setState({ data: result, error: null, isLoading: false });
    } catch (error) {
      setState({ data: null, error: error as Error, isLoading: false });
    }
  }, deps);

  return { ...state, execute };
}

// Usage
function DataComponent() {
  const { data, error, isLoading, execute } = useAsync(
    () => fetchData(),
    []
  );

  useEffect(() => {
    execute();
  }, [execute]);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} onRetry={execute} />;
  if (!data) return null;

  return <DataDisplay data={data} />;
}
```

### Error Fallback Components

```tsx
// CORRECT: Reusable error display components
interface ErrorFallbackProps {
  error: Error;
  onRetry?: () => void;
}

function ErrorFallback({ error, onRetry }: ErrorFallbackProps) {
  return (
    <div role="alert" className="error-fallback">
      <h2>Something went wrong</h2>
      <pre>{error.message}</pre>
      {onRetry && (
        <button onClick={onRetry}>Try again</button>
      )}
    </div>
  );
}

function NetworkErrorFallback({ error, onRetry }: ErrorFallbackProps) {
  const isNetworkError = error.message.includes('network') ||
                         error.message.includes('fetch');

  return (
    <div role="alert" className="network-error">
      <h2>{isNetworkError ? 'Connection Error' : 'Error'}</h2>
      <p>
        {isNetworkError
          ? 'Please check your internet connection'
          : error.message}
      </p>
      {onRetry && (
        <button onClick={onRetry}>Retry</button>
      )}
    </div>
  );
}
```

### Scoped Error Boundaries

```tsx
// CORRECT: Isolate failures to feature boundaries
function App() {
  return (
    <div>
      <Header />
      <main>
        <ErrorBoundary fallback={<SidebarError />}>
          <Sidebar />
        </ErrorBoundary>
        <ErrorBoundary fallback={<ContentError />}>
          <MainContent />
        </ErrorBoundary>
      </main>
      <Footer />
    </div>
  );
}
```

---

## Performance Patterns

### Memoized Callbacks

```tsx
// CORRECT: Stable function references for child components
function UserList({ users, onSelect }: Props) {
  const handleSelect = useCallback((userId: string) => {
    onSelect(userId);
  }, [onSelect]);

  return <List items={users} onSelect={handleSelect} />;
}
```

### Memoized Computed Values

```tsx
// CORRECT: Cache expensive computations
function Dashboard({ data }: { data: DataPoint[] }) {
  const stats = useMemo(() => computeExpensiveStats(data), [data]);
  const chartData = useMemo(() => transformForChart(data), [data]);

  return (
    <div>
      <Stats data={stats} />
      <Chart data={chartData} />
    </div>
  );
}
```

### Component Memoization

```tsx
// CORRECT: Skip re-render when props unchanged
const UserCard = memo(function UserCard({ user }: { user: User }) {
  return (
    <div>
      <h3>{user.name}</h3>
      <p>{user.email}</p>
    </div>
  );
});
```

### Derived State Instead of Effect

```tsx
// CORRECT: Compute during render, not in effect
function ProductList({ products, filter }: Props) {
  const filteredProducts = useMemo(
    () => products.filter(p => p.category === filter),
    [products, filter]
  );

  return <List items={filteredProducts} />;
}
```

### Effect Cleanup

```tsx
// CORRECT: Always clean up subscriptions
function WindowSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const handleResize = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return <span>{size.width} x {size.height}</span>;
}
```

### Debounced Search

```tsx
// CORRECT: Throttle expensive operations
function SearchInput({ onSearch }: { onSearch: (term: string) => void }) {
  const [value, setValue] = useState('');

  const debouncedSearch = useMemo(
    () => debounce((term: string) => onSearch(term), 300),
    [onSearch]
  );

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    debouncedSearch(e.target.value);
  };

  return <input value={value} onChange={handleChange} />;
}
```
