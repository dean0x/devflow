# Security Violations Index

This skill organizes violations by security domain. See the domain-specific files for detailed examples:

## Domain Files

| File | Domain | Key Violations |
|------|--------|----------------|
| [injection.md](injection.md) | Input Validation | SQL injection, NoSQL injection, command injection, path traversal, LDAP injection, template injection |
| [auth.md](auth.md) | Authentication | Weak passwords, session fixation, JWT misuse, broken access control, privilege escalation |
| [crypto.md](crypto.md) | Cryptography | Hardcoded secrets, weak algorithms, improper key management, timing attacks |

## Quick Reference

For detection patterns and grep commands, see [detection.md](detection.md).
