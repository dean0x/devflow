# Self-Review Violations

Common anti-patterns and code violations organized by the 9 pillars.

---

## Self-Review Process Violations

| Violation | Problem | Fix |
|-----------|---------|-----|
| Skipping pillars | Incomplete review | Check all 9 pillars |
| Ignoring P0/P1 issues | Returning broken code | Fix before returning |
| Surface-level review | Missing deep issues | Review each pillar thoroughly |
| No evidence | Unverifiable claims | Reference specific code |
| Deferring critical fixes | Technical debt | Fix CRITICAL/HIGH immediately |

---

## P0 Pillars (MUST Fix)

### 1. Design Violations

**Question**: Does the implementation fit the architecture?

**Red Flags**:
```typescript
// BAD: Direct database access in controller
class UserController {
  async getUser(req, res) {
    const user = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  }
}

// BAD: God class doing everything
class ApplicationManager {
  createUser() {}
  processPayment() {}
  sendEmail() {}
  generateReport() {}
  // 500 more methods...
}

// BAD: Circular dependencies
// a.ts imports b.ts, b.ts imports a.ts
```

**Checklist**:
- [ ] Follows existing patterns in codebase
- [ ] Respects layer boundaries (controller/service/repository)
- [ ] Dependencies injected, not instantiated
- [ ] Not over-engineering (YAGNI)
- [ ] Not under-engineering (technical debt)
- [ ] Interactions with other components are sound

---

### 2. Functionality Violations

**Question**: Does the code work as intended?

**Red Flags**:
```typescript
// BAD: Missing null check
function getDisplayName(user: User) {
  return user.profile.displayName;  // user.profile could be undefined!
}

// BAD: Race condition
let balance = await getBalance();
if (balance >= amount) {
  await withdraw(amount);  // Balance could change between check and withdraw!
}

// BAD: Off-by-one error
for (let i = 0; i <= array.length; i++) {  // Should be < not <=
  process(array[i]);
}
```

**Checklist**:
- [ ] Happy path works correctly
- [ ] Edge cases handled (null, empty, boundary values)
- [ ] Error cases handled gracefully
- [ ] No race conditions in concurrent code
- [ ] No infinite loops or recursion without base case
- [ ] State mutations are intentional and correct

---

### 3. Security Violations

**Question**: Are there security vulnerabilities?

**Red Flags**:
```typescript
// BAD: SQL injection
const query = `SELECT * FROM users WHERE email = '${email}'`;

// BAD: Command injection
exec(`ls ${userInput}`);

// BAD: Hardcoded secret
const API_KEY = 'sk-abc123xyz789';

// BAD: Missing auth check
app.delete('/api/users/:id', async (req, res) => {
  await deleteUser(req.params.id);  // No auth!
});
```

**Checklist**:
- [ ] No SQL/NoSQL injection
- [ ] No command injection
- [ ] No XSS vulnerabilities
- [ ] Input validated at boundaries
- [ ] No hardcoded secrets
- [ ] Authentication/authorization checked
- [ ] Sensitive data not logged

---

## P1 Pillars (SHOULD Fix)

### 4. Complexity Violations

**Question**: Can a reader understand this in 5 minutes?

**Red Flags**:
```typescript
// BAD: Deep nesting
if (a) {
  if (b) {
    if (c) {
      if (d) {
        if (e) {
          // actual logic buried here
        }
      }
    }
  }
}

// BAD: Magic numbers
setTimeout(callback, 86400000);
if (status === 3) { }
```

**Checklist**:
- [ ] Functions are < 50 lines
- [ ] Nesting depth < 4 levels
- [ ] Cyclomatic complexity < 10
- [ ] No magic numbers/strings
- [ ] Single responsibility per function
- [ ] Complex logic has explanatory comments

---

### 5. Error Handling Violations

**Question**: Are errors handled explicitly and consistently?

**Red Flags**:
```typescript
// BAD: Swallowed exception
try {
  await riskyOperation();
} catch (e) {
  // silently ignored!
}

// BAD: Generic error message
throw new Error('Something went wrong');

// BAD: Resource leak on error
const file = await openFile(path);
await processFile(file);  // If this throws, file never closed!
await file.close();
```

**Checklist**:
- [ ] Errors are caught and handled appropriately
- [ ] Error messages are helpful (not generic)
- [ ] No silent failures (swallowed exceptions)
- [ ] Consistent error handling pattern (Result types or throws)
- [ ] Resources cleaned up in error paths
- [ ] Errors logged with context

---

### 6. Tests Violations

**Question**: Is the new functionality tested?

**Red Flags**:
```typescript
// BAD: No tests for new function
export function calculateDiscount(price, type) {
  // 20 lines of logic with no tests
}

// BAD: Test that doesn't verify behavior
it('creates user', async () => {
  await createUser(data);
  expect(mockDb.insert).toHaveBeenCalled();  // Only checks mock was called
});

// BAD: Missing edge case tests
describe('divide', () => {
  it('divides numbers', () => {
    expect(divide(10, 2)).toBe(5);
  });
  // No test for divide by zero!
});
```

**Checklist**:
- [ ] New code has corresponding tests
- [ ] Tests cover happy path
- [ ] Tests cover error cases
- [ ] Tests cover edge cases
- [ ] Tests are not brittle (test behavior, not implementation)
- [ ] Tests would fail if code breaks

---

## P2 Pillars (FIX if Time Permits)

### 7. Naming Violations

**Question**: Are names clear and descriptive?

**Red Flags**:
```typescript
// BAD: Cryptic names
const d = new Date();
const r = items.filter(i => i.t > d);
const x = r.reduce((a, b) => a + b.p, 0);

// BAD: Misleading name
function getUser(id) {
  return db.users.findAll();  // Returns ALL users, not one!
}
```

**Checklist**:
- [ ] Variable names describe content
- [ ] Function names describe action
- [ ] No single-letter names (except loop indices)
- [ ] No abbreviations that aren't universal
- [ ] Consistent naming style (camelCase/snake_case)

---

### 8. Consistency Violations

**Question**: Does this match existing patterns?

**Red Flags**:
```typescript
// BAD: Different style than rest of codebase
// Existing code uses Result types
function existingFunction(): Result<User, Error> { }

// Your code throws instead
function yourFunction(): User {
  throw new Error('...');  // Inconsistent!
}
```

**Checklist**:
- [ ] Follows existing code style
- [ ] Uses same patterns as surrounding code
- [ ] Error handling matches project conventions
- [ ] Import organization matches existing files
- [ ] No unnecessary divergence from norms

---

### 9. Documentation Violations

**Question**: Will others understand this code?

**Red Flags**:
```typescript
// BAD: Missing docs on complex function
export function calculateProratedBilling(plan, start, end, previous) {
  // 50 lines of complex billing logic with no explanation
}

// BAD: Outdated comment
// Returns user's full name
function getDisplayName(user) {
  return user.username;  // Actually returns username!
}
```

**Checklist**:
- [ ] Complex logic has explanatory comments
- [ ] Public APIs have JSDoc/docstrings
- [ ] README updated if behavior changes
- [ ] No outdated comments
- [ ] Comments explain "why", not "what"

---

## Quick Reference

See [patterns.md](patterns.md) for correct patterns and [report-template.md](report-template.md) for self-review format.
