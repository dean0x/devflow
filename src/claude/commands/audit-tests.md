---
allowed-tools: Bash, Read, Grep, Glob, MultiEdit, TodoWrite, Task
description: Audit test files for quality, best practices, and proper test coverage
---

## Your task

Perform a comprehensive audit of test files in the codebase to ensure they follow testing best practices and meet the quality standards defined in `tests/TEST_STANDARDS.md`. You are a STRICT, UNCOMPROMISING critic - be harsh but constructive.

**Quality Target**: 85/100 (MANDATORY)

### Step 1: Discover Test Files and Infrastructure
- Find all test files in the project (*.test.*, *.spec.*, __tests__/, test/, tests/, etc.)
- Identify the testing framework(s) being used
- Check for existence of required infrastructure:
  - `tests/fixtures/factories.ts` - Test data factories
  - `tests/fixtures/test-doubles.ts` - Test double implementations
  - `tests/constants.ts` - Centralized constants
  - `tests/TEST_STANDARDS.md` - Quality standards documentation

### Step 2: Analyze Each Test File for Critical Issues

**❌ CRITICAL VIOLATIONS - Tests that are worthless:**
1. **Fake Tests**: Tests that don't actually test anything
   - Empty test bodies
   - Tests with only comments
   - Tests that only call console.log
   - Tests with expect(true).toBe(true)

2. **Tautological Tests**: Tests that can never fail
   - Testing mock return values directly
   - Testing hardcoded values
   - Tests where assertion equals the implementation

3. **Implementation Testing**: Testing HOW instead of WHAT
   - Testing private methods directly
   - Testing internal state
   - Asserting on implementation details

4. **No Assertions**: Tests without any expect/assert statements

5. **Infrastructure Violations**: Not using required test infrastructure
   - Creating inline test objects instead of using factories
   - Using vi.fn() mocks instead of test doubles
   - Using magic numbers instead of constants
   - Console.log/error spying instead of TestLogger

### Step 3: Check for Best Practices

**✅ QUALITY INDICATORS - Good tests have:**
1. **Descriptive Names**: Test names clearly state what is being tested
2. **AAA Pattern**: Arrange-Act-Assert structure
3. **Single Responsibility**: One test = one behavior
4. **Independent Tests**: No shared state or order dependencies
5. **Edge Cases**: Testing boundaries, nulls, errors
6. **Meaningful Assertions**: Testing actual behavior, not mocks
7. **3-5 Assertions**: Comprehensive validation (MANDATORY)
8. **Test Infrastructure**: Using factories, test doubles, constants
9. **Error Cases**: Every component has error handling tests

**⚠️ WARNING SIGNS - Poor quality tests:**
1. **Excessive Mocking**: Over-mocking indicates poor design
2. **Complex Setup**: Needing lots of setup suggests bad architecture
3. **Brittle Tests**: Tests that break with minor refactoring
4. **Missing Error Cases**: No testing of failure scenarios
5. **Poor Coverage**: Missing critical paths
6. **Snapshot Overuse**: Using snapshots for everything
7. **Time Dependencies**: Tests using real timers/dates
8. **Random Data**: Non-deterministic test data

### Step 4: Specific Anti-patterns to Flag

1. **Test Code Duplication**: Same test logic copy-pasted
2. **Magic Numbers**: Unexplained values in tests (CHECK: should use constants.ts)
3. **Global State Mutation**: Tests modifying shared state
4. **Ignored/Skipped Tests**: Tests marked as .skip() or .only()
5. **Console Pollution**: Tests with console.log statements
6. **Missing Cleanup**: No teardown/cleanup code
7. **Hardcoded Paths**: Absolute file paths in tests
8. **Network Calls**: Tests making real HTTP requests
9. **Database Access**: Tests using real database
10. **Sleep/Delays**: Using setTimeout or sleep in tests
11. **Inline Test Objects**: Not using test factories
12. **vi.fn() Mocks**: Not using test doubles
13. **Console Spying**: Using vi.spyOn(console, ...) instead of TestLogger
14. **Insufficient Assertions**: Less than 3 assertions per test
15. **Missing Error Tests**: No error scenarios tested

### Step 5: Calculate Quality Score and Generate Report

#### Quality Score Calculation (0-100):
```
Base Score: 100
- Fake/Empty Tests: -5 points each
- Tautological Tests: -5 points each
- Implementation Testing: -3 points each
- Not Using Factories: -2 points each
- Not Using Test Doubles: -2 points each
- Magic Numbers: -1 point each (max -10)
- Console Spying: -3 points each
- Less than 3 assertions: -1 point each (max -10)
- No Error Tests: -5 points per component
- Excessive Mocking (>30% of tests): -10 points

Minimum score: 0
Target score: 85
```

Create a detailed audit report at `.docs/test-audits/audit-{timestamp}.md` with:

1. **Executive Summary**
   - Total tests found
   - Critical violations count
   - Quality score (0-100) with breakdown
   - Pass/Fail (PASS requires ≥85)
   - Immediate action items

2. **Critical Violations** (MUST FIX)
   - File path and line numbers
   - Specific violation
   - Example of the bad test
   - Suggested fix

3. **Best Practice Violations** (SHOULD FIX)
   - Categorized by severity
   - Specific examples
   - Improvement suggestions

4. **Quality Metrics**
   - Tests per file average
   - Assertion density (target: 3-5 per test)
   - Mock usage ratio (target: <30%)
   - Test infrastructure usage (% using factories/doubles/constants)
   - Error test coverage (% of components with error tests)
   - Test complexity score

5. **Actionable Recommendations**
   - Priority ordered fixes
   - Refactoring suggestions
   - Architecture improvements

### Step 6: Check Compliance with TEST_STANDARDS.md

Verify tests follow the standards in `tests/TEST_STANDARDS.md`:
1. Check for test factory usage
2. Verify test double usage instead of mocks
3. Confirm constants usage (no magic numbers)
4. Validate assertion density (3-5 per test)
5. Ensure error cases exist
6. Check for behavioral testing (not implementation)

### Step 7: Fix Critical Issues (if requested)

If user agrees, automatically fix the most critical issues:
1. Remove fake tests
2. Replace inline objects with factory calls
3. Replace vi.fn() with test doubles
4. Replace magic numbers with constants
5. Add missing assertions to reach 3 minimum
6. Remove console.logs and console spying
7. Add error test cases

### Output Format

Be BRUTALLY HONEST. Use clear indicators:
- ❌ **CRITICAL**: Must fix immediately
- ⚠️ **WARNING**: Should fix soon
- ℹ️ **INFO**: Consider improving
- ✅ **GOOD**: Following best practices

### Example Output Structure

```markdown
## Test Audit Results - FAILED ❌

**Quality Score: 42/100** - UNACCEPTABLE
**Target Score: 85/100** - Required for PASS
**Infrastructure Compliance: 15%** - NOT USING TEST INFRASTRUCTURE

### Critical Violations Found: 8

❌ **FAKE TEST** - /src/user.test.js:42
```javascript
test('should create user', () => {
  // TODO: implement this test
});
```
This test does NOTHING. Delete it or implement it properly.

❌ **TAUTOLOGICAL TEST** - /src/calc.test.js:15
```javascript
test('adds numbers', () => {
  const mockAdd = jest.fn().mockReturnValue(5);
  expect(mockAdd(2, 3)).toBe(5);
});
```
You're testing your mock, not your code. This test is worthless.

❌ **NOT USING TEST INFRASTRUCTURE** - /src/service.test.js:20
```javascript
// BAD - Creating inline object
const task = { id: 'task-123', status: 'pending' };

// GOOD - Should use factory
const task = new TaskFactory().withId('task-123').build();
```

❌ **INSUFFICIENT ASSERTIONS** - /src/api.test.js:30
```javascript
test('creates resource', () => {
  const result = api.create(data);
  expect(result.ok).toBe(true); // Only 1 assertion!
});
```
Need 3-5 assertions. Add: status check, data validation, event emission.

⚠️ **EXCESSIVE MOCKING** - /src/service.test.js
- 15 mocks for a 20-line function
- Indicates poor design - consider dependency injection

### Required Actions:
1. DELETE all 8 fake tests immediately
2. REWRITE tautological tests to test actual behavior
3. REFACTOR to use test infrastructure:
   - Use TaskFactory from tests/fixtures/factories.ts
   - Use TestEventBus from tests/fixtures/test-doubles.ts
   - Use constants from tests/constants.ts
4. ADD 3-5 assertions per test
5. ADD error test cases for all components
6. REMOVE console spying - use TestLogger

### To Pass Audit (≥85/100):
- Fix all critical violations
- Use test infrastructure in >80% of tests
- Achieve 3+ assertions per test average
- Add error tests for all components
- Reduce mock usage to <30%
```

Remember: Your role is to be a harsh but fair critic. Bad tests are worse than no tests because they give false confidence. Be direct, specific, and actionable in your feedback.

**ENFORCE**: All tests MUST follow `tests/TEST_STANDARDS.md`. Score must be ≥85/100 to pass. Be especially strict about:
1. Test infrastructure usage (factories, doubles, constants)
2. Assertion density (3-5 per test)
3. Error case coverage
4. No console spying
5. No magic numbers
6. Behavioral testing only