# Database Issue Detection

Commands and patterns for detecting database issues in code reviews.

## Automated Detection Commands

### SQL Injection Detection

```bash
# String interpolation in queries (JavaScript/TypeScript)
grep -rn "query.*\`.*\${" --include="*.ts" --include="*.js"
grep -rn "query.*\(\`.*\${" --include="*.ts" --include="*.js"
grep -rn 'query.*".*\+' --include="*.ts" --include="*.js"
grep -rn "query.*'.*\+" --include="*.ts" --include="*.js"

# String formatting in queries (Python)
grep -rn 'execute.*f"' --include="*.py"
grep -rn 'execute.*%' --include="*.py"
grep -rn "execute.*\.format" --include="*.py"

# Raw SQL with variables (any language)
grep -rn "WHERE.*=.*'" --include="*.ts" --include="*.py" --include="*.go" | grep -v '\$'
```

### N+1 Query Detection

```bash
# Queries inside loops (TypeScript/JavaScript)
grep -rn -A 5 "for.*of\|forEach\|\.map(" --include="*.ts" | grep -B 2 "await.*query\|await.*find"

# ORM patterns that suggest N+1
grep -rn "\.find.*{.*where" --include="*.ts" | grep -B 5 "for\|forEach\|map"

# Sequential awaits that might be batched
grep -rn "await.*await.*await" --include="*.ts"
```

### SELECT * Detection

```bash
# Direct SELECT * usage
grep -rn "SELECT \*" --include="*.ts" --include="*.js" --include="*.sql"
grep -rn 'SELECT \*' --include="*.py"

# ORM patterns that select all columns
grep -rn "\.find\(\)\|\.findAll\(\)\|\.all\(\)" --include="*.ts"
```

### Missing Index Indicators

```bash
# Queries with multiple WHERE conditions (potential composite index)
grep -rn "WHERE.*AND.*AND" --include="*.ts" --include="*.sql"

# Queries with ORDER BY (potential index needed)
grep -rn "ORDER BY" --include="*.ts" --include="*.sql"

# Queries with LIKE patterns
grep -rn "LIKE.*%" --include="*.ts" --include="*.sql"
```

### Migration Risk Detection

```bash
# Dangerous migration operations
find . -path "*/migrations/*" -o -path "*/migrate/*" | xargs grep -l "DROP\|DELETE\|TRUNCATE\|ALTER.*DROP"

# Migrations without down method
find . -path "*/migrations/*" -name "*.ts" | xargs grep -L "down"

# NOT NULL additions (potential lock)
find . -path "*/migrations/*" | xargs grep -n "NOT NULL"

# Type changes
find . -path "*/migrations/*" | xargs grep -n "ALTER.*TYPE\|MODIFY.*COLUMN"
```

### Security Pattern Detection

```bash
# Hardcoded credentials
grep -rn "password.*=\|PASSWORD.*=\|secret.*=\|SECRET.*=" --include="*.ts" --include="*.env*"

# Connection strings with credentials
grep -rn "postgresql://.*:.*@\|mysql://.*:.*@\|mongodb://.*:.*@" --include="*.ts" --include="*.js"

# Excessive privilege grants
grep -rn "GRANT ALL\|SUPERUSER\|WITH GRANT OPTION" --include="*.sql" --include="*.ts"
```

---

## Manual Review Patterns

### Schema Review Checklist

```sql
-- Check for missing foreign keys
SELECT
  tc.table_name,
  kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'PRIMARY KEY'
  AND kcu.column_name LIKE '%_id'
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.referential_constraints rc
    WHERE rc.constraint_name = tc.constraint_name
  );

-- Check for missing NOT NULL on required fields
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE is_nullable = 'YES'
  AND column_name IN ('email', 'name', 'status', 'created_at')
ORDER BY table_name;

-- Check for VARCHAR without length limit
SELECT table_name, column_name
FROM information_schema.columns
WHERE data_type = 'character varying'
  AND character_maximum_length IS NULL;
```

### Index Review Checklist

```sql
-- Tables without primary key
SELECT table_name
FROM information_schema.tables t
WHERE table_type = 'BASE TABLE'
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    WHERE tc.table_name = t.table_name
      AND tc.constraint_type = 'PRIMARY KEY'
  );

-- Foreign key columns without index
SELECT
  tc.table_name,
  kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = tc.table_name
      AND indexdef LIKE '%' || kcu.column_name || '%'
  );

-- Unused indexes (PostgreSQL)
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
  AND indexname NOT LIKE '%pkey%'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### Query Performance Review

```sql
-- Check execution plan for specific query
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM orders WHERE customer_id = 123;

-- Expected good plan indicators:
-- - Index Scan or Index Only Scan
-- - Low cost estimates
-- - Small row estimates matching actual

-- Red flags in execution plans:
-- - Seq Scan on large tables
-- - Nested Loop with high row counts
-- - Sort operations without index
-- - Hash Join with large tables
```

---

## Code Review Triggers

When reviewing code, flag for database review if you see:

### High Priority (Always Review)

1. **New migration files** - Check for data loss risk, rollback strategy
2. **Raw SQL queries** - Check for injection, parameterization
3. **Loops with database calls** - Check for N+1 patterns
4. **Schema changes** - Check for breaking changes, constraints

### Medium Priority (Sample Review)

1. **ORM model changes** - Verify schema alignment
2. **New query methods** - Check for efficiency
3. **Bulk operations** - Check for batching
4. **Transaction usage** - Check for proper isolation

### Low Priority (Spot Check)

1. **Read-only queries** - Verify index usage
2. **Logging of database data** - Check for sensitive data exposure
3. **Error handling** - Check for proper connection cleanup
