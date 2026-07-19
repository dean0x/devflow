# Software Design — Sources

## Primary References

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 1 | "Railway Oriented Programming" | Scott Wlaschin | 2014 | [Free](https://fsharpforfunandprofit.com/rop/) | Result type composition, error as data flow, two-track model |
| 2 | "Domain Modeling Made Functional" | Scott Wlaschin | 2018 | Purchase | Constrained types, making invalid values impossible, type-driven design |
| 3 | "Inversion of Control Containers and the Dependency Injection pattern" | Martin Fowler | 2004 | [Free](https://martinfowler.com/articles/injection.html) | Canonical DI article, constructor/setter/interface injection |
| 4 | "Making Illegal States Unrepresentable" | Yaron Minsky | 2011 | [Free](https://blog.janestreet.com/effective-ml-video/) | Type-driven design, eliminating invalid states at compile time |
| 5 | "Notions of Computation and Monads" | Eugenio Moggi | 1991 | [Free](https://www.cs.cmu.edu/~crary/819-f09/Moggi91.pdf) | Monadic computation theory — formal foundation for Result/Option |
| 6 | "Comprehending Monads" | Philip Wadler | 1992 | [Free](https://homepages.inf.ed.ac.uk/wadler/papers/monads/monads.ps) | Practical monad application, do-notation, list comprehensions |
| 7 | "Structure and Interpretation of Computer Programs" (SICP) | Abelson & Sussman | 1996 | [Free](https://mitpress.mit.edu/sites/default/files/sicp/) | Abstraction, composition, immutability, streams, metalinguistic abstraction |
| 8 | "Functional Programming in Scala" | Chiusano & Bjarnason | 2014 | Purchase | Error handling with types, referential transparency, pure functions |
| 9 | "Effective Java", Item 72 | Joshua Bloch | 2018 | Purchase | "Favor the use of standard exceptions" — Result types improve on this |
| 10 | "Clean Code", Chapter 7 | Robert C. Martin | 2008 | Purchase | Error handling (contrast: Result types improve on try/catch guidance) |
| 11 | "Functional Core, Imperative Shell" | Gary Bernhardt | 2012 | [Free](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell) | Architecture pattern separating pure business logic from side effects |
| 12 | "Parse, don't validate" | Alexis King | 2019 | [Free](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) | Type-driven validation, making invalid states unrepresentable |
| 13 | "Simple Made Easy" | Rich Hickey | 2011 | [Free](https://www.infoq.com/presentations/Simple-Made-Easy/) | Simplicity vs complexity, complecting, composability |
| 14 | "The Value of Values" | Rich Hickey | 2012 | [Free](https://www.infoq.com/presentations/Value-Values/) | Immutability philosophy, values vs places |
| 15 | "Out of the Tar Pit" | Moseley & Marks | 2006 | [Free](https://curtclifton.net/papers/MoseleyMarks06a.pdf) | Essential vs accidental complexity, state management |
| 16 | "Propositions as Types" | Philip Wadler | 2015 | [Free](https://homepages.inf.ed.ac.uk/wadler/papers/propositions-as-types/propositions-as-types.pdf) | Types as proofs, Curry-Howard correspondence |
| 17 | "Robust Python" | Patrick Viafore | 2021 | Purchase | Result types in Python, type-driven robustness |
| 18 | neverthrow Documentation | George Czabania | 2024 | [Free](https://github.com/supermacro/neverthrow) | TypeScript Result type library — `ok`, `err`, `ResultAsync` |
| 19 | ts-results Documentation | Vultix | 2024 | [Free](https://github.com/vultix/ts-results) | TypeScript Result/Option type library |
| 20 | "Why Functional Programming Matters" | John Hughes | 1989 | [Free](https://www.cs.kent.ac.uk/people/staff/dat/miranda/whyfp90.pdf) | Higher-order functions, lazy evaluation, composition as glue |

## Standards & Style Guides

| # | Source | Org | Access | Topics |
|---|--------|-----|--------|--------|
| 21 | TypeScript Handbook — Type Narrowing | Microsoft | [Free](https://www.typescriptlang.org/docs/handbook/2/narrowing.html) | Discriminated unions, exhaustive checks, type guards |
| 22 | TypeScript Strict Mode | Microsoft | [Free](https://www.typescriptlang.org/tsconfig#strict) | `noImplicitAny`, `strictNullChecks`, `strictFunctionTypes` |

## Academic & Research

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 23 | "An Introduction to Algebraic Effects and Handlers" | Pretnar | 2015 | [Free](https://www.eff-lang.org/handlers-tutorial.pdf) | Effect systems — theoretical foundation for controlled side effects |
| 24 | "Typed Tagless Final Interpreters" | Carette, Kiselyov, Shan | 2009 | [Free](http://okmij.org/ftp/tagless-final/course/lecture.pdf) | Tagless final pattern, effect abstraction |
| 25 | "A Theory of Objects" | Abadi & Cardelli | 1996 | Free | Object type theory — subtyping, method dispatch, type safety |
