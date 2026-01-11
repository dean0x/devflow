---
name: devflow-performance-patterns
description: Performance optimization and bottleneck detection. Load when reviewing code for algorithmic complexity, memory issues, I/O inefficiencies, or caching concerns. Used by Reviewer agent with performance focus.
allowed-tools: Read, Grep, Glob
---

# Performance Patterns

Domain expertise for performance optimization and bottleneck detection. Use alongside `devflow-review-methodology` for complete performance reviews.

## Iron Law

> **MEASURE BEFORE OPTIMIZING**
>
> Premature optimization is the root of all evil. Profile first, then optimize. Every
> performance claim requires benchmarks. "It feels slow" is not a metric. O(n) with small n
> beats O(1) with huge constants. Optimize for the real bottleneck, not the imagined one.

## Performance Categories

### 1. Algorithmic Issues

**N+1 Query Problem**
```typescript
// PROBLEM: 1 query + N queries
const users = await db.users.findAll();
for (const user of users) {
  const orders = await db.orders.findByUserId(user.id);  // N queries!
  user.orders = orders;
}

// SOLUTION: Eager loading or batch query
const users = await db.users.findAll({
  include: [{ model: Order }]  // 1-2 queries total
});

// Or batch query
const users = await db.users.findAll();
const userIds = users.map(u => u.id);
const orders = await db.orders.findAll({ where: { userId: userIds } });
const ordersByUser = groupBy(orders, 'userId');
users.forEach(u => u.orders = ordersByUser[u.id] || []);
```

**O(n^2) or Worse**
```typescript
// PROBLEM: Nested loops
function findDuplicates(items: Item[]) {
  const duplicates = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].id === items[j].id) {  // O(n^2)
        duplicates.push(items[i]);
      }
    }
  }
  return duplicates;
}

// SOLUTION: Use a Set or Map
function findDuplicates(items: Item[]) {
  const seen = new Set<string>();
  const duplicates: Item[] = [];
  for (const item of items) {
    if (seen.has(item.id)) {
      duplicates.push(item);
    } else {
      seen.add(item.id);  // O(n) total
    }
  }
  return duplicates;
}
```

**Inefficient Search**
```typescript
// PROBLEM: Linear search in loop
function findMatches(needles: string[], haystack: string[]) {
  return needles.filter(n => haystack.includes(n));  // O(n*m)
}

// SOLUTION: Convert to Set for O(1) lookup
function findMatches(needles: string[], haystack: string[]) {
  const haystackSet = new Set(haystack);
  return needles.filter(n => haystackSet.has(n));  // O(n+m)
}
```

### 2. Database Issues

**Missing Indexes**
```sql
-- PROBLEM: Full table scan
SELECT * FROM orders WHERE customer_id = 123;
-- Without index on customer_id: scans all rows

-- SOLUTION: Add index
CREATE INDEX idx_orders_customer_id ON orders(customer_id);

-- Composite index for multiple conditions
CREATE INDEX idx_orders_customer_status ON orders(customer_id, status);
```

**SELECT ***
```typescript
// PROBLEM: Fetches all columns
const users = await db.query('SELECT * FROM users WHERE status = ?', ['active']);

// SOLUTION: Select only needed columns
const users = await db.query(
  'SELECT id, name, email FROM users WHERE status = ?',
  ['active']
);
```

**Large Result Sets Without Pagination**
```typescript
// PROBLEM: Loads millions of rows
const allOrders = await db.orders.findAll();

// SOLUTION: Paginate or stream
const orders = await db.orders.findAll({
  limit: 100,
  offset: page * 100,
  order: [['createdAt', 'DESC']]
});

// Or use cursor-based pagination
const orders = await db.orders.findAll({
  where: { id: { [Op.gt]: lastId } },
  limit: 100,
  order: [['id', 'ASC']]
});
```

### 3. Memory Issues

**Memory Leaks**
```typescript
// PROBLEM: Event listeners not cleaned up
class Component {
  mount() {
    window.addEventListener('resize', this.handleResize);
  }
  // Missing unmount() to remove listener
}

// SOLUTION: Clean up resources
class Component {
  mount() {
    window.addEventListener('resize', this.handleResize);
  }
  unmount() {
    window.removeEventListener('resize', this.handleResize);
  }
}
```

**Large Allocations in Loops**
```typescript
// PROBLEM: Creates new arrays/objects every iteration
function processItems(items: Item[]) {
  for (const item of items) {
    const result = JSON.parse(JSON.stringify(item));  // Full clone each time
    const tags = item.tags.map(t => t.toLowerCase());  // New array each time
    // ...
  }
}

// SOLUTION: Reuse or process in place
function processItems(items: Item[]) {
  for (const item of items) {
    // Mutate if ownership is clear, or process lazily
    for (const tag of item.tags) {
      processTag(tag.toLowerCase());
    }
  }
}
```

**Unbounded Caches**
```typescript
// PROBLEM: Cache grows forever
const cache = new Map<string, Result>();

function getCached(key: string): Result {
  if (!cache.has(key)) {
    cache.set(key, computeExpensive(key));  // Never evicted!
  }
  return cache.get(key)!;
}

// SOLUTION: LRU cache with limit
import LRU from 'lru-cache';
const cache = new LRU<string, Result>({ max: 1000 });
```

### 4. I/O Issues

**Blocking Operations**
```typescript
// PROBLEM: Synchronous I/O blocks event loop
import fs from 'fs';

function readConfig() {
  return fs.readFileSync('./config.json', 'utf-8');  // Blocks!
}

// SOLUTION: Use async
import fs from 'fs/promises';

async function readConfig() {
  return fs.readFile('./config.json', 'utf-8');
}
```

**Sequential Async When Parallel Possible**
```typescript
// PROBLEM: Sequential execution
async function fetchAll(ids: string[]) {
  const results = [];
  for (const id of ids) {
    results.push(await fetchItem(id));  // One at a time
  }
  return results;
}

// SOLUTION: Parallel execution
async function fetchAll(ids: string[]) {
  return Promise.all(ids.map(id => fetchItem(id)));
}

// Or with concurrency limit
import pLimit from 'p-limit';
const limit = pLimit(5);

async function fetchAll(ids: string[]) {
  return Promise.all(ids.map(id => limit(() => fetchItem(id))));
}
```

**Redundant API Calls**
```typescript
// PROBLEM: Same data fetched multiple times
async function renderDashboard(userId: string) {
  const user = await getUser(userId);
  const orders = await getOrders(userId);
  const user2 = await getUser(userId);  // Duplicate!

  return { user: user2, orders };
}

// SOLUTION: Fetch once, pass around
async function renderDashboard(userId: string) {
  const [user, orders] = await Promise.all([
    getUser(userId),
    getOrders(userId)
  ]);
  return { user, orders };
}
```

### 5. Rendering Issues (Frontend)

**Unnecessary Re-renders**
```tsx
// PROBLEM: New object reference every render
function UserList({ users }) {
  return (
    <List
      items={users}
      style={{ margin: 10 }}  // New object every render!
      onSelect={(u) => console.log(u)}  // New function every render!
    />
  );
}

// SOLUTION: Memoize or extract constants
const listStyle = { margin: 10 };

function UserList({ users }) {
  const handleSelect = useCallback((u) => console.log(u), []);

  return <List items={users} style={listStyle} onSelect={handleSelect} />;
}
```

**Missing Virtualization for Long Lists**
```tsx
// PROBLEM: Renders 10000 DOM nodes
function UserList({ users }) {
  return (
    <ul>
      {users.map(u => <li key={u.id}>{u.name}</li>)}
    </ul>
  );
}

// SOLUTION: Virtual list
import { FixedSizeList } from 'react-window';

function UserList({ users }) {
  return (
    <FixedSizeList height={400} itemCount={users.length} itemSize={35}>
      {({ index, style }) => (
        <div style={style}>{users[index].name}</div>
      )}
    </FixedSizeList>
  );
}
```

---

## Severity Guidelines

**CRITICAL** - Severe performance degradation:
- N+1 queries in loops with unbounded data
- O(n^2) or worse on large datasets
- Memory leaks in long-running processes
- Blocking I/O in request handlers
- Missing database indexes on high-traffic queries

**HIGH** - Significant performance impact:
- Sequential async when parallel possible
- SELECT * on large tables
- Unbounded caches/collections
- Large allocations in hot paths
- Missing pagination on list endpoints

**MEDIUM** - Moderate performance concern:
- Suboptimal algorithm with small data
- Missing memoization in renders
- Redundant data fetching
- Inefficient data structures

**LOW** - Minor optimization opportunity:
- Micro-optimizations
- Style over performance
- Premature optimization candidates

---

## Detection Patterns

Search for these patterns in code:

```bash
# N+1 queries (await in loop)
grep -rn "for.*await\|\.forEach.*await\|\.map.*await" --include="*.ts"

# Synchronous I/O
grep -rn "readFileSync\|writeFileSync\|existsSync\|statSync" --include="*.ts"

# Missing indexes (check query patterns)
grep -rn "WHERE.*=" --include="*.sql" --include="*.ts"

# SELECT *
grep -rn "SELECT \*" --include="*.ts" --include="*.sql"

# Nested loops
grep -rn "for.*{" -A10 --include="*.ts" | grep -B5 "for.*{"

# Large allocations in loops
grep -rn "\.map\|\.filter\|JSON.parse\|JSON.stringify" --include="*.ts" | grep -i "for\|while\|each"
```

---

## Performance Metrics Reference

| Operation | Good | Warning | Critical |
|-----------|------|---------|----------|
| API response | < 100ms | 100-500ms | > 500ms |
| Database query | < 10ms | 10-100ms | > 100ms |
| Page load (FCP) | < 1s | 1-2.5s | > 2.5s |
| Memory per request | < 10MB | 10-50MB | > 50MB |
| Bundle size | < 200KB | 200-500KB | > 500KB |

