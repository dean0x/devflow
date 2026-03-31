# Git Violations

Common anti-patterns for git safety, commits, and pull requests.

---

## Safety Violations

| Violation | Risk | Fix |
|-----------|------|-----|
| Parallel git commands | Index corruption | Run git commands sequentially |
| Force push to main | Lost commits | Never force push protected branches |
| Committing secrets | Security breach | Use detection.md patterns |
| Amending after push | History rewrite | Create new commit instead |
| Skipping hooks | Quality bypass | Never use `--no-verify` |
| Ignoring lock files | Corruption | Wait for lock release |

---

## Commit Violations

| Violation | Example | Impact |
|-----------|---------|--------|
| Grab-bag commits | "Various fixes and updates" | Hard to review, revert, bisect |
| Blind staging | `git add .` | Accidental sensitive file commits |
| Vague messages | "Fix bug" | Lost context, unclear history |
| Missing context | "Update user.ts" | No explanation of why |
| Sensitive files | Committing .env | Security breach |
| Mixed concerns | Feature + fix + chore | Impossible atomic reverts |
| No type prefix | "Add login" | Inconsistent changelog |
| Force push shared | `--force` to main | Team work destroyed |

### Grab-Bag Commits

```bash
# VIOLATION: Multiple unrelated changes
git add . && git commit -m "Various fixes and updates"

# FIX: Split into atomic commits by concern
git add src/auth/*.ts && git commit -m "feat(auth): add login handler"
git add src/components/button.tsx && git commit -m "fix(ui): correct button color"
```

### Blind Staging

```bash
# VIOLATION: No review of what's being committed
git add .

# FIX: Review and stage specific files
git status && git diff
git add src/services/user.ts src/models/user.ts
```

### Vague Messages

```bash
# VIOLATION: No context
git commit -m "Fix bug"

# FIX: Describe what and why
git commit -m "fix(auth): prevent session timeout during active use"
```

---

## PR Violations

| Violation | Problem | Fix |
|-----------|---------|-----|
| Vague descriptions | Reviewers can't understand | Use structured template |
| Hidden breaking changes | Consumers surprised | Document explicitly |
| Massive PRs (>1000 lines) | Impossible to review | Split into smaller PRs |
| Missing test plan | Unknown coverage | Include test steps |
| No related issues | Lost context | Link to issues/tickets |
| Dishonest limitations | Technical debt hidden | Disclose honestly |

### Vague Description

```markdown
# BAD
## Summary
Fixed some bugs and added features.

# GOOD
## Summary
- Fix: Null pointer exception in UserService when email is empty
- Feat: Add rate limiting to /api/login endpoint (5 req/min)
```

### Hidden Breaking Changes

```markdown
# BAD
## Summary
Refactored authentication module.

# GOOD
## Breaking Changes
- `authenticate(token)` now returns `Result<User, AuthError>` instead of `User | null`
- Required migration: Run `npm run migrate:auth` before deploying
```

### Massive PR Split

```markdown
PR SIZE WARNING

This PR changes {X} files and {Y} lines. Consider splitting:
1. PR 1: {Component A}
2. PR 2: {Component B}
3. PR 3: {Tests}
```

### Missing Test Plan

```markdown
# BAD
Added new payment processing.

# GOOD
## Testing
### Automated
- 12 unit tests for PaymentService
- 3 integration tests for Stripe webhook
### Gaps
- Edge case: Partial refunds not tested (tracked in #456)
```
