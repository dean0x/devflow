---
name: compliance
description: This skill should be used when reviewing code handling PII, payment data, health records, audit logs, data retention, or IaC under GDPR, HIPAA, PCI DSS, SOC 2, ISO 27001, or SOX.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Compliance Patterns

<!-- Composition tokens: ${DEVFLOW_COMPLIANCE_SCOPE} ${DEVFLOW_COMPLIANCE_ACTIVE} ${DEVFLOW_COMPLIANCE_MAPPING} ${DEVFLOW_COMPLIANCE_CHECKLIST} ${DEVFLOW_COMPLIANCE_REFERENCES}
     Dynamic sections compose from src/assets/skills/compliance/frameworks/{id}/fragment.md at install time.
     Shadow SKILL.md without these tokens passes through unchanged (C1). -->

Regulatory compliance review for code that touches regulated data ${DEVFLOW_COMPLIANCE_SCOPE}. Use alongside `devflow:security` for complete coverage.

## Iron Law

> **IF IT TOUCHES REGULATED DATA: CLASSIFY IT, MINIMIZE IT, ENCRYPT IT, AUDIT IT**
>
> Regulated data crossing a code path without classification, minimization, encryption,
> or an audit trail is a compliance gap — regardless of framework. No exceptions.

## Active Frameworks

${DEVFLOW_COMPLIANCE_ACTIVE}

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
| **LOW** | No active framework reference files installed; documentation/annotation gaps |

${DEVFLOW_COMPLIANCE_MAPPING}

## Checklist

- [ ] Active frameworks identified from installed `references/{id}.md` files; controls applied
- [ ] No PII/PHI/payment data in logs, errors, or analytics events
- [ ] Regulated data encrypted in transit (TLS 1.2+) and at rest
- [ ] Every regulated mutation has an append-only audit entry (actor, purpose, timestamp)
- [ ] All stored fields have a declared purpose, retention period, and deletion path
- [ ] Segregation of duties enforced — no self-approval of regulated state changes
- [ ] IaC scanned: no public buckets/SGs, no unencrypted volumes, no wildcard IAM
${DEVFLOW_COMPLIANCE_CHECKLIST}

## Extended References

| Reference | Contents |
|-----------|---------|
| `references/detection.md` | Grep patterns: PII field names, logging sinks, crypto misuse; IaC globs |
| `references/sources.md` | NIST SSDF SP 800-218, OWASP ASVS 5.0, GDPR, HIPAA, PCI DSS v4.0.1, AICPA TSC, ISO/IEC 27001, SOX |
${DEVFLOW_COMPLIANCE_REFERENCES}
