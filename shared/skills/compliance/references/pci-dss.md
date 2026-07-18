# PCI DSS — Code-Level Checks

**Standard**: PCI DSS v4.0 (Payment Card Industry Data Security Standard)

## Never Store

PCI DSS prohibits storing these elements after authorization under any circumstances:

| Element | Prohibition |
|---------|------------|
| Full magnetic-stripe / chip data (track data) | Never stored — Req 3.3.1.1 |
| CAV2/CVC2/CVV2/CID (card verification codes) | Never stored — Req 3.3.1.2 |
| PINs / PIN blocks | Never stored — Req 3.3.1.3 |
| Full PAN unmasked | Render unreadable (tokenize or encrypt) — Req 3.5.1 |

**Pattern**: grep model/schema files for `cvv|cvc|cvv2|track_data|track1|track2|pin_block`.

## Scope Minimization (Req 1 / Req 12.5.2)

Limit cardholder data (CHD) to systems that require it:
- Tokenize at the point of entry (Req 3.5); pass token not PAN to downstream services
- Network segmentation: CHD environment must not share a subnet with unscoped systems
- Code review: trace PAN from entry point — it must not appear in logs, analytics, or non-payment services

## Key Requirements as Code Checks

### Req 3 — Protect Stored Account Data
- PAN stored only where necessary; rendered unreadable (AES-256, tokenization, truncation)
- Retain CHD only as long as business/legal need exists; purge after **3 years** (typical anchor; follow your QSA guidance)

### Req 6.x — Develop and Maintain Secure Systems
- No injection flaws (parameterized queries)
- No hard-coded credentials or cryptographic keys in source code
- Dependency scanning in CI/CD pipeline

### Req 10 — Log and Monitor All Access to System Components
- Log all access to CHD: user, datetime, action, resource
- Logs must be tamper-evident and retained for **12 months** (3 months online)
- Failed authentication attempts logged and alerted

## Tokenization Pattern

```typescript
// NEVER pass raw PAN beyond the payment entry boundary
const { token } = await paymentVault.tokenize({ pan: req.body.cardNumber });
// Store and use token; raw PAN is dropped
await orders.create({ userId, paymentToken: token, amount });
```

## Common Code-Level Gaps

- PAN logged in request/response interceptors for debugging
- CVV field persisted in a draft-order or session table
- Payment callback webhook handler echoes full card data back in response
- Test fixtures with real-looking card numbers (use approved test PANs only)
