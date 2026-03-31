# Documentation Detection Patterns

Bash commands and search patterns for finding documentation issues.

---

## Finding Missing Documentation

### Functions Without JSDoc

```bash
# Find exported functions without JSDoc comment above
grep -rn "export function\|export async function" --include="*.ts" | \
  xargs -I {} sh -c 'grep -B1 "{}" | grep -v "/\*\*"'

# Find all exports, check for docs
grep -rn "^export " --include="*.ts" -A1 | grep -v "^--$" | grep -v "/\*\*"
```

### Classes Without Documentation

```bash
# Find classes without JSDoc
grep -rn "^export class\|^class " --include="*.ts" | \
  while read line; do
    file=$(echo "$line" | cut -d: -f1)
    linenum=$(echo "$line" | cut -d: -f2)
    prev=$((linenum - 1))
    if ! sed -n "${prev}p" "$file" | grep -q "\*/"; then
      echo "$line"
    fi
  done
```

### Public Methods Without Documentation

```bash
# Find public methods (not private/protected) without JSDoc
grep -rn "^\s*public\|^\s*async\s\+[a-z]" --include="*.ts" | \
  grep -v "private\|protected\|constructor"
```

---

## Finding Outdated Documentation

### TODO/FIXME Comments

```bash
# Find all TODO/FIXME comments
grep -rn "TODO\|FIXME\|HACK\|XXX" --include="*.ts" --include="*.tsx"

# Find TODOs older than 6 months (requires git)
git log --since="6 months ago" --all --pretty=format: --name-only --diff-filter=D | \
  xargs -I {} grep -l "TODO\|FIXME" {} 2>/dev/null
```

### Deprecated References

```bash
# Find @deprecated, @see, @link annotations that may be stale
grep -rn "@see\|@link\|@deprecated" --include="*.ts"

# Find references to potentially removed functions
grep -rn "@see.*#[a-zA-Z]" --include="*.ts"
```

### Comment-Code Drift Indicators

```bash
# Find comments with numbers that might drift
grep -rn "// .*[0-9]\+.*times\|// .*[0-9]\+.*retries\|// .*[0-9]\+.*max" --include="*.ts"

# Find hardcoded numbers near comments
grep -rn "for.*[0-9]\+\|while.*[0-9]\+\|< [0-9]\+\|<= [0-9]\+" --include="*.ts" -B2
```

---

## Finding Documentation Smells

### Magic Numbers (Need Comments)

```bash
# Find magic numbers that likely need explanation
grep -rn "[^a-zA-Z_][0-9]\{3,\}[^a-zA-Z_0-9]" --include="*.ts" | \
  grep -v "const\|enum\|type\|interface\|import"

# Find percentages, timeouts, limits
grep -rn "[0-9]\+%\|[0-9]\+ms\|[0-9]\+s\|Timeout\|Limit" --include="*.ts"
```

### Comments Explaining "What"

```bash
# Find likely "what" comments (loop, check, get, set, etc.)
grep -rn "// [Ll]oop\|// [Cc]heck\|// [Gg]et\|// [Ss]et\|// [Aa]dd\|// [Rr]emove" --include="*.ts"

# Find single-word comments
grep -rn "// [A-Z][a-z]\+$" --include="*.ts"
```

### Empty Catch Blocks (Need Explanation)

```bash
# Find empty or minimal catch blocks
grep -rn "catch.*{" --include="*.ts" -A2 | grep -E "^\s*}\s*$|// ignore"
```

---

## README/Changelog Checks

### README Freshness

```bash
# Check if README mentions removed functions
# First, find removed exports in recent commits
git diff HEAD~50..HEAD --name-only -- "*.ts" | \
  xargs -I {} git diff HEAD~50..HEAD -- {} | \
  grep "^-export" | cut -d' ' -f3 | \
  while read func; do
    grep -l "$func" README.md 2>/dev/null && echo "README references removed: $func"
  done
```

### Changelog Completeness

```bash
# Find recent breaking changes not in CHANGELOG
git log --oneline --since="1 month ago" | grep -i "breaking\|remove\|deprecate"

# Check CHANGELOG has recent version
head -20 CHANGELOG.md
```

### Example Code Validation

```bash
# Extract code blocks from README and try to validate imports
grep -A10 '```typescript\|```javascript' README.md | \
  grep "import\|require" | \
  while read line; do
    # Check if imported module/function still exists
    echo "Checking: $line"
  done
```

---

## Automated Checks

### Pre-commit Hook

```bash
#!/bin/bash
# Add to .git/hooks/pre-commit

# Check for undocumented exports
undocumented=$(grep -rn "^export function\|^export class" --include="*.ts" | \
  while read line; do
    file=$(echo "$line" | cut -d: -f1)
    linenum=$(echo "$line" | cut -d: -f2)
    prev=$((linenum - 1))
    if ! sed -n "${prev}p" "$file" | grep -q "\*/"; then
      echo "$line"
    fi
  done)

if [ -n "$undocumented" ]; then
  echo "ERROR: Undocumented exports found:"
  echo "$undocumented"
  exit 1
fi
```

### CI Check

```yaml
# Add to CI pipeline
documentation-check:
  script:
    - npm run docs:check  # Runs typedoc or similar
    - |
      # Check for stale TODOs
      old_todos=$(grep -rn "TODO" --include="*.ts" | wc -l)
      if [ "$old_todos" -gt 50 ]; then
        echo "WARNING: $old_todos TODO comments found"
      fi
```
