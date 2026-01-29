---
name: devflow-database-patterns
description: Database analysis for Reviewer agent. Loaded when focus=database. Detects schema issues, slow queries, migration problems.
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

| Issue | Problem | Solution |
|-------|---------|----------|
| Missing Foreign Keys | No referential integrity, orphaned records | Add FK with ON DELETE action |
| Denormalization | Unnecessary duplication, update anomalies | Normalize unless performance requires |
| Poor Data Types | VARCHAR for everything, lost precision | Use appropriate types (DECIMAL, BOOLEAN, TIMESTAMP) |
| Missing Constraints | No data validation at DB level | Add NOT NULL, CHECK, UNIQUE constraints |

**Example - Missing Constraints:**
```sql
-- VIOLATION
CREATE TABLE products (id SERIAL, name VARCHAR(100), price DECIMAL);

-- CORRECT
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL CHECK (LENGTH(TRIM(name)) > 0),
  price DECIMAL(10, 2) NOT NULL CHECK (price >= 0)
);
```

### 2. Query Optimization Issues

| Issue | Problem | Solution |
|-------|---------|----------|
| N+1 Queries | Query per iteration, O(n) round trips | JOIN or batch with IN/ANY |
| Missing Indexes | Full table scans on large tables | Add indexes for WHERE/JOIN columns |
| Full Table Scans | Functions prevent index use | Functional indexes or query rewrite |
| Inefficient JOINs | Joining before filtering | Filter early, select specific columns |

**Example - N+1 Query:**
```typescript
// VIOLATION: 101 queries for 100 users
for (const user of users) {
  user.orders = await db.query('SELECT * FROM orders WHERE user_id = ?', [user.id]);
}

// CORRECT: 2 queries total
const orders = await db.query('SELECT * FROM orders WHERE user_id = ANY($1)', [userIds]);
```

### 3. Migration Issues

| Issue | Problem | Solution |
|-------|---------|----------|
| Breaking Changes | Data loss, no recovery path | Phased approach with backups |
| Data Loss Risk | Type changes truncate data | Validate before changing types |
| Missing Rollback | Cannot undo migration | Always implement down() method |
| Performance Impact | Table locks during migration | Add columns nullable, backfill in batches |

**Example - Safe Column Addition:**
```sql
-- Step 1: Add nullable (instant)
ALTER TABLE users ADD COLUMN phone VARCHAR(20);
-- Step 2: Backfill in batches
UPDATE users SET phone = 'UNKNOWN' WHERE phone IS NULL AND id BETWEEN 1 AND 10000;
-- Step 3: Add constraint after backfill
ALTER TABLE users ALTER COLUMN phone SET NOT NULL;
```

### 4. Security Issues

| Issue | Problem | Solution |
|-------|---------|----------|
| SQL Injection | String interpolation in queries | Parameterized queries only |
| Excessive Privileges | App has GRANT ALL | Minimum required privileges |

**Example - SQL Injection:**
```typescript
// VULNERABLE
const query = `SELECT * FROM users WHERE email = '${email}'`;

// SECURE
const query = 'SELECT * FROM users WHERE email = $1';
await db.query(query, [email]);
```

---

## Extended References

For detailed examples and detection commands, see:

- **[references/violations.md](references/violations.md)** - Extended violation examples with explanations
- **[references/patterns.md](references/patterns.md)** - Correct patterns and migration strategies
- **[references/detection.md](references/detection.md)** - Automated detection commands

---

## Severity Guidelines

| Severity | Criteria | Examples |
|----------|----------|----------|
| **CRITICAL** | Data integrity or severe performance | SQL injection, N+1 unbounded, data loss migrations, missing FK on critical relations |
| **HIGH** | Significant database issues | Inefficient JOINs, missing constraints, migrations without rollback |
| **MEDIUM** | Moderate concerns | Minor denormalization, missing non-critical indexes |
| **LOW** | Minor improvements | Naming conventions, index organization |

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
