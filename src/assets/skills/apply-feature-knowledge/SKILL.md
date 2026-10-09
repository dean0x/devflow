---
name: apply-feature-knowledge
description: Consumption algorithm for FEATURE_KNOWLEDGE variable — pre-computed feature context
user-invocable: false
allowed-tools: Read
---

# Apply Feature Knowledge

## Iron Law

> **Pre-computed context, not a cage. Verify against current code — always.**
>
> A feature knowledge captures patterns AS THEY WERE when last written. Code evolves.
> Use the feature knowledge as a starting point, not gospel truth. When something feels
> off, Read the actual files. Code is authoritative; feature knowledge is supplementary.

---

## 3-Step Algorithm

1. **Read** each section of `FEATURE_KNOWLEDGE` (headed `--- Feature knowledge: {slug} ---`) for architecture, data flow, patterns, anti-patterns, gotchas and the integration points your task touches.
2. **Apply** it: follow documented patterns unless you have a specific reason not to; check your work against each anti-pattern and gotcha; respect documented integration boundaries; start exploring from the key files.
3. **Verify** against current code: it may not reflect recent changes. Where it is silent on your area, explore further. Where an assertion seems outdated or contradicts the code, Read the source and trust it. Note a discrepancy in your output when it matters for the task.

---

## Skip Guard

When `FEATURE_KNOWLEDGE` is `(none)`, empty, or not provided — skip this skill entirely.
Do not mention feature knowledge or its absence in your output.

## Freshness Model

Feature knowledge uses **write-through + verify-on-read** for freshness:
- KBs are written at the point a documented area changes (not on a background schedule)
- Readers verify key assertions against current code rather than relying on staleness markers
- When in doubt, Read the file — that resolves any uncertainty immediately

## Concatenation Format

Multiple feature knowledge entries are concatenated with slug headers:
```
--- Feature knowledge: payments ---
[full KNOWLEDGE.md content]

--- Feature knowledge: auth ---
[full KNOWLEDGE.md content]
```
