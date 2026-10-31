# TDD Rationalization Prevention — Extended Examples

The excuses table, the mid-work red flags, a test-first example, and detailed code examples that show how each rationalization leads to worse outcomes.

## Excuses and corrections

| Excuse | Why It Feels Right | Why It's Wrong | Correct Action |
|--------|-------------------|----------------|----------------|
| "I'll write tests after" | Need to see the shape first | Tests ARE the shape — they define the interface before implementation exists | Write the test first |
| "Too simple to test" | It's just a getter/setter | Getters break, defaults change, edge cases hide in "simple" code | Write it — takes 30 seconds |
| "I'll refactor later" | Just get it working now | "Later" never comes; technical debt compounds silently | Refactor now in Step 3 |
| "Test is too hard to write" or "the test setup is too complex" | Mocking is painful | Hard-to-test code = bad design, and complex setup = too much coupling; the test is telling you the interface is wrong | Simplify the interface first |
| "Need to see the whole picture" or "the architecture first" | Can't test what I haven't designed or structured yet | TDD IS design; each test reveals the next piece of the interface, and tests DEFINE the architecture | Let the tests drive the design and structure |
| "Tests slow me down" | Faster to just write the code | Faster until the first regression; TDD is faster for anything > 50 lines | Trust the cycle |
| "Framework is hard to set up" | Setup is complex | One-time cost vs recurring regression cost; untested code compounds debt | Set up the framework first — that IS the work |
| "This is infrastructure, not logic" | Plumbing doesn't need tests | Infrastructure carries data; broken plumbing floods everything downstream | Test the contract, not the internals |
| "Deadline is tight, no time for tests" | Ship now, test later | Untested code ships bugs; fixing bugs under deadline is slower than TDD | TDD is faster under pressure, not slower |

## Red flags mid-work

| Thought | Correction |
|---------|------------|
| "Let me write the implementation first, tests after" | Delete the code. Write the test. Watch it fail. Then rewrite. |
| "I'll just spike this and add tests later" | Unless the user said "spike" — you're rationalizing, not prototyping. |
| "Let me get it working, then lock it with tests" | Those tests verify your implementation, not the requirement. Backwards. |
| "I know this works, I've written it before" | Past code passed past tests. This code needs its own failing test. |
| "One more function, then I'll write the test" | STOP. Write the test for what you have now. Increments, not batches. |

## Test-first vs code-first

**Code-first** (wrong): write `parseConfig()`, then a test that mirrors it (`parseConfig("key=val")` passes). Empty input, malformed lines, multi-value keys and whitespace stay hidden until production.

**Test-first** (correct): "ignores comment lines", then "handles empty input", then "rejects malformed lines", each failing first and each driving the next slice of `parseConfig()`, so it handles the edges from the start.

Code-first tests verify what you *happened to build*. Test-first tests specify what *should exist*.

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
