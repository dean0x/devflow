# Code Smell Report Template

Full report format for documenting detected code smells.

---

## Report Structure

```markdown
CODE SMELLS DETECTED

## CRITICAL - Fake Solution
**File**: src/services/user.ts:45
**Issue**: Hardcoded user data pretending to fetch from API
**Evidence**:
```typescript
async function getUserProfile(userId: string) {
  return { id: userId, name: "John Doe", email: "john@example.com" };
}
```
**Problem**: This code pretends to work but returns fake data
**Impact**: Will fail in production, misleads other developers
**Action**: Either implement real API call or label as MOCK

## CRITICAL - Unlabeled Workaround
**File**: src/utils/sync.ts:23
**Issue**: Sleep statement without explanation
**Evidence**:
```typescript
await sleep(1000);
await performSync();
```
**Problem**: Workaround without documentation of why it's needed
**Required**: Add HACK: label explaining race condition
**Action**: Document the workaround or fix the root cause

## CRITICAL - Deceptive Validation
**File**: src/validation/email.ts:12
**Issue**: Validation function that doesn't validate
**Evidence**:
```typescript
function validateEmail(email: string): boolean {
  return true; // Accept anything for now
}
```
**Problem**: Function name promises validation but does nothing
**Impact**: Security risk, data quality issues
**Action**: Implement validation or return NotImplementedError

## HIGH - Magic Values
**File**: src/billing/discount.ts:34
**Issue**: Unexplained discount percentages
**Evidence**:
```typescript
if (userLevel >= 5) return price * 0.15;
```
**Problem**: Magic numbers without explanation
**Action**: Extract to named constants with documentation

## Summary
- **Critical**: 8 fake solutions detected
- **Critical**: 5 unlabeled workarounds
- **High**: 12 magic values
- **Files affected**: 9

## HONESTY CHECK FAILED

This code violates the "NO FAKE SOLUTIONS" principle:
- Functions pretend to work but return hardcoded data
- Workarounds exist without clear documentation
- Magic values indicate rushed implementation

## Required Actions

1. **Label all workarounds** - Add HACK:/TEMPORARY:/MOCK: labels
2. **Remove fake solutions** - Implement real functionality or mark as NOT-PRODUCTION
3. **Document magic values** - Extract to named constants
4. **Be transparent** - If something doesn't work, say so clearly

## Example Fix

Before:
```typescript
async function getRecommendations(userId: string) {
  return [{ id: "1", name: "Product 1" }];
}
```

After (honest):
```typescript
// MOCK: Recommendations service not yet implemented
// TODO: Integrate with ML recommendation engine (ticket: REC-123)
// Target: Sprint 25
// NOT-PRODUCTION: This will fail in production
async function getRecommendationsMock(userId: string): Promise<Product[]> {
  return [
    { id: "1", name: "Mock Product 1", price: 99.99 }
  ];
}

// Proper implementation
async function getRecommendations(userId: string): Promise<Result<Product[], Error>> {
  return {
    ok: false,
    error: new Error('NOT-IMPLEMENTED: Awaiting ML service deployment')
  };
}
```
```

---

## Integration with Quality Gates

This skill prevents:
- Merging fake functionality to main branch
- Deploying unlabeled workarounds to production
- Shipping code that pretends to work
- Accumulating technical debt without documentation

---

## Red Flags - Immediate Stop

Stop immediately if you detect:
- Multiple fake solutions in same PR
- Production code with MOCK: labels
- Security-critical functions returning true without logic
- Database operations with hardcoded responses
- API clients returning static data

---

## Philosophy Enforcement

This skill enforces the core principle:

**"NO FAKE SOLUTIONS - Never hardcode responses or data to simulate working functionality"**

Code must either:
1. Work correctly (real implementation)
2. Fail honestly (return error explaining what's missing)
3. Be clearly labeled (MOCK:, TEMPORARY:, NOT-PRODUCTION:)

No middle ground. No deception.
