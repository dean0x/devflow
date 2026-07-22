# TypeScript — Sources

## Primary References

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 1 | "Effective TypeScript" 2nd Ed | Dan Vanderkam | 2024 | Purchase | 83 items for TypeScript mastery; definitive guide to idiomatic TS |
| 2 | TypeScript Handbook | Microsoft | 2024 | [Free](https://www.typescriptlang.org/docs/handbook/) | Official guide to types, generics, narrowing, modules |
| 3 | TypeScript Design Goals | Microsoft | 2024 | [Free](https://github.com/Microsoft/TypeScript/wiki/TypeScript-Design-Goals) | Non-goals that explain TS structural type decisions |
| 4 | Google TypeScript Style Guide | Google | 2024 | [Free](https://google.github.io/styleguide/tsguide.html) | Production style rules: any, assertions, generics, enums |
| 5 | "Understanding TypeScript's Type System" | Bierman, Abadi, Torgersen | 2014 | [Free](https://link.springer.com/chapter/10.1007/978-3-662-44202-9_11) | Academic formalization — ECOOP 2014 |
| 6 | "Exploring TypeScript" | Stefan Baumgartner | 2024 | [Free](https://typescript-book.com) | Deep patterns: conditional types, mapped types, variance |
| 7 | "TypeScript Deep Dive" | Basarat Ali Syed | 2024 | [Free](https://basarat.gitbook.io/typescript/) | Community reference covering compiler internals |
| 8 | TypeScript Release Notes | Microsoft | 2024 | [Free](https://www.typescriptlang.org/docs/handbook/release-notes/overview.html) | Per-version feature details (template literals 4.1, satisfies 4.9, etc.) |
| 9 | "Effective TypeScript" Item 43 | Dan Vanderkam | 2024 | Purchase | "Prefer unknown to any" — core philosophy |
| 10 | "Effective TypeScript" Item 7 | Dan Vanderkam | 2024 | Purchase | "Think of types as sets of values" — structural typing model |
| 11 | "Effective TypeScript" Item 29 | Dan Vanderkam | 2024 | Purchase | "Be liberal in what you accept, strict in what you produce" |
| 12 | Zod Documentation | Colin McDonnell | 2024 | [Free](https://zod.dev) | Runtime schema validation — safeParse, infer, transforms |
| 13 | ts-pattern Documentation | Gabriel Vergnaud | 2024 | [Free](https://github.com/gvergnaud/ts-pattern) | Exhaustive pattern matching — match, P.when, exhaustive |
| 14 | Matt Pocock TypeScript Tips | Matt Pocock | 2024 | [Free](https://totaltypescript.com) | Advanced patterns: satisfies, const type params, template literals |
| 15 | Type Challenges | Anthony Fu | 2024 | [Free](https://github.com/type-challenges/type-challenges) | Type-level programming exercises — Easy through Extreme |
| 16 | TypeScript Error Messages | Microsoft | 2024 | [Free](https://www.typescriptlang.org/tsconfig) | Understanding compiler errors and tsconfig options |
| 17 | ESLint TypeScript Plugin | typescript-eslint | 2024 | [Free](https://typescript-eslint.io) | Lint rules for type safety: no-explicit-any, no-unsafe-* |
| 18 | "Programming TypeScript" | Boris Cherny | 2019 | Purchase | Type system fundamentals — function types, classes, advanced types |
| 19 | Conditional Types — TypeScript Handbook | Microsoft | 2024 | [Free](https://www.typescriptlang.org/docs/handbook/2/conditional-types.html) | infer keyword, distributive conditionals, recursive types |
| 20 | Template Literal Types — TypeScript 4.1+ | Microsoft | 2021 | [Free](https://www.typescriptlang.org/docs/handbook/2/template-literal-types.html) | String-level type operations, Capitalize, Uppercase, key remapping |

## Branded & Nominal Typing

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 21 | "Effective TypeScript" Item 37 | Dan Vanderkam | 2024 | Purchase | "Consider brands for nominal typing" |
| 22 | "Nominal Typing Techniques in TypeScript" | Michal Zalecki | 2020 | [Free](https://michalzalecki.com/nominal-typing-in-typescript/) | Branded types, unique symbol approach, opaque types |

## Type System Theory

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 23 | "Propositions as Types" | Philip Wadler | 2015 | [Free](https://homepages.inf.ed.ac.uk/wadler/papers/propositions-as-types/propositions-as-types.pdf) | Types as proofs — Curry-Howard correspondence |
| 24 | "Making Illegal States Unrepresentable" | Yaron Minsky | 2011 | [Free](https://blog.janestreet.com/effective-ml-video/) | Discriminated unions that prevent invalid states at compile time |
| 25 | "Parse, don't validate" | Alexis King | 2019 | [Free](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) | Schema parsing over scattered checks — combined with Item 9 [1] |
