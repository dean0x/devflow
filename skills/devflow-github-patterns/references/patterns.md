# GitHub Patterns

Correct patterns for GitHub API and workflows:

## Patterns

### Rate Limit Handling

```bash
# Check rate limit before operations
gh api rate_limit --jq '.resources.core.remaining'

# Wait if rate limited
check_rate_limit() {
  remaining=$(gh api rate_limit --jq '.resources.core.remaining')
  if [ "$remaining" -lt 10 ]; then
    echo "Rate limit low, waiting..."
    sleep 60
  fi
}
```

### Error Handling

```bash
# Always check gh command results
if ! gh pr create --title "..." --body "..."; then
  echo "PR creation failed"
  exit 1
fi
```

## Quick Reference

See [api.md](api.md) for complete API patterns and [commands.md](commands.md) for gh CLI examples.
