# Consistency Detection Patterns Reference

Bash commands and patterns for detecting consistency issues.

---

## Diff Statistics Analysis

### Files with Excessive Deletions

```bash
# Files with many more deletions than additions
git diff main...HEAD --stat | awk '{
  if (match($0, /\+([0-9]+).*-([0-9]+)/, arr)) {
    added = arr[1]; deleted = arr[2];
    if (deleted > added * 2 && deleted > 10) {
      print "WARNING:", $0
    }
  }
}'
```

### Content Length Changes

```bash
# Compare line counts for key files
for file in $(git diff --name-only main...HEAD); do
  if [ -f "$file" ]; then
    before=$(git show main:"$file" 2>/dev/null | wc -l)
    after=$(wc -l < "$file")
    if [ "$before" -gt "$after" ]; then
      reduction=$((before - after))
      percent=$((reduction * 100 / before))
      if [ "$percent" -gt 20 ]; then
        echo "WARNING: $file reduced by $percent% ($before -> $after lines)"
      fi
    fi
  fi
done
```

---

## Error Message Detection

### Shortened Error Messages

```bash
# Find shortened error messages in diff
git diff main...HEAD -- "*.ts" | grep "^-.*Error\|^-.*throw" | head -20

# Compare error message lengths before/after
git diff main...HEAD -- "*.ts" | grep -A1 "^-.*throw new Error" | head -30
```

### Generic Error Replacements

```bash
# Find generic error messages that replaced specific ones
git diff main...HEAD -- "*.ts" | grep "^+.*'Error'\|^+.*'Failed'\|^+.*'Invalid'" | head -20
```

---

## Export/Import Detection

### Removed Exports

```bash
# Find removed exports
git diff main...HEAD -- "*.ts" | grep "^-export" | head -20
```

### Changed Export Patterns

```bash
# Find export default vs named export changes
git diff main...HEAD -- "*.ts" | grep "^-export\|^+export" | head -30
```

### Import Order Analysis

```bash
# Check for import order inconsistencies
for file in $(git diff --name-only main...HEAD -- "*.ts"); do
  echo "=== $file ==="
  head -30 "$file" | grep "^import" | head -15
done
```

---

## CLI/Options Detection

### Removed Options

```bash
# Find removed CLI options
git diff main...HEAD -- "*.ts" | grep "^-.*\.option\|^-.*flag" | head -20

# Find removed function parameters
git diff main...HEAD -- "*.ts" | grep "^-.*function.*(" | head -20
```

### Changed Signatures

```bash
# Find changed function signatures
git diff main...HEAD -- "*.ts" | grep -A2 "^-.*function\|^+.*function" | head -40
```

---

## Naming Convention Detection

### Unusual Naming Patterns

```bash
# Find snake_case in functions (unusual for TypeScript)
grep -rn "function [A-Z_]" --include="*.ts" | head -10

# Find SCREAMING_CASE functions (should be constants only)
grep -rn "function [A-Z][A-Z]" --include="*.ts" | head -10

# Find mixed function styles
grep -rn "const [a-z].*= function" --include="*.ts" | head -10
```

### Quote Style Detection

```bash
# Find inconsistent quotes
echo "Double quotes:"
grep -rn '"[^"]*"' --include="*.ts" | head -5

echo "Single quotes:"
grep -rn "'[^']*'" --include="*.ts" | head -5
```

---

## Event Emission Detection

### Removed Event Emissions

```bash
# Find removed event emissions
git diff main...HEAD -- "*.ts" | grep "^-.*\.emit\|^-.*emit(" | head -20

# Find removed event listeners
git diff main...HEAD -- "*.ts" | grep "^-.*\.on(\|^-.*addEventListener" | head -20
```

---

## Configuration Detection

### Removed Config Options

```bash
# Find removed interface properties
git diff main...HEAD -- "*.ts" | grep "^-.*:" | grep -v "//" | head -20

# Find removed config keys
git diff main...HEAD -- "*.json" | grep "^-" | head -20
```

### Changed Default Values

```bash
# Find changed default values
git diff main...HEAD -- "*.ts" | grep "^-.*=.*\|^+.*=.*" | grep default | head -20
```

---

## Comprehensive Scan

### Full Consistency Check

```bash
#!/bin/bash
# Run all consistency checks

echo "=== Excessive Deletions ==="
git diff main...HEAD --stat | awk '{
  if (match($0, /\+([0-9]+).*-([0-9]+)/, arr)) {
    if (arr[2] > arr[1] * 2 && arr[2] > 10) print "WARNING:", $0
  }
}'

echo ""
echo "=== Removed Exports ==="
git diff main...HEAD -- "*.ts" | grep "^-export" | head -10

echo ""
echo "=== Shortened Errors ==="
git diff main...HEAD -- "*.ts" | grep "^-.*Error\|^-.*throw" | head -10

echo ""
echo "=== Removed Events ==="
git diff main...HEAD -- "*.ts" | grep "^-.*\.emit" | head -10

echo ""
echo "=== Naming Issues ==="
grep -rn "function [A-Z_]" --include="*.ts" | head -5
```
