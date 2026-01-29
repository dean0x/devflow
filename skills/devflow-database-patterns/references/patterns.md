# Database Correct Patterns

Extended examples of correct database design and optimization patterns.

## Schema Design Patterns

### Proper Table Structure

```sql
-- Well-designed table with all essential elements
CREATE TABLE orders (
  -- Primary key: UUID for distributed systems, SERIAL for simpler cases
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign keys with appropriate actions
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,

  -- Appropriate data types
  total DECIMAL(10, 2) NOT NULL CHECK (total >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',

  -- Timestamps with timezone
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Constraints
  CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'completed', 'cancelled'))
);

-- Indexes for common queries
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_status ON orders(status) WHERE status != 'completed';
CREATE INDEX idx_orders_created ON orders(created_at);
```

### Audit Trail Pattern

```sql
-- Audit columns on every table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,

  -- Audit trail
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  deleted_at TIMESTAMP WITH TIME ZONE,  -- Soft delete
  deleted_by UUID REFERENCES users(id)
);

-- Trigger for automatic updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
```

### Enum Pattern (Preferred over VARCHAR)

```sql
-- Create enum type
CREATE TYPE order_status AS ENUM (
  'pending',
  'processing',
  'shipped',
  'delivered',
  'cancelled'
);

-- Use in table
CREATE TABLE orders (
  id UUID PRIMARY KEY,
  status order_status NOT NULL DEFAULT 'pending'
);

-- Benefits: type safety, storage efficiency, self-documenting
```

---

## Query Optimization Patterns

### Efficient Batch Loading

```typescript
// Load related data efficiently
async function getUsersWithOrders(userIds: string[]): Promise<UserWithOrders[]> {
  // Query 1: Get users
  const users = await db.query(
    'SELECT * FROM users WHERE id = ANY($1)',
    [userIds]
  );

  // Query 2: Get all orders for these users in one query
  const orders = await db.query(
    'SELECT * FROM orders WHERE user_id = ANY($1)',
    [userIds]
  );

  // Build lookup map
  const ordersByUser = new Map<string, Order[]>();
  for (const order of orders) {
    const existing = ordersByUser.get(order.user_id) || [];
    existing.push(order);
    ordersByUser.set(order.user_id, existing);
  }

  // Combine
  return users.map(user => ({
    ...user,
    orders: ordersByUser.get(user.id) || []
  }));
}
// Total: 2 queries regardless of user count
```

### Pagination Pattern

```typescript
// Cursor-based pagination (efficient for large datasets)
async function getOrdersPage(
  customerId: string,
  cursor?: string,
  limit: number = 20
): Promise<{ orders: Order[]; nextCursor: string | null }> {
  const query = cursor
    ? `SELECT * FROM orders
       WHERE customer_id = $1 AND created_at < $2
       ORDER BY created_at DESC
       LIMIT $3`
    : `SELECT * FROM orders
       WHERE customer_id = $1
       ORDER BY created_at DESC
       LIMIT $2`;

  const params = cursor
    ? [customerId, new Date(cursor), limit + 1]
    : [customerId, limit + 1];

  const orders = await db.query(query, params);

  const hasMore = orders.length > limit;
  if (hasMore) orders.pop();

  return {
    orders,
    nextCursor: hasMore ? orders[orders.length - 1].created_at.toISOString() : null
  };
}
```

### Index Strategy

```sql
-- Primary lookup index
CREATE INDEX idx_orders_customer ON orders(customer_id);

-- Composite index for common query pattern
-- Order matters: most selective first, or match query order
CREATE INDEX idx_orders_customer_status_date
  ON orders(customer_id, status, created_at DESC);

-- Partial index for active records only
CREATE INDEX idx_orders_pending
  ON orders(customer_id, created_at)
  WHERE status = 'pending';

-- Covering index (includes all needed columns)
CREATE INDEX idx_orders_summary
  ON orders(customer_id, status)
  INCLUDE (total, created_at);
-- Query can be satisfied entirely from index
```

---

## Migration Patterns

### Safe Column Addition

```typescript
// Migration: Add new required column safely
export async function up(db: Database): Promise<void> {
  // Step 1: Add nullable column (instant, no lock)
  await db.query(`
    ALTER TABLE users ADD COLUMN phone VARCHAR(20)
  `);

  // Step 2: Backfill in batches
  let processed = 0;
  const batchSize = 1000;

  while (true) {
    const result = await db.query(`
      UPDATE users
      SET phone = 'UNKNOWN'
      WHERE phone IS NULL
      AND id IN (
        SELECT id FROM users WHERE phone IS NULL LIMIT $1
      )
      RETURNING id
    `, [batchSize]);

    processed += result.rowCount;
    if (result.rowCount < batchSize) break;

    // Small delay to reduce load
    await sleep(100);
  }

  // Step 3: Add NOT NULL constraint
  await db.query(`
    ALTER TABLE users ALTER COLUMN phone SET NOT NULL
  `);
}

export async function down(db: Database): Promise<void> {
  await db.query(`
    ALTER TABLE users DROP COLUMN phone
  `);
}
```

### Safe Column Rename

```typescript
// Migration: Rename column without downtime
export async function up(db: Database): Promise<void> {
  // Step 1: Add new column
  await db.query(`
    ALTER TABLE users ADD COLUMN full_name VARCHAR(200)
  `);

  // Step 2: Copy data
  await db.query(`
    UPDATE users SET full_name = name WHERE full_name IS NULL
  `);

  // Step 3: Create trigger for dual-write during transition
  await db.query(`
    CREATE OR REPLACE FUNCTION sync_name_columns()
    RETURNS TRIGGER AS $$
    BEGIN
      IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        IF NEW.full_name IS NOT NULL AND NEW.name IS DISTINCT FROM NEW.full_name THEN
          NEW.name = NEW.full_name;
        ELSIF NEW.name IS NOT NULL AND NEW.full_name IS DISTINCT FROM NEW.name THEN
          NEW.full_name = NEW.name;
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER sync_names
      BEFORE INSERT OR UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION sync_name_columns();
  `);

  // Step 4: Deploy code using new column
  // Step 5: (separate migration) Drop old column and trigger
}
```

### Safe Table Restructure

```typescript
// Migration: Restructure table without downtime
export async function up(db: Database): Promise<void> {
  // Step 1: Create new table structure
  await db.query(`
    CREATE TABLE users_v2 (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      -- new structure
      profile JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  // Step 2: Create insert trigger on old table
  await db.query(`
    CREATE OR REPLACE FUNCTION sync_to_users_v2()
    RETURNS TRIGGER AS $$
    BEGIN
      INSERT INTO users_v2 (id, email, profile, created_at)
      VALUES (
        NEW.id,
        NEW.email,
        jsonb_build_object('name', NEW.name, 'phone', NEW.phone),
        NEW.created_at
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        profile = EXCLUDED.profile;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER sync_users
      AFTER INSERT OR UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION sync_to_users_v2();
  `);

  // Step 3: Backfill existing data
  await db.query(`
    INSERT INTO users_v2 (id, email, profile, created_at)
    SELECT
      id,
      email,
      jsonb_build_object('name', name, 'phone', phone),
      created_at
    FROM users
    ON CONFLICT (id) DO NOTHING
  `);

  // Step 4: Switch reads to new table (code deployment)
  // Step 5: (separate migration) Drop old table
}
```

---

## Transaction Patterns

### Proper Transaction Handling

```typescript
// Transaction with proper error handling and isolation
async function transferFunds(
  fromAccount: string,
  toAccount: string,
  amount: number
): Promise<Result<void, TransferError>> {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');

    // Lock rows in consistent order to prevent deadlocks
    const accounts = [fromAccount, toAccount].sort();

    const fromResult = await client.query(
      'SELECT balance FROM accounts WHERE id = $1 FOR UPDATE',
      [accounts[0] === fromAccount ? fromAccount : toAccount]
    );

    const toResult = await client.query(
      'SELECT balance FROM accounts WHERE id = $1 FOR UPDATE',
      [accounts[0] === fromAccount ? toAccount : fromAccount]
    );

    const fromBalance = fromResult.rows[0]?.balance;
    if (!fromBalance || fromBalance < amount) {
      await client.query('ROLLBACK');
      return { ok: false, error: { type: 'insufficient_funds' } };
    }

    await client.query(
      'UPDATE accounts SET balance = balance - $1 WHERE id = $2',
      [amount, fromAccount]
    );

    await client.query(
      'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
      [amount, toAccount]
    );

    await client.query('COMMIT');
    return { ok: true, value: undefined };

  } catch (error) {
    await client.query('ROLLBACK');
    return { ok: false, error: { type: 'transaction_failed', cause: error } };

  } finally {
    client.release();
  }
}
```
