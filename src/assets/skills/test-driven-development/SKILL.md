---
name: test-driven-development
description: This skill should be used when implementing features or fixing bugs. Enforces RED-GREEN-REFACTOR.
user-invocable: false
allowed-tools: Read, Grep, Glob
activation:
  file-patterns:
    - "**/*.ts"
    - "**/*.tsx"
    - "**/*.js"
    - "**/*.jsx"
    - "**/*.py"
  exclude:
    - "node_modules/**"
    - "dist/**"
    - "**/*.test.*"
    - "**/*.spec.*"
---

# Test-Driven Development

Use the RED-GREEN-REFACTOR cycle for all implementation work. Tests define the design. Code satisfies the tests. Refactoring improves the design without changing behavior.

## Iron Law

> **Tests first, always.**
>
> Write the failing test before the production code. If you catch yourself writing
> production code without a failing test, stop, delete that code, write the test,
> watch it fail, then write the minimum code to make it pass. The test is the specification.

## The Cycle

**Affected tests**: the tests that cover the changed files, selected by the runner's related-test option (Jest's `--findRelatedTests`, Vitest's `related`) or, where the runner has none, the package or path that owns them. Every "run the tests" step below means the affected tests; the full suite belongs to Validate.

### Step 1: RED — Write a Failing Test

Write a test that describes the behavior you want. Run it. Watch it fail. The failure message is your specification. Describe what the code should do, not how. One behavior per test, and one assertion per test where you can. Name tests as sentences: "returns error when email is invalid".

**Checkpoint:** The test must fail before you go on. A test that passes at once proves nothing.

### Step 2: GREEN — Write Minimum Code to Pass

Write the simplest production code that makes the failing test pass. Hardcode first if that is simplest; generalize when the next test forces it. No code for later, no optimizing, no cleanup.

**Checkpoint:** All affected tests pass. If any test fails, fix it before moving on.

### Step 3: REFACTOR — Improve Without Changing Behavior

Extract helpers, rename, simplify, remove duplication. Run the affected tests after every refactoring step. If a test breaks during refactor, undo: you changed behavior.

**Checkpoint:** All affected tests still pass. Repeat from Step 1 for the next behavior.

## Cycle Verification

After each cycle, all of these must hold:

- [ ] Test existed BEFORE production code (not concurrent, not after)
- [ ] Test failed for the right reason (expected behavior absent, not a syntax or import error)
- [ ] Production code is minimal — nothing beyond what the test demands
- [ ] ALL affected tests pass, not just the new one
- [ ] Refactoring happened in Step 3 (or code is already clean — state explicitly)
- [ ] No untested production code remains

If any fails, you skipped TDD: back up and redo the cycle.

An excuse to skip the test-first step is a rationalization: reject it. `references/rationalization-prevention.md` lists the common excuses, the mid-work red flags and a test-first example.

## When Stuck

| Blocker | Solution |
|---------|----------|
| Don't know what to test first | Test the simplest input/output pair: "Given X, expect Y." |
| Test needs complex setup or state | Extract the logic into a pure function. Test that. Integrate after. |
| Behavior depends on external state (DB, API, clock) | Inject the dependency as a parameter. Pass a fake in tests. |
| Multiple behaviors tangled together | One test = one behavior. If you can't isolate it, split the design. |
| Modifying legacy code with no tests | Write a characterization test first: it captures the current behavior, even if wrong. Then change the code and see what breaks. |

## What to Test

Follow the project's test layout and conventions, and import the module under test, not its internal helpers.

| Test | Don't Test |
|------|------------|
| Public API behavior | Private implementation details |
| Error conditions and edge cases | Framework internals |
| Integration points (boundaries) | Third-party library correctness |
| State transitions | Getter/setter plumbing (unless non-trivial) |

## When TDD Does Not Apply

- **Quick or chat tasks**: trivial edits, exploration, conversational requests
- **Non-code tasks**: documentation, configuration, CI changes
- **Exploratory prototyping**: the user explicitly says "just spike this" or "prototype"
- **Existing test suite changes**: modifying tests themselves (devflow:testing skill applies instead)

When you skip TDD, state the reason from this list: "Skipping TDD because: [reason]."

## By Mode

- **IMPLEMENT**: write the failing test before production code, one behavior at a time. The Code agent preloads this skill.
- **DEBUG**: write a test that reproduces the bug first, then fix.
- **PLAN**: the plan has a test strategy and orders test files first.
- **RESOLVE**: the Code agent (issue-fix mode) writes a failing-then-passing regression test for every fix.
