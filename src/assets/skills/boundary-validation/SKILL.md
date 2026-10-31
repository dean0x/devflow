---
name: boundary-validation
description: This skill should be used when the user asks to "validate input", "parse request data", "add Zod schema", or creates API endpoints and system boundaries.
user-invocable: false
allowed-tools: Read, Grep, Glob, AskUserQuestion
---

# Boundary Validation Skill

## Iron Law

> **PARSE, DON'T VALIDATE**
>
> Use a function that accepts a less-structured input and produces a more-structured
> output — or fails. After parsing succeeds, the type system guarantees correctness;
> no downstream code ever rechecks.

## Core Principle: Schema at Every Boundary

A **boundary** is any point where data crosses a trust domain. External data is hostile
until parsed through a schema. Take `unknown`, not `any`, and parse it with a schema
(for example Zod `UserSchema.safeParse(data)`) that yields a typed value or a
`Result` error; do not scatter manual `typeof` checks. Design the schema type so it
cannot hold invalid data ("make illegal states unrepresentable"): it is the precondition
callers must satisfy, and internal code then trusts the type, with no redundant runtime checks.

## Boundary Taxonomy

| Boundary | Trust Level | Parse Strategy |
|----------|-------------|----------------|
| HTTP request body/params/query | Zero trust | Schema + sanitize |
| External API response | Low trust | Schema (API may change) |
| Environment variables | Low trust | Schema on startup, fail fast |
| File uploads | Zero trust | Schema + content sniffing + size limit |
| Webhook payloads | Zero trust | Signature verify then schema parse |
| Database reads | High trust | Schema optional (ORM types) |
| Internal function args | Full trust | Type system sufficient |

## Validation Libraries

| Language | Library | Parse Approach |
|----------|---------|----------------|
| TypeScript/JS | Zod | `safeParse()` returns discriminated union |
| Python | Pydantic | `model_validate()` returns model or `ValidationError` |
| Go | go-playground/validator | Struct tags + `Validate()` |
| Rust | serde + validator | `#[derive(Deserialize)]` + `#[validate]` |
| Java | Bean Validation (JSR 380) | `@Valid` + `ConstraintViolationException` |

## Security Principles

1. **All External Data Is Hostile** — assume malicious intent until parsed
2. **Parse Once at the Boundary** — then trust typed data downstream
3. **Fail Secure** — invalid input is rejected, never accepted with warnings
4. **No Bypass** — no "skip validation" flags or backdoors
5. **Parameterize Queries** — never interpolate parsed values into SQL/commands

## Extended References

- `references/sources.md` — Full bibliography with access links
- `references/patterns.md` — Correct patterns with citations
- `references/violations.md` — Violation examples with citations
- `references/detection.md` — Grep patterns and report templates

## Success Criteria

- [ ] All trust boundaries identified and schema-parsed
- [ ] Validation errors return Result types, not exceptions
- [ ] Tests cover invalid input scenarios at each boundary
