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
<!-- Stamped at install time: ${DEVFLOW_COMPLIANCE_RULE_BULLETS} per-framework bullets; ${DEVFLOW_COMPLIANCE_FRAMEWORKS} active-framework clause. Keep these placeholders so `devflow compliance --set` keeps the rule current. Remove them and your shadow owns those lines entirely. -->
${DEVFLOW_COMPLIANCE_RULE_BULLETS}
- ${DEVFLOW_COMPLIANCE_FRAMEWORKS}
