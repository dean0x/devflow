---
name: security
description: Use when reviewing code for injection, auth or secrets flaws.
user-invocable: false
allowed-tools: Read, Grep, Glob
---

# Security Patterns

Detection patterns for security vulnerability review. Use with `devflow:review-methodology`.

## Iron Law

> **Assume all input is malicious.**
>
> Every user input, URL parameter, header, and cookie is an attack vector. Use parameterized
> queries always. Escape output always. Validate schemas always. "This field is internal"
> is not a defense. Defense in depth, not wishful thinking.

## Vulnerability Categories

### 1. Input Validation & Injection

- **SQL injection**: parameterize, never interpolate (`` `... WHERE email = '${email}'` `` is vulnerable).
- **XSS**: set `textContent`, never `innerHTML`, with user input.

> `references/patterns.md` — NoSQL, command injection, path traversal, LDAP injection.

### 2. Authentication & Authorization

Every state-changing route needs layered auth middleware (`requireAuth`, `requireRole('admin')`); a `DELETE` handler without it is broken access control.
NIST 800-63 minimum: 15-char passphrase or 12-char complex, phishing-resistant MFA.
JWT: pin algorithm explicitly, set `expiresIn`, store refresh tokens server-side.

### 3. Cryptography & Secrets

Secrets come from env vars or a secret store, never literals. Tokens use `crypto.randomBytes`, never `Math.random()`.
Password hashing: Argon2id (preferred) or bcrypt cost ≥12. Encrypt with AES-256-GCM
(authenticated). Compare secrets with `crypto.timingSafeEqual`, never `===`.

**Reporting a found secret**: cite `file:line` and the type slug — never quote the full value.
Use `{first ≤4 chars}…[REDACTED:{type}]` (e.g. `AKID…[REDACTED:aws-key]`).
A found live credential is ALREADY COMPROMISED — the remediation is rotation
(revoke and regenerate the exposed credential) plus moving to env vars or a secret store,
not just removal from code.

### 4. Configuration & Headers

Expect `helmet()`, a Content-Security-Policy, Strict-Transport-Security, and CORS with an explicit origin list.
SameSite=Strict cookies prevent CSRF. SRI hashes prevent CDN tampering.

### 5. Business Logic & API Security

Race conditions: wrap check-then-act in database transactions with row locks.
Mass assignment: explicitly allowlist fields — never `User.create(req.body)`.
OWASP API Top 10: Broken Object Auth (API1), Excessive Data Exposure (API3), SSRF (API7).

### 6. Supply Chain

Pin dependencies to exact versions. Require SRI for CDN assets. Use
Sigstore/SLSA provenance in CI/CD to verify artifact integrity.

## Extended References

| Reference | Content |
|-----------|---------|
| `references/sources.md` | Full bibliography (25 sources) |
| `references/patterns.md` | Correct patterns |
| `references/violations.md` | Violation examples |
| `references/detection.md` | Grep patterns for automated scanning |

## Severity Guidelines

| Level | Criteria | Examples |
|-------|----------|----------|
| **CRITICAL** | Immediate exploitation | SQL injection in auth, RCE, hardcoded admin creds |
| **HIGH** | Significant risk | XSS, broken access control, weak crypto, CSRF |
| **MEDIUM** | Moderate with conditions | Missing headers, permissive CORS, missing rate limits |
| **LOW** | Minor improvement | Outdated deps (no CVE), suboptimal CSP |

## OWASP Top 10 Reference

| ID | Category | Examples |
|----|----------|----------|
| A01 | Broken Access Control | Missing auth, IDOR, privilege escalation |
| A02 | Cryptographic Failures | Weak hashing, hardcoded secrets |
| A03 | Injection | SQL, NoSQL, command, XSS |
| A04 | Insecure Design | Missing rate limits, mass assignment |
| A05 | Security Misconfiguration | Debug enabled, missing headers |
| A06 | Vulnerable Components | Outdated deps, supply chain risks |
| A07 | Auth Failures | Weak passwords, session issues, JWT misuse |
| A08 | Data Integrity Failures | Untrusted deserialization, no SRI |
| A09 | Logging Failures | Missing security event logs |
| A10 | SSRF | Unvalidated URLs in server requests |
