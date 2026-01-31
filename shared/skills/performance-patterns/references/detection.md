# Performance Detection Patterns

Commands and techniques for detecting performance issues. Reference from main SKILL.md.

## Static Analysis Commands

### N+1 Query Detection

```bash
# Await in loop patterns
grep -rn "for.*{" -A10 --include="*.ts" | grep -E "await|\.then"

# forEach with async (fire-and-forget bug)
grep -rn "\.forEach\s*\(\s*async" --include="*.ts"

# Map with await (sequential, not parallel)
grep -rn "\.map\s*\(\s*async.*await" --include="*.ts"

# Sequelize/TypeORM lazy loading
grep -rn "get[A-Z].*\(\)" --include="*.ts" | grep -v "\.get("
```

### Algorithmic Complexity Detection

```bash
# Nested loops
grep -rn "for.*{" -A15 --include="*.ts" | grep -c "for.*{"

# Array.includes/indexOf in loop
grep -rn "\.includes\|\.indexOf" --include="*.ts" | grep -E "for|while|each"

# Nested array methods
grep -rn "\.filter.*\.filter\|\.map.*\.map\|\.find.*\.find" --include="*.ts"

# String concatenation in loop
grep -rn "+=.*['\"\`]" --include="*.ts" | grep -E "for|while"
```

### Database Issue Detection

```bash
# SELECT * patterns
grep -rn "SELECT \*" --include="*.ts" --include="*.sql"

# Missing LIMIT on queries
grep -rn "findAll\|findMany" --include="*.ts" | grep -v "limit\|take"

# LIKE with leading wildcard
grep -rn "LIKE.*['\"]%" --include="*.ts" --include="*.sql"

# ORDER BY without limit
grep -rn "ORDER BY" --include="*.ts" | grep -v -i "limit"
```

### Memory Issue Detection

```bash
# Unbounded collections
grep -rn "new Map\|new Set\|= \[\]" --include="*.ts" | grep -v "const.*="

# Missing cleanup patterns
grep -rn "addEventListener" --include="*.ts" | head -20
grep -rn "removeEventListener" --include="*.ts" | head -20
# Compare counts

# setInterval without clear
grep -rn "setInterval" --include="*.ts"
grep -rn "clearInterval" --include="*.ts"
# Compare counts

# Spreading in reduce
grep -rn "\.reduce.*\.\.\.acc\|\.reduce.*\.\.\.prev" --include="*.ts"
```

### I/O Issue Detection

```bash
# Synchronous file operations
grep -rn "readFileSync\|writeFileSync\|existsSync\|statSync\|readdirSync" --include="*.ts"

# Sequential awaits (could be parallel)
grep -rn "await.*\n.*await.*\n.*await" --include="*.ts"

# Missing error handling on fetch
grep -rn "await fetch" --include="*.ts" | grep -v "try\|catch\|\.catch"
```

### Frontend Issue Detection

```bash
# Inline functions in JSX
grep -rn "onClick={() =>\|onChange={() =>\|onSubmit={() =>" --include="*.tsx"

# Inline objects in JSX
grep -rn "style={{ " --include="*.tsx"

# Missing useMemo/useCallback
grep -rn "const.*=.*=>" --include="*.tsx" | grep -v "useMemo\|useCallback\|useState\|useEffect"

# Index as key
grep -rn "key={.*index\|key={\`.*index" --include="*.tsx"
```

---

## Profiling Techniques

### Node.js Profiling

**CPU Profiling**
```bash
# Start with profiler
node --prof app.js

# Process the log
node --prof-process isolate-*.log > profile.txt

# Or use clinic.js
npx clinic doctor -- node app.js
npx clinic flame -- node app.js
```

**Memory Profiling**
```bash
# Heap snapshot
node --inspect app.js
# Open chrome://inspect and take heap snapshot

# Memory usage tracking
node --expose-gc app.js
# In code: global.gc() and process.memoryUsage()
```

**Event Loop Monitoring**
```typescript
// Detect blocked event loop
const start = Date.now();
setImmediate(() => {
  const lag = Date.now() - start;
  if (lag > 100) {
    console.warn(`Event loop lag: ${lag}ms`);
  }
});
```

### Database Profiling

**Query Analysis**
```sql
-- PostgreSQL: Explain analyze
EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 123;

-- MySQL: Show query plan
EXPLAIN SELECT * FROM orders WHERE customer_id = 123;

-- Find slow queries (PostgreSQL)
SELECT query, calls, total_time, mean_time
FROM pg_stat_statements
ORDER BY total_time DESC
LIMIT 10;
```

**Index Analysis**
```sql
-- PostgreSQL: Missing indexes
SELECT schemaname, tablename, attname, null_frac, n_distinct
FROM pg_stats
WHERE schemaname = 'public'
AND tablename = 'orders';

-- Check index usage
SELECT indexrelname, idx_scan, idx_tup_read
FROM pg_stat_user_indexes
WHERE schemaname = 'public';
```

### Frontend Profiling

**React DevTools Profiler**
```tsx
// Wrap component to measure
import { Profiler } from 'react';

function onRender(id, phase, actualDuration) {
  console.log(`${id} ${phase}: ${actualDuration}ms`);
}

<Profiler id="MyComponent" onRender={onRender}>
  <MyComponent />
</Profiler>
```

**Performance API**
```typescript
// Measure specific operations
performance.mark('start');
doExpensiveOperation();
performance.mark('end');
performance.measure('operation', 'start', 'end');

const measure = performance.getEntriesByName('operation')[0];
console.log(`Duration: ${measure.duration}ms`);
```

**Lighthouse CLI**
```bash
# Run Lighthouse audit
npx lighthouse https://example.com --output=json --output-path=./report.json

# Focus on performance
npx lighthouse https://example.com --only-categories=performance
```

---

## Automated Detection

### ESLint Rules

```json
{
  "rules": {
    "no-await-in-loop": "error",
    "no-sync": "error",
    "react-hooks/exhaustive-deps": "warn"
  }
}
```

### Custom ESLint Rule (N+1 Detection)

```javascript
// eslint-rules/no-await-in-foreach.js
module.exports = {
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.property?.name === 'forEach' &&
          node.arguments[0]?.async
        ) {
          context.report({
            node,
            message: 'Avoid async forEach - use for...of or Promise.all'
          });
        }
      }
    };
  }
};
```

### CI Integration

```yaml
# .github/workflows/performance.yml
name: Performance Check
on: [pull_request]

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Check for sync I/O
        run: |
          if grep -rn "Sync(" --include="*.ts" src/; then
            echo "::error::Synchronous I/O detected"
            exit 1
          fi

      - name: Check for N+1 patterns
        run: |
          if grep -rn "\.forEach.*async" --include="*.ts" src/; then
            echo "::warning::Potential N+1 pattern detected"
          fi

      - name: Bundle size check
        run: |
          npm run build
          size=$(du -sb dist/ | cut -f1)
          if [ $size -gt 500000 ]; then
            echo "::error::Bundle too large: $size bytes"
            exit 1
          fi
```

---

## Performance Monitoring

### Application Metrics

```typescript
// Track key metrics
const metrics = {
  requestDuration: new Histogram({
    name: 'http_request_duration_ms',
    help: 'Request duration in milliseconds',
    buckets: [10, 50, 100, 200, 500, 1000]
  }),

  dbQueryDuration: new Histogram({
    name: 'db_query_duration_ms',
    help: 'Database query duration',
    buckets: [1, 5, 10, 50, 100, 500]
  }),

  memoryUsage: new Gauge({
    name: 'memory_usage_bytes',
    help: 'Memory usage in bytes'
  })
};

// Collect periodically
setInterval(() => {
  const usage = process.memoryUsage();
  metrics.memoryUsage.set(usage.heapUsed);
}, 10000);
```

### Alerting Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| P95 latency | > 200ms | > 500ms |
| P99 latency | > 500ms | > 1000ms |
| Error rate | > 1% | > 5% |
| Memory growth | > 10% / hour | > 25% / hour |
| CPU usage | > 70% | > 90% |

### Performance Budget

```json
// performance-budget.json
{
  "timings": [
    { "metric": "first-contentful-paint", "budget": 1500 },
    { "metric": "time-to-interactive", "budget": 3000 },
    { "metric": "largest-contentful-paint", "budget": 2500 }
  ],
  "resourceSizes": [
    { "resourceType": "script", "budget": 200 },
    { "resourceType": "total", "budget": 500 }
  ],
  "resourceCounts": [
    { "resourceType": "third-party", "budget": 5 }
  ]
}
```
