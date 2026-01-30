# Codebase Navigation Violations

Common mistakes when exploring unfamiliar codebases.

---

## Critical Violations

### Starting Implementation Without Exploration

```typescript
// BAD: Implementing without finding existing patterns
class UserService {
  // Invented new error handling pattern
  async getUser(id: string): Promise<User | null> {
    try {
      return await db.users.find(id);
    } catch {
      return null;
    }
  }
}

// GOOD: Found existing Result pattern first
class UserService {
  // Matches existing codebase pattern
  async getUser(id: string): Promise<Result<User, NotFoundError>> {
    const user = await db.users.find(id);
    if (!user) return Err({ type: 'NotFound', id });
    return Ok(user);
  }
}
```

**Problem**: Creates inconsistent patterns across codebase
**Fix**: Search for similar implementations before writing new code

---

### Ignoring Test Files

```typescript
// BAD: Guessing how to test without checking existing tests
describe('UserService', () => {
  let service: UserService;
  let mockDb: jest.Mock;

  beforeEach(() => {
    mockDb = jest.fn();
    service = new UserService(mockDb);
  });
  // ... invented test pattern
});

// GOOD: Followed existing test patterns
describe('UserService', () => {
  // Found that codebase uses factory functions
  const service = createTestService();
  const user = createTestUser();

  it('should return user', async () => {
    // Matches existing assertion style
    const result = await service.getUser(user.id);
    expectOk(result);
    expect(result.value).toMatchUser(user);
  });
});
```

**Problem**: Test styles diverge, harder to maintain
**Fix**: Search `*.test.ts` for existing patterns before writing tests

---

### Not Finding Entry Points

```typescript
// BAD: Added route in wrong location
// Created new file: src/api/users/routes.ts
app.get('/users/:id', getUserHandler);

// GOOD: Found existing route registration pattern
// Added to existing file: src/routes/index.ts (where all routes live)
import { userRoutes } from './users';
app.use('/users', userRoutes);
```

**Problem**: Routes scattered, hard to find, may conflict
**Fix**: Find main/index files to understand registration patterns

---

### Duplicating Existing Code

```typescript
// BAD: Wrote new validation function
function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// GOOD: Found existing utility
import { validateEmail } from '@/utils/validation';
// Or found Zod schema
import { EmailSchema } from '@/schemas/common';
```

**Problem**: Multiple implementations, bugs fixed in one place only
**Fix**: Search for similar functionality before implementing

---

### Skipping Type Definitions

```typescript
// BAD: Used any because didn't find types
function processOrder(order: any): any {
  return { ...order, processed: true };
}

// GOOD: Found and used existing types
import { Order, ProcessedOrder } from '@/types/orders';

function processOrder(order: Order): ProcessedOrder {
  return { ...order, processed: true, processedAt: new Date() };
}
```

**Problem**: Type safety lost, runtime errors
**Fix**: Search `*.d.ts`, `types.ts` for existing type definitions

---

### Not Following Imports

```typescript
// BAD: Created new database instance
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

// GOOD: Found existing database instance
import { db } from '@/lib/database';
// Or found it's injected via context
function handler(ctx: AppContext) {
  const { db } = ctx;
}
```

**Problem**: Multiple connections, resource leaks, inconsistent state
**Fix**: Follow imports to find shared instances

---

## Anti-Pattern Summary

| Violation | Problem | Detection |
|-----------|---------|-----------|
| No exploration | Inconsistent patterns | New patterns that don't match existing code |
| Ignoring tests | Divergent test styles | Test setup differs from other test files |
| Wrong entry points | Scattered registration | Files created outside standard locations |
| Duplicating code | Multiple implementations | Similar utilities in different locations |
| Skipping types | Type safety lost | `any` types, missing interfaces |
| Not following imports | Resource leaks | Direct instantiation of shared resources |

---

## Quick Checks Before Implementing

1. **Pattern check**: `grep -r "similar pattern" --include="*.ts" | head -5`
2. **Test check**: `find . -name "*.test.ts" | head -5` then read one
3. **Entry point check**: `ls src/routes/ src/index.*` to find registration
4. **Utility check**: `ls src/utils/ src/lib/` for existing helpers
5. **Type check**: `find . -name "types.ts" -o -name "*.d.ts" | head -5`
6. **Import check**: Read imports in similar files to find shared resources
