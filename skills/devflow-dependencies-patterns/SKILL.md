---
name: devflow-dependencies-patterns
description: Dependency analysis for Reviewer agent. Loaded when focus=dependencies. Detects CVEs, outdated packages, license issues.
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

---

## Dependency Categories

### 1. Security Vulnerabilities

Known CVEs, vulnerable version ranges, malicious packages.

**Violation**: Wide version range includes vulnerable versions
```json
{ "lodash": "^4.0.0" }  // Includes vulnerable 4.17.0-4.17.20
```

**Correct**: Pin to safe version
```json
{ "lodash": "^4.17.21" }  // First safe version
```

### 2. Version Management

Unpinned versions, missing lockfiles, dependency conflicts.

**Violation**: Unpinned allows any version
```json
{ "express": "*", "lodash": "latest" }
```

**Correct**: Pin with lockfile
```json
{ "express": "^4.18.2" }  // + committed lockfile
```

### 3. Dependency Health

Outdated packages, unused dependencies, unnecessary heavy packages.

**Violation**: Heavy dependency for simple task
```json
{ "moment": "^2.29.4" }  // 300KB for date formatting
```

**Correct**: Use native or lighter alternative
```typescript
new Date().toLocaleDateString();  // Native
```

### 4. License Issues

Incompatible licenses (GPL in MIT project), missing licenses.

**Violation**: GPL in proprietary code
```bash
# GPL-3.0: some-package  # Requires your code to be GPL too!
```

**Correct**: Use permissive licenses only
```bash
npx license-checker --failOn "GPL-3.0;AGPL-3.0"
```

### 5. Supply Chain Risks

Deep transitive dependencies, unmaintained packages, typosquatting.

**Violation**: Typosquatted package
```json
{ "loadsh": "1.0.0" }  // Typosquat of "lodash"
```

**Correct**: Verify package authenticity
```bash
npm view loadsh  # Check downloads, repo, maintainers
```

---

## Extended References

For extended examples and detection commands, see:
- `references/violations.md` - Extended violation examples by category
- `references/patterns.md` - Correct dependency management patterns
- `references/detection.md` - Detection commands and CI integration

---

## Severity Guidelines

| Severity | Indicators |
|----------|------------|
| **CRITICAL** | Known exploited CVEs (CISA KEV), confirmed malicious packages, typosquats |
| **HIGH** | High severity CVEs, unmaintained packages, GPL in proprietary code |
| **MEDIUM** | Medium CVEs, significantly outdated, wide version ranges, missing lockfile |
| **LOW** | Unused dependencies, lighter alternatives available, minor version behind |

---

## Dependency Review Checklist

Before approving dependency changes:

- [ ] No known CVEs in added packages
- [ ] Version ranges appropriate (not too wide)
- [ ] Lockfile updated and committed
- [ ] Package actively maintained
- [ ] License compatible
- [ ] Package from verified publisher
- [ ] Transitive dependencies reviewed
- [ ] Package name verified (not typosquat)
- [ ] Bundle size impact considered
- [ ] Native alternatives considered

---

## Common Vulnerability Sources

| Registry | URL |
|----------|-----|
| npm Advisory | https://www.npmjs.com/advisories |
| Snyk Vuln DB | https://snyk.io/vuln |
| GitHub Advisory | https://github.com/advisories |
| NVD | https://nvd.nist.gov/ |
| CISA KEV | https://www.cisa.gov/known-exploited-vulnerabilities-catalog |
