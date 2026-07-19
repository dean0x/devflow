# Test Issue Detection

Commands and patterns for detecting test quality issues.

---

## Coverage Detection

### Find Untested Functions

```bash
# List exported functions in source
grep -rn "export function\|export async function" --include="*.ts" src/ | cut -d: -f1,3 | sort

# List tested functions
grep -rn "describe\|it\(" --include="*.test.ts" | grep -oE "'[^']+'" | sort -u

# Compare to find gaps (manual comparison needed)
```

### Find Missing Error Tests

```bash
# Count error-throwing code in source
grep -rn "throw\|reject\|Error" --include="*.ts" src/ | grep -v test | wc -l

# Count error test assertions
grep -rn "rejects.toThrow\|toThrow\|toThrowError" --include="*.test.ts" | wc -l

# Large discrepancy indicates missing error tests
```

---

## Quality Detection

### Tests Without Assertions

```bash
# Find test blocks that may lack assertions
grep -rn "it\(.*=>" --include="*.test.ts" -A20 | grep -v "expect" | head -50

# Find empty test blocks
grep -rn "it\(.*{\s*}\)" --include="*.test.ts"
```

### Weak Assertions

```bash
# Find overly permissive assertions
grep -rn "toBeDefined\|toBeTruthy\|not.toBeNull\|not.toBeUndefined" --include="*.test.ts"

# Count for comparison with strong assertions
grep -rn "toEqual\|toMatchObject\|toHaveLength\|toBe(" --include="*.test.ts" | wc -l
```

### Implementation Testing

```bash
# Find tests that verify mock calls (may indicate implementation testing)
grep -rn "toHaveBeenCalledWith\|toHaveBeenCalled\|toHaveBeenCalledTimes" --include="*.test.ts"
```

---

## Design Detection

### Slow Tests

```bash
# Find tests with long timeouts (>5000ms)
grep -rn "}, [0-9][0-9][0-9][0-9][0-9])" --include="*.test.ts"

# Find real delays in tests
grep -rn "setTimeout\|sleep\|delay" --include="*.test.ts"
```

### Complex Setup

```bash
# Find tests with many mock objects
grep -rn "jest.fn\|sinon.stub\|mock" --include="*.test.ts" | cut -d: -f1 | uniq -c | sort -rn | head -10

# Find long beforeEach blocks
grep -rn "beforeEach" --include="*.test.ts" -A30 | head -100
```

---

## Mocking Detection

### Over-Mocking

```bash
# Count mocks per test file
for f in $(find . -name "*.test.ts" -type f); do
  count=$(grep -c "jest.fn\|mock" "$f" 2>/dev/null || echo 0)
  echo "$count $f"
done | sort -rn | head -20

# Files with >20 mocks may be over-mocked
```

### Third-Party Library Mocking

```bash
# Find jest.mock of node_modules
grep -rn "jest.mock\(['\"]" --include="*.test.ts" | grep -v "\./" | grep -v "\.\./"

# These should be wrapped in interfaces instead
```

---

## Summary Report Script

```bash
#!/bin/bash
# test-health-check.sh - Quick test quality assessment

echo "=== Test Health Check ==="
echo ""

echo "Coverage Indicators:"
echo "  Source functions: $(grep -rn 'export function' --include='*.ts' src/ 2>/dev/null | wc -l)"
echo "  Test blocks: $(grep -rn 'it\(' --include='*.test.ts' 2>/dev/null | wc -l)"
echo ""

echo "Quality Indicators:"
echo "  Strong assertions: $(grep -rn 'toEqual\|toMatchObject' --include='*.test.ts' 2>/dev/null | wc -l)"
echo "  Weak assertions: $(grep -rn 'toBeDefined\|toBeTruthy' --include='*.test.ts' 2>/dev/null | wc -l)"
echo ""

echo "Design Indicators:"
echo "  Long timeouts: $(grep -rn '}, [0-9]\{5,\})' --include='*.test.ts' 2>/dev/null | wc -l)"
echo "  Mock count: $(grep -rn 'jest.fn\|mock' --include='*.test.ts' 2>/dev/null | wc -l)"
```

---

## Test Coverage Guidelines

| Code Type | Required Coverage | Test Type |
|-----------|-------------------|-----------|
| Business logic | 90%+ | Unit tests |
| API endpoints | 80%+ | Integration tests |
| UI components | 70%+ | Component tests |
| Utilities | 100% | Unit tests |
| Error paths | 100% | Unit tests |
