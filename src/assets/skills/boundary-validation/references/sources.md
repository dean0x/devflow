# Boundary Validation — Sources

## Primary References

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 1 | "Parse, don't validate" | Alexis King | 2019 | [Free](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) | Core principle: parsing vs validation, type-driven design |
| 2 | "Secure by Design" Ch. 3–5 | Bernsmed, Deogun, Sawano | 2019 | Purchase | Domain primitives, trust boundaries, input validation architecture |
| 3 | OWASP Input Validation Cheat Sheet | OWASP Foundation | 2024 | [Free](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html) | Allow-lists, deny-lists, canonicalization, validation strategies |
| 4 | OWASP Top 10 (2021) | OWASP Foundation | 2021 | [Free](https://owasp.org/Top10/) | A03:Injection, A08:Software and Data Integrity Failures |
| 5 | Zod Documentation | Colin McDonnell | 2024 | [Free](https://zod.dev) | TypeScript-first schema validation, safeParse, transforms, pipes |
| 6 | "Railway Oriented Programming" | Scott Wlaschin | 2014 | [Free](https://fsharpforfunandprofit.com/rop/) | Result type composition, error handling as data flow |
| 7 | CWE-20: Improper Input Validation | MITRE | 2024 | [Free](https://cwe.mitre.org/data/definitions/20.html) | Root cause taxonomy for input validation failures |
| 8 | "The Twelve-Factor App" (III. Config) | Adam Wiggins | 2011 | [Free](https://12factor.net/config) | Environment-based config, strict separation, fail-fast startup |
| 9 | OWASP Webhook Security | OWASP Foundation | 2024 | [Free](https://cheatsheetseries.owasp.org/cheatsheets/Webhook_Security_Cheat_Sheet.html) | Signature verification, replay protection, payload validation |
| 10 | Pydantic Documentation | Samuel Colvin | 2024 | [Free](https://docs.pydantic.dev) | Python data validation, model_validate, strict mode, custom validators |
| 11 | go-playground/validator | Dean Karn | 2024 | [Free](https://pkg.go.dev/github.com/go-playground/validator/v10) | Go struct validation, tag-based rules, custom validators |
| 12 | Serde Documentation | David Tolnay | 2024 | [Free](https://serde.rs) | Rust serialization/deserialization framework |
| 13 | validator (Rust crate) | Keats | 2024 | [Free](https://docs.rs/validator) | Derive-based Rust validation, struct-level and field-level rules |
| 14 | Jakarta Bean Validation (JSR 380) | JCP | 2017 | [Free](https://beanvalidation.org/2.0/spec/) | Java annotation-based validation, constraint composition |
| 15 | OWASP SQL Injection Prevention | OWASP Foundation | 2024 | [Free](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html) | Parameterized queries, stored procedures, allow-list validation |

## Standards & Specifications

| # | Source | Org | Access | Topics |
|---|--------|-----|--------|--------|
| 16 | "Object-Oriented Software Construction" Ch. 11 | Bertrand Meyer | 1997 | Purchase | Design by Contract — preconditions, postconditions, invariants |
| 17 | "Making illegal states unrepresentable" | Yaron Minsky | 2011 | [Free](https://blog.janestreet.com/effective-ml-video/) | Type-driven design, eliminating invalid states at compile time |
| 18 | "Domain Modeling Made Functional" Ch. 3–4 | Scott Wlaschin | 2018 | Purchase | Constrained types, smart constructors, making invalid values impossible |
| 19 | JSON Schema Specification | JSON Schema Org | 2020 | [Free](https://json-schema.org/specification) | Schema vocabulary, validation keywords, format annotations |
| 20 | OpenAPI Specification 3.1 | OpenAPI Initiative | 2024 | [Free](https://spec.openapis.org/oas/latest.html) | API schema definitions, request/response validation |

## Academic & Research

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 21 | "The Emperor's Old Clothes" | C.A.R. Hoare | 1981 | [Free](https://dl.acm.org/doi/10.1145/358549.358561) | Billion-dollar mistake (null), importance of type safety |
| 22 | "Propositions as Types" | Philip Wadler | 2015 | [Free](https://homepages.inf.ed.ac.uk/wadler/papers/propositions-as-types/propositions-as-types.pdf) | Curry-Howard correspondence — types as proofs of properties |
| 23 | "Typestates for Objects" | Aldrich, Sunshine, Saini, Sparks | 2009 | [Free](https://www.cs.cmu.edu/~aldrich/papers/onward2009-state.pdf) | Typestate pattern — encoding protocol states in the type system |
| 24 | NIST SP 800-53 Rev. 5 (SI-10) | NIST | 2020 | [Free](https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final) | Federal information input validation requirements |
| 25 | "Robustness and Least Power" | Tim Berners-Lee | 2001 | [Free](https://www.w3.org/2001/tag/doc/leastPower.html) | Rule of Least Power — accept strictly, produce liberally (and when not to) |
