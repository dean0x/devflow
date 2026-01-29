# GitHub Patterns Violations

Common GitHub API and workflow violations:

## Violations

| Violation | Risk | Fix |
|-----------|------|-----|
| Ignoring rate limits | API lockout | Check rate limit before batch operations |
| Missing error handling | Silent failures | Handle 403, 404, 422 responses |
| Hardcoded tokens | Security breach | Use environment variables |
| No pagination | Missing data | Always handle paginated responses |
| Blocking on API calls | Slow workflows | Use async/concurrent patterns |

## Quick Reference

See [api.md](api.md) for proper API patterns and [commands.md](commands.md) for gh CLI usage.
