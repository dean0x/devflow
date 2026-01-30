---
name: code-smell
description: Detects fake solutions and workarounds. Use when user asks to "implement", "add feature", or code uses TODO, HACK, mock data outside tests.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Code Smell Skill

## Iron Law

> **NO FAKE SOLUTIONS**
>
> Never hardcode data to simulate working functionality. If it doesn't work, it MUST
> either: (1) fail honestly with an error, or (2) be clearly labeled as MOCK/TEMPORARY.
> Pretending to work is deception. Deception compounds into production failures.

## Purpose

Detect and prevent anti-patterns that indicate fake solutions or workarounds:
1. **Hardcoded data** - Simulating functionality instead of implementing
2. **Missing labels** - Workarounds without clear documentation
3. **Fake solutions** - Code that pretends to work but doesn't
4. **Magic values** - Unexplained constants and configuration

## When This Skill Activates

Automatically triggers when:
- New functionality is being implemented
- Code changes are being made
- Mock data or test fixtures appear outside tests
- Comments suggesting temporary solutions
- Configuration or constants are added

---

## Critical Anti-Patterns

### 1. Hardcoded Data Detection (FAKE SOLUTIONS)

**CRITICAL**: Never hardcode responses to simulate working functionality.

```typescript
// BAD: Fake solution pretending to work
async function getUserProfile(userId: string): Promise<UserProfile> {
  return { id: userId, name: "John Doe", email: "john@example.com" };
}

// GOOD: Honest implementation with Result type
async function getUserProfile(userId: string): Promise<Result<UserProfile, Error>> {
  const response = await api.get(`/users/${userId}`);
  return response.ok ? { ok: true, value: response.data } : { ok: false, error: response.error };
}
```

**Detection**: Hardcoded returns, static arrays from "fetch" functions, functions with only returns, "TODO: implement" with fake data.

### 2. Missing Label Detection (UNDOCUMENTED WORKAROUNDS)

**CRITICAL**: All workarounds, hacks, and temporary solutions MUST be labeled.

```typescript
// BAD: Workaround without label
function processPayment(amount: number): boolean {
  return true; // Skip validation for now
}

// GOOD: Clearly labeled workaround
function processPayment(amount: number): boolean {
  // TEMPORARY: Validation disabled until payment gateway integration complete
  // TODO: Add amount validation, currency checks, fraud detection
  // Target: Sprint 23 (2025-11-15)
  // Ticket: PAY-456
  return true;
}
```

**Required labels:**
- `HACK:` - Workaround for specific problem
- `MOCK:` - Fake data for testing/development
- `TODO:` - Work that needs to be done
- `TEMPORARY:` - Short-term solution with deadline
- `NOT-PRODUCTION:` - Code that should never ship
- `ARCHITECTURE EXCEPTION:` - Violates pattern with justification

**Detection**: Unlabeled comments, empty catch blocks, early returns without rationale.

### 3. Fake Functionality Detection (DECEPTIVE CODE)

**CRITICAL**: Code must actually work or be clearly marked as non-functional.

```typescript
// BAD: Pretending to validate but doing nothing
function validateEmail(email: string): boolean {
  return true; // Just accept anything for now
}

// GOOD: Honest unimplemented function
function validateEmail(email: string): Result<boolean, Error> {
  return { ok: false, error: new Error('NOT-IMPLEMENTED: Email validation pending') };
}
```

**Detection**: Functions returning `true` with no logic, empty try/catch, console.log as functionality, setTimeout simulating async.

### 4. Magic Value Detection (UNEXPLAINED CONSTANTS)

**CRITICAL**: All magic values must be explained with constants or comments.

```typescript
// BAD: Magic numbers
function calculateDiscount(price: number, userLevel: number): number {
  if (userLevel >= 5) return price * 0.15;
  return 0;
}

// GOOD: Named constants with documentation
const USER_LEVEL_THRESHOLD = { PREMIUM: 5 } as const;
const DISCOUNT_RATE = { PREMIUM: 0.15 } as const;

function calculateDiscount(price: number, userLevel: number): number {
  if (userLevel >= USER_LEVEL_THRESHOLD.PREMIUM) return price * DISCOUNT_RATE.PREMIUM;
  return 0;
}
```

**Detection**: Numeric literals in business logic (except 0, 1, -1), string literals in conditionals, unexplained timeouts, unlabeled ratios.

---

## Extended References

For extended examples and templates:
- [Extended violation examples](references/violations.md) - Full code examples for each category
- [Report template](references/report-template.md) - Full report format, quality gates, philosophy

---

## Success Criteria

Code passes smell check when:
- [ ] No hardcoded return data in business logic
- [ ] All workarounds have required labels
- [ ] All fake/mock code clearly marked
- [ ] Magic values extracted to named constants
- [ ] Comments include rationale and timeline
- [ ] Functions do what their names promise
