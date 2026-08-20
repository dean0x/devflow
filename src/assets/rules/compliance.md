---
paths: []
---
# Compliance

**No regulated data leaves a controlled path — classify, minimize, encrypt, and audit by default.**

- Never write PII, PHI, payment data, or secrets to logs, error messages, or analytics events
- State-changing operations on regulated data get an append-only audit entry: actor, timestamp, action, purpose
- Encrypt regulated data in transit (TLS 1.2+) and at rest — no plaintext exports, dumps, or backups
- Collect the minimum: every stored field needs a purpose, a retention period, and a deletion path
- Least privilege and segregation of duties — no shared accounts, no self-approval of changes
- Active frameworks: ${DEVFLOW_COMPLIANCE_FRAMEWORKS} — their controls are binding.
