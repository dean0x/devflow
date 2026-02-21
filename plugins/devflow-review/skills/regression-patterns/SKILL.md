---
name: regression-patterns
description: Regression analysis patterns for code review. Detects lost functionality, removed exports, changed signatures, and behavioral changes that break existing consumers. Loaded by Reviewer agent when focus=regression.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Regression Patterns

Domain expertise for detecting functionality regressions and validating implementation intent. Use alongside `review-methodology` for complete regression reviews.

## Iron Law

> **WHAT WORKED BEFORE MUST WORK AFTER**
>
> Every change carries regression risk. Removed exports break consumers. Changed signatures
> break callers. Modified behavior breaks expectations. The burden of proof is on the change:
> demonstrate no regression, or document the intentional breaking change.

---

## Regression Categories

### 1. Lost Functionality

Features, exports, or capabilities that existed before but are missing after.

| Type | Risk | Detection |
|------|------|-----------|
| Removed exports | Breaks consumers | Compare `export` statements |
| Removed CLI options | Breaks scripts | Compare option definitions |
| Removed API endpoints | Breaks clients | Compare route handlers |
| Removed event handlers | Breaks integrations | Compare `.on()` calls |

```typescript
// VIOLATION: Export removed without deprecation
// BEFORE: export function deleteUser(id: string): void { }
// AFTER: (removed) - consumers will break!
```

### 2. Broken Behavior

Code still exists but behaves differently in breaking ways.

| Type | Risk | Detection |
|------|------|-----------|
| Changed return types | Null dereference | Compare function signatures |
| Changed defaults | Unexpected behavior | Compare default values |
| Removed side effects | Missing events/logs | Compare emit/log calls |
| Changed error handling | Uncaught errors | Compare throw/return patterns |

```typescript
// VIOLATION: Return type widened without migration
// BEFORE: function getUser(id: string): User { }
// AFTER: function getUser(id: string): User | null { }
// Callers assuming non-null will break!
```

### 3. Intent vs Reality Mismatch

Commit message promises one thing, code does another.

| Type | Risk | Detection |
|------|------|-----------|
| Commit says X, code does Y | False confidence | Compare message to diff |
| Partial implementation | Incomplete feature | Check all stated changes |
| Missing edge cases | Fragile code | Verify claimed coverage |

```typescript
// VIOLATION: Commit says "Add retry logic" but no retry implemented
async function fetchData(): Promise<Data> {
  return api.get('/data');  // No retry!
}
```

### 4. Incomplete Migrations

Old API deprecated but not all consumers updated.

| Type | Risk | Detection |
|------|------|-----------|
| Some call sites updated | Mixed behavior | Search for old API usage |
| Consumers not updated | Type errors | Check all importers |
| Tests not updated | False passes | Compare test coverage |

```typescript
// VIOLATION: Migration incomplete
// file1.ts: newFunction({ a, b })  // Updated
// file2.ts: oldFunction(a, b)      // NOT updated!
```

---

## Quick Detection Commands

```bash
# Find removed exports
git diff main...HEAD | grep "^-export"

# Find removed files
git diff main...HEAD --name-status | grep "^D"

# Find incomplete migration (old API still used)
grep -r "oldFunction" src/ --include="*.ts"

# Find new TODOs (incomplete work)
git diff main...HEAD | grep "^\+.*TODO"
```

---

## Extended References

For extended examples and detection techniques:

- **[violations.md](references/violations.md)** - Detailed violation examples for each category
- **[patterns.md](references/patterns.md)** - Correct patterns for regression-safe changes
- **[detection.md](references/detection.md)** - Comprehensive bash commands for detection

---

## Severity Guidelines

| Severity | Criteria | Examples |
|----------|----------|----------|
| **CRITICAL** | Breaking changes without migration | Public exports removed, return types incompatible, required params added |
| **HIGH** | Significant behavior changes | Defaults changed, error handling changed, side effects removed |
| **MEDIUM** | Moderate regression risk | Internal APIs changed, logging reduced, performance changed |
| **LOW** | Minor concerns | Documentation drift, internal refactoring |

---

## Regression Checklist

Before approving changes:

- [ ] No exports removed without deprecation
- [ ] Return types backward compatible
- [ ] Default values unchanged (or documented)
- [ ] Side effects preserved (events, logging)
- [ ] All consumers of changed code updated
- [ ] Migration complete across codebase
- [ ] CLI options preserved or deprecated
- [ ] API endpoints preserved or versioned
- [ ] Commit message matches implementation
- [ ] Breaking changes documented in CHANGELOG
