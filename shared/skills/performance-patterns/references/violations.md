# Performance Violation Examples

Extended violation patterns for performance reviews. Reference from main SKILL.md.

## Algorithmic Violations

### N+1 Query Variants

**ORM Eager Loading Missing**
```typescript
// VIOLATION: Lazy loading triggers N queries
const posts = await Post.findAll();
for (const post of posts) {
  console.log(post.author.name);  // N additional queries
}
```

**GraphQL Resolver N+1**
```typescript
// VIOLATION: Resolver called per item
const resolvers = {
  Post: {
    author: async (post) => {
      return db.users.findById(post.authorId);  // N queries
    }
  }
};
```

**Nested Loop Queries**
```typescript
// VIOLATION: Query inside nested loop
for (const category of categories) {
  for (const product of category.products) {
    const reviews = await db.reviews.findByProductId(product.id);  // N*M queries
  }
}
```

### O(n^2) or Worse Patterns

**Array.includes in Loop**
```typescript
// VIOLATION: O(n^2) - includes is O(n)
function removeDuplicates(items: Item[]) {
  const unique: Item[] = [];
  for (const item of items) {
    if (!unique.some(u => u.id === item.id)) {  // O(n) check each time
      unique.push(item);
    }
  }
  return unique;
}
```

**Nested Array Methods**
```typescript
// VIOLATION: O(n*m) - filter inside map
function matchItems(list1: Item[], list2: Item[]) {
  return list1.map(item => ({
    ...item,
    matches: list2.filter(i => i.category === item.category)  // O(m) per item
  }));
}
```

**String Concatenation in Loop**
```typescript
// VIOLATION: O(n^2) string copies
function buildCsv(rows: string[][]): string {
  let csv = '';
  for (const row of rows) {
    csv += row.join(',') + '\n';  // Creates new string each time
  }
  return csv;
}
```

### Inefficient Data Structure Usage

**Object.keys/values/entries in Hot Path**
```typescript
// VIOLATION: Creates new array on each call
function findInObject(obj: Record<string, Item>, predicate: (item: Item) => boolean) {
  for (const key of Object.keys(obj)) {  // Allocates array
    if (predicate(obj[key])) {
      return obj[key];
    }
  }
}
```

**Array as Queue/Stack**
```typescript
// VIOLATION: shift() is O(n)
class Queue<T> {
  private items: T[] = [];

  dequeue(): T | undefined {
    return this.items.shift();  // O(n) - reindexes entire array
  }
}
```

---

## Database Violations

### Missing Index Patterns

**Unindexed Foreign Key**
```sql
-- VIOLATION: Joins without index
SELECT * FROM orders o
JOIN order_items oi ON o.id = oi.order_id  -- order_id likely unindexed
WHERE o.customer_id = 123;
```

**Unindexed Filter Column**
```typescript
// VIOLATION: Filters on unindexed column
const activeUsers = await db.query(
  'SELECT * FROM users WHERE last_login > ?',  // last_login probably unindexed
  [thirtyDaysAgo]
);
```

**Composite Index Order Wrong**
```sql
-- Index exists: (customer_id, status)
-- VIOLATION: Query doesn't use index efficiently
SELECT * FROM orders WHERE status = 'pending';  -- Can't use composite index
```

### Inefficient Queries

**LIKE with Leading Wildcard**
```typescript
// VIOLATION: Can't use index
const results = await db.query(
  'SELECT * FROM products WHERE name LIKE ?',
  ['%laptop%']  // Leading % prevents index usage
);
```

**OR Instead of IN**
```typescript
// VIOLATION: OR conditions often slower
const users = await db.query(
  'SELECT * FROM users WHERE status = ? OR status = ? OR status = ?',
  ['active', 'pending', 'trial']
);

// Better: Use IN clause
const users = await db.query(
  'SELECT * FROM users WHERE status IN (?, ?, ?)',
  ['active', 'pending', 'trial']
);
```

**Sorting Without Index**
```typescript
// VIOLATION: ORDER BY on unindexed column causes filesort
const recent = await db.query(
  'SELECT * FROM logs ORDER BY created_at DESC LIMIT 100'  // No index on created_at
);
```

---

## Memory Violations

### Memory Leak Patterns

**Closure Retaining Large Object**
```typescript
// VIOLATION: Closure keeps entire large object alive
function processLargeData(data: LargeObject) {
  return () => {
    console.log(data.id);  // Only needs id, but retains entire data object
  };
}
```

**Timer Without Cleanup**
```typescript
// VIOLATION: Interval never cleared
class Poller {
  start() {
    setInterval(() => this.poll(), 1000);  // Runs forever
  }
}
```

**Observable Without Unsubscribe**
```typescript
// VIOLATION: Subscription never cleaned up
class Component {
  init() {
    eventBus.subscribe('update', this.handleUpdate);  // Memory leak
  }
  // Missing cleanup method
}
```

### Large Allocation Patterns

**Spreading in Reduce**
```typescript
// VIOLATION: Creates new object on each iteration
const merged = items.reduce((acc, item) => ({
  ...acc,  // Copies entire accumulator each time
  [item.id]: item
}), {});
```

**Array.concat in Loop**
```typescript
// VIOLATION: Creates new array each iteration
let all: Item[] = [];
for (const batch of batches) {
  all = all.concat(batch);  // O(n^2) total allocations
}
```

**JSON Clone in Hot Path**
```typescript
// VIOLATION: Full serialization/parsing
function processItem(item: Item) {
  const copy = JSON.parse(JSON.stringify(item));  // Expensive!
  // ... modify copy
}
```

---

## I/O Violations

### Blocking Operations

**Sync File Operations in Request Handler**
```typescript
// VIOLATION: Blocks event loop
app.get('/config', (req, res) => {
  const config = fs.readFileSync('./config.json');  // Blocks!
  res.json(JSON.parse(config));
});
```

**Sync Crypto Operations**
```typescript
// VIOLATION: CPU-intensive sync operation
function hashPassword(password: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512');  // Blocks!
}
```

### Sequential vs Parallel

**await in forEach (No Parallelism)**
```typescript
// VIOLATION: forEach doesn't wait, unpredictable behavior
ids.forEach(async (id) => {
  await processItem(id);  // Fire and forget!
});
```

**Sequential Processing When Order Doesn't Matter**
```typescript
// VIOLATION: Could be parallel
async function validateAll(items: Item[]) {
  const results = [];
  for (const item of items) {
    results.push(await validate(item));  // Sequential but independent
  }
  return results;
}
```

### Redundant Operations

**Same Data Fetched Multiple Times**
```typescript
// VIOLATION: Duplicate API calls
async function buildReport(userId: string) {
  const user = await getUser(userId);
  const profile = await getUserProfile(userId);  // Probably same data
  const permissions = await getUserPermissions(userId);  // Another call
}
```

**Cache Miss on Every Request**
```typescript
// VIOLATION: No caching strategy
async function getConfig() {
  return await fetchFromRemote('/config');  // Network call every time
}
```

---

## Frontend Violations

### Re-render Patterns

**Inline Object/Array in JSX**
```tsx
// VIOLATION: New reference every render
<Component
  options={{ show: true, animate: false }}  // New object each render
  items={[1, 2, 3]}  // New array each render
/>
```

**Inline Arrow in JSX**
```tsx
// VIOLATION: New function every render
<Button onClick={() => handleClick(item.id)} />  // New function each render
```

**Missing Key or Index as Key**
```tsx
// VIOLATION: Index as key breaks reconciliation
{items.map((item, index) => (
  <Item key={index} {...item} />  // Index key causes issues on reorder
))}
```

### Missing Optimization

**Expensive Computation Every Render**
```tsx
// VIOLATION: Recalculates on every render
function Dashboard({ data }) {
  const stats = computeExpensiveStats(data);  // Runs every render
  return <Stats data={stats} />;
}
```

**Unthrottled Event Handler**
```tsx
// VIOLATION: Fires on every scroll pixel
window.addEventListener('scroll', () => {
  updateParallax();  // 60+ calls per second
});
```

**Large Component Tree Without Code Splitting**
```tsx
// VIOLATION: Loads everything upfront
import HugeChartLibrary from 'huge-chart-lib';
import RarelyUsedFeature from './RarelyUsedFeature';
// All loaded even if not used
```
