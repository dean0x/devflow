---
allowed-tools: Bash, Read, Grep, Glob, Task, TodoWrite
description: Audit database schemas, queries, migrations, and performance issues
---

## Your task

Perform a DEVASTATING database audit. Most databases are poorly designed disasters waiting to corrupt data or crash under load. Find every ticking time bomb.

### Step 1: Detect Database Type

```bash
# Identify database system
echo "=== Detecting Database Configuration ==="

# Check for migration files
find . -type f -name "*.sql" -o -name "*migration*" -o -name "*schema*" | head -10

# Check for ORM configurations
grep -r "sequelize\|typeorm\|prisma\|mongoose\|knex\|bookshelf" --include="*.js" --include="*.ts" --include="*.json" | head -5

# Database connection strings (CAREFUL - might contain passwords)
grep -r "postgres://\|mysql://\|mongodb://\|sqlite:" --include="*.js" --include="*.ts" --include="*.env*" | sed 's/:\/\/[^@]*@/:\/\/***@/g' | head -5
```

### Step 2: Schema Design Issues

**📐 SCHEMA DISASTERS**

```bash
# Missing foreign key constraints
echo "=== Missing Foreign Key Constraints ==="
grep -r "user_id\|userId\|customer_id\|order_id\|product_id" --include="*.sql" --include="*migration*" | grep -v "REFERENCES\|FOREIGN KEY\|references" | head -10

# Missing indexes on foreign keys
echo "=== Missing Indexes ==="
grep -r "CREATE TABLE\|ALTER TABLE" --include="*.sql" -A 20 | grep -E "user_id|customer_id|order_id" | grep -v "INDEX\|KEY" | head -10

# No primary keys
echo "=== Tables Without Primary Keys ==="
grep -r "CREATE TABLE" --include="*.sql" -A 10 | grep -v "PRIMARY KEY\|SERIAL\|AUTO_INCREMENT" | head -5

# Storing JSON in varchar columns (NoSQL abuse)
grep -rE "VARCHAR.*JSON|TEXT.*JSON|json.*VARCHAR" --include="*.sql" --include="*migration*" | head -5
```

### Step 3: Query Performance Anti-Patterns

**🐌 QUERY DISASTERS**

```bash
# N+1 Query Problems
echo "=== N+1 Query Patterns ==="
grep -rE "forEach.*await.*\.(find|query|select)|for.*await.*\.(find|query|select)" --include="*.js" --include="*.ts" | head -10

# SELECT * (fetching unnecessary columns)
echo "=== SELECT * Anti-pattern ==="
grep -rE "SELECT \*|select\(\)|find\(\{\}\)|findAll\(\)" --include="*.js" --include="*.ts" --include="*.sql" | head -10

# Missing LIMIT/pagination
echo "=== Unlimited Result Sets ==="
grep -rE "SELECT.*FROM|\.find\(|\.all\(" --include="*.js" --include="*.ts" --include="*.sql" | grep -v "LIMIT\|limit\|take\|skip\|offset" | head -10

# LIKE with leading wildcard (table scan)
echo "=== Full Table Scans ==="
grep -rE "LIKE ['\"]\%|ILIKE ['\"]\%|startsWith.*\%" --include="*.js" --include="*.ts" --include="*.sql" | head -10

# JOINs without indexes
echo "=== Expensive JOINs ==="
grep -rE "JOIN.*ON|INNER JOIN|LEFT JOIN" --include="*.sql" -B 2 -A 2 | head -20
```

### Step 4: Data Integrity Issues

**💔 DATA CORRUPTION RISKS**

```bash
# No constraints
echo "=== Missing Constraints ==="
grep -r "CREATE TABLE" --include="*.sql" -A 30 | grep -v "NOT NULL\|UNIQUE\|CHECK\|DEFAULT" | head -10

# Dangerous DELETE operations
echo "=== Unsafe DELETEs ==="
grep -rE "DELETE FROM.*WHERE|destroy\(\)|remove\(\)" --include="*.js" --include="*.ts" --include="*.sql" | grep -v "soft\|deleted_at\|archive" | head -10

# No transactions for multi-step operations
echo "=== Missing Transactions ==="
grep -rE "INSERT.*INSERT|UPDATE.*UPDATE|DELETE.*INSERT" --include="*.js" --include="*.ts" | grep -v "transaction\|BEGIN\|COMMIT" | head -10

# Direct SQL concatenation (SQL injection risk)
echo "=== SQL Injection Risks ==="
grep -rE "query.*\+|sql.*\+|WHERE.*\$\{|WHERE.*\+" --include="*.js" --include="*.ts" | head -10
```

### Step 5: Migration Disasters

**🔄 MIGRATION NIGHTMARES**

```bash
# Irreversible migrations
echo "=== Irreversible Migrations ==="
find . -name "*migration*" -type f -exec grep -l "DROP TABLE\|DROP COLUMN\|DROP INDEX" {} \; | xargs grep -L "down\|rollback\|revert" | head -10

# Missing down migrations
echo "=== One-way Migrations ==="
find . -name "*migration*" -type f -exec grep -L "down\|rollback\|revert" {} \; | head -10

# Schema-breaking changes
echo "=== Breaking Changes ==="
grep -rE "DROP COLUMN\|RENAME COLUMN\|ALTER.*TYPE\|MODIFY COLUMN" --include="*migration*" | head -10

# Data migrations mixed with schema
echo "=== Data in Schema Migrations ==="
grep -rE "INSERT INTO\|UPDATE.*SET\|DELETE FROM" --include="*migration*" | head -10
```

### Step 6: Connection Pool & Resource Issues

**🏊 CONNECTION DISASTERS**

```bash
# No connection pooling
echo "=== Connection Management ==="
grep -rE "createConnection\|connect\(" --include="*.js" --include="*.ts" | grep -v "pool\|Pool" | head -10

# Connections not closed
echo "=== Unclosed Connections ==="
grep -rE "connect\(|query\(" --include="*.js" --include="*.ts" | grep -v -A 5 "close\(\)|end\(\)|release\(\)" | head -10

# Hardcoded connection strings
echo "=== Hardcoded Credentials ==="
grep -rE "password.*=.*['\"][^'\"]+['\"]|PASSWORD.*=.*['\"][^'\"]+['\"]" --include="*.js" --include="*.ts" | grep -v "env\|process\.env\|config" | head -5
```

### Step 7: NoSQL Specific Issues

**🍃 MONGODB/NOSQL DISASTERS**

```bash
# No schema validation
echo "=== NoSQL Schema Chaos ==="
grep -rE "mongoose\.model|Schema\(" --include="*.js" --include="*.ts" | grep -v "required\|validate\|type:" | head -10

# Missing indexes
echo "=== MongoDB Missing Indexes ==="
grep -rE "\.find\(|\.findOne\(|\.aggregate\(" --include="*.js" --include="*.ts" | head -10
# Check if these frequently queried fields have indexes

# Unbounded array growth
echo "=== Unbounded Arrays ==="
grep -rE "\$push|\$addToSet|\.push\(" --include="*.js" --include="*.ts" | grep -v "slice\|limit" | head-10
```

### Step 8: Generate Database Audit Report

Create `.docs/database-audits/db-{timestamp}.md`:

```markdown
# 🗄️ DATABASE AUDIT REPORT - {timestamp}

## Database Health Score: 8/100 - CRITICAL

**Database Type**: PostgreSQL 9.6 (UNSUPPORTED!)
**Schema Complexity**: CHAOS
**Query Performance**: ABYSMAL
**Data Integrity**: AT RISK
**Migration Strategy**: DANGEROUS

## 🔴 CRITICAL DATABASE ISSUES

### 1. NO FOREIGN KEY CONSTRAINTS
**Tables Affected**: ALL OF THEM
```sql
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,  -- No FK constraint!
    product_id INTEGER  -- No FK constraint!
);
-- Result: Orphaned records everywhere
```
**Impact**: Data integrity nightmare
**Orphaned Records Found**: 47,823

### 2. FULL TABLE SCANS EVERYWHERE
**File**: repositories/user.repo.js:45
```javascript
// Scanning 5 million rows every time!
const users = await db.query(
    "SELECT * FROM users WHERE email LIKE '%@gmail.com'"
);
```
**Performance**: 47 seconds per query
**Fix**: Add index, remove leading wildcard

### 3. N+1 QUERY EXPLOSION
**File**: services/order.service.js:89
```javascript
const orders = await Order.findAll();
for (const order of orders) {
    order.user = await User.findById(order.user_id);
    order.items = await OrderItem.findByOrderId(order.id);
    // 1000 orders = 2001 queries!
}
```
**Queries per request**: 2,001
**Should be**: 1

## 📊 Database Metrics

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Avg Query Time | 3.7s | <50ms | ❌ DISASTER |
| Queries per Request | 147 | <10 | ❌ N+1 HELL |
| Missing Indexes | 34 | 0 | ❌ SLOW |
| Tables without PK | 8 | 0 | ❌ CHAOS |
| Orphaned Records | 47,823 | 0 | ❌ CORRUPT |
| Connection Pool Size | 1 | 20 | ❌ BOTTLENECK |
| Database Version | 9.6 | 15 | ❌ UNSUPPORTED |

## 💀 SCHEMA DISASTERS

### The "Everything" Table:
```sql
CREATE TABLE data (
    id SERIAL,
    type VARCHAR(255),
    json_data TEXT,  -- Storing everything as JSON!
    created_at TIMESTAMP
);
-- 147 different "types", no schema validation
```

### Missing Indexes on Foreign Keys:
```sql
-- orders table: 10M rows, NO INDEX on user_id!
SELECT * FROM orders WHERE user_id = ?;
-- Execution time: 8.3 seconds

-- order_items table: 50M rows, NO INDEX on order_id!
SELECT * FROM order_items WHERE order_id = ?;
-- Execution time: 23 seconds
```

### No Cascade Deletes:
```sql
DELETE FROM users WHERE id = 123;
-- Leaves orphaned: orders, comments, profiles, settings
-- Data integrity = destroyed
```

## 🔥 QUERY PERFORMANCE DISASTERS

### Query From Hell:
```sql
SELECT DISTINCT u.*,
    (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id),
    (SELECT COUNT(*) FROM comments c WHERE c.user_id = u.id),
    (SELECT MAX(login_date) FROM logins l WHERE l.user_id = u.id),
    (SELECT json_agg(p.*) FROM products p
     WHERE p.id IN (SELECT product_id FROM orders WHERE user_id = u.id))
FROM users u
WHERE u.email LIKE '%@%'
ORDER BY u.created_at DESC;
-- Execution time: 2 MINUTES
```

### The Cartesian Product Disaster:
```sql
SELECT * FROM users, orders, products, categories;
-- No JOIN conditions!
-- Result: 5B rows (crashes server)
```

## 🚨 MIGRATION DISASTERS

### The Irreversible Migration:
```sql
-- Migration #47: up.sql
DROP COLUMN users.email;
-- Migration #47: down.sql
-- TODO: implement rollback (NEVER IMPLEMENTED!)
```

### The Data Destroyer:
```sql
-- "Quick fix" in production
UPDATE users SET email = LOWER(email);
-- No backup, no transaction, no rollback plan
```

## 🔒 SECURITY VULNERABILITIES

### SQL Injection Paradise:
```javascript
db.query(`SELECT * FROM users WHERE id = ${userId}`);
// Direct interpolation = SQL injection
```

### Plain Text Passwords:
```sql
CREATE TABLE users (
    password VARCHAR(255)  -- Not even hashed!
);
```

### No Row Level Security:
```javascript
// Any user can query any data
app.get('/api/users/:id', async (req, res) => {
    const user = await User.findById(req.params.id);
    res.json(user);  // No authorization check!
});
```

## 💰 COST ANALYSIS

Your bad database design is costing you:
- **Wasted Compute**: $8,000/month (inefficient queries)
- **Downtime**: $45,000/year (migration failures)
- **Data Recovery**: $120,000 last year
- **Developer Time**: 40% spent fighting database

**Total Annual Cost**: $287,000

## 🔧 EMERGENCY FIXES

### Day 1 (STOP THE BLEEDING):
```sql
-- Add critical indexes
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_users_email ON users(email);

-- Add foreign keys
ALTER TABLE orders ADD FOREIGN KEY (user_id) REFERENCES users(id);
```

### Week 1:
1. Upgrade database version (9.6 → 15)
2. Implement connection pooling
3. Fix N+1 queries with eager loading
4. Add missing primary keys

### Month 1:
1. Normalize schema properly
2. Implement proper migrations
3. Add data validation
4. Set up replication

## Example Fixes

### N+1 Fix:
```javascript
// BEFORE: 2001 queries
const orders = await Order.findAll();
for (const order of orders) {
    order.user = await User.findById(order.user_id);
}

// AFTER: 1 query
const orders = await Order.findAll({
    include: [User, OrderItem]
});
```

### Query Optimization:
```sql
-- BEFORE: 47 seconds
SELECT * FROM users WHERE email LIKE '%gmail.com';

-- AFTER: 45ms
CREATE INDEX idx_email_domain ON users(reverse(email));
SELECT * FROM users WHERE reverse(email) LIKE reverse('gmail.com%');
```

Remember: The database is the foundation. When it crumbles, everything collapses.
```

Remember: Bad database design is the #1 cause of system failure. Fix it now or pay 100x later.