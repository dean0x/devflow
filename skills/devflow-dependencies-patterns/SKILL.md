---
name: devflow-dependencies-patterns
description: Dependency management and security analysis. Load when reviewing package.json changes, dependency updates, or assessing supply chain risks. Used by Reviewer agent with dependencies focus.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Dependencies Patterns

Domain expertise for dependency management and security analysis. Use alongside `devflow-review-methodology` for complete dependency reviews.

## Iron Law

> **EVERY DEPENDENCY IS AN ATTACK SURFACE**
>
> Each package you add is code you didn't write but must trust. Minimize dependencies.
> Pin versions. Audit regularly. A single compromised transitive dependency can compromise
> your entire application. "It's a popular package" is not a security review.

## Dependency Categories

### 1. Security Vulnerabilities

**Known CVEs**
```bash
# Check for known vulnerabilities
npm audit
# or
yarn audit
# or
pnpm audit

# Output example:
# High: Prototype Pollution in lodash
# Package: lodash
# Dependency of: my-package
# Path: my-package > lodash
# More info: https://github.com/advisories/GHSA-xxx
```

**Vulnerable Version Ranges**
```json
// PROBLEM: Wide version range includes vulnerable versions
{
  "dependencies": {
    "lodash": "^4.0.0"  // Includes vulnerable 4.17.0-4.17.20
  }
}

// SOLUTION: Pin to safe version or use range excluding vulnerable
{
  "dependencies": {
    "lodash": "^4.17.21"  // First safe version
  }
}
```

**Malicious Packages**
```json
// RED FLAGS for potentially malicious packages:
{
  "dependencies": {
    "loadsh": "1.0.0",           // Typosquat of "lodash"
    "event-stream": "3.3.6",     // Known compromised version
    "random-unknown-pkg": "0.0.1" // No downloads, no repo
  }
}

// VERIFY packages:
// - Check npm page for download counts
// - Verify repository link
// - Check maintainer history
// - Look for typosquatting
```

### 2. Version Management Issues

**Unpinned Versions**
```json
// PROBLEM: Can get different versions on each install
{
  "dependencies": {
    "express": "*",           // Any version!
    "lodash": "latest",       // Whatever is latest
    "moment": ""              // Empty = latest
  }
}

// SOLUTION: Pin exact or use caret with lockfile
{
  "dependencies": {
    "express": "4.18.2",      // Exact pin
    "lodash": "^4.17.21",     // Caret + lockfile
    "moment": "~2.29.4"       // Tilde for patch only
  }
}
```

**Missing Lockfile**
```bash
# PROBLEM: No lockfile committed
.gitignore:
package-lock.json  # Don't ignore this!
yarn.lock          # Don't ignore this!

# SOLUTION: Commit lockfile
git add package-lock.json  # or yarn.lock
git commit -m "Add lockfile for reproducible builds"
```

**Dependency Conflicts**
```bash
# PROBLEM: Multiple versions of same package
npm ls react
# my-app
# ├── react@18.2.0
# └── some-library
#     └── react@17.0.2  # Conflict!

# SOLUTION: Use resolutions/overrides
# package.json (yarn)
{
  "resolutions": {
    "react": "18.2.0"
  }
}

# package.json (npm)
{
  "overrides": {
    "react": "18.2.0"
  }
}
```

### 3. Dependency Issues

**Outdated Packages**
```bash
# Check for outdated
npm outdated

# Package          Current  Wanted  Latest
# lodash           4.17.15  4.17.21 4.17.21  # Security update!
# typescript       4.9.5    4.9.5   5.3.2    # Major version
# @types/node      18.0.0   18.19.0 20.10.0  # Minor updates

# Prioritize:
# 1. Security patches (lodash)
# 2. Bug fixes (minor updates)
# 3. Major versions (careful review)
```

**Unused Dependencies**
```bash
# Find unused dependencies
npx depcheck

# Unused dependencies:
# * moment           # Listed but never imported
# * lodash           # Listed but never imported

# SOLUTION: Remove unused
npm uninstall moment lodash
```

**Unnecessary Dependencies**
```json
// PROBLEM: Heavy dependencies for simple tasks
{
  "dependencies": {
    "moment": "^2.29.4",     // 300KB for date formatting
    "lodash": "^4.17.21",    // 70KB for one function
    "left-pad": "^1.3.0"     // 1KB for string padding
  }
}

// SOLUTION: Use native or lighter alternatives
// Native date formatting
new Date().toLocaleDateString();

// Native array methods instead of lodash
array.filter(x => x.active);

// Native string padding
'5'.padStart(2, '0');

// Or import only what you need
import { debounce } from 'lodash/debounce';
```

### 4. License Issues

**Incompatible Licenses**
```bash
# Check licenses
npx license-checker --summary

# Watch for incompatible combinations:
# - GPL in MIT project (viral license)
# - Commercial-only licenses
# - AGPL in SaaS (requires source disclosure)

# Example problematic output:
# GPL-3.0: some-package  # Requires your code to be GPL too!
```

**Missing License**
```bash
# Find packages without license
npx license-checker --onlyunknown

# Packages with unknown license:
# - internal-company-pkg@1.0.0  # Verify this is intentional
```

### 5. Supply Chain Risks

**Transitive Dependencies**
```bash
# Check dependency tree depth
npm ls --all | wc -l
# If > 1000, high supply chain risk

# Audit transitive deps
npm audit --all

# SOLUTION: Minimize dependencies, audit regularly
```

**Maintainer Concerns**
```json
// RED FLAGS:
// - Package with 1 maintainer who's inactive
// - No recent releases but many open issues
// - Repository archived or deleted
// - Maintainer account compromised (check news)

// Check package health:
// https://snyk.io/advisor/npm-package/{package-name}
```

---

## Severity Guidelines

**CRITICAL** - Immediate security risk:
- Known exploited CVEs (CISA KEV)
- Critical severity vulnerabilities
- Confirmed malicious packages
- Typosquatted package names

**HIGH** - Significant risk:
- High severity CVEs
- Packages with no maintainers
- Extremely outdated with security fixes
- Incompatible GPL in proprietary code

**MEDIUM** - Moderate concerns:
- Medium severity CVEs
- Significantly outdated packages
- Wide version ranges
- Missing lockfile

**LOW** - Minor improvements:
- Unused dependencies
- Could use lighter alternatives
- Minor version behind

---

## Detection Patterns

Search for these patterns:

```bash
# Check for vulnerabilities
npm audit --json | jq '.vulnerabilities | keys'

# Check for outdated
npm outdated --json

# Check for unused
npx depcheck --json

# Check lockfile exists
[ -f package-lock.json ] || [ -f yarn.lock ] || echo "No lockfile!"

# Check for wide version ranges
grep -E '"[*~^]|": "latest|": ""' package.json

# Check dependency count
jq '.dependencies | length' package.json
jq '.devDependencies | length' package.json
```

---

## Dependency Review Checklist

Before approving dependency changes:

- [ ] No known CVEs in added packages
- [ ] Version ranges are appropriate (not too wide)
- [ ] Lockfile updated and committed
- [ ] Package is actively maintained
- [ ] License is compatible
- [ ] Package is from verified publisher
- [ ] Transitive dependencies reviewed
- [ ] Package name verified (not typosquat)
- [ ] Bundle size impact considered
- [ ] Alternative native solutions considered

---

## Common Vulnerability Sources

| Registry | URL |
|----------|-----|
| npm Advisory | https://www.npmjs.com/advisories |
| Snyk Vuln DB | https://snyk.io/vuln |
| GitHub Advisory | https://github.com/advisories |
| NVD | https://nvd.nist.gov/ |
| CISA KEV | https://www.cisa.gov/known-exploited-vulnerabilities-catalog |

