# Self-Review Violations

Common self-review anti-patterns:

## Violations

| Violation | Problem | Fix |
|-----------|---------|-----|
| Skipping pillars | Incomplete review | Check all 9 pillars |
| Ignoring P0/P1 issues | Returning broken code | Fix before returning |
| Surface-level review | Missing deep issues | Review each pillar thoroughly |
| No evidence | Unverifiable claims | Reference specific code |
| Deferring critical fixes | Technical debt | Fix CRITICAL/HIGH immediately |

## 9-Pillar Coverage

Each pillar must be explicitly checked:

1. **Design** - Architecture, patterns, SOLID principles
2. **Functionality** - Correctness, edge cases, requirements
3. **Security** - Input validation, auth, data protection
4. **Complexity** - Readability, maintainability, simplicity
5. **Error Handling** - Result types, recovery, logging
6. **Tests** - Coverage, quality, behavior validation
7. **Naming** - Clarity, consistency, domain alignment
8. **Consistency** - Pattern adherence, style matching
9. **Documentation** - Comments, JSDoc, README

## Quick Reference

See [pillars.md](pillars.md) for detailed pillar guidance and [report-template.md](report-template.md) for self-review format.
