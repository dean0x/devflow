---
paths: ["**/*.ts", "**/*.tsx"]
---
# TypeScript

**Type safety is non-negotiable — `unknown` over `any`, always.**

- Exhaustive switch statements via `never` in default case
- Discriminated unions for state machines and variants
- Branded types for domain identifiers (UserId, OrderId)
- Strict mode always — no escape hatches
- Cap retries and pagination — every while loop and recursive fetch needs a maxAttempts guard
