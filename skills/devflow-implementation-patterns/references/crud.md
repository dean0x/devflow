# CRUD Implementation Patterns

Detailed patterns for Create, Read, Update, Delete operations.

## Create Operation

```typescript
// Pattern: Validate -> Transform -> Persist -> Return
async function createUser(input: CreateUserInput): Promise<Result<User, CreateError>> {
  // 1. Validate input
  const validated = validateCreateUser(input);
  if (!validated.ok) {
    return Err({ type: 'validation', details: validated.error });
  }

  // 2. Transform to domain entity
  const user: User = {
    id: generateId(),
    ...validated.value,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // 3. Persist
  const saved = await userRepository.save(user);
  if (!saved.ok) {
    return Err({ type: 'persistence', details: saved.error });
  }

  // 4. Return created entity
  return Ok(saved.value);
}
```

## Read Operation (Single)

```typescript
// Pattern: Fetch -> NotFound check -> Transform -> Return
async function getUser(id: UserId): Promise<Result<UserDTO, GetError>> {
  // 1. Fetch from store
  const user = await userRepository.findById(id);

  // 2. Handle not found
  if (!user.ok) {
    return Err({ type: 'not_found', id });
  }

  // 3. Transform to DTO (hide internal fields)
  const dto = toUserDTO(user.value);

  // 4. Return
  return Ok(dto);
}
```

## Read Operation (List)

```typescript
// Pattern: Parse filters -> Query -> Transform -> Paginate
async function listUsers(params: ListParams): Promise<Result<PaginatedResult<UserDTO>, ListError>> {
  // 1. Parse and validate filters
  const filters = parseFilters(params);
  const pagination = parsePagination(params);

  // 2. Query with filters
  const result = await userRepository.findMany({
    where: filters,
    skip: pagination.offset,
    take: pagination.limit,
    orderBy: pagination.orderBy,
  });

  // 3. Transform to DTOs
  const items = result.items.map(toUserDTO);

  // 4. Return paginated result
  return Ok({
    items,
    total: result.total,
    page: pagination.page,
    pageSize: pagination.limit,
    hasMore: result.total > pagination.offset + items.length,
  });
}
```

## Update Operation

```typescript
// Pattern: Fetch existing -> Validate changes -> Merge -> Persist
async function updateUser(
  id: UserId,
  input: UpdateUserInput
): Promise<Result<User, UpdateError>> {
  // 1. Fetch existing
  const existing = await userRepository.findById(id);
  if (!existing.ok) {
    return Err({ type: 'not_found', id });
  }

  // 2. Validate changes
  const validated = validateUpdateUser(input, existing.value);
  if (!validated.ok) {
    return Err({ type: 'validation', details: validated.error });
  }

  // 3. Merge changes (immutable update)
  const updated: User = {
    ...existing.value,
    ...validated.value,
    updatedAt: new Date(),
  };

  // 4. Persist
  const saved = await userRepository.save(updated);
  if (!saved.ok) {
    return Err({ type: 'persistence', details: saved.error });
  }

  return Ok(saved.value);
}
```

## Delete Operation

```typescript
// Pattern: Check exists -> Check constraints -> Delete -> Confirm
async function deleteUser(id: UserId): Promise<Result<void, DeleteError>> {
  // 1. Check exists
  const existing = await userRepository.findById(id);
  if (!existing.ok) {
    return Err({ type: 'not_found', id });
  }

  // 2. Check constraints (can this be deleted?)
  const canDelete = await checkDeleteConstraints(existing.value);
  if (!canDelete.ok) {
    return Err({ type: 'constraint_violation', details: canDelete.error });
  }

  // 3. Delete (soft delete preferred)
  const deleted = await userRepository.softDelete(id);
  if (!deleted.ok) {
    return Err({ type: 'persistence', details: deleted.error });
  }

  // 4. Confirm success
  return Ok(undefined);
}
```

## Database Patterns

### Repository Pattern

```typescript
// Pattern: Abstract data access behind interface
interface UserRepository {
  findById(id: UserId): Promise<Result<User, NotFoundError>>;
  findByEmail(email: string): Promise<Result<User, NotFoundError>>;
  findMany(query: UserQuery): Promise<PaginatedResult<User>>;
  save(user: User): Promise<Result<User, PersistenceError>>;
  delete(id: UserId): Promise<Result<void, PersistenceError>>;
}

// Implementation
class PostgresUserRepository implements UserRepository {
  constructor(private db: Database) {}

  async findById(id: UserId): Promise<Result<User, NotFoundError>> {
    const row = await this.db.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    if (!row) {
      return Err({ type: 'not_found', entity: 'User', id });
    }
    return Ok(rowToUser(row));
  }

  // ... other methods
}
```

### Transaction Pattern

```typescript
// Pattern: Start transaction -> Execute operations -> Commit or rollback
async function transferFunds(
  from: AccountId,
  to: AccountId,
  amount: Money
): Promise<Result<Transfer, TransferError>> {
  return db.transaction(async (tx) => {
    // 1. Debit source account
    const debit = await tx.accounts.debit(from, amount);
    if (!debit.ok) {
      return Err({ type: 'insufficient_funds', account: from });
    }

    // 2. Credit destination account
    const credit = await tx.accounts.credit(to, amount);
    if (!credit.ok) {
      return Err({ type: 'credit_failed', account: to });
    }

    // 3. Record transfer
    const transfer = await tx.transfers.create({
      from,
      to,
      amount,
      timestamp: new Date(),
    });

    return Ok(transfer);
  });
  // Transaction auto-commits on success, auto-rollbacks on error
}
```
