# SOX — Code-Level Checks

**Law**: Sarbanes-Oxley Act of 2002 — §404 (Internal Controls) and §802 (Records Retention)

SOX §404 applies to internal controls over financial reporting (ICFR). Relevant code areas: financial data stores, general ledger integrations, ERP connectors, billing systems, and the CI/CD change-management pipeline that deploys them.

## ITGC — IT General Controls

IT General Controls are the primary SOX intersection with software engineering. Key domains:

### Change Management (CC8.1 in SOC 2 terms; ITGC-CM)

All changes to financial systems must follow:
1. Documented change request with business justification
2. Code review by someone other than the author
3. Testing in a non-production environment
4. Approval by an authorized approver (segregation of duties)
5. Deployment via the automated pipeline — no manual console/DB changes

**Code review flag**: any migration, schema change, or configuration update to a financial system that lacks a PR and reviewer.

### Segregation of Duties (ITGC-SOD)

- The developer who implements a financial feature must not be the sole approver of their own change
- Service accounts used to process financial transactions must not have the ability to modify their own audit logs
- No single role can initiate AND approve a financial transaction

### Access Management (ITGC-AM)

- Access to financial system databases must be role-based; no shared credentials
- Privileged access (e.g., direct DB write to a ledger table) requires just-in-time approval and audit logging
- Offboarding must revoke financial system access within one business day

## §802 — Records Retention

Financial records must be retained for **7 years**. Code obligations:
- `retainUntil` on financial records = created + 7 years
- Deletion of financial records before retention period is a criminal violation; implement hard guards
- Audit logs covering financial transactions are themselves financial records — same 7-year rule

```typescript
// SOX §802: financial records retained for 7 years; hard guard against early deletion
async function deleteRecord(id: string): Promise<Result<void, DeleteError>> {
  const record = await financialRepo.findById(id);
  if (!record) return Err({ type: 'NotFound' });
  if (record.retainUntil > new Date()) {
    return Err({ type: 'RetentionPolicyViolation', retainUntil: record.retainUntil });
  }
  await financialRepo.delete(id);
  return Ok(undefined);
}
```

## Delta vs SOC 2 CC8.1

SOC 2 CC8.1 covers change management for all in-scope systems. SOX adds:
- **Criminal liability** for records destruction (§802)
- Mandatory external audit attestation (§404)
- Explicit segregation of duties for financial transaction approvals
- 7-year retention anchor (vs. the variable periods in SOC 2)

## Common Code-Level Gaps

- No retention guard on financial record deletion (§802 violation risk)
- Developer self-merging PRs for financial system changes (ITGC-SOD)
- Audit log sink with write access granted to the application service account (ITGC-AM)
- Financial data in a non-production environment without de-identification (ITGC-AM)
