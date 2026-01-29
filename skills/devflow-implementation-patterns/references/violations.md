# Implementation Violations Index

This skill organizes violations by implementation domain. See the domain-specific files for detailed examples:

## Domain Files

| File | Domain | Key Violations |
|------|--------|----------------|
| [crud.md](crud.md) | CRUD Operations | Missing validation, inconsistent error handling, N+1 queries |
| [api.md](api.md) | API Endpoints | Missing auth checks, inconsistent responses, poor error messages |
| [events.md](events.md) | Event Handling | Lost events, race conditions, missing error handling |
| [config.md](config.md) | Configuration | Hardcoded values, missing validation, insecure defaults |
| [logging.md](logging.md) | Logging | Missing context, sensitive data exposure, inconsistent levels |

## Quick Reference

Each domain file contains both violations (❌) and correct patterns (✅).
