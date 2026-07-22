# HIPAA — Code-Level Checks

**Regulation**: Health Insurance Portability and Accountability Act — 45 CFR Part 164

## The 18 PHI Identifiers

Any field containing one of these transforms ordinary data into PHI requiring full safeguards:

Names, geographic data below state level, dates (except year) for individuals, phone numbers, fax numbers, email addresses, SSNs, medical record numbers, health plan beneficiary numbers, account numbers, certificate/license numbers, vehicle identifiers, device identifiers, URLs, IPs, biometric identifiers, full-face photographs, any other unique identifying number.

**Pattern**: grep for field names matching `name|dob|birth|ssn|mrn|phone|email|address|zip|ip_addr` in models that live in health-related services.

## §164.312 — Technical Safeguards

| Safeguard | §164.312 ref | Code obligation |
|-----------|-------------|----------------|
| Access control | (a)(1) | Unique user IDs; no shared credentials; role-based access |
| Audit controls | (b) | Log all PHI access: user, timestamp, record touched, action |
| Integrity | (c)(1) | Checksums or MACs on PHI at rest; detect tampering |
| Transmission security | (e)(1) | TLS 1.2+ for all PHI in transit; no plaintext channels |

## Minimum Necessary Principle (§164.502(b))

Code reviews must check:
- API responses do not include PHI fields not needed by the caller
- Query projections are explicit (`SELECT mrn, dob` not `SELECT *`)
- Logs contain event metadata, never PHI content

## Retention

HIPAA §164.530(j) requires covered entities to retain required documentation (policies, procedures, and records mandated by the rules) for **6 years** from creation or last effective date. HIPAA sets **no federal PHI retention period** — state law governs how long medical records must be kept. Code must:
- Store a `retainUntil` timestamp on every PHI record (6 years is a conservative default covering required documentation; verify applicable state law for medical records)
- Prevent deletion before the retention period unless a HIPAA-compliant destruction process is followed

## Business Associate Agreements (BAA)

Third-party services receiving PHI must have a BAA on file. Code review flag: any external HTTP call that includes PHI fields in the request body or query string.

## Common Code-Level Gaps

- PHI included in exception messages caught by logging middleware
- Audit log records missing the `purpose` or `user_id` field
- Backup files stored in unencrypted S3 buckets or local dev volumes
- PHI columns returned in paginated list endpoints consumed by non-clinical roles
