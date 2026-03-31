# Performance — Violation Examples

Extended violation patterns for performance reviews. Reference from main SKILL.md.
Citations reference `sources.md`.

## Algorithmic Violations [5][12]

### N+1 Query Variants [5]

**ORM Eager Loading Missing** — lazy loading triggers N queries [5]
```typescript
// VIOLATION: Lazy loading triggers N queries [5]
const posts = await Post.findAll();
for (const post of posts) {
  console.log(post.author.name);  // N additional queries
}
```

**GraphQL Resolver N+1** — resolver called per item, not batched [5]
```typescript
// VIOLATION: Resolver called per item — N queries per request [5]
const resolvers = {
  Post: {
    author: async (post) => {
      return db.users.findById(post.authorId);  // N queries
    }
  }
};
```

**Nested Loop Queries** — N*M round-trips [5]
```typescript
// VIOLATION: Query inside nested loop — O(N*M) round-trips [5]
for (const category of categories) {
  for (const product of category.products) {
    const reviews = await db.reviews.findByProductId(product.id);
  }
}
```

### O(n²) or Worse Patterns [12]

**Array.includes in Loop** — O(n) check per iteration [12]
```typescript
// VIOLATION: O(n²) — Array.some is O(n), called n times [12]
function removeDuplicates(items: Item[]) {
  const unique: Item[] = [];
  for (const item of items) {
    if (!unique.some(u => u.id === item.id)) {
      unique.push(item);
    }
  }
  return unique;
}
```

**Nested Array Methods** — O(n*m) with filter inside map [12]
```typescript
// VIOLATION: O(n*m) — filter inside map [12]
function matchItems(list1: Item[], list2: Item[]) {
  return list1.map(item => ({
    ...item,
    matches: list2.filter(i => i.category === item.category)
  }));
}
```

**String Concatenation in Loop** — O(n²) string copies [12]
```typescript
// VIOLATION: O(n²) string copies — new string each iteration [12]
function buildCsv(rows: string[][]): string {
  let csv = '';
  for (const row of rows) {
    csv += row.join(',') + '\n';  // Creates new string each time
  }
  return csv;
}
```

### Inefficient Data Structure Usage [12]

**Object.keys/values/entries in Hot Path** — allocates new array each call [12]
```typescript
// VIOLATION: Creates new array on each call in hot path [12]
function findInObject(obj: Record<string, Item>, predicate: (item: Item) => boolean) {
  for (const key of Object.keys(obj)) {  // Allocates array every call
    if (predicate(obj[key])) {
      return obj[key];
    }
  }
}
```

**Array as Queue** — Array.shift() is O(n) [12]
```typescript
// VIOLATION: shift() is O(n) — reindexes entire array [12]
class Queue<T> {
  private items: T[] = [];

  dequeue(): T | undefined {
    return this.items.shift();  // O(n) - reindexes entire array
  }
}
```

**Spreading in Reduce** — O(n²) total allocations [12]
```typescript
// VIOLATION: Copies entire accumulator on each iteration — O(n²) [12]
const merged = items.reduce((acc, item) => ({
  ...acc,  // Full copy every iteration
  [item.id]: item
}), {});
```

---

## Database Violations [20]

### Missing Index Patterns [20]

**Unindexed Foreign Key** — JOIN without index causes full scan [20]
```sql
-- VIOLATION: Joins without index on order_id [20]
SELECT * FROM orders o
JOIN order_items oi ON o.id = oi.order_id  -- order_id likely unindexed
WHERE o.customer_id = 123;
```

**Unindexed Filter Column** [20]
```typescript
// VIOLATION: Full table scan — last_login probably unindexed [20]
const activeUsers = await db.query(
  'SELECT * FROM users WHERE last_login > ?',
  [thirtyDaysAgo]
);
```

**Composite Index Order Wrong** [20]
```sql
-- Index exists: (customer_id, status)
-- VIOLATION: Query on status alone can't use composite index [20]
SELECT * FROM orders WHERE status = 'pending';
```

### Inefficient Queries [20]

**LIKE with Leading Wildcard** — can't use index [20]
```typescript
// VIOLATION: Leading % prevents index scan [20]
const results = await db.query(
  'SELECT * FROM products WHERE name LIKE ?',
  ['%laptop%']
);
```

**SELECT * on Wide Tables** — fetches unused columns, stresses network [20]
```typescript
// VIOLATION: Fetches all columns — many may be unused [20]
const users = await db.query('SELECT * FROM users WHERE status = ?', ['active']);
```

**Sorting Without Index** — causes filesort [20]
```typescript
// VIOLATION: ORDER BY on unindexed column causes full scan + filesort [20]
const recent = await db.query(
  'SELECT * FROM logs ORDER BY created_at DESC LIMIT 100'
);
```

**OFFSET Pagination on Large Tables** — O(n) even for last pages [20]
```typescript
// VIOLATION: OFFSET scans and discards all prior rows — O(n) [20]
const page = await db.query('SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 100000');
```

---

## Memory Violations [4][10]

### Memory Leak Patterns [4]

**Closure Retaining Large Object** — closure holds entire object for single field [4]
```typescript
// VIOLATION: Closure keeps entire large object alive for just one field [4]
function processLargeData(data: LargeObject) {
  return () => {
    console.log(data.id);  // Only needs id, retains entire data object
  };
}
```

**Timer Without Cleanup** — interval runs until process exit [4]
```typescript
// VIOLATION: Interval never cleared — memory held indefinitely [4]
class Poller {
  start() {
    setInterval(() => this.poll(), 1000);  // Runs forever
  }
}
```

**Observable Without Unsubscribe** [4]
```typescript
// VIOLATION: Subscription never cleaned up [4]
class Component {
  init() {
    eventBus.subscribe('update', this.handleUpdate);  // Memory leak
  }
  // Missing cleanup method
}
```

### False Sharing in Shared Memory [4][10]

**Unpadded Hot Fields** — multiple cores invalidate same cache line [4][10]
```typescript
// VIOLATION: producer and consumer cursors share a cache line [4][10]
class RingBuffer {
  private producerCursor = 0n;  // Same cache line as consumerCursor
  private consumerCursor = 0n;  // Core A writes, Core B reads → thrashing
}
```

### Large Allocation Patterns [4][12]

**Array.concat in Loop** — O(n²) total allocations [12]
```typescript
// VIOLATION: Creates new array each iteration — O(n²) total [12]
let all: Item[] = [];
for (const batch of batches) {
  all = all.concat(batch);
}
```

**JSON Clone in Hot Path** — full serialization/parsing is expensive [4]
```typescript
// VIOLATION: Full JSON round-trip on every call [4]
function processItem(item: Item) {
  const copy = JSON.parse(JSON.stringify(item));  // Expensive in hot path!
}
```

---

## I/O Violations [3][16]

### Blocking Operations [3][16]

**Sync File Operations in Request Handler** — blocks event loop for all requests [3][16]
```typescript
// VIOLATION: Blocks entire event loop during file read [3][16]
app.get('/config', (req, res) => {
  const config = fs.readFileSync('./config.json');  // Blocks!
  res.json(JSON.parse(config));
});
```

**Sync Crypto Operations** — CPU-intensive work blocks event loop [16]
```typescript
// VIOLATION: CPU-intensive sync operation — blocks all I/O [16]
function hashPassword(password: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512');  // Blocks!
}
```

### Sequential vs Parallel [5]

**await in forEach** — fire-and-forget, no back-pressure [5]
```typescript
// VIOLATION: forEach doesn't await — all run concurrently, no control [5]
ids.forEach(async (id) => {
  await processItem(id);  // Fire and forget — uncontrolled concurrency
});
```

**Sequential Processing When Order Doesn't Matter** [5]
```typescript
// VIOLATION: Sequential independent operations — wasted wall-clock time [5]
async function validateAll(items: Item[]) {
  const results = [];
  for (const item of items) {
    results.push(await validate(item));  // Sequential but independent
  }
  return results;
}
```

### Redundant Operations [5]

**Same Data Fetched Multiple Times** — duplicate network cost [5]
```typescript
// VIOLATION: Multiple calls for what could be one [5]
async function buildReport(userId: string) {
  const user = await getUser(userId);
  const profile = await getUserProfile(userId);  // Likely same data
  const permissions = await getUserPermissions(userId);
}
```

---

## Frontend Violations [6][14][15]

### Core Web Vitals Regressions [6][17]

**Unoptimized LCP Image** — large images delay LCP [6]
```html
<!-- VIOLATION: LCP image not preloaded — browser discovers it late [6] -->
<img src="/hero.jpg" alt="Hero" />
```

**Long Task Blocking INP** — synchronous work > 50ms on click [21]
```typescript
// VIOLATION: Synchronous heavy computation on click — blocks input [21]
button.addEventListener('click', () => {
  const result = processEntireDataset(bigData);  // Blocks for 500ms
  render(result);
});
```

**Layout Shift from Dynamic Content** — CLS violation [6]
```tsx
// VIOLATION: Image without dimensions causes layout shift [6]
<img src={user.avatar} alt={user.name} />  // No width/height — CLS!
```

### Re-render Patterns [15]

**Inline Object/Array in JSX** — new reference every render [15]
```tsx
// VIOLATION: New reference every render — child always re-renders [15]
<Component
  options={{ show: true, animate: false }}  // New object each render
  items={[1, 2, 3]}  // New array each render
/>
```

**Inline Arrow in JSX** — new function every render [15]
```tsx
// VIOLATION: New function every render — breaks memo [15]
<Button onClick={() => handleClick(item.id)} />
```

**Index as Key** — breaks reconciliation on reorder [15]
```tsx
// VIOLATION: Index key causes unnecessary unmount/remount on reorder [15]
{items.map((item, index) => (
  <Item key={index} {...item} />
))}
```

### Missing Optimization [14][15][18]

**Expensive Computation Every Render** [15]
```tsx
// VIOLATION: Recalculates on every render — no memoization [15]
function Dashboard({ data }) {
  const stats = computeExpensiveStats(data);  // Runs every render
  return <Stats data={stats} />;
}
```

**Large Component Tree Without Code Splitting** [14][18]
```tsx
// VIOLATION: Loads everything upfront — large initial bundle [14][18]
import HugeChartLibrary from 'huge-chart-lib';
import RarelyUsedFeature from './RarelyUsedFeature';
// All loaded even if never shown
```

**Unthrottled Scroll Handler** [3]
```tsx
// VIOLATION: Fires 60+ times per second, DOM updates each time [3]
window.addEventListener('scroll', () => {
  updateParallax();  // 60+ calls per second
});
```

---

## Measurement Violations [1][8]

### Premature Optimization [1]

**Optimizing Without Profiling** — the cardinal sin [1]
```typescript
// VIOLATION: Micro-optimizing without evidence of bottleneck [1]
// HACK: Using bitshift instead of division for "performance"
const half = value >> 1;  // No benchmark proves this matters
```

### Faulty Measurement [8]

**Average Latency Reported as P99** — averages hide tail [8][11]
```typescript
// VIOLATION: Mean conceals tail latency issues [8]
const avgLatency = measurements.reduce((a, b) => a + b) / measurements.length;
console.log(`Latency: ${avgLatency}ms`);  // Hides P99 spikes
```

**Measurement Under Cold JIT** — V8 not warmed up [13][25]
```typescript
// VIOLATION: Single cold-path measurement — JIT not warmed up [13][25]
const start = Date.now();
const result = expensiveFunction(data);  // V8 interprets, not compiles
console.log(`Time: ${Date.now() - start}ms`);
```

**Coordinated Omission** — not measuring wait time under load [8]
```typescript
// VIOLATION: Issues requests sequentially — hides queuing latency [8]
for (const request of requests) {
  const start = Date.now();
  await sendRequest(request);  // Wait before next — omits queuing delay
  record(Date.now() - start);
}
```
