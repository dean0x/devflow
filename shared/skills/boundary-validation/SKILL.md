---
name: boundary-validation
description: This skill should be used when the user asks to "validate input", "parse request data", "handle form data", "add Zod schema", "sanitize user input", or creates API endpoints and system boundaries. Provides parse-don't-validate patterns with schema validation for type-safe boundary enforcement and hostile input defense.
user-invocable: false
allowed-tools: Read, Grep, Glob, AskUserQuestion
---

# Boundary Validation Skill

## Iron Law

> **PARSE, DON'T VALIDATE**
>
> Use a function that accepts a less-structured input and produces a more-structured
> output — or fails. After parsing succeeds, the type system guarantees correctness;
> no downstream code ever rechecks. "The difference between validation and parsing is
> that parsing gives you a new value… whose type _tells_ you the check has been
> performed." — Alexis King [1]

## When This Skill Activates

- Creating API endpoints or routes
- Processing user-submitted data
- Integrating with external APIs
- Accepting environment variables or configuration
- Handling database queries with user input
- File uploads or webhook processing

## Core Principle: Schema at Every Boundary

A **boundary** is any point where data crosses a trust domain [2][3]. External data
is hostile until parsed through a schema [4]. After parsing, the type carries proof
of validity — no redundant checks downstream [1].

```typescript
// VIOLATION: Manual validation — checks scattered, no type proof [1]
function createUser(data: any): User {
  if (!data.email || typeof data.email !== 'string') throw new Error('Invalid');
  // ...scattered checks, easy to miss, no type guarantee
}

// CORRECT: Parse at boundary — schema yields typed value or error [5][6]
const UserSchema = z.object({
  email: z.string().email().max(255),
  age: z.number().int().min(0).max(150),
  name: z.string().min(1).max(100),
});

function createUser(data: unknown): Result<User, ValidationError> {
  const parsed = UserSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: new ValidationError('Invalid', parsed.error) };
  }
  return { ok: true, value: parsed.data }; // typed User, guaranteed valid
}
```

## Boundary Taxonomy

| Boundary | Trust Level | Parse Strategy |
|----------|-------------|----------------|
| HTTP request body/params/query | Zero trust | Schema + sanitize [4][7] |
| External API response | Low trust | Schema (API may change) [2] |
| Environment variables | Low trust | Schema on startup, fail fast [8] |
| File uploads | Zero trust | Schema + content sniffing + size limit [4] |
| Webhook payloads | Zero trust | Signature verify then schema parse [4][9] |
| Database reads | High trust | Schema optional (ORM types) |
| Internal function args | Full trust | Type system sufficient [1] |

## Validation Libraries

| Language | Library | Parse Approach | Source |
|----------|---------|----------------|--------|
| TypeScript/JS | Zod | `safeParse()` returns discriminated union | [5] |
| Python | Pydantic | `model_validate()` returns model or `ValidationError` | [10] |
| Go | go-playground/validator | Struct tags + `Validate()` | [11] |
| Rust | serde + validator | `#[derive(Deserialize)]` + `#[validate]` | [12][13] |
| Java | Bean Validation (JSR 380) | `@Valid` + `ConstraintViolationException` | [14] |

## Security Principles

1. **All External Data Is Hostile** — assume malicious intent until parsed [4][7]
2. **Parse Once at the Boundary** — then trust typed data downstream [1]
3. **Fail Secure** — invalid input is rejected, never accepted with warnings [3]
4. **No Bypass** — no "skip validation" flags or backdoors [4]
5. **Parameterize Queries** — never interpolate parsed values into SQL/commands [7][15]

## Design by Contract Connection

Boundary validation implements the **precondition** half of Design by Contract [16]:
the schema is the precondition that callers must satisfy. Once the precondition is met
(parsing succeeds), internal code operates on strong types — the **postcondition** is
guaranteed by the type system, not by redundant runtime checks.

Yaron Minsky's principle **"make illegal states unrepresentable"** [17] applies directly:
a well-designed schema type cannot hold invalid data, so bugs from invalid states become
compile-time errors rather than runtime failures.

---

## Extended References

For extended examples, detection patterns, and full bibliography:
- `references/sources.md` — Full bibliography with access links
- `references/patterns.md` — Correct patterns with citations
- `references/violations.md` — Violation examples with citations
- `references/detection.md` — Grep patterns and report templates

---

## Success Criteria

- [ ] All trust boundaries identified and schema-validated [2]
- [ ] Schema validation used — no manual type checks [1][5]
- [ ] No SQL/command injection risks — parameterized queries [7][15]
- [ ] External API responses validated before use [2]
- [ ] Configuration validated on startup with fail-fast [8]
- [ ] Validation errors return Result types, not exceptions [6][18]
- [ ] Tests cover invalid input scenarios at each boundary
