# Performance Correct Patterns

Extended correct patterns for performance optimization. Reference from main SKILL.md.

## Algorithmic Solutions

### N+1 Query Solutions

**ORM Eager Loading**
```typescript
// CORRECT: Include related data in single query
const posts = await Post.findAll({
  include: [
    { model: User, as: 'author' },
    { model: Comment, limit: 10 }
  ]
});
```

**GraphQL DataLoader**
```typescript
// CORRECT: Batch and cache with DataLoader
const userLoader = new DataLoader(async (ids) => {
  const users = await db.users.findAll({ where: { id: ids } });
  return ids.map(id => users.find(u => u.id === id));
});

const resolvers = {
  Post: {
    author: (post) => userLoader.load(post.authorId)  // Batched!
  }
};
```

**Batch Query with Map**
```typescript
// CORRECT: Single query, map results
async function enrichOrders(orders: Order[]) {
  const customerIds = [...new Set(orders.map(o => o.customerId))];
  const customers = await db.customers.findByIds(customerIds);
  const customerMap = new Map(customers.map(c => [c.id, c]));

  return orders.map(o => ({
    ...o,
    customer: customerMap.get(o.customerId)
  }));
}
```

### Efficient Algorithm Patterns

**Set for Lookup**
```typescript
// CORRECT: O(n+m) instead of O(n*m)
function findCommon(list1: string[], list2: string[]) {
  const set = new Set(list2);
  return list1.filter(item => set.has(item));
}
```

**Map for Grouping**
```typescript
// CORRECT: Single pass grouping
function groupBy<T, K extends string>(items: T[], keyFn: (item: T) => K) {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}
```

**Efficient String Building**
```typescript
// CORRECT: Array join instead of string concat
function buildCsv(rows: string[][]): string {
  return rows.map(row => row.join(',')).join('\n');
}

// Or for very large data: streaming
function* streamCsv(rows: string[][]): Generator<string> {
  for (const row of rows) {
    yield row.join(',') + '\n';
  }
}
```

**Proper Queue Implementation**
```typescript
// CORRECT: O(1) dequeue with circular buffer or linked list
class Queue<T> {
  private items: T[] = [];
  private head = 0;

  enqueue(item: T): void {
    this.items.push(item);
  }

  dequeue(): T | undefined {
    if (this.head >= this.items.length) return undefined;
    const item = this.items[this.head];
    this.items[this.head] = undefined as any;  // Allow GC
    this.head++;

    // Compact when half empty
    if (this.head > this.items.length / 2) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return item;
  }
}
```

---

## Database Solutions

### Indexing Strategies

**Composite Index for Range Queries**
```sql
-- CORRECT: Index supports both equality and range
CREATE INDEX idx_orders_customer_date ON orders(customer_id, created_at DESC);

-- Efficient query
SELECT * FROM orders
WHERE customer_id = 123
ORDER BY created_at DESC
LIMIT 10;
```

**Covering Index**
```sql
-- CORRECT: Index includes all needed columns
CREATE INDEX idx_users_status_email ON users(status) INCLUDE (email, name);

-- Query satisfied entirely from index
SELECT email, name FROM users WHERE status = 'active';
```

**Partial Index for Common Filters**
```sql
-- CORRECT: Index only relevant rows
CREATE INDEX idx_orders_pending ON orders(created_at)
WHERE status = 'pending';

-- Efficient for common query pattern
SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at;
```

### Efficient Query Patterns

**Select Specific Columns**
```typescript
// CORRECT: Only fetch needed data
const users = await db.query(
  'SELECT id, name, email FROM users WHERE status = ?',
  ['active']
);
```

**Cursor-Based Pagination**
```typescript
// CORRECT: Efficient for large datasets
async function getOrdersPage(cursor?: string, limit = 20) {
  const query = cursor
    ? 'SELECT * FROM orders WHERE id > ? ORDER BY id LIMIT ?'
    : 'SELECT * FROM orders ORDER BY id LIMIT ?';

  const params = cursor ? [cursor, limit + 1] : [limit + 1];
  const rows = await db.query(query, params);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, -1) : rows;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { items, nextCursor, hasMore };
}
```

**Batch Processing Large Tables**
```typescript
// CORRECT: Process in chunks to avoid memory issues
async function processAllOrders(batchSize = 1000) {
  let cursor: string | null = null;

  do {
    const { items, nextCursor } = await getOrdersPage(cursor, batchSize);
    await Promise.all(items.map(processOrder));
    cursor = nextCursor;
  } while (cursor);
}
```

---

## Memory Solutions

### Cleanup Patterns

**Event Listener Cleanup**
```typescript
// CORRECT: Track and cleanup listeners
class Component {
  private cleanupFns: (() => void)[] = [];

  mount() {
    const handler = (e: Event) => this.handleResize(e);
    window.addEventListener('resize', handler);
    this.cleanupFns.push(() => window.removeEventListener('resize', handler));
  }

  unmount() {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
  }
}
```

**AbortController for Async Cleanup**
```typescript
// CORRECT: Cancel pending operations
class DataFetcher {
  private controller?: AbortController;

  async fetch(url: string) {
    this.controller?.abort();
    this.controller = new AbortController();

    const response = await fetch(url, { signal: this.controller.signal });
    return response.json();
  }

  cancel() {
    this.controller?.abort();
  }
}
```

**Weak References for Caches**
```typescript
// CORRECT: Allow GC to reclaim cached objects
const cache = new WeakMap<object, ComputedResult>();

function getOrCompute(key: object): ComputedResult {
  let result = cache.get(key);
  if (!result) {
    result = computeExpensive(key);
    cache.set(key, result);
  }
  return result;
}
```

### Allocation Optimization

**Efficient Object Accumulation**
```typescript
// CORRECT: Direct property assignment
function indexById<T extends { id: string }>(items: T[]): Record<string, T> {
  const result: Record<string, T> = {};
  for (const item of items) {
    result[item.id] = item;  // No spreading
  }
  return result;
}
```

**Pre-allocated Arrays**
```typescript
// CORRECT: Single allocation when size known
function processItems(items: Item[]): ProcessedItem[] {
  const results = new Array<ProcessedItem>(items.length);
  for (let i = 0; i < items.length; i++) {
    results[i] = process(items[i]);
  }
  return results;
}
```

**Streaming for Large Data**
```typescript
// CORRECT: Process without loading all into memory
async function* readLargeFile(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path);
  const rl = readline.createInterface({ input: stream });

  for await (const line of rl) {
    yield line;
  }
}

// Usage
for await (const line of readLargeFile('huge.csv')) {
  processLine(line);  // Constant memory usage
}
```

---

## I/O Solutions

### Async Patterns

**Async File Operations**
```typescript
// CORRECT: Non-blocking I/O
import fs from 'fs/promises';

async function readConfig() {
  return JSON.parse(await fs.readFile('./config.json', 'utf-8'));
}
```

**Worker Threads for CPU-Intensive**
```typescript
// CORRECT: Offload to worker
import { Worker } from 'worker_threads';

async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./hash-worker.js', {
      workerData: { password }
    });
    worker.on('message', resolve);
    worker.on('error', reject);
  });
}
```

### Parallelism Patterns

**Promise.all for Independent Operations**
```typescript
// CORRECT: Parallel independent fetches
async function loadDashboard(userId: string) {
  const [user, orders, notifications] = await Promise.all([
    getUser(userId),
    getOrders(userId),
    getNotifications(userId)
  ]);
  return { user, orders, notifications };
}
```

**Controlled Concurrency**
```typescript
// CORRECT: Limit parallel operations
async function processAll(items: Item[], concurrency = 5) {
  const results: Result[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const promise = process(item).then(r => {
      results.push(r);
      executing.splice(executing.indexOf(promise), 1);
    });
    executing.push(promise);

    if (executing.length >= concurrency) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}
```

**Promise.allSettled for Fault Tolerance**
```typescript
// CORRECT: Continue despite failures
async function fetchAllWithFallback(urls: string[]) {
  const results = await Promise.allSettled(urls.map(url => fetch(url)));

  return results.map((result, i) => ({
    url: urls[i],
    success: result.status === 'fulfilled',
    data: result.status === 'fulfilled' ? result.value : null,
    error: result.status === 'rejected' ? result.reason : null
  }));
}
```

---

## Frontend Solutions

### React Optimization Patterns

**Memoized Callbacks**
```tsx
// CORRECT: Stable function reference
function UserList({ users, onSelect }: Props) {
  const handleSelect = useCallback((userId: string) => {
    onSelect(userId);
  }, [onSelect]);

  return <List items={users} onSelect={handleSelect} />;
}
```

**Memoized Computed Values**
```tsx
// CORRECT: Only recompute when dependencies change
function Dashboard({ data }: Props) {
  const stats = useMemo(() => computeExpensiveStats(data), [data]);
  return <Stats data={stats} />;
}
```

**Component Memoization**
```tsx
// CORRECT: Skip re-render if props unchanged
const UserCard = memo(function UserCard({ user }: Props) {
  return (
    <div>
      <h3>{user.name}</h3>
      <p>{user.email}</p>
    </div>
  );
});
```

**Lazy Loading**
```tsx
// CORRECT: Load on demand
const HeavyChart = lazy(() => import('./HeavyChart'));

function Dashboard() {
  const [showChart, setShowChart] = useState(false);

  return (
    <div>
      <button onClick={() => setShowChart(true)}>Show Chart</button>
      {showChart && (
        <Suspense fallback={<Spinner />}>
          <HeavyChart />
        </Suspense>
      )}
    </div>
  );
}
```

**Virtualized Lists**
```tsx
// CORRECT: Only render visible items
import { useVirtualizer } from '@tanstack/react-virtual';

function VirtualList({ items }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 35
  });

  return (
    <div ref={parentRef} style={{ height: '400px', overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map(virtualRow => (
          <div
            key={virtualRow.key}
            style={{
              position: 'absolute',
              top: virtualRow.start,
              height: virtualRow.size
            }}
          >
            {items[virtualRow.index].name}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Debounced Input**
```tsx
// CORRECT: Debounce expensive operations
function SearchInput({ onSearch }: Props) {
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
