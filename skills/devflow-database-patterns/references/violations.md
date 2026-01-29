# Database Violation Examples

Extended examples of database anti-patterns and violations.

## Schema Design Violations

### Missing Foreign Keys - Extended

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

**Why it matters:**
- Orphaned records accumulate over time
- Data integrity depends on application code (fragile)
- Cannot use cascading deletes/updates
- Database cannot optimize joins

### Denormalization Without Justification - Extended

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

**When denormalization IS justified:**
- Read-heavy workloads with measured performance issues
- Historical data that must not change when source changes
- Reporting/analytics tables (materialized views)
- Document explicitly: `-- DENORMALIZED: Performance requirement, see ticket DB-123`

### Poor Data Type Choices - Extended

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

**Data type guidelines:**
| Data | Wrong | Correct |
|------|-------|---------|
| Money | FLOAT, VARCHAR | DECIMAL(precision, scale) |
| Boolean | VARCHAR, INT | BOOLEAN |
| Date/Time | VARCHAR | TIMESTAMP WITH TIME ZONE |
| IDs | VARCHAR (random) | UUID, SERIAL, BIGSERIAL |
| Email | TEXT | VARCHAR(255) with CHECK |

### Missing Constraints - Extended

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

**Essential constraints:**
- `NOT NULL` on required fields
- `CHECK` constraints for business rules
- `UNIQUE` on natural keys
- `DEFAULT` values where appropriate

---

## Query Optimization Violations

### N+1 Queries - Extended

```typescript
// PROBLEM: Query per iteration (N+1)
const users = await db.query('SELECT * FROM users');
for (const user of users) {
  const orders = await db.query(
    'SELECT * FROM orders WHERE user_id = ?',
    [user.id]
  );
  user.orders = orders;
}
// If 100 users: 1 + 100 = 101 queries!

// SOLUTION 1: Single query with JOIN
const users = await db.query(`
  SELECT u.*, json_agg(o.*) as orders
  FROM users u
  LEFT JOIN orders o ON o.user_id = u.id
  GROUP BY u.id
`);

// SOLUTION 2: Two queries with IN (batch)
const users = await db.query('SELECT * FROM users');
const userIds = users.map(u => u.id);
const orders = await db.query(
  'SELECT * FROM orders WHERE user_id = ANY($1)',
  [userIds]
);
// Group orders by user_id in application code
// Total: 2 queries regardless of user count
```

### Full Table Scans - Extended

```sql
-- PROBLEM: Functions prevent index use
SELECT * FROM users WHERE LOWER(email) = 'john@example.com';
-- Sequential scan: O(n)

SELECT * FROM orders WHERE YEAR(created_at) = 2024;
-- Sequential scan: index on created_at cannot be used

SELECT * FROM products WHERE name LIKE '%widget%';
-- Sequential scan: leading wildcard prevents index use

-- SOLUTIONS:

-- 1. Functional index
CREATE INDEX idx_users_email_lower ON users(LOWER(email));
SELECT * FROM users WHERE LOWER(email) = 'john@example.com';
-- Now uses index

-- 2. Range query instead of function
SELECT * FROM orders
WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';
-- Uses index on created_at

-- 3. Full-text search for LIKE patterns
CREATE INDEX idx_products_name_gin ON products USING gin(to_tsvector('english', name));
SELECT * FROM products WHERE to_tsvector('english', name) @@ to_tsquery('widget');
```

### Inefficient JOINs - Extended

```sql
-- PROBLEM: Joining large tables without filters
SELECT * FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id;
-- Returns millions of rows, processes entire tables

-- SOLUTION: Filter early, select specific columns
SELECT
  o.id as order_id,
  o.created_at,
  oi.quantity,
  p.name as product_name,
  p.price
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p ON p.id = oi.product_id
WHERE o.customer_id = 123
  AND o.created_at > NOW() - INTERVAL '30 days';
-- Filters applied before join expands data
```

---

## Migration Violations

### Breaking Changes Without Migration Path

```sql
-- PROBLEM: Destructive change
ALTER TABLE users DROP COLUMN legacy_field;
-- Data is lost immediately!

-- SOLUTION: Phased approach
-- Phase 1: Stop writes (deploy code that doesn't write to column)
-- Phase 2: Add deprecation notice
ALTER TABLE users ALTER COLUMN legacy_field SET DEFAULT NULL;
-- Phase 3: Wait for deployment verification
-- Phase 4: Drop column after confirming no reads/writes
ALTER TABLE users DROP COLUMN legacy_field;
```

### Data Loss Risk

```sql
-- PROBLEM: Type change loses data
ALTER TABLE products ALTER COLUMN price TYPE INT;
-- Decimal values truncated: 19.99 becomes 19

-- SOLUTION: Validate first
SELECT id, price FROM products WHERE price != FLOOR(price);
-- If results exist: handle decimal values first

-- Safe alternative: create new column
ALTER TABLE products ADD COLUMN price_cents INT;
UPDATE products SET price_cents = price * 100;
-- Verify, then drop old column
```

### Missing Rollback Strategy

```typescript
// PROBLEM: No way to undo
export async function up(db) {
  await db.query('DROP TABLE old_users');
}

export async function down(db) {
  // Can't recreate dropped table with its data!
  throw new Error('Irreversible migration');
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

### Performance Impact

```sql
-- PROBLEM: Locks table for extended period
ALTER TABLE large_table ADD COLUMN new_field VARCHAR(100) NOT NULL DEFAULT 'value';
-- Rewrites entire table, holds exclusive lock

-- SOLUTION: Non-blocking approach (3 steps)
-- Step 1: Add nullable column (instant, no rewrite)
ALTER TABLE large_table ADD COLUMN new_field VARCHAR(100);

-- Step 2: Backfill in batches (no lock)
UPDATE large_table SET new_field = 'value' WHERE id BETWEEN 1 AND 10000;
UPDATE large_table SET new_field = 'value' WHERE id BETWEEN 10001 AND 20000;
-- ... continue in batches with small transactions

-- Step 3: Add constraint after backfill complete
ALTER TABLE large_table ALTER COLUMN new_field SET NOT NULL;
```

---

## Security Violations

### SQL Injection - Extended

```typescript
// VULNERABLE: String interpolation
const query = `SELECT * FROM users WHERE email = '${email}'`;
// If email = "'; DROP TABLE users; --" -> disaster

// VULNERABLE: String concatenation
const query = 'SELECT * FROM users WHERE email = "' + email + '"';
// Same vulnerability

// SECURE: Parameterized queries
const query = 'SELECT * FROM users WHERE email = $1';
await db.query(query, [email]);

// SECURE: ORM with proper escaping
await User.findOne({ where: { email } });
```

### Excessive Privileges

```sql
-- PROBLEM: App has too many privileges
GRANT ALL PRIVILEGES ON DATABASE myapp TO app_user;
-- App can DROP tables, modify schema, etc.

-- SOLUTION: Minimum required privileges (principle of least privilege)
-- Read-only operations
GRANT SELECT ON users, products, orders TO readonly_user;

-- Application user (typical CRUD)
GRANT SELECT, INSERT, UPDATE ON users TO app_user;
GRANT SELECT ON products TO app_user;
GRANT SELECT, INSERT ON orders TO app_user;
-- No DELETE unless business requirement
-- No schema modification privileges

-- Migrations user (separate, restricted use)
GRANT ALL ON SCHEMA public TO migrations_user;
-- Only used during deployments, not by running application
```
