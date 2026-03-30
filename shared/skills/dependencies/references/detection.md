# Detection Patterns

Commands and patterns for detecting dependency issues.

---

## Vulnerability Detection

```bash
# npm audit (detailed)
npm audit
npm audit --json | jq '.vulnerabilities | keys'

# Yarn audit
yarn audit
yarn audit --json

# pnpm audit
pnpm audit
pnpm audit --json

# Snyk (more comprehensive)
npx snyk test
npx snyk monitor  # Continuous monitoring
```

---

## Outdated Package Detection

```bash
# List outdated packages
npm outdated
npm outdated --json

# Yarn
yarn outdated

# pnpm
pnpm outdated

# Interactive update
npx npm-check -u
```

---

## Unused Dependency Detection

```bash
# depcheck (most comprehensive)
npx depcheck
npx depcheck --json

# Alternatives
npx unimported
npx knip
```

---

## Lockfile Verification

```bash
# Check lockfile exists
[ -f package-lock.json ] && echo "npm lockfile found"
[ -f yarn.lock ] && echo "yarn lockfile found"
[ -f pnpm-lock.yaml ] && echo "pnpm lockfile found"

# Check if lockfile is committed
git ls-files package-lock.json yarn.lock pnpm-lock.yaml

# Verify lockfile integrity
npm ci --dry-run
```

---

## Version Range Detection

```bash
# Find problematic version ranges
grep -E '"[*~^]|": "latest|": ""' package.json

# Find exact pins
grep -E '": "[0-9]+\.[0-9]+\.[0-9]+"' package.json

# Count dependencies
jq '.dependencies | length' package.json
jq '.devDependencies | length' package.json
```

---

## License Detection

```bash
# List all licenses
npx license-checker --summary

# Find specific license types
npx license-checker --onlyAllow "MIT;ISC;BSD-2-Clause;BSD-3-Clause;Apache-2.0"

# Find unknown licenses
npx license-checker --onlyunknown

# Fail on problematic licenses
npx license-checker --failOn "GPL-3.0;AGPL-3.0"
```

---

## Supply Chain Analysis

```bash
# Dependency tree depth
npm ls --all | wc -l

# Flat dependency list
npm ls --all --json | jq '.dependencies | keys | length'

# Find duplicate packages
npm dedupe --dry-run

# Package metadata
npm view <package-name>
npm view <package-name> maintainers
npm view <package-name> time
```

---

## Typosquat Detection

```bash
# Common typosquats to check
# lodash vs loadsh, lodasg
# express vs exress, expres
# react vs reakt, reactt

# Manual check
npm view <suspicious-package>
# Look for:
# - Low weekly downloads
# - No or suspicious repository
# - Recent creation date
# - Unknown maintainer
```

---

## CI Integration Commands

```bash
# Combined audit script
audit_deps() {
  echo "=== Checking vulnerabilities ==="
  npm audit --audit-level=high || exit 1

  echo "=== Checking lockfile ==="
  [ -f package-lock.json ] || [ -f yarn.lock ] || exit 1

  echo "=== Checking licenses ==="
  npx license-checker --failOn "GPL-3.0;AGPL-3.0" || exit 1

  echo "=== All checks passed ==="
}
```

---

## Quick Reference

| Check | Command |
|-------|---------|
| Vulnerabilities | `npm audit` |
| Outdated | `npm outdated` |
| Unused | `npx depcheck` |
| Licenses | `npx license-checker` |
| Tree depth | `npm ls --all \| wc -l` |
| Lockfile | `ls package-lock.json yarn.lock 2>/dev/null` |
