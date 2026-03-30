# Code Smell Violations Reference

Extended examples of fake solutions, unlabeled workarounds, deceptive code, and magic values. Absorbed from the former `code-smell` skill into `core-patterns`.

---

## 1. Hardcoded Data (FAKE SOLUTIONS)

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

**Problem**: Returns static data instead of fetching from actual service.

### Correct: Honest implementation with Result type

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

## 2. Missing Labels (UNDOCUMENTED WORKAROUNDS)

### Violation: Temporary fix without documentation

```typescript
async function syncData() {
  await sleep(1000); // Wait for previous operation
  await performSync();
}
```

### Correct: Clearly labeled workaround

```typescript
function processPayment(amount: number): boolean {
  // TEMPORARY: Validation disabled until payment gateway integration complete
  // TODO: Add amount validation, currency checks, fraud detection
  // Target: Sprint 23 (2025-11-15)
  // Ticket: PAY-456
  return true;
}
```

### Correct: Documented hack with rationale

```typescript
async function syncData() {
  // HACK: Sleep required due to race condition in legacy sync system
  // Root cause: Event system doesn't guarantee order
  // Proper fix: Implement event sequencing (3-week effort)
  await sleep(1000);
  await performSync();
}
```

---

## 3. Fake Functionality (DECEPTIVE CODE)

### Violation: Fake error handling

```typescript
async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  try {
    // TODO: Implement SMTP
    console.log(`Email sent to ${to}`);
  } catch (error) {
    // Ignore errors
  }
}
```

### Correct: Honest unimplemented function

```typescript
function validateEmail(email: string): Result<boolean, Error> {
  return {
    ok: false,
    error: new Error('NOT-IMPLEMENTED: Email validation pending regex pattern approval')
  };
}
```

---

## 4. Magic Values (UNEXPLAINED CONSTANTS)

### Violation: Magic numbers

```typescript
function calculateDiscount(price: number, userLevel: number): number {
  if (userLevel >= 5) return price * 0.15;
  return 0;
}
```

### Correct: Named constants with documentation

```typescript
const USER_LEVEL_THRESHOLD = { PREMIUM: 5 } as const;
const DISCOUNT_RATE = { PREMIUM: 0.15 } as const;

function calculateDiscount(price: number, userLevel: number): number {
  if (userLevel >= USER_LEVEL_THRESHOLD.PREMIUM) return price * DISCOUNT_RATE.PREMIUM;
  return 0;
}
```

---

## Detection Quick Reference

Code passes smell check when:
- No hardcoded return data in business logic
- All workarounds have required labels (HACK:, MOCK:, TODO:, TEMPORARY:, NOT-PRODUCTION:, ARCHITECTURE EXCEPTION:)
- All fake/mock code clearly marked
- Magic values extracted to named constants
- Functions do what their names promise
