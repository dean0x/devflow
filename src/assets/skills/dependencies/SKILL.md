---
name: dependencies
description: This skill should be used when reviewing dependency or lock file changes.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Dependencies Patterns

Detection patterns for dependency management and supply-chain review. Use with `devflow:review-methodology`.

## Iron Law

> **Every dependency is an attack surface.**
>
> Each package you add is code you didn't write but must trust. Minimize dependencies.
> Pin versions. Audit regularly. A single compromised transitive dependency can compromise
> your entire application. "It's a popular package" is not a security review.

## Dependency Categories

1. **Security vulnerabilities**: known CVEs in added packages, version ranges that include vulnerable versions (`"lodash": "^4.0.0"` includes 4.17.0-4.17.20), malicious packages.
2. **Version management**: unpinned versions (`"*"`, `"latest"`), ranges too wide, lockfile missing or not updated, dependency conflicts.
3. **Dependency health**: unmaintained or outdated packages, unused dependencies, heavy packages for simple tasks (`moment` for date formatting) where a native or lighter alternative exists, bundle size impact.
4. **License issues**: incompatible licenses (GPL in MIT or proprietary code), missing licenses.
5. **Supply chain risks**: deep transitive dependencies, unverified publishers, typosquatting (`loadsh` for `lodash`).

## Extended References

- `references/violations.md` - Extended violation examples by category
- `references/patterns.md` - Correct dependency management patterns
- `references/detection.md` - Detection commands and CI integration

## Severity Guidelines

| Severity | Indicators |
|----------|------------|
| **CRITICAL** | Known exploited CVEs (CISA KEV), confirmed malicious packages, typosquats |
| **HIGH** | High severity CVEs, unmaintained packages, GPL in proprietary code |
| **MEDIUM** | Medium CVEs, significantly outdated, wide version ranges, missing lockfile |
| **LOW** | Unused dependencies, lighter alternatives available, minor version behind |
