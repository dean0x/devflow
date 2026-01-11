---
name: devflow-self-review
description: Self-review framework for Coder agent. Evaluate implementation against 9 pillars before returning. Fix P0/P1 issues immediately. Used via Stop hook to ensure quality before handoff.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Self-Review Framework

Systematic self-review process for the Coder agent. Evaluate your implementation against 9 pillars before returning. **Fix issues, don't just report them.**

Based on [Google Engineering Practices](https://google.github.io/eng-practices/review/reviewer/looking-for.html) and [Microsoft Engineering Playbook](https://microsoft.github.io/code-with-engineering-playbook/code-reviews/process-guidance/reviewer-guidance/).

## Iron Law

> **FIX BEFORE RETURNING**
>
> Self-review is not a report generator. It's a quality gate. If you find a P0 or P1 issue,
> you fix it. You only return when all critical issues are resolved. The goal is to catch
> your own mistakes before someone else has to. Pride in craftsmanship, not speed of delivery.

## The 9 Pillars

### Priority Levels

| Priority | Action | Pillars |
|----------|--------|---------|
| **P0** | MUST fix before returning | Design, Functionality, Security |
| **P1** | SHOULD fix before returning | Complexity, Error Handling, Tests |
| **P2** | FIX if time permits | Naming, Consistency, Documentation |

---

## P0 Pillars (MUST Fix)

### 1. Design

**Question**: Does the implementation fit the architecture?

**Checklist**:
- [ ] Follows existing patterns in codebase
- [ ] Respects layer boundaries (controller/service/repository)
- [ ] Dependencies injected, not instantiated
- [ ] Not over-engineering (YAGNI)
- [ ] Not under-engineering (technical debt)
- [ ] Interactions with other components are sound

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

**Fix Pattern**: Refactor to match existing architecture. Extract responsibilities. Use dependency injection.

---

### 2. Functionality

**Question**: Does the code work as intended?

**Checklist**:
- [ ] Happy path works correctly
- [ ] Edge cases handled (null, empty, boundary values)
- [ ] Error cases handled gracefully
- [ ] No race conditions in concurrent code
- [ ] No infinite loops or recursion without base case
- [ ] State mutations are intentional and correct

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

**Fix Pattern**: Add null checks, use transactions for atomic operations, verify loop bounds.

---

### 3. Security

**Question**: Are there security vulnerabilities?

**Checklist**:
- [ ] No SQL/NoSQL injection
- [ ] No command injection
- [ ] No XSS vulnerabilities
- [ ] Input validated at boundaries
- [ ] No hardcoded secrets
- [ ] Authentication/authorization checked
- [ ] Sensitive data not logged

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

**Fix Pattern**: Use parameterized queries, escape user input, use environment variables, add auth middleware.

---

## P1 Pillars (SHOULD Fix)

### 4. Complexity

**Question**: Can a reader understand this in 5 minutes?

**Checklist**:
- [ ] Functions are < 50 lines
- [ ] Nesting depth < 4 levels
- [ ] Cyclomatic complexity < 10
- [ ] No magic numbers/strings
- [ ] Single responsibility per function
- [ ] Complex logic has explanatory comments

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

**Fix Pattern**: Extract functions, use early returns, define named constants.

---

### 5. Error Handling

**Question**: Are errors handled explicitly and consistently?

**Checklist**:
- [ ] Errors are caught and handled appropriately
- [ ] Error messages are helpful (not generic)
- [ ] No silent failures (swallowed exceptions)
- [ ] Consistent error handling pattern (Result types or throws)
- [ ] Resources cleaned up in error paths
- [ ] Errors logged with context

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

**Fix Pattern**: Always handle or rethrow errors, include context in messages, use try/finally for cleanup.

---

### 6. Tests

**Question**: Is the new functionality tested?

**Checklist**:
- [ ] New code has corresponding tests
- [ ] Tests cover happy path
- [ ] Tests cover error cases
- [ ] Tests cover edge cases
- [ ] Tests are not brittle (test behavior, not implementation)
- [ ] Tests would fail if code breaks

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

**Fix Pattern**: Add tests for all new functions, test behavior not mocks, cover edge cases.

---

## P2 Pillars (FIX if Time Permits)

### 7. Naming

**Question**: Are names clear and descriptive?

**Checklist**:
- [ ] Variable names describe content
- [ ] Function names describe action
- [ ] No single-letter names (except loop indices)
- [ ] No abbreviations that aren't universal
- [ ] Consistent naming style (camelCase/snake_case)

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

**Fix Pattern**: Rename to be descriptive and accurate.

---

### 8. Consistency

**Question**: Does this match existing patterns?

**Checklist**:
- [ ] Follows existing code style
- [ ] Uses same patterns as surrounding code
- [ ] Error handling matches project conventions
- [ ] Import organization matches existing files
- [ ] No unnecessary divergence from norms

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

**Fix Pattern**: Match existing patterns, follow established conventions.

---

### 9. Documentation

**Question**: Will others understand this code?

**Checklist**:
- [ ] Complex logic has explanatory comments
- [ ] Public APIs have JSDoc/docstrings
- [ ] README updated if behavior changes
- [ ] No outdated comments
- [ ] Comments explain "why", not "what"

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

**Fix Pattern**: Add JSDoc to public APIs, explain complex algorithms, remove outdated comments.

---

## Self-Review Process

### Step 1: Gather Changes

```bash
# List files you changed
git diff --name-only HEAD~1

# See the actual diff
git diff HEAD~1
```

### Step 2: Evaluate Each Pillar

For each pillar, ask the question and run through the checklist.

**Scoring**:
- PASS: No issues found
- ISSUE: Problem identified (note file:line)

### Step 3: Fix P0 Issues

If any P0 pillar has issues:
1. Fix the issue immediately
2. Re-evaluate that pillar
3. Continue until PASS

**If P0 issue is unfixable** (requires architectural change beyond scope):
- STOP
- Report blocker to orchestrator
- Do not proceed

### Step 4: Fix P1 Issues

If any P1 pillar has issues:
1. Fix the issue
2. Re-evaluate
3. Continue until PASS or time constraint

### Step 5: Address P2 Issues

If time permits:
1. Fix P2 issues
2. These are improvements, not blockers

### Step 6: Generate Report

```markdown
## Self-Review Report

### P0 Pillars
- Design: PASS
- Functionality: PASS (fixed null check in user.ts:45)
- Security: PASS

### P1 Pillars
- Complexity: PASS (extracted helper function)
- Error Handling: PASS
- Tests: PASS (added 3 test cases)

### P2 Pillars
- Naming: PASS
- Consistency: PASS
- Documentation: PASS (added JSDoc)

### Summary
All P0 and P1 issues resolved. Ready for external review.
```

---

## Decision Tree

```
START
  │
  ▼
┌─────────────────┐
│ Evaluate P0     │
│ (Design,        │
│  Functionality, │
│  Security)      │
└────────┬────────┘
         │
    Issues found?
    ┌────┴────┐
   YES       NO
    │         │
    ▼         │
┌─────────┐   │
│ Fixable?│   │
└────┬────┘   │
  ┌──┴──┐     │
 YES   NO     │
  │     │     │
  ▼     ▼     │
 FIX   STOP   │
  │   REPORT  │
  │   BLOCKER │
  │           │
  └─────┬─────┘
        │
        ▼
┌─────────────────┐
│ Evaluate P1     │
│ (Complexity,    │
│  Error Handling,│
│  Tests)         │
└────────┬────────┘
         │
    Issues found?
    ┌────┴────┐
   YES       NO
    │         │
    ▼         │
   FIX        │
    │         │
    └────┬────┘
         │
         ▼
┌─────────────────┐
│ Evaluate P2     │
│ (Naming,        │
│  Consistency,   │
│  Documentation) │
└────────┬────────┘
         │
    Issues found?
    ┌────┴────┐
   YES       NO
    │         │
    ▼         │
 FIX IF       │
 TIME         │
    │         │
    └────┬────┘
         │
         ▼
      RETURN
   WITH REPORT
```

---

## Integration

This skill is used by:
- **Coder agent**: Via Stop hook before returning implementation
- **Stop hook prompt**: "Run self-review using devflow-self-review. Fix all P0/P1 issues. Return when PASS."

The self-review ensures implementations meet quality standards before external review, reducing review cycles and catching issues early.
