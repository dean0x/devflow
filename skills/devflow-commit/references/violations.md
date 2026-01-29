# Commit Violations

Common commit anti-patterns:

## Violations

| Violation | Example | Fix |
|-----------|---------|-----|
| Grab-bag commits | "Various fixes and updates" | Split into atomic commits |
| Mixed concerns | Feature + refactor + fix in one | Separate by type |
| Blind staging | `git add .` without review | Review each file |
| Vague messages | "Fix bug" | Describe what and why |
| Missing context | "Update user.ts" | Explain the change purpose |
| Sensitive files | Committing .env, credentials | Add to .gitignore |

## Quick Reference

See [examples.md](examples.md) for correct commit patterns and grouping strategies.
