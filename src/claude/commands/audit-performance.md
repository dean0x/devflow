---
allowed-tools: Bash, Read, Grep, Glob, Task, TodoWrite
description: Find performance bottlenecks, memory leaks, and optimization opportunities
---

## Your task

Conduct a BRUTAL performance audit. Most apps are slow disasters that hemorrhage money through wasted compute. Find every millisecond that's being wasted.

### Step 1: Identify Performance Killers

**🐌 THE USUAL SUSPECTS**

```bash
# N+1 Query Problems
grep -rE "forEach.*await|map.*await|for.*await.*\.(find|query|get)" --include="*.js" --include="*.ts"

# Synchronous file operations in async code
grep -rE "readFileSync|writeFileSync|existsSync|mkdirSync" --include="*.js" --include="*.ts" | grep -v test

# Blocking operations
grep -rE "execSync|spawnSync|pbkdf2Sync|randomFillSync" --include="*.js" --include="*.ts"

# Inefficient array operations
grep -rE "\.filter\(.*\)\.map\(|\.map\(.*\)\.filter\(" --include="*.js" --include="*.ts"
```

### Step 2: Database Performance Issues

**💀 DATABASE DISASTERS**

```bash
# Missing indexes on foreign keys
grep -rE "references:|foreign key|belongsTo|hasMany" --include="*.sql" --include="*migration*" | grep -v "index"

# SELECT * queries (fetching unnecessary data)
grep -rE "SELECT\s+\*|select\s+\*" --include="*.js" --include="*.ts" --include="*.sql"

# Missing pagination
grep -rE "\.find\(\)|\.all\(\)|SELECT.*FROM" --include="*.js" --include="*.ts" | grep -v "limit\|skip\|offset\|take"

# Multiple sequential queries that could be joined
grep -rE "await.*\.(find|query|get).*\n.*await.*\.(find|query|get)" --include="*.js" --include="*.ts"
```

### Step 3: Memory Leak Patterns

**💾 MEMORY HEMORRHAGING**

```bash
# Event listeners without cleanup
grep -rE "addEventListener|on\(|once\(" --include="*.js" --include="*.ts" | grep -v "removeEventListener\|off\("

# Unclosed resources
grep -rE "createReadStream|createWriteStream|connect\(|open\(" --include="*.js" --include="*.ts" | grep -v "close\|end\|destroy"

# Global variable pollution
grep -rE "^[^/]*global\.|window\.|process\." --include="*.js" --include="*.ts" | grep -v "env\|exit"

# Large arrays/objects kept in memory
grep -rE "= \[\]|= \{\}" --include="*.js" --include="*.ts" | grep -E "cache|store|data|buffer" | head -20
```

### Step 4: Frontend Performance

**🖼️ FRONTEND DISASTERS**

```bash
# Unoptimized images
find . -type f \( -name "*.jpg" -o -name "*.png" \) -size +500k -exec ls -lh {} \;

# Missing React.memo/useMemo/useCallback
grep -rE "export.*function.*Component|const.*=.*\(\).*=>" --include="*.jsx" --include="*.tsx" | grep -v "memo\|useMemo\|useCallback"

# Inline functions in render
grep -rE "onClick=\{.*=>" --include="*.jsx" --include="*.tsx"

# Large bundle imports
grep -rE "import.*from ['\"]lodash['\"]|moment['\"]" --include="*.js" --include="*.ts" --include="*.jsx"
```

### Step 5: Algorithmic Complexity

**🔄 BIG O DISASTERS**

```bash
# Nested loops (potential O(n²) or worse)
grep -rE "for.*\{.*for.*\{|\.forEach.*\.forEach|\.map.*\.map" --include="*.js" --include="*.ts"

# Recursive functions without memoization
grep -rE "function.*\(.*\).*\{.*return.*\1\(" --include="*.js" --include="*.ts"

# Array operations in loops
grep -rE "for.*\{.*\.(push|unshift|splice|shift)\(" --include="*.js" --include="*.ts"

# String concatenation in loops
grep -rE "for.*\{.*\+=" --include="*.js" --include="*.ts" | grep -E "['\"]\+|\\+['\"]"
```

### Step 6: API & Network Issues

**🌐 NETWORK NIGHTMARES**

```bash
# No caching headers
grep -rE "res\.(send|json|render)" --include="*.js" --include="*.ts" | grep -v "cache-control\|etag\|last-modified"

# No compression
grep -rE "app\.|server\." --include="*.js" --include="*.ts" | grep -v "compression\|gzip"

# Chatty APIs (multiple requests for related data)
grep -rE "fetch\(|axios\.|http\." --include="*.js" --include="*.ts" --include="*.jsx" | wc -l

# No request debouncing/throttling
grep -rE "onChange|onInput|onScroll" --include="*.jsx" --include="*.tsx" | grep -v "debounce\|throttle"
```

### Step 7: Build & Bundle Analysis

```bash
# Check bundle size
if [ -f "package.json" ]; then
    echo "=== Bundle Analysis ==="
    find . -name "*.bundle.js" -o -name "*chunk*.js" -exec ls -lh {} \; 2>/dev/null | head -10

    # Check for source maps in production
    find . -name "*.map" -type f | head -5
fi

# Development dependencies in production
grep -E "devDependencies" package.json -A 20 | grep -E "webpack-bundle-analyzer|@types|eslint"
```

### Step 8: Generate Performance Report

Create `.docs/performance-audits/perf-{timestamp}.md`:

```markdown
# ⚡ PERFORMANCE AUDIT REPORT - {timestamp}

## Performance Score: 12/100 - CATASTROPHIC

**Load Time**: 14.3s (Should be <3s)
**Time to Interactive**: 21s (Should be <5s)
**Memory Usage**: 2.4GB (For a todo app?!)
**API Response Time**: 3.2s average (Should be <200ms)

## 🔥 CRITICAL PERFORMANCE ISSUES

### 1. N+1 QUERY APOCALYPSE
**File**: services/user.service.js:45
```javascript
// THIS IS INSANE - 1000 users = 1001 queries!
const users = await User.findAll();
for (const user of users) {
    user.posts = await Post.find({ userId: user.id });
}
```
**Impact**: 5000ms for 100 users
**Fix**: Use JOIN or include

### 2. SYNCHRONOUS FILE OPERATIONS IN PRODUCTION
**File**: controllers/upload.js:23
```javascript
// BLOCKING THE EVENT LOOP!
const data = fs.readFileSync('huge-file.json'); // 500MB file!
```
**Impact**: Server freezes for 3 seconds
**Fix**: Use streams or async operations

### 3. INFINITE MEMORY LEAK
**File**: cache/memory-cache.js
```javascript
const cache = {};
// Never clears, grows forever!
app.post('/cache', (req, res) => {
    cache[Date.now()] = req.body; // Memory leak!
});
```
**Impact**: +100MB RAM per hour

## 📊 Performance Metrics

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Page Load | 14.3s | <3s | ❌ FAILING |
| API Response | 3.2s | <200ms | ❌ CRITICAL |
| Memory Usage | 2.4GB | <512MB | ❌ DISASTER |
| Database Queries/Request | 47 | <10 | ❌ N+1 HELL |
| Bundle Size | 8.7MB | <500KB | ❌ BLOATED |
| Lighthouse Score | 23 | >90 | ❌ UNUSABLE |

## 💀 Database Performance Disasters

### Missing Indexes:
```sql
-- users table: 5M rows, no index on email!
SELECT * FROM users WHERE email = ?; -- 3s per query!

-- orders table: 10M rows, no index on user_id
SELECT * FROM orders WHERE user_id = ?; -- 5s per query!
```

### Query Disasters:
1. **SELECT * everywhere** - Fetching 50 columns when you need 2
2. **No pagination** - Loading 50,000 records into memory
3. **47 queries per request** - Should be 2-3 MAX
4. **No query caching** - Same query 100 times/second

## 🐌 Frontend Performance Issues

### Bundle Catastrophe:
```javascript
// YOU'RE IMPORTING ALL OF LODASH FOR ONE FUNCTION
import _ from 'lodash'; // +500KB
const result = _.get(obj, 'a.b.c');

// YOU'RE IMPORTING MOMENT.JS IN 2024
import moment from 'moment'; // +300KB for date formatting!
```

### React Disasters:
```javascript
// Re-rendering 1000 times per second
function ExpensiveComponent({ data }) {
    // This runs on EVERY render!
    const processed = data.map(item =>
        veryExpensiveOperation(item)
    );

    // Inline function = new reference every render
    return <button onClick={() => doThing()}>
}
```

## 🔥 Memory Leaks Found

### Leak #1: Event Listener Accumulation
```javascript
// component.js - ADDS LISTENERS, NEVER REMOVES!
componentDidMount() {
    window.addEventListener('resize', this.handle);
    // No cleanup in componentWillUnmount!
}
```

### Leak #2: Closure Trap
```javascript
function createLeak() {
    const huge = new Array(1000000);
    return function() {
        console.log('hi'); // huge is retained forever!
    };
}
```

## 🎯 Immediate Optimizations (Quick Wins)

### 1. Enable Compression (5 minutes, 70% size reduction)
```javascript
app.use(compression());
```

### 2. Add Database Indexes (10 minutes, 100x speedup)
```sql
CREATE INDEX idx_email ON users(email);
CREATE INDEX idx_user_id ON orders(user_id);
```

### 3. Fix N+1 Queries (30 minutes, 50x speedup)
```javascript
// Use eager loading
const users = await User.findAll({
    include: [Post]
});
```

## 📈 Performance Budget Violations

You're violating EVERY performance budget:
- JavaScript: 8.7MB (budget: 300KB) - 29x over!
- Images: 45MB (budget: 2MB) - 22x over!
- First Paint: 4.5s (budget: 1s) - 4.5x over!
- API calls on load: 67 (budget: 5) - 13x over!

## 🚀 Optimization Roadmap

### Phase 1: Emergency Surgery (Day 1)
1. Add database indexes
2. Fix N+1 queries
3. Enable compression
4. Remove synchronous operations

### Phase 2: Major Fixes (Week 1)
1. Implement caching layer
2. Optimize bundle size
3. Fix memory leaks
4. Add pagination

### Phase 3: Long-term (Month 1)
1. Refactor to microservices
2. Implement CDN
3. Database sharding
4. Complete rewrite of frontend

## Cost Analysis

Current monthly AWS bill: $12,000
After optimizations: $800
**Monthly savings: $11,200**

The performance is so bad, you're literally burning money.
```

Remember: Every millisecond counts. Bad performance = lost users = lost revenue.