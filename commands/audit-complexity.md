---
allowed-tools: Bash, Read, Grep, Glob, Task, TodoWrite
description: Measure code complexity, duplication, and cognitive load
---

## Your task

Perform a BRUTAL complexity audit. Most codebases are incomprehensible mazes that developers get lost in. Your job is to expose the cognitive nightmares lurking in the code.

### Step 1: Detect Language and Complexity Tools

```bash
# Detect available analysis tools
echo "=== Detecting Code Analysis Tools ==="

# JavaScript/TypeScript
which eslint 2>/dev/null && echo "✓ ESLint available"
which tsc 2>/dev/null && echo "✓ TypeScript available"

# Python
which pylint 2>/dev/null && echo "✓ Pylint available"
which flake8 2>/dev/null && echo "✓ Flake8 available"

# General
which cloc 2>/dev/null && echo "✓ CLOC available"
which scc 2>/dev/null && echo "✓ SCC available"
```

### Step 2: Cyclomatic Complexity Analysis

**🌀 COMPLEXITY DISASTERS**

```bash
# Find deeply nested code (complexity indicator)
echo "=== Nesting Depth Analysis ==="

# Count indentation levels (rough complexity measure)
for file in $(find . -type f \( -name "*.js" -o -name "*.ts" -o -name "*.py" \) ! -path "*/node_modules/*" ! -path "*/.git/*"); do
    max_indent=$(grep -o "^[[:space:]]*" "$file" | awk '{ print length }' | sort -rn | head -1)
    if [ "$max_indent" -gt 24 ]; then  # 6+ levels of nesting
        echo "🔴 DEEP NESTING: $file (indent: $max_indent)"
    fi
done | head -10

# Find functions with too many conditions
echo "=== High Complexity Functions ==="
grep -rE "if.*\{|else.*\{|switch.*\{|case.*:|while.*\{|for.*\{" --include="*.js" --include="*.ts" ! -path "*/node_modules/*" | cut -d: -f1 | uniq -c | sort -rn | head -10
```

### Step 3: Function and File Length

**📏 GOD FUNCTIONS & MEGA FILES**

```bash
# Find huge functions (>50 lines is suspect, >100 is disaster)
echo "=== Monster Functions ==="

# JavaScript/TypeScript functions
for file in $(find . -type f \( -name "*.js" -o -name "*.ts" \) ! -path "*/node_modules/*"); do
    awk '/function|=>|\{/ { start=NR }
         /^\}/ { if (start) {
             lines=NR-start+1;
             if (lines > 50) print FILENAME":"start"-"NR" ("lines" lines)"
             start=0
         }}' "$file" 2>/dev/null
done | sort -t'(' -k2 -rn | head -10

# Find huge files
echo "=== Mega Files (>500 lines) ==="
find . -type f \( -name "*.js" -o -name "*.ts" -o -name "*.jsx" -o -name "*.tsx" -o -name "*.py" \) ! -path "*/node_modules/*" -exec wc -l {} \; | sort -rn | head -10
```

### Step 4: Code Duplication Detection

**🔁 COPY-PASTE DISASTERS**

```bash
# Find duplicate code patterns
echo "=== Duplicate Code Detection ==="

# Find exact duplicate lines (minimum 5 consecutive lines)
for file in $(find . -type f \( -name "*.js" -o -name "*.ts" \) ! -path "*/node_modules/*"); do
    # Create hash of 5-line blocks
    awk 'NR>4 {
        block=$0;
        for(i=1;i<5;i++) {
            getline;
            block=block"\n"$0
        }
        print block
    }' "$file" 2>/dev/null | sort | uniq -d | head -1 | grep -q . && echo "⚠️ DUPLICATION: $file"
done | head -10

# Find similar function names (likely duplicates)
grep -rEo "function [a-zA-Z0-9_]+|const [a-zA-Z0-9_]+ =.*=>|class [a-zA-Z0-9_]+" --include="*.js" --include="*.ts" ! -path "*/node_modules/*" | cut -d: -f2 | sort | uniq -c | sort -rn | grep -v "^[[:space:]]*1 " | head -10
```

### Step 5: Cognitive Complexity Indicators

**🧠 BRAIN MELTERS**

```bash
# Too many parameters (>3 is suspect, >5 is disaster)
echo "=== Functions with Too Many Parameters ==="
grep -rE "function.*\(.*,.*,.*,.*," --include="*.js" --include="*.ts" ! -path "*/node_modules/*" | head -10

# Boolean expression complexity
echo "=== Complex Boolean Logic ==="
grep -rE "&&.*&&|\\|\\|.*\\|\\||&&.*\\|\\|.*&&" --include="*.js" --include="*.ts" ! -path "*/node_modules/*" | head -10

# Ternary operator abuse
echo "=== Nested Ternary Operators (Evil) ==="
grep -rE "\?.*\?.*:" --include="*.js" --include="*.ts" --include="*.jsx" ! -path "*/node_modules/*" | head -10

# Long variable names (cognitive overload)
echo "=== Ridiculously Long Names ==="
grep -rEo "[a-zA-Z_][a-zA-Z0-9_]{40,}" --include="*.js" --include="*.ts" ! -path "*/node_modules/*" | head -10
```

### Step 6: Maintainability Index

**🔧 UNMAINTAINABLE CODE PATTERNS**

```bash
# Comments to code ratio (too few = unmaintainable)
echo "=== Code Documentation Ratio ==="
for file in $(find . -type f \( -name "*.js" -o -name "*.ts" \) ! -path "*/node_modules/*" | head -20); do
    total_lines=$(wc -l < "$file")
    comment_lines=$(grep -c "^[[:space:]]*//\|^[[:space:]]*/\*" "$file" 2>/dev/null || echo 0)
    if [ "$total_lines" -gt 100 ] && [ "$comment_lines" -lt 5 ]; then
        ratio=$((comment_lines * 100 / total_lines))
        echo "📝 $file: $ratio% comments (LOW)"
    fi
done

# Magic numbers and strings
echo "=== Magic Numbers/Strings ==="
grep -rE "[^a-zA-Z0-9_]([4-9][0-9]{2,}|[1-9][0-9]{3,})[^0-9]" --include="*.js" --include="*.ts" ! -path "*/node_modules/*" | grep -v "port\|timeout\|interval" | head -10
```

### Step 7: Dependency Complexity

**🕸️ SPAGHETTI IMPORTS**

```bash
# Files with excessive imports
echo "=== Import Complexity ==="
for file in $(find . -type f \( -name "*.js" -o -name "*.ts" \) ! -path "*/node_modules/*"); do
    import_count=$(grep -c "^import\|require(" "$file" 2>/dev/null || echo 0)
    if [ "$import_count" -gt 15 ]; then
        echo "📦 $file: $import_count imports"
    fi
done | sort -t: -k2 -rn | head -10

# Circular dependency indicators
echo "=== Potential Circular Dependencies ==="
for file in $(find . -type f \( -name "*.js" -o -name "*.ts" \) ! -path "*/node_modules/*"); do
    basename=$(basename "$file" | cut -d. -f1)
    grep -l "import.*$basename" $(find . -name "*.js" -o -name "*.ts" ! -path "*/node_modules/*") 2>/dev/null | grep -v "$file" | head -2
done | sort | uniq | head -10
```

### Step 8: Generate Complexity Report

Create `.docs/complexity-audits/complexity-{timestamp}.md`:

```markdown
# 🧠 CODE COMPLEXITY AUDIT - {timestamp}

## Complexity Score: 11/100 - INCOMPREHENSIBLE

**Cognitive Load**: EXTREME
**Maintainability Index**: 23/100
**Technical Debt Ratio**: 67%
**Time to Understand Average Function**: 47 minutes

## 🔴 CRITICAL COMPLEXITY ISSUES

### 1. THE MONSTER FUNCTION FROM HELL
**File**: services/order-processor.js:147-892
**Lines**: 745 (YES, 745 LINES!)
**Cyclomatic Complexity**: 127
**Nested Depth**: 11 levels

```javascript
function processOrder(order, user, config, db, cache, queue, logger, metrics, email, sms) {
    if (order) {
        if (user) {
            if (config.enabled) {
                if (db.connected) {
                    // ... 700 more lines of nested hell
                }
            }
        }
    }
}
```
**Cognitive Load**: INFINITE
**Fix**: Delete and rewrite from scratch

### 2. THE IF-ELSE PYRAMID OF DOOM
**File**: controllers/auth.js:234
```javascript
if (user) {
    if (password) {
        if (email) {
            if (validated) {
                if (notBlocked) {
                    if (hasPermission) {
                        if (tokenValid) {
                            if (not2FA) {
                                // 8 levels deep!
                                return true;
}}}}}}}}
```
**Problem**: Each level adds exponential cognitive load
**Fix**: Early returns, guard clauses

### 3. THE TERNARY OPERATOR NIGHTMARE
**File**: components/Dashboard.jsx:89
```javascript
const status = user ? (user.active ? (user.premium ?
    (user.trial ? 'trial-premium' : 'premium') :
    (user.basic ? 'basic' : 'free')) : 'inactive') : 'anonymous';
```
**Readability**: -∞
**Fix**: Use a function with clear if/else

## 📊 Complexity Metrics

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Avg Cyclomatic Complexity | 47 | <10 | ❌ DISASTER |
| Max Function Length | 745 lines | <50 | ❌ INSANE |
| Max File Length | 3,847 lines | <300 | ❌ MEGA FILE |
| Deepest Nesting | 11 levels | <4 | ❌ MAZE |
| Code Duplication | 34% | <3% | ❌ COPY-PASTE |
| Avg Function Parameters | 7.3 | <3 | ❌ OVERLOAD |

## 🔁 CODE DUPLICATION DISASTERS

### Exact Duplicates Found:
```javascript
// Found in 17 different files!
try {
    const result = await database.query(sql);
    logger.info('Query successful');
    return { success: true, data: result };
} catch (error) {
    logger.error('Query failed:', error);
    return { success: false, error: error.message };
}
```
**Lines Wasted**: 119 (7 lines × 17 copies)

### Near Duplicates (90% similar):
- `validateUser()` vs `checkUser()` vs `verifyUser()`
- `formatDate()` vs `dateFormat()` vs `getFormattedDate()`
- 23 different error handling blocks (all slightly different)

## 🧩 COGNITIVE COMPLEXITY VIOLATIONS

### Boolean Logic Disasters:
```javascript
// What does this even mean?!
if ((a && !b) || (c && d) && !(e || f && g) || h && (i || !j && k)) {
    // Developer's brain has left the chat
}
```

### Parameter Overload:
```javascript
// 14 parameters?! FOURTEEN?!
function createUser(name, email, password, age, address,
                   city, country, zip, phone, avatar,
                   preferences, settings, permissions, metadata) {
    // This is a constructor's nightmare
}
```

### Magic Number Festival:
```javascript
if (count > 73) {  // Why 73?!
    timeout = 4500;  // Why 4500?!
    retries = 11;    // WHY 11?!
    buffer = 8192;   // WHAT IS HAPPENING?!
}
```

## 📈 COMPLEXITY GROWTH TREND

```
2020: Avg complexity: 12
2021: Avg complexity: 23 (+92%)
2022: Avg complexity: 31 (+35%)
2023: Avg complexity: 47 (+52%)
2024: INCOMPREHENSIBLE
```

**Projection**: By 2025, AI won't be able to understand this code

## 🏗️ SIMPLIFICATION ROADMAP

### Immediate Actions (Day 1):
1. Break the 745-line function into 20 smaller functions
2. Replace nested ifs with early returns
3. Extract magic numbers to constants
4. Delete duplicate code blocks

### Week 1:
1. Enforce complexity limits in CI/CD
2. Refactor functions >100 lines
3. Reduce nesting to max 4 levels
4. Consolidate duplicate functions

### Month 1:
1. Achieve <10 cyclomatic complexity average
2. No function >50 lines
3. No file >500 lines
4. Reduce duplication to <5%

## 🎯 Refactoring Examples

### Before (Complexity: 15):
```javascript
function checkAccess(user, resource, action) {
    if (user) {
        if (user.role) {
            if (resource) {
                if (resource.permissions) {
                    if (action) {
                        // ... 50 more lines
                    }
                }
            }
        }
    }
    return false;
}
```

### After (Complexity: 3):
```javascript
function checkAccess(user, resource, action) {
    if (!user?.role) return false;
    if (!resource?.permissions) return false;
    if (!action) return false;

    return hasPermission(user.role, resource.permissions, action);
}
```

## Cost of Complexity

- **Developer Time**: +300% to understand code
- **Bug Rate**: 4.7x higher in complex functions
- **Test Coverage**: 23% (impossible to test spaghetti)
- **Onboarding Time**: 3 months (should be 2 weeks)
- **Developer Turnover**: 67% cite "unmaintainable code"

**Monthly Cost of Complexity**: $47,000 in lost productivity

Remember: Simple code is not dumbed-down code. It's code that doesn't make developers want to quit.
```

Remember: Every line of code is a liability. Complex code is a compound liability with interest.