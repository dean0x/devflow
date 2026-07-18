# Primary Sources

Authoritative references for the compliance skill. All framework-specific controls are grounded in these documents.

## Regulatory and Standards

| Source | Version / Date | Access |
|--------|---------------|--------|
| **GDPR** — General Data Protection Regulation | Regulation (EU) 2016/679 | https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679 |
| **HIPAA** — Health Insurance Portability and Accountability Act | 45 CFR Parts 160, 162, 164 | https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html |
| **PCI DSS** — Payment Card Industry Data Security Standard | v4.0 (March 2022) | https://www.pcisecuritystandards.org/document_library/ |
| **SOX** — Sarbanes-Oxley Act | Pub.L. 107-204 (2002) §404, §802 | https://www.congress.gov/107/plaws/publ204/PLAW-107publ204.pdf |
| **ISO/IEC 27001** | 2022 edition, Annex A | https://www.iso.org/standard/82875.html |
| **AICPA Trust Services Criteria** | 2017 (updated 2022) | https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria |

## Engineering Frameworks

| Source | Version | Access |
|--------|---------|--------|
| **NIST SSDF** — Secure Software Development Framework | SP 800-218 (Feb 2022) | https://csrc.nist.gov/publications/detail/sp/800-218/final |
| **OWASP ASVS** — Application Security Verification Standard | 5.0 | https://owasp.org/www-project-application-security-verification-standard/ |

## Framework-to-Control Mapping Notes

- GDPR Art. 25 (data protection by design) and NIST SSDF PO.1.3 overlap: both require security/privacy embedded in design, not bolted on
- PCI DSS Req 6.x and OWASP ASVS V14 (configuration) address the same secure-development lifecycle concerns; ASVS gives more code-level specifics
- SOC 2 CC8.1 and SOX ITGC change-management controls are substantively equivalent; SOX adds criminal liability and the 7-year retention anchor
- ISO/IEC 27001 A.14.2 (secure development) and NIST SSDF are complementary; SSDF is more prescriptive at the build-pipeline level
