# Code Smell Correct Patterns

Patterns that avoid fake solutions and workarounds:

## Correct Patterns

### Honest Implementation

```typescript
// CORRECT: Real implementation with proper error handling
async function fetchUser(id: string): Promise<Result<User, UserError>> {
  const response = await api.get(`/users/${id}`);
  if (!response.ok) {
    return Err({ type: 'NotFound', userId: id });
  }
  return Ok(response.data);
}
```

### Labeled Workarounds

```typescript
// HACK: Using setTimeout due to race condition in third-party library
// TODO: Remove when library issue #123 is fixed
// Tracked in: JIRA-456
setTimeout(() => initializeWidget(), 100);
```

### Honest Limitations

```typescript
// NOT-PRODUCTION: Mock data for development only
// Real implementation requires API key from environment
const mockUsers = process.env.NODE_ENV === 'development'
  ? MOCK_USERS
  : await fetchRealUsers();
```

## Quick Reference

See [violations.md](violations.md) for anti-patterns to avoid.
