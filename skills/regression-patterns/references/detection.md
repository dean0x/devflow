# Regression Detection Reference

Bash commands and techniques for detecting regressions during code review.

---

## Export Comparison

### Compare Module Exports

```bash
# List exports in main branch
git show main:src/index.ts | grep -E "^export" > /tmp/exports_before.txt

# List exports in current branch
grep -E "^export" src/index.ts > /tmp/exports_after.txt

# Find removed exports
diff /tmp/exports_before.txt /tmp/exports_after.txt | grep "^<"
```

### Find All Removed Exports Across Files

```bash
# Get list of changed .ts files
git diff main...HEAD --name-only --diff-filter=M "*.ts" | while read file; do
  echo "=== $file ==="
  diff <(git show main:"$file" 2>/dev/null | grep "^export") \
       <(cat "$file" | grep "^export") | grep "^<" || echo "(no removals)"
done
```

---

## Function Usage Analysis

### Find Removed Function Calls

```bash
# Check if function is still called
git show main:src/*.ts | grep "oldFunction" | wc -l  # Before: 15
grep -r "oldFunction" src/*.ts | wc -l                # After: 3 (12 removed!)
```

### Verify All Consumers Updated

```bash
# Find all imports of changed module
grep -rn "from './changed-module'" --include="*.ts"

# Check each importer for usage of changed exports
for file in $(grep -l "from './changed-module'" src/**/*.ts); do
  echo "=== $file ==="
  grep -n "changedExport\|renamedFunction" "$file"
done
```

### Find Incomplete Migrations

```bash
# Count usages of old vs new API
echo "Old API usages:"
grep -r "oldFunction" src/ --include="*.ts" | wc -l

echo "New API usages:"
grep -r "newFunction" src/ --include="*.ts" | wc -l

# List files still using old API
grep -rl "oldFunction" src/ --include="*.ts"
```

---

## File Structure Comparison

### Compare File Trees

```bash
# Compare file structure
diff <(git ls-tree -r --name-only main src/) \
     <(git ls-tree -r --name-only HEAD src/)
```

### Find Deleted Files

```bash
# Find removed files
git diff main...HEAD --name-status | grep "^D"

# Find removed test files specifically
git diff main...HEAD --name-status | grep "^D.*test"

# Find removed type definition files
git diff main...HEAD --name-status | grep "^D.*\.d\.ts"
```

---

## Change Analysis

### Find Large Deletions

```bash
# Find files with significant deletions
git diff main...HEAD --stat | grep -E "^\s+-" | head -20

# Show deletion-heavy changes
git diff main...HEAD --numstat | awk '$2 > 50 {print $3 ": +" $1 " -" $2}'
```

### Find TODO/FIXME Additions

```bash
# Find incomplete work markers
git diff main...HEAD | grep "^\+.*TODO\|^\+.*FIXME"

# Count new vs resolved TODOs
echo "New TODOs:"
git diff main...HEAD | grep "^\+.*TODO" | wc -l

echo "Resolved TODOs:"
git diff main...HEAD | grep "^-.*TODO" | wc -l
```

---

## API Endpoint Analysis

### Find Removed Routes

```bash
# Compare route definitions
diff <(git show main:src/routes/*.ts | grep -E "app\.(get|post|put|delete|patch)") \
     <(cat src/routes/*.ts | grep -E "app\.(get|post|put|delete|patch)")

# Find removed Express routes
git diff main...HEAD src/routes/ | grep "^-.*app\.\(get\|post\|put\|delete\)"
```

### Find Removed Event Handlers

```bash
# Compare event handlers
diff <(git show main:src/**/*.ts | grep -E "\.on\(|\.addEventListener\(") \
     <(cat src/**/*.ts | grep -E "\.on\(|\.addEventListener\(") | grep "^<"
```

---

## CLI Option Analysis

### Compare CLI Options

```bash
# Find commander/yargs options before
git show main:src/cli.ts | grep -E "\.option\(|\.command\(" > /tmp/cli_before.txt

# Find options after
grep -E "\.option\(|\.command\(" src/cli.ts > /tmp/cli_after.txt

# Compare
diff /tmp/cli_before.txt /tmp/cli_after.txt | grep "^<"
```

---

## Return Type Analysis

### Find Changed Return Types

```bash
# Extract function signatures
git show main:src/services/*.ts | grep -E "function.*\):" > /tmp/sigs_before.txt
grep -E "function.*\):" src/services/*.ts > /tmp/sigs_after.txt

# Compare (look for added | null, | undefined)
diff /tmp/sigs_before.txt /tmp/sigs_after.txt
```

---

## Side Effect Analysis

### Find Removed Logging

```bash
# Count logger calls before vs after
echo "Logging before:"
git show main:src/**/*.ts | grep -c "logger\.\|console\."

echo "Logging after:"
grep -rc "logger\.\|console\." src/**/*.ts | awk -F: '{sum += $2} END {print sum}'
```

### Find Removed Event Emissions

```bash
# Count event emissions before vs after
echo "Events before:"
git show main:src/**/*.ts | grep -c "\.emit\("

echo "Events after:"
grep -rc "\.emit\(" src/**/*.ts | awk -F: '{sum += $2} END {print sum}'
```

---

## Quick Regression Checks

### All-in-One Regression Scan

```bash
#!/bin/bash
# regression-check.sh

echo "=== REGRESSION CHECK ==="

echo -e "\n1. Removed exports:"
git diff main...HEAD | grep "^-export" | head -10

echo -e "\n2. Removed files:"
git diff main...HEAD --name-status | grep "^D" | head -10

echo -e "\n3. Removed routes:"
git diff main...HEAD | grep "^-.*app\.\(get\|post\|put\|delete\)" | head -10

echo -e "\n4. Removed event handlers:"
git diff main...HEAD | grep "^-.*\.on\(" | head -10

echo -e "\n5. New TODOs (incomplete work):"
git diff main...HEAD | grep "^\+.*TODO" | head -10

echo -e "\n6. Type changes (potential breaks):"
git diff main...HEAD | grep "^\+.*| null\|^\+.*| undefined" | head -10

echo -e "\n=== END CHECK ==="
```
