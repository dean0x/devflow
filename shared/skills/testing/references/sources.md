# Testing Skill — Sources

## Primary References

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 1 | "xUnit Test Patterns: Refactoring Test Code" | Gerard Meszaros | 2007 | Purchase | Test doubles taxonomy (dummy, stub, spy, mock, fake), patterns catalog |
| 2 | "Test Driven Development: By Example" | Kent Beck | 2003 | Purchase | Red-Green-Refactor cycle, TDD methodology, money example |
| 3 | "Growing Object-Oriented Software, Guided by Tests" | Freeman & Pryce | 2009 | Purchase | Outside-in TDD, listening to tests, mock roles not objects |
| 4 | "Software Engineering at Google" Ch.11-14 | Winters, Manshreck & Wright | 2020 | [Free](https://abseil.io/resources/swe-book) | Testing overview, unit tests, test doubles, larger tests |
| 5 | "QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs" | Claessen & Hughes | 2000 | [Free](https://www.cs.tufts.edu/~nr/cs257/archive/john-hughes/quick.pdf) | Property-based testing foundation, generators, shrinking |
| 6 | "TestPyramid" | Martin Fowler | 2012 | [Free](https://martinfowler.com/bliki/TestPyramid.html) | Testing pyramid: unit → integration → E2E shape |
| 7 | "Write tests. Not too many. Mostly integration." | Kent C. Dodds | 2019 | [Free](https://kentcdodds.com/blog/write-tests) | Testing trophy, integration-first testing shape |
| 8 | "Unit Testing: Principles, Practices, and Patterns" | Vladimir Khorikov | 2020 | Purchase | Classical vs London school, fragile tests, observable behavior |
| 9 | "Mocks Aren't Stubs" | Martin Fowler | 2007 | [Free](https://martinfowler.com/articles/mocksArentStubs.html) | Test double classification, mockist vs classicist styles |
| 10 | "On the Diverse and Fantastical Shapes of Testing" | Martin Fowler | 2021 | [Free](https://martinfowler.com/articles/2021-test-shapes.html) | Testing shapes debate, context-dependent pyramid |
| 11 | "Flaky Tests at Google and How We Mitigate Them" | Micco & Memon | ICSE 2017 | [Free](https://dl.acm.org/doi/10.1109/ICSE-SEIP.2017.3) | Flaky test research: root causes, detection, mitigation at scale |
| 12 | "Just Say No to More End-to-End Tests" | Google Testing Blog | 2015 | [Free](https://testing.googleblog.com/2015/04/just-say-no-to-more-end-to-end-tests.html) | Test scope optimization, cost of E2E, balancing pyramid |
| 13 | Hypothesis Documentation | David MacIver | 2024 | [Free](https://hypothesis.readthedocs.io) | Python property-based testing, strategies, stateful testing |
| 14 | fast-check Documentation | Nicolas Dubien | 2024 | [Free](https://fast-check.dev) | TypeScript property-based testing, arbitraries, shrinking |
| 15 | Testing Library Documentation | Kent C. Dodds | 2024 | [Free](https://testing-library.com/docs/) | Behavior-focused DOM testing, query by role/text/label |
| 16 | "Working Effectively with Legacy Code" | Michael Feathers | 2004 | Purchase | Characterization tests, seams, safe refactoring of untested code |
| 17 | "The Art of Unit Testing" 3rd Ed | Roy Osherove | 2024 | Purchase | Trustworthy test design, maintainable tests, test reviews |
| 18 | "An Empirical Study of Flaky Tests in JavaScript for Web Applications" | Luo et al. | 2014 | [Free](https://ieeexplore.ieee.org/document/6982620) | Root cause analysis: async, timing, order-dependent failures |
| 19 | Vitest Documentation | Vitest Team | 2024 | [Free](https://vitest.dev) | Modern Vite-native testing: vi.fn(), fake timers, coverage |
| 20 | "Integrated Tests Are a Scam" | J.B. Rainsberger | 2009 | [Free](https://www.jbrains.ca/permalink/integrated-tests-are-a-scam-part-1) | Contract tests, collaboration tests, avoiding integrated test explosion |

## Testing Shapes

| # | Source | Key Claim |
|---|--------|-----------|
| 6 | Test Pyramid (Fowler) | Many unit → fewer integration → fewest E2E [6] |
| 7 | Testing Trophy (Dodds) | Integration tests give best ROI for most UIs [7] |
| 10 | Diverse Shapes (Fowler) | Right shape is context-dependent, not universal [10] |
| 12 | Google Testing Blog | E2E tests are expensive to maintain; prefer lower-level [12] |

## Test Doubles Taxonomy (Meszaros [1] / Fowler [9])

| Type | Definition | Source |
|------|-----------|--------|
| Dummy | Passed but never used; fills parameter lists | [1] |
| Stub | Returns canned answers to calls made during tests | [1][9] |
| Spy | Records calls for later assertion | [1][9] |
| Mock | Pre-programmed with expectations; fails if not met | [1][9] |
| Fake | Working implementation, unsuitable for production (e.g., in-memory DB) | [1][9] |

## Property-Based Testing

| # | Source | Language | Topics |
|---|--------|----------|--------|
| 5 | QuickCheck paper | Haskell | Foundation: generators, shrinking, properties |
| 13 | Hypothesis | Python | `@given`, strategies, stateful testing |
| 14 | fast-check | TypeScript | `fc.property`, arbitraries, model-based testing |
