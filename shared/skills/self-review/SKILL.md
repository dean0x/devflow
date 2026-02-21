---
name: self-review
description: Self-review framework evaluating implementation quality against 9 pillars (correctness, completeness, security, performance, maintainability, testing, documentation, error handling, simplicity). Fixes P0/P1 issues immediately rather than reporting them. Used by the Scrutinizer agent as a quality gate.
user-invocable: false
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Self-Review Framework

Systematic self-review for the Scrutinizer agent. Evaluate implementation against 9 pillars. **Fix issues, don't just report them.**

Based on [Google Engineering Practices](https://google.github.io/eng-practices/review/reviewer/looking-for.html).

## Iron Law

> **FIX BEFORE RETURNING**
>
> Self-review is not a report generator. It's a quality gate. If you find a P0 or P1 issue,
> you fix it. You only return when all critical issues are resolved. Pride in craftsmanship.

---

## The 9 Pillars

| Priority | Action | Pillars |
|----------|--------|---------|
| **P0** | MUST fix | Design, Functionality, Security |
| **P1** | SHOULD fix | Complexity, Error Handling, Tests |
| **P2** | FIX if time | Naming, Consistency, Documentation |

### P0 - Design
Does the implementation fit the architecture? Follows existing patterns, respects layer boundaries, dependencies injected.

### P0 - Functionality
Does the code work? Happy path, edge cases (null, empty, boundary), no race conditions.

### P0 - Security
Any vulnerabilities? No injection, input validated, no hardcoded secrets, auth checked.

### P1 - Complexity
Understandable in 5 minutes? Functions < 50 lines, nesting < 4 levels, no magic numbers.

### P1 - Error Handling
Errors handled explicitly? No swallowed exceptions, helpful messages, resources cleaned up.

### P1 - Tests
New code tested? Covers happy path, errors, edges. Tests behavior, not implementation.

### P2 - Naming
Names clear and descriptive? No cryptic abbreviations, consistent style.

### P2 - Consistency
Matches existing patterns? Same style, same conventions, no unnecessary divergence.

### P2 - Documentation
Will others understand? Complex logic commented, public APIs documented, no outdated comments.

---

## Quick Examples

### Design Red Flag
```typescript
// BAD: Direct DB in controller (violates layers)
class UserController {
  async getUser(req, res) {
    const user = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  }
}
```

### Security Red Flag
```typescript
// BAD: SQL injection
const query = `SELECT * FROM users WHERE email = '${email}'`;

// BAD: Missing auth
app.delete('/api/users/:id', async (req, res) => {
  await deleteUser(req.params.id);  // No auth check!
});
```

---

## Self-Review Process

### Step 1: Gather Changes
```bash
git diff --name-only HEAD~1
git diff HEAD~1
```

### Step 2: Evaluate P0 Pillars
Check Design, Functionality, Security. If issues found and fixable, fix immediately. If unfixable, STOP and report blocker.

### Step 3: Evaluate P1 Pillars
Check Complexity, Error Handling, Tests. Fix issues found.

### Step 4: Evaluate P2 Pillars
Check Naming, Consistency, Documentation. Fix if time permits.

### Step 5: Generate Report
Document status of each pillar, fixes applied, and overall readiness.

---

## Output Format

```markdown
## Self-Review Report

### P0 Pillars
- Design: PASS/FIXED
- Functionality: PASS/FIXED
- Security: PASS/FIXED

### P1 Pillars
- Complexity: PASS/FIXED
- Error Handling: PASS/FIXED
- Tests: PASS/FIXED

### P2 Pillars
- Naming: PASS/FIXED/SKIP
- Consistency: PASS/FIXED/SKIP
- Documentation: PASS/FIXED/SKIP

### Summary
Issues Found: {n}, Fixed: {n}
Status: READY / BLOCKED
```

---

## Extended References

For detailed checklists, examples, and red flags for each pillar:
- See `references/pillars.md`

For complete report templates and examples:
- See `references/report-template.md`

---

## Integration

Used by:
- **Scrutinizer agent**: Dedicated self-review in fresh context after Coder completes

The self-review ensures implementations meet quality standards before external review, catching issues early.
