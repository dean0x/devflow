---
name: devflow-database-patterns
description: Database design and optimization review. Load when reviewing migrations, schema changes, query patterns, or database-related code. Used by Reviewer agent with database focus.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Database Patterns

Domain expertise for database design and optimization. Use alongside `devflow-review-methodology` for complete database reviews.

## Iron Law

> **EVERY QUERY MUST HAVE AN EXECUTION PLAN**
>
> Never deploy a query without understanding its execution plan. Every WHERE clause needs
> an index analysis. Every JOIN needs cardinality consideration. "It works in dev" is not
> validation. Production data volumes will expose every missing index and inefficient join.

## Database Categories

### 1. Schema Design Issues

**Missing Foreign Keys**
```sql
-- PROBLEM: No referential integrity
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INT,  -- No FK constraint!
  total DECIMAL
);

-- SOLUTION: Add foreign key
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  total DECIMAL
);
```

**Denormalization Without Justification**
```sql
-- PROBLEM: Unnecessary duplication
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INT,
  customer_name VARCHAR(100),     -- Duplicated!
  customer_email VARCHAR(100),    -- Duplicated!
  customer_address TEXT           -- Duplicated!
);

-- SOLUTION: Normalize unless performance requires otherwise
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  customer_id INT REFERENCES customers(id)
);
-- Access customer data via JOIN
```

**Poor Data Type Choices**
```sql
-- PROBLEM: Inappropriate types
CREATE TABLE users (
  id VARCHAR(100),           -- Use UUID or SERIAL
  age VARCHAR(10),           -- Use INT
  balance VARCHAR(50),       -- Use DECIMAL
  is_active VARCHAR(5),      -- Use BOOLEAN
  created_at VARCHAR(50)     -- Use TIMESTAMP
);

-- SOLUTION: Appropriate types
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  age INT CHECK (age >= 0 AND age < 150),
  balance DECIMAL(10, 2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Missing Constraints**
```sql
-- PROBLEM: No data validation
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100),
  price DECIMAL,
  quantity INT
);

-- SOLUTION: Add constraints
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
  quantity INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  CONSTRAINT name_not_empty CHECK (LENGTH(TRIM(name)) > 0)
);
```

### 2. Query Optimization Issues

**N+1 Queries**
```typescript
// PROBLEM: Query per iteration
const users = await db.query('SELECT * FROM users');
for (const user of users) {
  const orders = await db.query(
    'SELECT * FROM orders WHERE user_id = ?',
    [user.id]
  );
  user.orders = orders;
}

// SOLUTION: Single query with JOIN or IN
const users = await db.query(`
  SELECT u.*, json_agg(o.*) as orders
  FROM users u
  LEFT JOIN orders o ON o.user_id = u.id
  GROUP BY u.id
`);

// Or two queries with IN
const users = await db.query('SELECT * FROM users');
const userIds = users.map(u => u.id);
const orders = await db.query(
  'SELECT * FROM orders WHERE user_id = ANY(?)',
  [userIds]
);
```

**Missing Indexes**
```sql
-- PROBLEM: Frequent query without index
SELECT * FROM orders WHERE customer_id = 123 AND status = 'pending';

-- Check execution plan
EXPLAIN ANALYZE SELECT * FROM orders WHERE customer_id = 123 AND status = 'pending';
-- Sequential Scan on orders (cost=0.00..1234.00 rows=100 width=100)

-- SOLUTION: Add composite index
CREATE INDEX idx_orders_customer_status ON orders(customer_id, status);

-- After index:
-- Index Scan using idx_orders_customer_status (cost=0.00..8.00 rows=100 width=100)
```

**Full Table Scans**
```sql
-- PROBLEM: Functions prevent index use
SELECT * FROM users WHERE LOWER(email) = 'john@example.com';
SELECT * FROM orders WHERE YEAR(created_at) = 2024;

-- SOLUTION: Use index-friendly queries
-- Option 1: Functional index
CREATE INDEX idx_users_email_lower ON users(LOWER(email));

-- Option 2: Rewrite query
SELECT * FROM users WHERE email ILIKE 'john@example.com';
SELECT * FROM orders WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';
```

**Inefficient JOINs**
```sql
-- PROBLEM: Joining large tables without filters
SELECT * FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id;
-- Returns millions of rows

-- SOLUTION: Filter before joining
SELECT * FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id
WHERE o.customer_id = 123
  AND o.created_at > NOW() - INTERVAL '30 days';
```

### 3. Migration Issues

**Breaking Changes Without Migration Path**
```sql
-- PROBLEM: Destructive change
ALTER TABLE users DROP COLUMN legacy_field;
-- Data is lost!

-- SOLUTION: Phased approach
-- Phase 1: Add deprecation, stop writes
-- Phase 2: Migrate data if needed
-- Phase 3: Remove column after verification
ALTER TABLE users ALTER COLUMN legacy_field SET DEFAULT NULL;
-- Wait for deployment, verify no writes
ALTER TABLE users DROP COLUMN legacy_field;
```

**Data Loss Risk**
```sql
-- PROBLEM: Type change loses data
ALTER TABLE products ALTER COLUMN price TYPE INT;
-- Decimal values truncated!

-- SOLUTION: Validate first
SELECT id, price FROM products WHERE price != FLOOR(price);
-- If results: handle decimal values first
```

**Missing Rollback Strategy**
```typescript
// PROBLEM: No way to undo
export async function up(db) {
  await db.query('DROP TABLE old_users');
}

export async function down(db) {
  // Can't recreate dropped table!
}

// SOLUTION: Always plan rollback
export async function up(db) {
  await db.query('ALTER TABLE old_users RENAME TO old_users_backup');
  await db.query('CREATE TABLE users_v2 AS SELECT * FROM old_users_backup');
}

export async function down(db) {
  await db.query('DROP TABLE IF EXISTS users_v2');
  await db.query('ALTER TABLE old_users_backup RENAME TO old_users');
}
```

**Performance Impact**
```sql
-- PROBLEM: Locks table for extended period
ALTER TABLE large_table ADD COLUMN new_field VARCHAR(100) NOT NULL DEFAULT 'value';
-- Rewrites entire table, locks during operation

-- SOLUTION: Non-blocking approach
-- Step 1: Add nullable column (instant)
ALTER TABLE large_table ADD COLUMN new_field VARCHAR(100);

-- Step 2: Backfill in batches
UPDATE large_table SET new_field = 'value' WHERE id BETWEEN 1 AND 10000;
-- Repeat for ranges...

-- Step 3: Add constraint after backfill
ALTER TABLE large_table ALTER COLUMN new_field SET NOT NULL;
```

### 4. Security Issues

**SQL Injection**
```typescript
// VULNERABLE
const query = `SELECT * FROM users WHERE email = '${email}'`;
await db.query(query);

// SECURE: Parameterized query
const query = 'SELECT * FROM users WHERE email = $1';
await db.query(query, [email]);
```

**Excessive Privileges**
```sql
-- PROBLEM: App has too many privileges
GRANT ALL PRIVILEGES ON DATABASE myapp TO app_user;

-- SOLUTION: Minimum required privileges
GRANT SELECT, INSERT, UPDATE ON users TO app_user;
GRANT SELECT ON products TO app_user;
-- No DELETE unless needed
-- No schema modification privileges
```

---

## Severity Guidelines

**CRITICAL** - Data integrity or severe performance:
- Missing indexes on high-traffic queries
- N+1 queries with unbounded data
- Data loss in migrations
- SQL injection vulnerabilities
- Missing foreign keys on critical relationships

**HIGH** - Significant database issues:
- Inefficient JOINs on large tables
- Missing constraints allowing bad data
- Migrations without rollback
- Poor data type choices

**MEDIUM** - Moderate concerns:
- Minor denormalization
- Missing non-critical indexes
- Could use better constraints

**LOW** - Minor improvements:
- Naming conventions
- Index organization
- Documentation

---

## Detection Patterns

Search for these patterns in code:

```bash
# SQL injection (string interpolation in queries)
grep -rn "query.*\${.*}\|query.*+ " --include="*.ts"

# N+1 patterns (queries in loops)
grep -rn "for.*await.*query\|forEach.*await.*query" --include="*.ts"

# SELECT * usage
grep -rn "SELECT \*" --include="*.ts" --include="*.sql"

# Missing parameterization
grep -rn "WHERE.*'.*\$\|WHERE.*\".*\$" --include="*.ts"

# Check migration files
find . -name "*migration*" -o -name "*migrate*" | xargs grep -l "DROP\|DELETE\|TRUNCATE"
```

---

## Database Checklist

Before approving database changes:

- [ ] All queries have appropriate indexes
- [ ] N+1 patterns identified and resolved
- [ ] Migrations have rollback scripts
- [ ] Data types are appropriate
- [ ] Constraints enforce business rules
- [ ] Foreign keys maintain referential integrity
- [ ] No SQL injection vulnerabilities
- [ ] Performance tested with production-like data volume

