# Pull Request Patterns

Correct patterns for high-quality PRs:

## Patterns

### PR Title Format

```
<type>(<scope>): <description>

feat(auth): add JWT token validation
fix(api): handle null response from external service
```

### PR Description Structure

```markdown
## Summary
- Brief bullet points of what changed and why

## Breaking Changes
- API signature changes: `oldMethod()` → `newMethod(options)`

## Test Plan
- [ ] Unit tests pass
- [ ] Manual testing steps

## Related
Closes #123
```

## Quick Reference

See [templates.md](templates.md) for complete PR description template and bash examples.
