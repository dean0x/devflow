# SOC 2 — Code-Level Checks

**Standard**: AICPA Trust Services Criteria (TSC) — Security, Availability, Confidentiality

## Relevant Trust Services Criteria

### CC6 — Logical and Physical Access Controls

| Criterion | Code obligation |
|-----------|----------------|
| CC6.1 | Classify data at rest; encrypt sensitive/confidential data stores |
| CC6.3 | Role-based access; enforce at API layer — never rely on UI gating alone |
| CC6.5 | Remove access when employment or role changes (offboarding triggers) |
| CC6.6 | Restrict external network access; firewall/SG rules scoped to required IPs |
| CC6.7 | Encrypt regulated data in transit; no plaintext transmission channels |

### CC7 — System Operations

| Criterion | Code obligation |
|-----------|----------------|
| CC7.2 | Detect and log anomalies: failed auth, privilege escalation, bulk exports |
| CC7.3 | Documented incident response procedures reachable from the code repo |

### CC8 — Change Management

| Criterion | Code obligation |
|-----------|----------------|
| CC8.1 | All production changes via version-controlled PR; no direct console/DB edits |

## Change Management Pattern (CC8.1)

```typescript
// Every schema migration must be code-reviewed and deployed via pipeline
// Direct DB modifications that bypass migrations violate CC8.1
// Pattern: version-controlled migration + PR + CI gate before merge
```

## Audit Log Requirements (CC7.2)

Each security-relevant event must include:
- `actor` — authenticated user or service account ID (never anonymous)
- `action` — what was attempted and whether it succeeded
- `resource` — the target object and its classification
- `timestamp` — UTC ISO-8601; clock source must be NTP-synchronized
- `purpose` — business justification for sensitive operations

## Common Code-Level Gaps

- Audit events missing `actor` field (logged before auth middleware runs)
- Bulk data export endpoints with no rate limit or alert threshold (CC7.2)
- Shared service-account credentials used across environments (CC6.1, CC6.5)
- Feature flags that can disable security controls in production (CC6.3)
- Database migrations applied outside the CI/CD pipeline (CC8.1)
