# Pull Request Violations

Common PR anti-patterns and how to fix them.

---

## Violation Table

| Violation | Problem | Fix |
|-----------|---------|-----|
| Vague descriptions | Reviewers can't understand changes | Use structured template |
| Hidden breaking changes | Consumers surprised | Document explicitly |
| Massive PRs (>1000 lines) | Impossible to review | Split into smaller PRs |
| Missing test plan | Unknown coverage | Include manual/automated test steps |
| No related issues | Lost context | Link to issues/tickets |
| Dishonest limitations | Technical debt hidden | Disclose honestly |

---

## Vague Description Examples

```markdown
# BAD: Vague
## Summary
Fixed some bugs and added features.

# GOOD: Specific
## Summary
- Fix: Null pointer exception in UserService when email is empty
- Feat: Add rate limiting to /api/login endpoint (5 req/min)
```

---

## Hidden Breaking Changes

```markdown
# BAD: Breaking change buried in code
## Summary
Refactored authentication module.

# GOOD: Breaking changes called out
## Summary
Refactored authentication module.

## Breaking Changes
- `authenticate(token)` now returns `Result<User, AuthError>` instead of `User | null`
- Required migration: Run `npm run migrate:auth` before deploying
```

---

## Massive PR Split Recommendation

When PR is too large (>1000 lines), recommend splitting:

```markdown
PR SIZE WARNING

This PR changes {X} files and {Y} lines. Consider splitting:

1. PR 1: {Component A} - {files}
2. PR 2: {Component B} - {files}
3. PR 3: {Tests} - {files}

Rationale: Smaller PRs are easier to review, safer to merge.
```

---

## Missing Test Plan

```markdown
# BAD: No testing information
## Summary
Added new payment processing.

# GOOD: Clear test plan
## Summary
Added new payment processing.

## Testing
### Automated
- 12 unit tests for PaymentService
- 3 integration tests for Stripe webhook

### Manual
1. Create test payment at /checkout
2. Verify webhook received in Stripe dashboard
3. Confirm order status updated to "paid"

### Gaps
- Edge case: Partial refunds not tested (tracked in #456)
```

---

## Dishonest Limitations

```markdown
# BAD: Hiding technical debt
## Summary
Implemented caching layer.

# GOOD: Honest about limitations
## Summary
Implemented caching layer.

## Limitations
- Cache invalidation not implemented (tracked in #789)
- Memory usage not bounded - add eviction policy before production load
- Redis cluster mode not supported yet
```
