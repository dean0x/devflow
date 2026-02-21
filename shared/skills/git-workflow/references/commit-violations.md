# Commit Violations

Common commit anti-patterns to avoid.

---

## Summary Table

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

---

## Grab-Bag Commits

```bash
# VIOLATION: Multiple unrelated changes
git add . && git commit -m "Various fixes and updates"

# FIX: Split into atomic commits by concern
git add src/auth/*.ts && git commit -m "feat(auth): add login handler"
git add src/components/button.tsx && git commit -m "fix(ui): correct button color"
```

## Blind Staging

```bash
# VIOLATION: No review of what's being committed
git add .
git add -A

# FIX: Review and stage specific files
git status && git diff
git add src/services/user.ts src/models/user.ts
```

## Vague Messages

```bash
# VIOLATION: No context
git commit -m "Fix bug"
git commit -m "WIP"
git commit -m "stuff"

# FIX: Describe what and why
git commit -m "fix(auth): prevent session timeout during active use"
```

## Sensitive Files

```bash
# VIOLATION: Committing secrets
git add .env
git add config/credentials.json

# FIX: Add to .gitignore and commit example config
git add .env.example
```

## Force Push to Shared Branches

```bash
# VIOLATION: Rewriting shared history
git push --force origin main

# FIX: Create new commits for fixes
git commit -m "fix(auth): correct typo in previous commit"
git push  # Normal push
```
