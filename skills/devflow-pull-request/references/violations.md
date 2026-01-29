# Pull Request Violations

Common PR anti-patterns:

## Violations

| Violation | Problem | Fix |
|-----------|---------|-----|
| Vague descriptions | Reviewers can't understand changes | Use structured template |
| Hidden breaking changes | Consumers surprised | Document explicitly |
| Massive PRs (>1000 lines) | Impossible to review | Split into smaller PRs |
| Missing test plan | Unknown coverage | Include manual/automated test steps |
| No related issues | Lost context | Link to issues/tickets |
| Dishonest limitations | Technical debt hidden | Disclose honestly |

## Quick Reference

See [templates.md](templates.md) for proper PR description templates and size guidelines.
