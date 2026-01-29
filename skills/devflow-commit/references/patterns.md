# Commit Patterns

Correct commit practices for atomic, well-documented history:

## Patterns

### Atomic Commits

```bash
# Commit 1: Source code changes
git add src/auth/*.ts && git commit -m "feat(auth): implement login handler"

# Commit 2: Tests for the feature
git add tests/auth/*.ts && git commit -m "test(auth): add login handler tests"

# Commit 3: Documentation updates
git add docs/auth.md && git commit -m "docs(auth): document login flow"
```

### Message Format

```
<type>(<scope>): <short summary> (max 50 chars)

<optional body explaining what and why>
<wrap at 72 characters>

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Quick Reference

See [examples.md](examples.md) for extended commit grouping examples.
