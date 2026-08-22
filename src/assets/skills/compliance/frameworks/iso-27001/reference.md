# ISO/IEC 27001 — Code-Level Checks

**Standard**: ISO/IEC 27001:2022 Annex A — Information Security Controls

## Relevant Annex A Controls as Code Checks

### A.5 — Organizational Controls (Information Classification & Handling)

| Control | Code obligation |
|---------|----------------|
| A.5.12 Classification of information | Annotate data models with classification level (public / internal / confidential / restricted) |
| A.5.10 Acceptable use of information | Confidential/restricted data must be encrypted at rest and in transit |

### A.8 — Technological Controls (Logging, Monitoring, Cryptography, Secure Development)

| Control | Code obligation |
|---------|----------------|
| A.8.10 Information deletion | Secure deletion procedures for regulated data; overwrite or cryptographic erasure |
| A.8.15 Logging | Log privileged access, authentication events, and data access to regulated stores; logs must be append-only or write to a tamper-resistant sink; no log deletion by app code |
| A.8.16 Monitoring activities | Monitor and alert on anomalous access patterns and privilege escalation |
| A.8.17 Clock synchronization | All log timestamps from NTP-synchronized source; UTC ISO-8601 format |
| A.8.24 Use of cryptography | Approved algorithms only (AES-256-GCM, RSA-4096+, ECDSA-P256+); no MD5/SHA-1 for security |
| A.8.25 Secure development life cycle | Security review gates in the CI/CD pipeline |
| A.8.26 Application security requirements | TLS enforced; no HTTP fallback for services handling regulated data |
| A.8.27 Secure system architecture and engineering principles | Defense in depth; fail secure; least privilege |
| A.8.29 Security testing in development and acceptance | Security tests in CI; dependency scanning; SAST for confidential-data code paths |

## Classification Annotation Pattern

```typescript
/** @classification confidential — contains employee PII */
interface EmployeeRecord {
  id: string;
  name: string;       // PII
  nationalId: string; // PII — restricted
  department: string; // internal
}
```

## Common Code-Level Gaps

- No data classification in model definitions (A.5.12)
- Logs written to the same sink as application output — no tamper protection (A.8.15)
- Development environment using production data without de-identification (A.8.29)
- Deprecated cryptographic primitives (MD5, SHA-1) used for data integrity (A.8.24)
