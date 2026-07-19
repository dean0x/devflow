---
paths: []
---
# Security

**Assume all input is malicious.**

- Parameterized queries for all database access — no string concatenation
- Escape output for its context (HTML, URL, SQL, shell)
- No hardcoded secrets, tokens, or credentials — use environment variables
- Validate and sanitize at every trust boundary
- Defense in depth: never rely on a single security control
