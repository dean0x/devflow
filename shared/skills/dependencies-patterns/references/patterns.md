# Correct Dependency Patterns

Best practices for dependency management.

---

## Secure Version Pinning

### Exact Pinning (Most Secure)

```json
{
  "dependencies": {
    "express": "4.18.2",
    "lodash": "4.17.21"
  }
}
```

**When to use**: Production apps, security-critical dependencies

### Caret with Lockfile (Balanced)

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "typescript": "^5.3.0"
  }
}
```

**When to use**: Most projects, allows patch updates

### Tilde for Patch-Only (Conservative)

```json
{
  "dependencies": {
    "critical-lib": "~1.2.3"
  }
}
```

**When to use**: When you need bug fixes but not new features

---

## Lockfile Management

### Commit Lockfile

```bash
# Always commit your lockfile
git add package-lock.json
git add yarn.lock
git add pnpm-lock.yaml

# CI should use frozen installs
npm ci          # Not npm install
yarn --frozen-lockfile
pnpm install --frozen-lockfile
```

### Renovate/Dependabot Config

```json
// renovate.json
{
  "extends": ["config:base"],
  "schedule": ["before 9am on Monday"],
  "packageRules": [
    {
      "matchPackagePatterns": ["*"],
      "groupName": "all dependencies",
      "groupSlug": "all"
    },
    {
      "matchUpdateTypes": ["patch", "minor"],
      "automerge": true
    }
  ]
}
```

---

## Dependency Auditing

### Regular Audit Workflow

```bash
# Weekly audit
npm audit

# Fix automatically what's safe
npm audit fix

# Manual review for breaking changes
npm audit fix --dry-run
```

### Pre-commit Hook

```json
// package.json
{
  "scripts": {
    "preinstall": "npm audit --audit-level=high"
  }
}
```

### CI Pipeline Check

```yaml
# GitHub Actions
- name: Security audit
  run: npm audit --audit-level=high
```

---

## Minimal Dependencies

### Native Alternatives

| Instead of | Use Native |
|------------|------------|
| `moment` | `Intl.DateTimeFormat`, `date-fns` |
| `lodash` (full) | Native methods, `lodash-es` (tree-shake) |
| `left-pad` | `String.prototype.padStart()` |
| `is-array` | `Array.isArray()` |
| `is-number` | `typeof x === 'number'` |

### Tree-Shaking Imports

```typescript
// AVOID: Imports entire library
import _ from 'lodash';
_.debounce(fn, 100);

// BETTER: Import only what you need
import debounce from 'lodash/debounce';
debounce(fn, 100);

// BEST: Use ESM for tree-shaking
import { debounce } from 'lodash-es';
debounce(fn, 100);
```

---

## License Compliance

### License Whitelist

```json
// .licensrc.json
{
  "whitelist": [
    "MIT",
    "ISC",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "Apache-2.0"
  ],
  "blacklist": [
    "GPL-3.0",
    "AGPL-3.0"
  ]
}
```

### CI License Check

```bash
# Check licenses in CI
npx license-checker --failOn "GPL-3.0;AGPL-3.0"
```

---

## Supply Chain Security

### Package Verification

```bash
# Verify package integrity
npm pack <package-name> --dry-run

# Check package signatures (npm v8.12+)
npm audit signatures

# Review before install
npm view <package-name>
```

### Minimal Attack Surface

```json
// Use optional dependencies wisely
{
  "dependencies": {
    "core-lib": "^1.0.0"
  },
  "optionalDependencies": {
    "platform-specific": "^1.0.0"
  },
  "devDependencies": {
    "test-utils": "^1.0.0"
  }
}
```

### Dependency Review for PRs

```yaml
# GitHub Actions - dependency review
- name: Dependency Review
  uses: actions/dependency-review-action@v3
  with:
    fail-on-severity: high
    deny-licenses: GPL-3.0, AGPL-3.0
```
