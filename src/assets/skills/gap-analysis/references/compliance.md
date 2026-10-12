# Gap Analysis: Compliance Focus

The compliance focus's detection patterns. D-COMPLIANCE-INJECT: the `Design` agent's preload does not carry them. The `/plan` compliance-focus spawn names this file and the agent Reads it by path, so a lens-off run never loads it.

## Compliance (when the compliance lens is on)

Detect regulatory gaps that security doesn't cover. Load `devflow:compliance` before analyzing, then the compliance skill's `references/{id}.md` only for the ids the spawn's compliance directive names (`none`: generic controls only).

**Detection patterns:**
- Missing audit trails on regulated mutations — writes to financial records, PHI, PCI-scoped data without durable logging
- PII flows without retention/erasure specification — data collected but deletion/expiry policy absent
- Missing encryption requirements — regulated data at rest or in transit without specified encryption control
- Sensitive data in observability — PII or credentials leaking into logs, traces, or metrics
- IaC exposure — infrastructure definitions without required security controls (open ports, unencrypted storage, missing IAM boundaries)
- Self-approval flows — change requires segregation of duties (SOX/SOC 2 CC8.1) but single-actor path exists in the design

**Explicit scope note:** Do NOT duplicate §3 Security's checks (secrets, injection, authZ). Compliance focus is on regulatory control requirements — retention periods, erasure rights, audit completeness, and segregation of duties — not general application security.

**Evidence trigger:** Any regulated-data flow or infrastructure element in the design that does not specify a required control (retention policy, encryption spec, audit log destination, approval workflow).
