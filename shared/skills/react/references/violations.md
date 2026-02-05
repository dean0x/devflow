# React Violation Examples

Extended violation patterns for React reviews. Reference from main SKILL.md.

## Vercel Performance Violations

### Sequential Fetches

```tsx
// VIOLATION: Sequential fetches (waterfall)
async function loadDashboard(userId: string) {
  const user = await fetchUser(userId);
  const orders = await fetchOrders(userId);  // Waits for user
  const prefs = await fetchPreferences(userId);  // Waits for orders
  return { user, orders, prefs };
}
// Total time: T(user) + T(orders) + T(prefs)
// Should be: max(T(user), T(orders), T(prefs))

// VIOLATION: Sequential in useEffect
useEffect(() => {
  async function load() {
    setUser(await fetchUser(id));
    setOrders(await fetchOrders(id));  // Sequential
    setStats(await fetchStats(id));     // Sequential
  }
  load();
}, [id]);
```

### Barrel Import Anti-Patterns

```tsx
// VIOLATION: Barrel import pulls entire library
import { Button } from '@/components';
import { formatDate, formatCurrency, formatNumber } from '@/utils';
import { IconHome, IconUser } from '@/icons';

// VIOLATION: Named imports from large packages
import { debounce } from 'lodash';  // Imports entire lodash
import { Button, Input, Select } from 'antd';  // Large bundle

// VIOLATION: Not lazy loading heavy dependencies
import Editor from '@monaco-editor/react';  // 2MB+ bundle
import { Chart } from 'chart.js';  // Heavy charting library

function Dashboard() {
  const [showChart, setShowChart] = useState(false);
  return (
    <div>
      {showChart && <Chart />}  {/* Loaded even when not shown */}
    </div>
  );
}
```

### Re-render Causing Patterns

```tsx
// VIOLATION: Object literal in deps (new ref every render)
useEffect(() => {
  fetchData(config);
}, [{ page: 1, limit: 10 }]);  // Always "changed"

// VIOLATION: Array in deps
useEffect(() => {
  updateFilters(filters);
}, [[filter1, filter2, filter3]]);  // New array every render

// VIOLATION: Inline callback to memoized child
const MemoChild = memo(Child);

function Parent() {
  return (
    <MemoChild
      onClick={() => console.log('clicked')}  // New fn = re-render
      style={{ color: 'blue' }}  // New object = re-render
    />
  );
}

// VIOLATION: Computed value in render without memo
function FilteredList({ items, filter }: Props) {
  const filtered = items.filter(i => i.includes(filter));  // Every render
  return <List items={filtered} />;
}
```

### Unoptimized Images

```tsx
// VIOLATION: No dimensions (causes layout shift)
<img src={url} alt={alt} />

// VIOLATION: No lazy loading (loads all images immediately)
{images.map(img => <img src={img.src} alt={img.alt} />)}

// VIOLATION: No aspect ratio (jumps on load)
<img
  src={url}
  width={400}
  height={300}
  // Missing: style={{ aspectRatio: '4/3' }}
/>

// VIOLATION: Eager loading below fold
<img
  src={heroImage}
  alt="Hero"
  loading="eager"  // Should be lazy for non-critical images
/>
```

### Inefficient Data Structures

```tsx
// VIOLATION: Array.includes for frequent checks (O(n))
function SelectableList({ items, selected }: Props) {
  return (
    <ul>
      {items.map(item => (
        <li className={selected.includes(item.id) ? 'selected' : ''}>
          {/* O(n) check on every item render */}
          {item.name}
        </li>
      ))}
    </ul>
  );
}

// VIOLATION: Array.find for lookups (O(n))
function UserDisplay({ userId, users }: Props) {
  const user = users.find(u => u.id === userId);  // O(n) every render
  return <span>{user?.name}</span>;
}

// VIOLATION: Filter + map in render (double iteration)
function ActiveUsers({ users }: Props) {
  return (
    <ul>
      {users
        .filter(u => u.active)
        .map(u => <li key={u.id}>{u.name}</li>)
      }
    </ul>
  );
}

// VIOLATION: Recreating Set every render
function Tags({ tags, selected }: Props) {
  const selectedSet = new Set(selected);  // Created every render
  return tags.map(tag => (
    <Tag selected={selectedSet.has(tag)} />
  ));
}
```

---

## Component Violations

### Prop Drilling

```tsx
// VIOLATION: Passing data through multiple intermediate components
function App() {
  const [user, setUser] = useState<User | null>(null);

  return (
    <Layout user={user}>
      <Sidebar user={user}>
        <Navigation user={user}>
          <UserMenu user={user} />  {/* Props drilled through 3 levels */}
        </Navigation>
      </Sidebar>
    </Layout>
  );
}
```

### Rigid Component Structure

```tsx
// VIOLATION: Too many props, no composition
function Card({
  title,
  subtitle,
  content,
  footer,
  headerIcon,
  showCloseButton,
  onClose,
  variant,
  size,
  className
}: CardProps) {
  return (
    <div className={className}>
      <header>
        {headerIcon && <Icon name={headerIcon} />}
        <h2>{title}</h2>
        <p>{subtitle}</p>
        {showCloseButton && <button onClick={onClose}>X</button>}
      </header>
      <div>{content}</div>
      <footer>{footer}</footer>
    </div>
  );
}
```

### Direct State Mutation

```tsx
// VIOLATION: Mutating state directly
function UserList() {
  const [users, setUsers] = useState<User[]>([]);

  const updateUser = (index: number, name: string) => {
    users[index].name = name;  // BAD: Direct mutation
    setUsers(users);           // Won't trigger re-render
  };
}
```

### Missing Keys

```tsx
// VIOLATION: Index as key causes reconciliation issues
{items.map((item, index) => (
  <Item key={index} {...item} />  // Index key breaks reordering
))}

// VIOLATION: Missing key entirely
{items.map((item) => (
  <Item {...item} />  // React warning, poor performance
))}
```

---

## Hooks Violations

### Missing Dependencies

```tsx
// VIOLATION: Missing dependency causes stale closure
function SearchResults({ query }: { query: string }) {
  const [results, setResults] = useState<Result[]>([]);

  useEffect(() => {
    fetchResults(query).then(setResults);
  }, []);  // BAD: Missing 'query' dependency

  return <ResultsList results={results} />;
}
```

### Conditional Hooks

```tsx
// VIOLATION: Hook called conditionally
function UserProfile({ user }: { user: User | null }) {
  if (!user) {
    return <LoginPrompt />;
  }

  // BAD: Hook called after conditional return
  const [isEditing, setIsEditing] = useState(false);

  return <ProfileEditor user={user} isEditing={isEditing} />;
}
```

### Stale Closure in Callbacks

```tsx
// VIOLATION: Callback captures stale state
function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCount(count + 1);  // BAD: Always references initial count (0)
    }, 1000);

    return () => clearInterval(interval);
  }, []);  // Missing count dependency

  return <span>{count}</span>;
}
```

### Effects Without Cleanup

```tsx
// VIOLATION: Event listener never removed
function WindowSize() {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const handleResize = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    };

    window.addEventListener('resize', handleResize);
    // BAD: Missing cleanup - memory leak
  }, []);

  return <span>{size.width} x {size.height}</span>;
}
```

### Derived State in useState

```tsx
// VIOLATION: Storing computed value in state
function ProductList({ products, filter }: Props) {
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);

  useEffect(() => {
    setFilteredProducts(products.filter(p => p.category === filter));
  }, [products, filter]);  // BAD: Unnecessary state and effect

  return <List items={filteredProducts} />;
}
```

---

## Forms Violations

### Uncontrolled to Controlled Switch

```tsx
// VIOLATION: Switching from uncontrolled to controlled
function SearchInput() {
  const [value, setValue] = useState<string>();  // undefined initially

  return (
    <input
      value={value}  // BAD: undefined -> string causes warning
      onChange={(e) => setValue(e.target.value)}
    />
  );
}
```

### Missing Form Validation

```tsx
// VIOLATION: No validation, direct submission
function LoginForm({ onSubmit }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ email, password });  // BAD: No validation
  };

  return (
    <form onSubmit={handleSubmit}>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      <input value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit">Login</button>
    </form>
  );
}
```

### Missing Accessibility Attributes

```tsx
// VIOLATION: Form inputs without proper accessibility
function ContactForm() {
  return (
    <form>
      {/* BAD: No labels, no aria attributes, no error announcements */}
      <input placeholder="Email" />
      {error && <span style={{ color: 'red' }}>{error}</span>}
      <button>Submit</button>
    </form>
  );
}
```

### Form State Not Reset After Submit

```tsx
// VIOLATION: Form keeps stale data after successful submit
function CommentForm({ onSubmit }: Props) {
  const [comment, setComment] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(comment);
    // BAD: Missing state reset after successful submit
  };

  return (
    <form onSubmit={handleSubmit}>
      <textarea value={comment} onChange={(e) => setComment(e.target.value)} />
      <button type="submit">Post</button>
    </form>
  );
}
```

---

## Error Handling Violations

### Missing Error Boundaries

```tsx
// VIOLATION: No error boundary around risky component
function App() {
  return (
    <div>
      <Header />
      <main>
        <UserProfile userId={userId} />  {/* If this crashes, entire app crashes */}
        <OrderHistory userId={userId} />
      </main>
      <Footer />
    </div>
  );
}
```

### Swallowed Errors

```tsx
// VIOLATION: Error caught but not handled
function DataLoader({ url }: { url: string }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(url)
      .then(res => res.json())
      .then(setData)
      .catch(() => {});  // BAD: Silently swallows error
  }, [url]);

  return data ? <DataDisplay data={data} /> : <Spinner />;
}
```

### No Loading/Error States

```tsx
// VIOLATION: Only handles success case
function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    fetchUser(userId).then(setUser);
  }, [userId]);

  // BAD: No loading spinner, no error handling
  return user ? <Profile user={user} /> : null;
}
```

### Error State Not Cleared

```tsx
// VIOLATION: Error persists after retry
function DataFetcher({ url }: { url: string }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = async () => {
    try {
      const result = await fetch(url).then(r => r.json());
      setData(result);
      // BAD: Error state not cleared on success
    } catch (e) {
      setError(e as Error);
    }
  };

  return (
    <div>
      {error && <ErrorMessage error={error} />}
      <button onClick={fetchData}>Retry</button>
    </div>
  );
}
```

---

## Performance Violations

### Inline Objects in JSX

```tsx
// VIOLATION: New reference every render
<Component
  options={{ show: true, animate: false }}  // New object each render
  items={[1, 2, 3]}  // New array each render
/>
```

### Inline Arrow Functions in JSX

```tsx
// VIOLATION: New function every render
<Button onClick={() => handleClick(item.id)} />

// Also creates new function each render
{items.map(item => (
  <Item
    key={item.id}
    onClick={() => onSelect(item)}  // New function per item per render
  />
))}
```

### Missing useMemo for Expensive Computations

```tsx
// VIOLATION: Recalculates on every render
function Dashboard({ data }: { data: DataPoint[] }) {
  const stats = computeExpensiveStats(data);  // Runs every render
  const chartData = transformForChart(data);   // Also runs every render

  return (
    <div>
      <Stats data={stats} />
      <Chart data={chartData} />
    </div>
  );
}
```

### State Updates in Render

```tsx
// VIOLATION: Causes infinite loop
function Sync({ value }: { value: string }) {
  const [state, setState] = useState(value);

  if (value !== state) {
    setState(value);  // BAD: State update during render
  }

  return <span>{state}</span>;
}
```

### Unthrottled Event Handlers

```tsx
// VIOLATION: Fires on every scroll pixel
function ParallaxEffect() {
  useEffect(() => {
    window.addEventListener('scroll', () => {
      updateParallax();  // 60+ calls per second
    });
  }, []);
}
```
