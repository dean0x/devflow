# Test Quality Report Template

Use this template when reporting test design issues.

---

## Report Format

```markdown
## Test Design Issues Detected

## [SEVERITY] - [Category] ([Root Cause Type])
**File**: path/to/file.test.ts:line-range
**Issue**: Brief description of the problem
**Root Cause**: What architectural issue causes this
**Symptom**:
```code
// The problematic code snippet
```
**Correct Design**:
```code
// What good design looks like
```
**Action Required**: Specific action to fix

## Summary
- **Critical**: N issues (block implementation)
- **High**: N issues (refactor needed)
- **Files affected**: N test files
- **Root cause**: Brief architectural diagnosis

## STOP - Design Issues Detected

[List fundamental design flaws discovered]

**DO NOT work around these issues in tests.**
**DO NOT add more complex test helpers.**
**DO NOT mock more things to make tests pass.**

## Next Steps

1. **STOP writing tests** - Current design cannot be tested simply
2. **ANALYZE root cause** - Identify architectural issue
3. **PROPOSE redesign** - Show correct pattern
4. **GET APPROVAL** - User confirms design changes
5. **IMPLEMENT redesign** - Fix architecture first
6. **WRITE SIMPLE TESTS** - Tests should be trivial after redesign
```

---

## Severity Levels

| Severity | Use For | Examples |
|----------|---------|---------|
| **CRITICAL** | Fundamental design flaws | Complex setup >10 lines, repetitive boilerplate >3 times, mock objects >5 methods, testing private methods |
| **HIGH** | Maintenance complications | Difficult mocking >20 lines, implementation testing, environment manipulation, database seeding |
| **MEDIUM** | Reduced clarity | Test helper abuse, inconsistent assertion patterns, missing edge case coverage |
| **LOW** | Minor improvements | Organization, naming clarity |

---

## Category Labels

| Category | Root Cause Type | Indicates |
|----------|-----------------|-----------|
| Complex Setup | Design Problem | Too many dependencies |
| Repetitive Boilerplate | API Problem | Inconsistent error handling |
| Difficult Mocking | Coupling Problem | Tight coupling to externals |
| Implementation Testing | Fragile Tests | Tests coupled to internals |
| Environment Manipulation | DI Problem | Direct environment access |
| Database Seeding | Separation Problem | Logic mixed with data access |

---

## Test Suite Safety Configuration

### Full Configuration Examples

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    fileParallelism: false,
    maxWorkers: 1,
    pool: 'forks',
    testTimeout: 10000,
  }
});

// jest.config.js
module.exports = {
  maxWorkers: 1,
  runInBand: true,
  testTimeout: 10000,
};
```

```bash
# Memory limits
NODE_OPTIONS="--max-old-space-size=512" npm test

# Go
go test -p 1 ./...

# Rust
cargo test -- --test-threads=1
```
