# Performance — Correct Patterns

Extended correct patterns for performance optimization. Reference from main SKILL.md.
Citations reference `sources.md`.

## Algorithmic Solutions [5][12]

### N+1 Query Solutions [5]

**ORM Eager Loading** — single query with JOIN instead of N round-trips [5]
```typescript
// CORRECT: Include related data in single query [5]
const posts = await Post.findAll({
  include: [
    { model: User, as: 'author' },
    { model: Comment, limit: 10 }
  ]
});
```

**GraphQL DataLoader** — batch and cache per request [5]
```typescript
// CORRECT: Batch and cache with DataLoader [5]
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

**Batch Query with Map** — O(1) lookup after single fetch [5][12]
```typescript
// CORRECT: Single query, O(1) map lookup per result [5][12]
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

### Efficient Algorithm Patterns [12]

**Set for O(1) Lookup** — replaces O(n) array scan [12]
```typescript
// CORRECT: O(n+m) instead of O(n*m) [12]
function findCommon(list1: string[], list2: string[]) {
  const set = new Set(list2);
  return list1.filter(item => set.has(item));
}
```

**Map for Single-Pass Grouping** [12]
```typescript
// CORRECT: Single pass grouping — O(n) [12]
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

**Efficient String Building** — avoid O(n²) string copies [12]
```typescript
// CORRECT: Array join instead of string concat [12]
function buildCsv(rows: string[][]): string {
  return rows.map(row => row.join(',')).join('\n');
}

// For very large data: streaming — O(1) memory [12]
function* streamCsv(rows: string[][]): Generator<string> {
  for (const row of rows) {
    yield row.join(',') + '\n';
  }
}
```

**Proper Queue Implementation** — O(1) dequeue with circular buffer [12]
```typescript
// CORRECT: O(1) dequeue — no reindexing [12]
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

## Database Solutions [20]

### Indexing Strategies [20]

**Composite Index for Range Queries** [20]
```sql
-- CORRECT: Index supports both equality and range [20]
CREATE INDEX idx_orders_customer_date ON orders(customer_id, created_at DESC);

-- Efficient query
SELECT * FROM orders
WHERE customer_id = 123
ORDER BY created_at DESC
LIMIT 10;
```

**Covering Index** — query satisfied from index alone [20]
```sql
-- CORRECT: Index includes all needed columns [20]
CREATE INDEX idx_users_status_email ON users(status) INCLUDE (email, name);

-- Query satisfied entirely from index — no heap fetch
SELECT email, name FROM users WHERE status = 'active';
```

**Partial Index for Common Filters** [20]
```sql
-- CORRECT: Index only relevant rows — smaller, faster [20]
CREATE INDEX idx_orders_pending ON orders(created_at)
WHERE status = 'pending';
```

### Efficient Query Patterns [20]

**Select Specific Columns** — avoids fetching unused data [20]
```typescript
// CORRECT: Only fetch needed data [20]
const users = await db.query(
  'SELECT id, name, email FROM users WHERE status = ?',
  ['active']
);
```

**Cursor-Based Pagination** — efficient for large datasets [20]
```typescript
// CORRECT: Cursor pagination — O(log n) vs OFFSET O(n) [20]
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

**Batch Processing Large Tables** [20]
```typescript
// CORRECT: Process in chunks to avoid memory issues [20]
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

## Memory Solutions [4][10]

### Cleanup Patterns [4]

**Event Listener Cleanup** — track and remove on unmount [4]
```typescript
// CORRECT: Track and cleanup listeners [4]
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

**AbortController for Async Cleanup** [3]
```typescript
// CORRECT: Cancel pending operations on unmount [3]
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

**Weak References for Caches** — allow GC to reclaim entries [4]
```typescript
// CORRECT: WeakMap allows GC to reclaim cached objects [4]
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

### Cache Line Awareness [4][10]

High-throughput code: keep hot mutable data in separate 64-byte cache lines to avoid
false sharing between CPU cores [4][10]. The LMAX Disruptor demonstrates this with
sequence number padding [10].

```typescript
// CORRECT: Pad hot fields to prevent false sharing [10]
class RingBuffer {
  // Pad each cursor to its own cache line (64 bytes)
  private readonly producerCursor = new Int64Array(
    new SharedArrayBuffer(64)  // 64-byte aligned
  );
  private readonly consumerCursor = new Int64Array(
    new SharedArrayBuffer(64)
  );
}
```

### Allocation Optimization [4][12]

**Efficient Object Accumulation** — direct assignment, no spreading in hot loops [12]
```typescript
// CORRECT: Direct property assignment — no intermediate allocations [12]
function indexById<T extends { id: string }>(items: T[]): Record<string, T> {
  const result: Record<string, T> = {};
  for (const item of items) {
    result[item.id] = item;
  }
  return result;
}
```

**Streaming for Large Data** — O(1) memory regardless of input size [4]
```typescript
// CORRECT: Process without loading all into memory [4]
async function* readLargeFile(path: string): AsyncGenerator<string> {
  const stream = createReadStream(path);
  const rl = readline.createInterface({ input: stream });

  for await (const line of rl) {
    yield line;
  }
}
```

---

## I/O Solutions [3][16]

### Async Patterns [3][16]

**Async File Operations** — non-blocking I/O frees event loop [16]
```typescript
// CORRECT: Non-blocking I/O [16]
import fs from 'fs/promises';

async function readConfig() {
  return JSON.parse(await fs.readFile('./config.json', 'utf-8'));
}
```

**Worker Threads for CPU-Intensive Work** — offload off the event loop [16]
```typescript
// CORRECT: Offload CPU work to worker thread [16]
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

### Parallelism Patterns [5]

**Promise.all for Independent Operations** [5]
```typescript
// CORRECT: Parallel independent fetches — total time = max(fetches) [5]
async function loadDashboard(userId: string) {
  const [user, orders, notifications] = await Promise.all([
    getUser(userId),
    getOrders(userId),
    getNotifications(userId)
  ]);
  return { user, orders, notifications };
}
```

**Controlled Concurrency** — avoid overwhelming downstream services [11]
```typescript
// CORRECT: Limit parallel operations — prevent overload [11]
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

---

## Frontend Solutions [6][14][15]

### Core Web Vitals Optimization [6][17]

**LCP Optimization** — largest visible element must load fast [6]
```html
<!-- CORRECT: Preload LCP image — tells browser early [6] -->
<link rel="preload" as="image" href="/hero.webp" fetchpriority="high" />
```

**INP Optimization** — interactions must complete within 200ms [21]
```typescript
// CORRECT: Yield to browser between heavy tasks [21]
async function handleClick() {
  processFirstChunk();
  await scheduler.yield();  // Let browser render, process input
  processSecondChunk();
}
```

### React Optimization Patterns [15]

**Memoized Callbacks** — stable function reference prevents child re-renders
```tsx
// CORRECT: Stable function reference [15]
function UserList({ users, onSelect }: Props) {
  const handleSelect = useCallback((userId: string) => {
    onSelect(userId);
  }, [onSelect]);

  return <List items={users} onSelect={handleSelect} />;
}
```

**Memoized Computed Values** [15]
```tsx
// CORRECT: Only recompute when dependencies change [15]
function Dashboard({ data }: Props) {
  const stats = useMemo(() => computeExpensiveStats(data), [data]);
  return <Stats data={stats} />;
}
```

**Virtualized Lists** — render only visible rows [14]
```tsx
// CORRECT: Only render visible items — O(viewport) not O(n) [14]
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
            style={{ position: 'absolute', top: virtualRow.start, height: virtualRow.size }}
          >
            {items[virtualRow.index].name}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Lazy Loading for Code Splitting** [14][18]
```tsx
// CORRECT: Load on demand — reduces initial bundle [14][18]
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

---

## Measurement Patterns [1][2][8][9]

### USE Method Application [1]

For each system resource: CPU, memory, disk, network:
1. **Utilization** — time resource was busy (e.g., CPU at 80%)
2. **Saturation** — degree of queuing beyond capacity (e.g., run-queue > 0)
3. **Errors** — error events (e.g., network retransmits)

### Flame Graph Interpretation [9]

Widest frames at top = hottest call paths. Optimize the widest towers, not the tallest stacks.

### HDR Histogram for Latency [8]

```typescript
// CORRECT: HDR histogram captures full distribution without coordinated omission [8]
import { Histogram } from 'hdr-histogram-js';

const histogram = new Histogram(1, 3_600_000, 3);  // 1ns to 1hr, 3 sig figs

function recordLatency(startNs: bigint) {
  const latencyNs = Number(process.hrtime.bigint() - startNs);
  histogram.recordValue(latencyNs);
}

// Report meaningful percentiles
console.log(`P50: ${histogram.getValueAtPercentile(50)}ns`);
console.log(`P99: ${histogram.getValueAtPercentile(99)}ns`);
console.log(`P999: ${histogram.getValueAtPercentile(99.9)}ns`);
```

### Node.js Performance Measurement [16]

```typescript
// CORRECT: Use performance.mark for operation timing [16]
performance.mark('op:start');
await doExpensiveOperation();
performance.mark('op:end');
performance.measure('expensive-op', 'op:start', 'op:end');

const [entry] = performance.getEntriesByName('expensive-op');
console.log(`Duration: ${entry.duration}ms`);
```
