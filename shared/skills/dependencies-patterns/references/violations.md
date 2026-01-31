# Extended Violation Examples

Detailed examples of dependency violations by category.

---

## Security Vulnerability Violations

### Known CVEs - Extended Examples

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

### Vulnerable Version Ranges

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

### Malicious Package Red Flags

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

---

## Version Management Violations

### Unpinned Versions

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

### Missing Lockfile

```bash
# PROBLEM: No lockfile committed
.gitignore:
package-lock.json  # Don't ignore this!
yarn.lock          # Don't ignore this!

# SOLUTION: Commit lockfile
git add package-lock.json  # or yarn.lock
git commit -m "Add lockfile for reproducible builds"
```

### Dependency Conflicts

```bash
# PROBLEM: Multiple versions of same package
npm ls react
# my-app
# +-- react@18.2.0
# \-- some-library
#     \-- react@17.0.2  # Conflict!

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

---

## Dependency Health Violations

### Outdated Packages

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

### Unused Dependencies

```bash
# Find unused dependencies
npx depcheck

# Unused dependencies:
# * moment           # Listed but never imported
# * lodash           # Listed but never imported

# SOLUTION: Remove unused
npm uninstall moment lodash
```

### Unnecessary Heavy Dependencies

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

---

## License Violations

### Incompatible Licenses

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

### Missing License

```bash
# Find packages without license
npx license-checker --onlyunknown

# Packages with unknown license:
# - internal-company-pkg@1.0.0  # Verify this is intentional
```

---

## Supply Chain Violations

### Transitive Dependencies

```bash
# Check dependency tree depth
npm ls --all | wc -l
# If > 1000, high supply chain risk

# Audit transitive deps
npm audit --all

# SOLUTION: Minimize dependencies, audit regularly
```

### Maintainer Concerns

```json
// RED FLAGS:
// - Package with 1 maintainer who's inactive
// - No recent releases but many open issues
// - Repository archived or deleted
// - Maintainer account compromised (check news)

// Check package health:
// https://snyk.io/advisor/npm-package/{package-name}
```
