---
name: database
description: Use when reviewing queries, migrations or schema changes.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Database Patterns

Detection patterns for database design and query review. Use with `devflow:review-methodology`.

## Iron Law

> **Every query must have an execution plan.**
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

### 2. Query Optimization Issues

| Issue | Problem | Solution |
|-------|---------|----------|
| N+1 Queries | Query per iteration, O(n) round trips | JOIN or batch with IN/ANY |
| Missing Indexes | Full table scans on large tables | Add indexes for WHERE/JOIN columns |
| Full Table Scans | Functions prevent index use | Functional indexes or query rewrite |
| Inefficient JOINs | Joining before filtering | Filter early, select specific columns |

### 3. Migration Issues

| Issue | Problem | Solution |
|-------|---------|----------|
| Breaking Changes | Data loss, no recovery path | Phased approach with backups |
| Data Loss Risk | Type changes truncate data | Validate before changing types |
| Missing Rollback | Cannot undo migration | Always implement down() method |
| Performance Impact | Table locks during migration | Add columns nullable, backfill in batches, then add the constraint |

### 4. Security Issues

| Issue | Problem | Solution |
|-------|---------|----------|
| SQL Injection | String interpolation in queries | Parameterized queries only |
| Excessive Privileges | App has GRANT ALL | Minimum required privileges |

## Extended References

- `references/violations.md` - Extended violation examples with explanations
- `references/patterns.md` - Correct patterns and migration strategies
- `references/detection.md` - Automated detection commands

## Severity Guidelines

| Severity | Criteria | Examples |
|----------|----------|----------|
| **CRITICAL** | Data integrity or severe performance | SQL injection, N+1 unbounded, data loss migrations, missing FK on critical relations |
| **HIGH** | Significant database issues | Inefficient JOINs, missing constraints, migrations without rollback |
| **MEDIUM** | Moderate concerns | Minor denormalization, missing non-critical indexes |
| **LOW** | Minor improvements | Naming conventions, index organization |
