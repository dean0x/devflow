# Documentation Framework Violations

Common violations of documentation conventions:

## Violations

| Violation | Example | Fix |
|-----------|---------|-----|
| Wrong timestamp format | `2025-1-5` | Use `YYYY-MM-DD_HHMM` (e.g., `2025-01-05_1430`) |
| Unsanitized branch slug | `feature/auth` | Replace `/` with `-`: `feature-auth` |
| Wrong directory | Files outside `.docs/` | Use standard `.docs/` structure |
| Missing INDEX.md | Status files without index | Create INDEX.md for directories |
| Uppercase artifacts | `status-2025-01-05.md` | Use UPPERCASE only for special indexes |

## Quick Reference

See [templates.md](templates.md) for correct templates and [examples.md](examples.md) for naming examples.
