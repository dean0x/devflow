# GDPR — Code-Level Checks

**Regulation**: EU General Data Protection Regulation 2016/679

## Key Articles as Code Checks

### Art. 25 — Data Protection by Design and by Default
- Schema design: collect only fields with a documented purpose (`purpose` column or annotation)
- Default values must not over-share; opt-in, not opt-out, for non-essential data processing

### Art. 30 — Records of Processing Activities
- Each data store must have a corresponding processing record (purpose, retention, recipients)
- Code owning a new regulated table should emit a warning if no processing record is referenced

### Art. 32 — Security of Processing
- Encrypted in transit (TLS 1.2+) and at rest (AES-256-GCM or equivalent)
- Access controls scoped to least privilege; no shared service accounts with write access

### Art. 33 — Notification of a Personal Data Breach
- Breach detection requires audit logs sufficient to determine scope and affected subjects
- Code review: verify logging captures which records were accessed, by whom, and when

## Data-Subject Rights Endpoints

| Right | Art. | Code obligation |
|-------|------|----------------|
| Access (SAR) | 15 | Export endpoint returning all data held for a subject |
| Rectification | 16 | Update path that records the correction in the audit log |
| Erasure ("Right to be Forgotten") | 17 | Hard-delete or anonymization; cascades to all replicas |
| Portability | 20 | Machine-readable export (JSON/CSV) of subject's own data |
| Restriction | 18 | Flag to suppress processing without deleting the record |

## Retention Pattern

```typescript
// Each PII insert must register an erasure handler and TTL
await db.insert('user_profiles', {
  userId, email, name,
  createdAt: new Date(),
  retainUntil: addYears(new Date(), 3), // explicit retention period
});
await erasureRegistry.register(userId, ['user_profiles', 'audit_events']);
```

## Common Code-Level Gaps

- Missing erasure cascade: deleting the user row but not linked tables
- Soft deletes that leave PII queryable post-erasure request
- Analytics events that include email or userId in plaintext event properties
- Backup/export pipelines that bypass the encryption layer
