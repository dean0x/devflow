# Complexity Detection Patterns

Commands and techniques for detecting complexity issues in codebases.

---

## Automated Detection

### Long Functions

```bash
# Find files with potentially long functions (rough heuristic)
# Look for function definitions and count lines between them
grep -rn "^[[:space:]]*\(function\|async function\|const.*=.*=>\|export.*function\)" --include="*.ts" | head -50

# Count lines in each function (requires manual inspection)
# Look for files > 300 lines as candidates
find . -name "*.ts" -exec wc -l {} \; | sort -rn | head -20
```

### Deep Nesting

```bash
# Find deeply indented code (8+ spaces = 2+ levels)
grep -rn "^        if\|^        for\|^        while\|^        switch" --include="*.ts"

# Find even deeper nesting (12+ spaces = 3+ levels)
grep -rn "^            if\|^            for\|^            while" --include="*.ts"

# Count indentation levels in files
awk '/^[[:space:]]+/ { match($0, /^[[:space:]]+/); depth=RLENGTH/2; if(depth>max)max=depth } END {print FILENAME": max depth="max}' file.ts
```

### Magic Numbers

```bash
# Find numeric literals (excluding common values)
grep -rn "[^a-zA-Z_][0-9]\{3,\}[^a-zA-Z_]" --include="*.ts" | grep -v "const\|enum\|type\|interface\|port\|status"

# Find hardcoded timeouts/delays
grep -rn "setTimeout\|setInterval\|delay\|sleep" --include="*.ts" -A 1 | grep "[0-9]"

# Find percentages and rates
grep -rn "0\.[0-9]\+\|[0-9]\+%" --include="*.ts" | grep -v "test\|spec"
```

### Long Parameter Lists

```bash
# Find functions with 5+ parameters (rough pattern)
grep -rn "function.*,.*,.*,.*,.*," --include="*.ts"

# Find arrow functions with many parameters
grep -rn "([^)]*,[^)]*,[^)]*,[^)]*,[^)]*) =>" --include="*.ts"
```

### Complex Boolean Expressions

```bash
# Find chained AND conditions
grep -rn "&&.*&&.*&&" --include="*.ts"

# Find chained OR conditions
grep -rn "||.*||.*||" --include="*.ts"

# Find mixed complex conditions
grep -rn "&&.*||.*&&\|||.*&&.*||" --include="*.ts"

# Find negation patterns
grep -rn "!.*!.*!\|!!!\|!.*&&.*!" --include="*.ts"
```

### Code Duplication

```bash
# Find repeated patterns (heuristic)
grep -rn "if (!.*) return\|throw" --include="*.ts" | sort | uniq -c | sort -rn | head -20

# Find similar validation patterns
grep -rn "if.*null\|if.*undefined\|if.*===.*''" --include="*.ts" | sort | uniq -c | sort -rn

# Find copied error handling
grep -rn "catch.*error\|catch.*e\)" --include="*.ts" | sort | uniq -c | sort -rn
```

---

## Static Analysis Tools

### TypeScript/JavaScript

```bash
# ESLint with complexity rules
npm install -D eslint-plugin-sonarjs

# eslint.config.js
rules: {
  'sonarjs/cognitive-complexity': ['error', 15],
  'max-depth': ['error', 4],
  'max-lines-per-function': ['error', { max: 50 }],
  'max-params': ['error', 4],
  'complexity': ['error', 10],
}

# Run ESLint
npx eslint --ext .ts src/
```

### Code Climate / SonarQube

```yaml
# .codeclimate.yml
plugins:
  duplication:
    enabled: true
    config:
      languages:
        typescript:
          mass_threshold: 40
  fixme:
    enabled: true
  eslint:
    enabled: true
    channel: eslint-8
```

---

## Manual Review Checklist

### Function-Level Review

```
For each function, check:
[ ] Lines of code < 50
[ ] Maximum nesting depth < 4
[ ] Number of parameters < 5
[ ] Cyclomatic complexity < 10
[ ] Single responsibility (one reason to change)
[ ] Clear, intention-revealing name
```

### File-Level Review

```
For each file, check:
[ ] Total lines < 300
[ ] Single cohesive purpose
[ ] No duplicated logic blocks
[ ] Constants extracted and named
[ ] Related functions grouped together
```

### Expression-Level Review

```
For complex expressions, check:
[ ] Can be understood without comments
[ ] No chained ternaries
[ ] Boolean conditions are simple
[ ] Magic values are named
[ ] Array operations are broken into steps
```

---

## Complexity Metrics Reference

| Metric | Good | Warning | Critical |
|--------|------|---------|----------|
| Function length | < 30 lines | 30-50 lines | > 50 lines |
| Cyclomatic complexity | < 5 | 5-10 | > 10 |
| Nesting depth | < 3 | 3-4 | > 4 |
| Parameters | < 3 | 3-5 | > 5 |
| File length | < 300 lines | 300-500 lines | > 500 lines |
| Cognitive complexity | < 10 | 10-15 | > 15 |

---

## IDE Integration

### VS Code Settings

```json
{
  "editor.rulers": [80, 120],
  "editor.renderIndentGuides": true,
  "eslint.validate": ["typescript"],
  "sonarlint.rules": {
    "typescript:S3776": { "level": "on" }
  }
}
```

### Vim/Neovim

```vim
" Highlight long lines
set colorcolumn=80,120

" Show indentation levels
set listchars+=tab:>-,trail:.,extends:>,precedes:<
set list
```

---

## Continuous Integration

### GitHub Actions Example

```yaml
name: Complexity Check
on: [pull_request]

jobs:
  complexity:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npx eslint --ext .ts src/ --max-warnings 0
      - name: Check function lengths
        run: |
          # Fail if any file > 500 lines
          find src -name "*.ts" -exec wc -l {} \; | awk '$1 > 500 { print "FAIL:", $2, "has", $1, "lines"; exit 1 }'
```

---

## Interpreting Results

### When to Act

**Immediate refactor required:**
- Cyclomatic complexity > 20
- Function > 200 lines
- Nesting > 6 levels
- Same code block duplicated 5+ times

**Schedule refactor:**
- Cyclomatic complexity 10-20
- Function 50-200 lines
- Nesting 4-6 levels
- Parameter list > 5

**Note for future:**
- Cyclomatic complexity 5-10
- Function 30-50 lines
- Minor magic values
- Small duplication

### False Positives

Some patterns look complex but are acceptable:

- **Generated code**: Auto-generated types, parsers
- **Lookup tables**: Large const objects mapping data
- **Test data**: Long arrays/objects in test files
- **Configuration**: Comprehensive config objects
- **Regex patterns**: Complex but necessary patterns
