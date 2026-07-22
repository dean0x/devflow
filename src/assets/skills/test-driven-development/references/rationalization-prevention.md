# TDD Rationalization Prevention — Extended Examples

Detailed code examples showing how each rationalization leads to worse outcomes.

## "I'll write tests after"

### What happens:

```typescript
// Developer writes production code first
function calculateDiscount(price: number, tier: string): number {
  if (tier === 'gold') return price * 0.8;
  if (tier === 'silver') return price * 0.9;
  return price;
}

// Then "writes tests after" — but only for the happy path they remember
test('gold tier gets 20% off', () => {
  expect(calculateDiscount(100, 'gold')).toBe(80);
});
// Missing: negative prices, unknown tiers, zero prices, NaN handling
```

### What TDD would have caught:

```typescript
// Test first — forces you to think about the contract
test('returns error for negative price', () => {
  expect(calculateDiscount(-100, 'gold')).toEqual({ ok: false, error: 'NEGATIVE_PRICE' });
});
// Now the interface includes error handling from the start
```

## "Too simple to test"

### What happens:

```typescript
// "It's just a config getter, no test needed"
function getMaxRetries(): number {
  return parseInt(process.env.MAX_RETRIES || '3');
}
// 6 months later: someone sets MAX_RETRIES="three" and prod crashes with NaN retries
```

### What TDD would have caught:

```typescript
test('returns default when env var is not a number', () => {
  process.env.MAX_RETRIES = 'three';
  expect(getMaxRetries()).toBe(3); // Forces validation logic
});
```

## "Test is too hard to write"

### What happens:

```typescript
// "I can't test this easily because it needs database + email + filesystem"
async function processOrder(orderId: string) {
  const db = new Database();
  const order = await db.find(orderId);
  await sendEmail(order.customerEmail, 'Your order is processing');
  await fs.writeFile(`/invoices/${orderId}.pdf`, generateInvoice(order));
  await db.update(orderId, { status: 'processing' });
}
// Result: untestable monolith, test would need real DB + email + filesystem
```

### What TDD forces:

```typescript
// Hard-to-test = bad design. TDD forces dependency injection:
async function processOrder(
  orderId: string,
  deps: { db: OrderRepository; emailer: Emailer; invoices: InvoiceStore }
): Promise<Result<void, OrderError>> {
  // Now trivially testable with mocks
}
```

## "I'll refactor later"

### What happens:

```typescript
// Sprint 1: "just get it working"
function handleRequest(req: any) {
  if (req.type === 'create') { /* 50 lines */ }
  else if (req.type === 'update') { /* 50 lines */ }
  else if (req.type === 'delete') { /* 30 lines */ }
  // Sprint 2-10: more conditions added, function grows to 500 lines
  // "Refactor later" never comes because nobody wants to touch it
}
```

### What TDD enforces:

Step 3 (REFACTOR) happens every cycle. The function never grows beyond what's clean because you clean it every 5-10 minutes.

## "Tests slow me down"

### The math:

| Approach | Time to write | Time to first bug | Time to fix bug | Total (1 month) |
|----------|:---:|:---:|:---:|:---:|
| No TDD | 2h | 4h | 3h (no repro test) | 9h+ |
| TDD | 3h | Caught in test | 15min (test pinpoints) | 3h 15min |

TDD is slower for the first 30 minutes. It's faster for everything after that.
