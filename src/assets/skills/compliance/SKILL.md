---
name: compliance
description: This skill should be used when reviewing code that handles PII, payments or health data.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Compliance Patterns

Regulatory compliance review for code that touches regulated data ${DEVFLOW_COMPLIANCE_SCOPE}. Use alongside `devflow:security` for complete coverage.

## Iron Law

> **IF IT TOUCHES REGULATED DATA: CLASSIFY IT, MINIMIZE IT, ENCRYPT IT, AUDIT IT**
>
> Regulated data crossing a code path without classification, minimization, encryption,
> or an audit trail is a compliance gap — regardless of framework. No exceptions.

## Active Frameworks

${DEVFLOW_COMPLIANCE_ACTIVE}

## Scope Boundary

Compliance covers regulatory-specific gaps: retention, erasure/data-subject rights, audit-trail completeness (actor/purpose fields), segregation of duties, framework mapping, IaC exposure. Do not re-raise security lens findings (injection, secret handling, authN/Z) — reference those via framework mapping only.

**Lens only.** This skill shapes what a compliance review looks for in the diff or design. It does not decide how much evidence a change must carry: tracker links, test plans, approvals and release traces follow the repository's evidence policy. Never report a missing ticket, test plan or approval as a compliance finding.

## Clean-Report Contract

If the diff/design has no regulated-data surface (no PII/PHI/payment fields, no sensitive data in logs, no IaC, no auth/audit/retention changes) → emit zero findings with a one-line "no compliance-relevant surface detected" note. Never manufacture findings.

## Control Categories

1. **Data Classification & Minimization**: store the minimum the purpose needs (the last 4 digits, not the full SSN). Every stored field has a declared purpose and retention period.
2. **Sensitive Data in Logs & Errors**: no PII/PHI/payment data in logs, errors or analytics events. Omit or mask regulated fields.
3. **Encryption In Transit & At Rest**: encrypt regulated data before it is written, and enforce TLS 1.2+ in transit.
4. **Audit Trails & Change Traceability**: every regulated mutation writes an append-only audit entry (actor, action, target, purpose, timestamp) before the state change. Segregation of duties: the actor is not the approver, and no one self-approves a regulated state change.
5. **Retention & Erasure**: every stored regulated field has a retention limit and a deletion path, registered at write time.
6. **Environments & IaC**: no public buckets or security groups, no unencrypted volumes or stores, no wildcard IAM, and access logging on.

## Severity

| Level | Criteria |
|-------|----------|
| **CRITICAL** | Plaintext regulated data exposed; public IaC exposure of regulated stores |
| **HIGH** | Missing audit trail on regulated mutations; PII in logs or errors |
| **MEDIUM** | Missing retention/erasure paths; weak traceability (no actor/purpose) |
| **LOW** | Documentation/annotation gaps |

${DEVFLOW_COMPLIANCE_MAPPING}

## Checklist

- [ ] Frameworks in force are the ids your prompt names; their controls applied
- [ ] Each control category above checked against the diff or design
${DEVFLOW_COMPLIANCE_CHECKLIST}

## Extended References

| Reference | Contents |
|-----------|---------|
| `references/detection.md` | Grep patterns: PII field names, logging sinks, crypto misuse; IaC globs |
| `references/sources.md` | NIST SSDF SP 800-218, OWASP ASVS 5.0, GDPR, HIPAA, PCI DSS v4.0.1, AICPA TSC, ISO/IEC 27001, SOX |
${DEVFLOW_COMPLIANCE_REFERENCES}
