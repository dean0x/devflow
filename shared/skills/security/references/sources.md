# Security — Sources

## Primary References

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 1 | OWASP Top 10 (2021) | OWASP Foundation | 2021 | [Free](https://owasp.org/Top10/) | Top vulnerability categories: injection, broken auth, misconfiguration, SSRF |
| 2 | OWASP Application Security Verification Standard (ASVS) 4.0 | OWASP Foundation | 2021 | [Free](https://owasp.org/www-project-application-security-verification-standard/) | Application security verification requirements at three assurance levels |
| 3 | OWASP Proactive Controls (2024) | OWASP Foundation | 2024 | [Free](https://owasp.org/www-project-proactive-controls/) | Top 10 preventive security measures for developers |
| 4 | OWASP Cheat Sheet Series | OWASP Foundation | 2024 | [Free](https://cheatsheetseries.owasp.org) | Auth, crypto, XSS, injection, session management prevention patterns |
| 5 | CWE Top 25 Most Dangerous Software Weaknesses (2024) | MITRE | 2024 | [Free](https://cwe.mitre.org/top25/) | Most exploited weakness categories ranked by prevalence and severity |
| 6 | CWE-20: Improper Input Validation | MITRE | 2024 | [Free](https://cwe.mitre.org/data/definitions/20.html) | Root cause of injection and boundary-violation vulnerabilities |
| 7 | NIST SP 800-63 Rev 4 — Digital Identity Guidelines | NIST | 2024 | [Free](https://pages.nist.gov/800-63-4/) | Password length/complexity, MFA, phishing-resistant authenticators |
| 8 | NIST SP 800-218 — Secure Software Development Framework (SSDF) | NIST | 2022 | [Free](https://csrc.nist.gov/publications/detail/sp/800-218/final) | Secure coding practices, code review requirements, vulnerability response |
| 9 | CERT Secure Coding Standards | SEI Carnegie Mellon | 2024 | [Free](https://wiki.sei.cmu.edu/confluence/display/seccode) | Language-specific secure coding rules (C, C++, Java, Android, Perl) |
| 10 | Mozilla Web Security Guidelines | Mozilla Corporation | 2024 | [Free](https://infosec.mozilla.org/guidelines/web_security) | CSP, CORS, HSTS, Referrer-Policy, X-Frame-Options recommendations |
| 11 | OWASP API Security Top 10 (2023) | OWASP Foundation | 2023 | [Free](https://owasp.org/API-Security/editions/2023/en/0x00-header/) | API-specific vulnerabilities: broken object auth, mass assignment, SSRF |
| 12 | SLSA Framework — Supply-chain Levels for Software Artifacts | Google / OpenSSF | 2024 | [Free](https://slsa.dev) | Supply chain integrity levels, provenance requirements, build hardening |
| 13 | Sigstore Documentation | Linux Foundation / OpenSSF | 2024 | [Free](https://docs.sigstore.dev) | Keyless code signing, artifact verification, transparency log |
| 14 | STRIDE Threat Model | Microsoft | 2022 | [Free](https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats) | Spoofing, Tampering, Repudiation, Information Disclosure, DoS, Elevation |
| 15 | Content Security Policy (CSP) Level 3 | W3C | 2023 | [Free](https://www.w3.org/TR/CSP3/) | Directive syntax, nonce/hash-based allow-lists, XSS mitigation mechanism |
| 16 | SameSite Cookies Explained | web.dev (Google) | 2020 | [Free](https://web.dev/articles/samesite-cookies-explained) | CSRF prevention, SameSite=Strict/Lax/None, cookie attribute semantics |
| 17 | JWT Best Practices — RFC 8725 | IETF | 2020 | [Free](https://www.rfc-editor.org/rfc/rfc8725) | Algorithm confusion, weak secrets, missing validation, claim verification |
| 18 | Subresource Integrity (SRI) | W3C | 2022 | [Free](https://www.w3.org/TR/SRI/) | Hash-based CDN tamper prevention, integrity attribute for script/link tags |
| 19 | OWASP Testing Guide (WSTG) v4.2 | OWASP Foundation | 2021 | [Free](https://owasp.org/www-project-web-security-testing-guide/) | Security testing methodology, test cases for each vulnerability category |
| 20 | Stanford CS 253: Web Security | Feross Aboukhadijeh | 2019 | [Free](https://web.stanford.edu/class/cs253/) | Comprehensive academic web security: XSS, CSRF, SQLi, clickjacking, CSP |

## Books

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 21 | "The Web Application Hacker's Handbook" 2nd ed. | Stuttard & Pinto | 2011 | Purchase | Comprehensive web app attack and defense: auth, logic flaws, injection |
| 22 | "Secure by Design" | Deogun, Sawano & Johnsson | 2019 | Purchase | Security as architectural property, domain primitives, trust boundaries |
| 23 | "Threat Modeling: Designing for Security" | Adam Shostack | 2014 | Purchase | Systematic threat analysis, STRIDE application, mitigation strategies |

## Algorithms & Specifications

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 24 | Argon2 Reference Implementation and Specification | Biryukov, Dinu & Khovratovich | 2021 | [Free](https://github.com/P-H-C/phc-winner-argon2) | Winner of PHC; memory-hard password hashing; recommended over bcrypt/scrypt |
| 25 | "Cryptography Engineering" Ch. 3–6 | Ferguson, Schneier & Kohno | 2010 | Purchase | Random number generation, symmetric encryption, hash functions, MACs |
