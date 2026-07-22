# Code Smell Violations Reference

Extended examples of fake solutions, unlabeled workarounds, deceptive code, and magic values.
All examples cite `references/sources.md`.

---

## 1. Hardcoded Data (FAKE SOLUTIONS) [10]

"Clean Code" [10] identifies this as a fundamental form of deception. Martin's maxim
"don't lie to your colleagues" applies equally to code that pretends to be real.

### Violation: Mock data masquerading as real functionality

```typescript
async function fetchRecommendations(userId: string): Promise<Product[]> {
  // TODO: Connect to recommendation engine
  return [
    { id: "1", name: "Product 1", price: 99.99 },
    { id: "2", name: "Product 2", price: 149.99 }
  ];
}
```

**Problem**: Returns static data instead of fetching from actual service. Caller has no idea
this is a fake [10].

### Correct: Honest implementation with Result type [1]

```typescript
async function getUserProfile(userId: string): Promise<Result<UserProfile, Error>> {
  try {
    const response = await api.get(`/users/${userId}`);
    return { ok: true, value: response.data };
  } catch (error) {
    return { ok: false, error };
  }
}
```

### Correct: Clearly labeled mock for testing

```typescript
// MOCK: For development only, not production-ready
async function getUserProfileMock(userId: string): Promise<UserProfile> {
  return { id: userId, name: "Test User", email: "test@example.com" };
}
```

---

## 2. Missing Labels (UNDOCUMENTED WORKAROUNDS) [13]

Hickey's "Simple Made Easy" [13] defines complecting as interleaving concerns.
Undocumented workarounds complect the accidental with the essential.

### Violation: Temporary fix without documentation

```typescript
async function syncData() {
  await sleep(1000); // Wait for previous operation
  await performSync();
}
```

### Correct: Clearly labeled workaround with rationale

```typescript
function processPayment(amount: number): boolean {
  // TEMPORARY: Validation disabled until payment gateway integration complete
  // TODO: Add amount validation, currency checks, fraud detection
  // Target: Sprint 23 (2025-11-15)
  // Ticket: PAY-456
  return true;
}
```

### Correct: Documented hack with root cause

```typescript
async function syncData() {
  // HACK: Sleep required due to race condition in legacy sync system
  // Root cause: Event system doesn't guarantee order
  // Proper fix: Implement event sequencing (3-week effort)
  // Ticket: SYNC-789
  await sleep(1000);
  await performSync();
}
```

---

## 3. Fake Functionality (DECEPTIVE CODE) [10]

"Clean Code" Ch.7 [10] specifically warns against functions that pretend to work.
Result types [1] give us an honest way to say "not implemented yet."

### Violation: Fake error handling with swallowed exception

```typescript
async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  try {
    // TODO: Implement SMTP
    console.log(`Email sent to ${to}`);
  } catch (error) {
    // Ignore errors — caller thinks this worked [10]
  }
}
```

### Correct: Honest unimplemented function [1]

```typescript
function validateEmail(email: string): Result<boolean, Error> {
  return {
    ok: false,
    error: new Error('NOT-IMPLEMENTED: Email validation pending regex pattern approval')
  };
}
```

---

## 4. Magic Values (UNEXPLAINED CONSTANTS) [9]

Bloch's "Effective Java" Item 72 [9] identifies unexplained constants as a readability
and maintenance hazard. Named constants make the domain model explicit [2].

### Violation: Magic numbers

```typescript
function calculateDiscount(price: number, userLevel: number): number {
  if (userLevel >= 5) return price * 0.15;  // What is 5? What is 0.15? [9]
  return 0;
}
```

### Correct: Named constants with documentation [2][9]

```typescript
// Domain constants named for their business meaning [2]
const USER_LEVEL_THRESHOLD = { PREMIUM: 5 } as const;
const DISCOUNT_RATE = { PREMIUM: 0.15 } as const;

function calculateDiscount(price: number, userLevel: number): number {
  if (userLevel >= USER_LEVEL_THRESHOLD.PREMIUM) return price * DISCOUNT_RATE.PREMIUM;
  return 0;
}
```

---

## 5. Type Escape Hatches (BYPASSING THE TYPE SYSTEM) [4][22]

Minsky's "Making Illegal States Unrepresentable" [4] and TypeScript strict mode [22]
are both undermined by unchecked type assertions.

### Violation: as-casting without validation

```typescript
// VIOLATION: Bypasses all type safety [4][22]
const user = response.data as User;  // No runtime check
const name = user!.profile!.name!;   // Assumes structure that may not exist [22]
```

### Correct: Schema validation at boundary [12]

```typescript
// Parse, don't validate [12] — schema enforces the shape at the boundary
const userResult = UserSchema.safeParse(response.data);
if (!userResult.success) {
  return Err({ type: 'InvalidResponse', details: userResult.error });
}
const user = userResult.data;  // Typed and verified [12]
```

---

## Detection Quick Reference

Code passes smell check when:

- No hardcoded return data in business logic [10]
- All workarounds have required labels (`HACK:` `MOCK:` `TODO:` `TEMPORARY:` `NOT-PRODUCTION:` `ARCHITECTURE EXCEPTION:`) [13]
- All fake/mock code clearly marked [10]
- Magic values extracted to named constants [9]
- Functions do what their names promise [10]
- No unchecked type assertions [4][22]
- No swallowed exceptions [1][10]
