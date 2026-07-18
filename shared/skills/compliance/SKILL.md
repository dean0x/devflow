---
name: compliance
description: This skill should be used when reviewing code handling PII, payment data, health records, audit logs, data retention, or IaC under GDPR, HIPAA, PCI DSS, or SOC 2.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Compliance Patterns

Regulatory compliance review for code that touches regulated data. Use alongside `devflow:security` for complete coverage.

## Iron Law

> **IF IT TOUCHES REGULATED DATA: CLASSIFY IT, MINIMIZE IT, ENCRYPT IT, AUDIT IT**
>
> Regulated data crossing a code path without classification, minimization, encryption,
> or an audit trail is a compliance gap — regardless of framework. No exceptions.

## Project Framework Declaration

Read the project CLAUDE.md `## Compliance` section before reviewing:
- `Frameworks: GDPR, SOC 2` → apply generic controls + load `references/{framework}.md` (case-insensitive)
- `Frameworks: none` → all compliance integrations disabled for this project; skip review
- Absent → generic controls only; suggest declaring (LOW, at most once) when regulated data is clearly present
- Unknown framework name → generic controls + explicit coverage-gap note; never fabricate framework specifics

## Scope Boundary

Compliance covers regulatory-specific gaps: retention, erasure/data-subject rights, audit-trail completeness (actor/purpose fields), segregation of duties, framework mapping, IaC exposure. Do NOT re-raise security lens findings (injection, secret handling, authN/Z) — reference those via framework mapping only.

## Clean-Report Contract

If the diff/design has no regulated-data surface (no PII/PHI/payment fields, no sensitive data in logs, no IaC, no auth/audit/retention changes) → emit zero findings with a one-line "no compliance-relevant surface detected" note. Never manufacture findings.

## Control Categories

### 1. Data Classification & Minimization
```typescript
// VULNERABLE: full SSN stored when only last-4 needed
user.ssn = req.body.ssn;
// COMPLIANT: store minimum; annotate purpose + retention
user.ssnLast4 = req.body.ssn.slice(-4); // retention: 90d for verification
```

### 2. Sensitive Data in Logs & Errors
```typescript
// VULNERABLE: PII in structured log
logger.info('login', { email, password, creditCard });
// COMPLIANT: omit or mask regulated fields
logger.info('login', { userId, ip });
```

### 3. Encryption In Transit & At Rest
```typescript
// VULNERABLE: plaintext PHI written to disk
fs.writeFileSync('/data/patients.json', JSON.stringify(records));
// COMPLIANT: encrypt before write; TLS enforced at transport
await vault.encrypt(records, { key: 'phi-key', algo: 'AES-256-GCM' });
```

### 4. Audit Trails & Change Traceability
```typescript
// VULNERABLE: mutation with no audit entry; no segregation of duties
await db.update('orders', { status: 'refunded' }, { id });
// COMPLIANT: append-only audit before state change; actor ≠ approver
await audit.append({ actor, action: 'refund', target: id, purpose, ts: Date.now() });
await db.update('orders', { status: 'refunded' }, { id });
```

### 5. Retention & Erasure
```typescript
// VULNERABLE: PII stored with no deletion path
await db.insert('user_pii', { userId, ssn, email });
// COMPLIANT: TTL field + erasure handler registered at write time
await db.insert('user_pii', { userId, ssn, email, retainUntil: addDays(90) });
await erasure.register(userId, ['user_pii']);
```

### 6. Environments & IaC
```hcl
# VULNERABLE: public bucket, no encryption, no access logging
resource "aws_s3_bucket" "data" { acl = "public-read" }
# COMPLIANT: private, encrypted, logging enabled
resource "aws_s3_bucket_acl" "data" { acl = "private" }
resource "aws_s3_bucket_server_side_encryption_configuration" "data" {
  rule { apply_server_side_encryption_by_default { sse_algorithm = "AES256" } }
}
resource "aws_s3_bucket_logging" "data" { target_bucket = var.audit_bucket_id }
```

---

## Severity

| Level | Criteria |
|-------|----------|
| **CRITICAL** | Plaintext regulated data exposed; public IaC exposure of regulated stores |
| **HIGH** | Missing audit trail on regulated mutations; PII in logs or errors |
| **MEDIUM** | Missing retention/erasure paths; weak traceability (no actor/purpose) |
| **LOW** | Missing framework declaration; documentation/annotation gaps |

## Framework Mapping

| Control | SOC 2 | PCI DSS | GDPR | HIPAA | ISO 27001 | SOX |
|---------|-------|---------|------|-------|-----------|-----|
| Data Classification | CC6.1 | Req 3 | Art. 25 | §164.514 | A.8.2 | — |
| Sensitive Data in Logs | CC6.7 | Req 3.4 | Art. 32 | §164.312(b) | A.12.4 | ITGC |
| Encryption | CC6.1 | Req 3/4 | Art. 32 | §164.312(a)(2) | A.10.1 | — |
| Audit Trails | CC7.2 | Req 10.x | Art. 30/32 | §164.312(b) | A.12.4 | ITGC |
| Retention & Erasure | CC6.5 | Req 3.1 | Art. 17 | §164.530(j) | A.8.3 | SOX §802 |
| IaC / Env Controls | CC6.6 | Req 1/6.x | Art. 25 | §164.312(a) | A.14.2 | ITGC |

## Checklist

- [ ] CLAUDE.md `## Compliance` section read; declared frameworks applied
- [ ] No PII/PHI/payment data in logs, errors, or analytics events
- [ ] Regulated data encrypted in transit (TLS 1.2+) and at rest
- [ ] Every regulated mutation has an append-only audit entry (actor, purpose, timestamp)
- [ ] All stored fields have a declared purpose, retention period, and deletion path
- [ ] Segregation of duties enforced — no self-approval of regulated state changes
- [ ] IaC scanned: no public buckets/SGs, no unencrypted volumes, no wildcard IAM
- [ ] Data-subject rights handlers present (erasure, portability) when GDPR is in scope

## Extended References

| Reference | Contents |
|-----------|---------|
| `references/gdpr.md` | Data-subject rights endpoints, Art. 25/30/32/33 as code-level checks |
| `references/hipaa.md` | PHI/18 identifiers, §164.312 safeguards, minimum-necessary, 6-year retention |
| `references/pci-dss.md` | Scope minimization, no CVV/track data, Req 3/6.x/10, tokenization, 3-year retention |
| `references/soc2.md` | CC6/CC7/CC8.1 trust-services criteria expressed as code checks |
| `references/iso-27001.md` | Annex A: A.8 data handling, A.12.4 logging, A.14.2 secure dev |
| `references/sox.md` | ITGC change control, segregation of duties, 7-year retention, audit integrity |
| `references/detection.md` | Grep patterns: PII field names, logging sinks, crypto misuse; IaC globs |
| `references/sources.md` | NIST SSDF SP 800-218, OWASP ASVS 5.0, GDPR, HIPAA, PCI DSS v4.0, AICPA TSC, ISO/IEC 27001, SOX |

> **Note**: This skill supports — and does not replace — your organization's compliance program. Not legal advice.
