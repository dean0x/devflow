# Self-Review Report Template

Use this template when generating your self-review report.

---

## Report Format

```markdown
## Self-Review Report

### Task
{Brief description of what was implemented}

### Files Changed
- `path/to/file.ts` - {what changed}
- `path/to/test.ts` - {what changed}

---

### P0 Pillars (MUST Fix)

| Pillar | Status | Notes |
|--------|--------|-------|
| Design | PASS/FIXED | {details if fixed} |
| Functionality | PASS/FIXED | {details if fixed} |
| Security | PASS/FIXED | {details if fixed} |

**Fixes Applied**:
- {file:line} - {what was fixed}

---

### P1 Pillars (SHOULD Fix)

| Pillar | Status | Notes |
|--------|--------|-------|
| Complexity | PASS/FIXED | {details if fixed} |
| Error Handling | PASS/FIXED | {details if fixed} |
| Tests | PASS/FIXED | {details if fixed} |

**Fixes Applied**:
- {file:line} - {what was fixed}

---

### P2 Pillars (FIX if Time Permits)

| Pillar | Status | Notes |
|--------|--------|-------|
| Naming | PASS/FIXED/SKIP | {details} |
| Consistency | PASS/FIXED/SKIP | {details} |
| Documentation | PASS/FIXED/SKIP | {details} |

**Fixes Applied** (if any):
- {file:line} - {what was fixed}

---

### Summary

**Issues Found**: {total count}
**Issues Fixed**: {count}
**Status**: READY / BLOCKED

{If BLOCKED, explain what cannot be fixed and why}
```

---

## Example Reports

### Example 1: Clean Pass

```markdown
## Self-Review Report

### Task
Add user profile update endpoint

### Files Changed
- `src/routes/users.ts` - added PUT /users/:id/profile endpoint
- `src/services/user-service.ts` - added updateProfile method
- `tests/services/user-service.test.ts` - added profile update tests

---

### P0 Pillars (MUST Fix)

| Pillar | Status | Notes |
|--------|--------|-------|
| Design | PASS | Follows existing route/service pattern |
| Functionality | PASS | All edge cases handled |
| Security | PASS | Auth middleware in place, input validated |

---

### P1 Pillars (SHOULD Fix)

| Pillar | Status | Notes |
|--------|--------|-------|
| Complexity | PASS | Functions under 30 lines |
| Error Handling | PASS | Uses Result types consistently |
| Tests | PASS | Happy path, errors, and edges covered |

---

### P2 Pillars (FIX if Time Permits)

| Pillar | Status | Notes |
|--------|--------|-------|
| Naming | PASS | Clear, descriptive names |
| Consistency | PASS | Matches existing patterns |
| Documentation | PASS | JSDoc on public methods |

---

### Summary

**Issues Found**: 0
**Issues Fixed**: 0
**Status**: READY
```

### Example 2: Issues Fixed

```markdown
## Self-Review Report

### Task
Implement order cancellation flow

### Files Changed
- `src/services/order-service.ts` - added cancelOrder method
- `src/routes/orders.ts` - added DELETE /orders/:id endpoint
- `tests/services/order-service.test.ts` - added cancellation tests

---

### P0 Pillars (MUST Fix)

| Pillar | Status | Notes |
|--------|--------|-------|
| Design | PASS | Follows existing patterns |
| Functionality | FIXED | Added missing status check before cancel |
| Security | FIXED | Added ownership verification |

**Fixes Applied**:
- `src/services/order-service.ts:45` - Added check: cannot cancel completed orders
- `src/routes/orders.ts:78` - Added auth check: user must own the order

---

### P1 Pillars (SHOULD Fix)

| Pillar | Status | Notes |
|--------|--------|-------|
| Complexity | PASS | Clean, simple logic |
| Error Handling | FIXED | Changed generic error to specific CancellationError |
| Tests | FIXED | Added test for already-completed order case |

**Fixes Applied**:
- `src/services/order-service.ts:52` - Specific error: `OrderCancellationError('Order already completed')`
- `tests/services/order-service.test.ts:120` - Added: `it('rejects cancellation of completed orders')`

---

### P2 Pillars (FIX if Time Permits)

| Pillar | Status | Notes |
|--------|--------|-------|
| Naming | PASS | Clear names |
| Consistency | PASS | Matches existing order methods |
| Documentation | FIXED | Added JSDoc explaining cancellation rules |

**Fixes Applied**:
- `src/services/order-service.ts:40` - Added JSDoc documenting cancellation states

---

### Summary

**Issues Found**: 5
**Issues Fixed**: 5
**Status**: READY
```

### Example 3: Blocked

```markdown
## Self-Review Report

### Task
Add payment refund capability

### Files Changed
- `src/services/payment-service.ts` - added refund method
- `src/routes/payments.ts` - added POST /payments/:id/refund

---

### P0 Pillars (MUST Fix)

| Pillar | Status | Notes |
|--------|--------|-------|
| Design | BLOCKED | Requires architectural change (see below) |
| Functionality | - | Cannot evaluate due to design blocker |
| Security | - | Cannot evaluate due to design blocker |

---

### Summary

**Issues Found**: 1 (architectural)
**Issues Fixed**: 0
**Status**: BLOCKED

**Blocker**: Payment refunds require access to transaction history, but current
PaymentService has no dependency on TransactionRepository. Adding this dependency
would require:
1. Modifying PaymentService constructor (breaking change)
2. Updating all 15 existing tests
3. Modifying dependency injection container

This is beyond the scope of self-review fixes. Escalating to orchestrator for
architectural decision.

**Recommendation**: Refactor PaymentService to accept TransactionRepository
before implementing refund feature.
```

---

## Status Definitions

| Status | Meaning |
|--------|---------|
| PASS | No issues found for this pillar |
| FIXED | Issue found and resolved |
| SKIP | P2 only - issue noted but not fixed due to time |
| BLOCKED | Cannot fix - requires escalation |

---

## Report Checklist

Before submitting report:
- [ ] All P0 pillars are PASS or FIXED
- [ ] All P1 pillars are PASS or FIXED
- [ ] P2 pillars evaluated (PASS/FIXED/SKIP)
- [ ] All fixes documented with file:line
- [ ] Summary accurately reflects status
- [ ] If BLOCKED, clear explanation provided
