---
allowed-tools: Bash, Read, Grep, Glob, TodoWrite
description: Audit dependencies for vulnerabilities, bloat, licenses, and maintenance issues
---

## Your task

Perform a RUTHLESS dependency audit. Most projects are dependency dumpster fires with abandoned packages, security holes, and 500MB of JavaScript for a "Hello World" app.

### Step 1: Dependency Analysis by Language

```bash
# Detect project type
if [ -f "package.json" ]; then
    echo "=== Node.js Project Detected ==="
    npm list --depth=0 2>/dev/null | wc -l
    echo "Direct dependencies count"

    npm list 2>/dev/null | wc -l
    echo "Total dependencies (including transitive)"

    # Bundle size analysis
    du -sh node_modules 2>/dev/null || echo "No node_modules"

elif [ -f "requirements.txt" ] || [ -f "Pipfile" ]; then
    echo "=== Python Project Detected ==="
    pip list 2>/dev/null | wc -l

elif [ -f "go.mod" ]; then
    echo "=== Go Project Detected ==="
    go list -m all | wc -l

elif [ -f "Cargo.toml" ]; then
    echo "=== Rust Project Detected ==="
    cargo tree | wc -l
fi
```

### Step 2: Security Vulnerabilities

**🚨 SECURITY AUDIT**

```bash
# Node.js vulnerabilities
if [ -f "package.json" ]; then
    echo "=== NPM Security Audit ==="
    npm audit 2>/dev/null || echo "npm audit failed"

    echo "=== Critical & High Vulnerabilities ==="
    npm audit --json 2>/dev/null | grep -E '"severity":"(critical|high)"' | wc -l
fi

# Python vulnerabilities
if [ -f "requirements.txt" ]; then
    pip-audit 2>/dev/null || safety check 2>/dev/null || echo "No Python security scanner found"
fi

# Check for known vulnerable packages
grep -E "event-stream|flatmap-stream|eslint-scope@3.7.2|lodash@<4.17.19" package.json 2>/dev/null
```

### Step 3: Dependency Bloat Analysis

**🎈 BLOAT DETECTION**

```bash
# Find largest dependencies
if [ -d "node_modules" ]; then
    echo "=== Top 10 Largest Dependencies ==="
    du -sh node_modules/* 2>/dev/null | sort -rh | head -10
fi

# Duplicate packages (different versions)
if [ -f "package-lock.json" ]; then
    echo "=== Duplicate Dependencies ==="
    grep '"version"' package-lock.json | sort | uniq -c | sort -rn | grep -v "1 " | head -10
fi

# Development dependencies in production
grep -A 999 '"devDependencies"' package.json 2>/dev/null | grep -E "webpack|babel|eslint|jest|mocha" | head -10
```

### Step 4: Abandoned & Unmaintained Packages

**☠️ DEAD DEPENDENCIES**

```bash
# Check last publish dates (packages not updated in 2+ years)
if [ -f "package.json" ]; then
    echo "=== Checking for Abandoned Packages ==="
    for pkg in $(grep -oE '"[^"]+":' package.json | cut -d'"' -f2 | grep -v "Dependencies"); do
        npm view "$pkg" time.modified 2>/dev/null | grep -E "201[0-9]|2020|2021" && echo "⚠️ $pkg might be abandoned"
    done | head -10
fi

# Packages with lots of open issues
# This requires API calls, so we'll check for red flags in package.json
grep -E "left-pad|request|node-uuid|colors@1.4.1" package.json 2>/dev/null
```

### Step 5: License Compliance

**⚖️ LICENSE NIGHTMARES**

```bash
# Find GPL/AGPL licenses (viral licenses)
if [ -d "node_modules" ]; then
    echo "=== Checking for Problematic Licenses ==="
    find node_modules -name "LICENSE*" -o -name "license*" | xargs grep -l "GPL\|AGPL" 2>/dev/null | head -10
fi

# Check direct dependency licenses
if [ -f "package.json" ]; then
    echo "=== License Summary ==="
    npx license-checker --summary 2>/dev/null || echo "license-checker not available"
fi
```

### Step 6: Unnecessary Dependencies

**🗑️ USELESS PACKAGES**

```bash
# One-liner packages (probably unnecessary)
grep -E '"is-odd"|"is-even"|"is-number"|"is-positive"|"is-negative"' package.json 2>/dev/null

# Polyfills for modern environments
grep -E '"babel-polyfill"|"core-js@2"|"es5-shim"|"es6-shim"' package.json 2>/dev/null

# Multiple packages doing the same thing
echo "=== Duplicate Functionality ==="
grep -E '"axios"|"node-fetch"|"got"|"request"|"superagent"' package.json 2>/dev/null | wc -l
echo "HTTP libraries (should be 1)"

grep -E '"moment"|"dayjs"|"date-fns"|"luxon"' package.json 2>/dev/null | wc -l
echo "Date libraries (should be 1)"

grep -E '"lodash"|"underscore"|"ramda"' package.json 2>/dev/null | wc -l
echo "Utility libraries (should be 1 or 0)"
```

### Step 7: Dependency Graph Complexity

```bash
# Circular dependencies
if [ -f "package-lock.json" ]; then
    echo "=== Checking Circular Dependencies ==="
    npm ls 2>&1 | grep -E "UNMET|extraneous|invalid" | head -10
fi

# Depth of dependency tree
if [ -f "package.json" ]; then
    npm ls 2>/dev/null | grep "├─" | wc -l
    echo "Total dependency tree nodes"
fi
```

### Step 8: Generate Dependency Report

Create `.docs/dependency-audits/deps-{timestamp}.md`:

```markdown
# 📦 DEPENDENCY AUDIT REPORT - {timestamp}

## Dependency Health Score: 18/100 - CRITICAL

**Total Dependencies**: 1,847 (for a todo app!)
**Security Vulnerabilities**: 67 (23 critical, 44 high)
**Abandoned Packages**: 34
**Total Size**: 487MB
**Duplicate Packages**: 89

## 🚨 CRITICAL SECURITY VULNERABILITIES

### 1. Remote Code Execution in lodash
**Package**: lodash@4.17.11
**Severity**: CRITICAL
**Current**: 4.17.11
**Fixed in**: 4.17.21
**Exploit**: Prototype pollution leading to RCE
**Used by**: 423 packages in your tree

### 2. SQL Injection in sequelize
**Package**: sequelize@5.0.0
**Severity**: CRITICAL
**CVE**: CVE-2019-10752
**Impact**: Complete database compromise

### 3. Path Traversal in express-fileupload
**Package**: express-fileupload@0.4.0
**Severity**: HIGH
**Impact**: Arbitrary file read/write

## 💀 ABANDONED PACKAGES

These packages haven't been updated in YEARS:

1. **request** - DEPRECATED 2020 (still used!)
2. **node-uuid** - Renamed 5 years ago
3. **bower** - Dead since 2017
4. **gulp-uglify** - Last update 2019
5. **phantomjs** - Abandoned 2018

## 🎈 BLOAT ANALYSIS

### Largest Dependencies:
```
487MB  node_modules/
├── 89MB   aws-sdk (Using 1 function!)
├── 67MB   @babel (In production?!)
├── 45MB   webpack (WHY in production?)
├── 34MB   lodash (For _.get()?)
└── 31MB   moment (Use native dates!)
```

### One-Line Packages (YES, REALLY):
```javascript
// is-odd: 7 weekly downloads, 12 dependencies
module.exports = n => n % 2 === 1;

// is-positive: Seriously?
module.exports = n => n > 0;

// left-pad: Never forget
```

## 🔄 DUPLICATE FUNCTIONALITY

You have MULTIPLE packages doing the SAME THING:

### HTTP Libraries (Pick ONE):
- axios (45MB with deps)
- node-fetch (2MB)
- request (DEPRECATED)
- superagent (8MB)
- got (5MB)

### Date Libraries (Pick ONE or use native):
- moment (67MB, deprecated)
- moment-timezone (more bloat)
- dayjs (2MB)
- date-fns (4MB)
- luxon (3MB)

### Utility Libraries (Pick NONE):
- lodash (89MB total)
- underscore (why both?)
- ramda (for 2 functions)

## ⚖️ LICENSE VIOLATIONS

**LEGAL NIGHTMARES DETECTED:**

1. **GPL-3.0** packages in proprietary code:
   - some-gpl-package
   - another-gpl-thing

2. **No License** (legally unusable):
   - random-npm-package
   - some-guys-code

3. **Facebook's BSD+Patents** (controversial):
   - react@15.x.x (old version)

## 📊 Dependency Metrics

| Metric | Current | Acceptable | Status |
|--------|---------|------------|--------|
| Direct Dependencies | 234 | <30 | ❌ INSANE |
| Total Dependencies | 1,847 | <200 | ❌ EXPLOSION |
| Security Issues | 67 | 0 | ❌ COMPROMISED |
| Size | 487MB | <50MB | ❌ BLOATED |
| Outdated (>2 years) | 34 | 0 | ❌ ABANDONED |
| Audit Time | 45s | <5s | ❌ SLOW |

## 🗑️ PACKAGES TO DELETE IMMEDIATELY

### Completely Useless:
1. `is-odd`, `is-even`, `is-number` - Write it yourself!
2. `left-pad` - It's ONE LINE
3. `colors@1.4.1` - Has malware!

### Replaced by Native:
1. `node-fetch` - Use native fetch
2. `uuid` - Use crypto.randomUUID()
3. `lodash` - Use native array methods

### Development Dependencies in Production:
1. `webpack` - Build tool, not runtime
2. `@babel/*` - Transpiler, not runtime
3. `eslint` - Linter in production?!
4. `jest` - Tests in production?!

## 💰 COST ANALYSIS

Your bloated dependencies are costing you:
- **CI/CD**: +10 min per build × 100 builds/day = 16 hours wasted
- **Docker Image**: 2.3GB (should be 100MB)
- **Lambda Cold Starts**: 15s (should be <1s)
- **Monthly AWS Bill**: +$3,000 in unnecessary compute

## 🔧 IMMEDIATE ACTIONS

### Day 1 (EMERGENCY):
```bash
# Update critical vulnerabilities
npm audit fix --force

# Remove known bad packages
npm uninstall colors request left-pad

# Remove dev dependencies from production
npm prune --production
```

### Week 1:
1. Consolidate duplicate functionality
2. Replace abandoned packages
3. Remove unnecessary polyfills
4. Update all dependencies

### Month 1:
1. Implement dependency budget
2. Set up security scanning in CI
3. Regular dependency reviews
4. Consider vendoring critical deps

## Dependency Diet Plan

Before: 1,847 packages, 487MB
Target: <100 packages, <30MB
Savings: 95% reduction

Stop treating npm like a buffet. Every dependency is technical debt.
```

Remember: The best dependency is no dependency. The second best is one you understand and can replace.