---
name: test-driven-development
description: >-
  Enforce RED-GREEN-REFACTOR cycle during implementation. Write failing tests before
  production code. Distinct from test-patterns (which reviews test quality) — this
  skill enforces the TDD workflow during code generation.
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

Enforce the RED-GREEN-REFACTOR cycle for all implementation work. Tests define the design. Code satisfies the tests. Refactoring improves the design without changing behavior.

## Iron Law

> **TESTS FIRST, ALWAYS**
>
> Write the failing test before the production code. No exceptions. If you catch
> yourself writing production code without a failing test, stop immediately, delete
> the production code, write the test, watch it fail, then write the minimum code
> to make it pass. The test IS the specification.

---

## The Cycle

### Step 1: RED — Write a Failing Test

Write a test that describes the behavior you want. Run it. Watch it fail. The failure message IS your specification.

```
Describe what the code SHOULD do, not how it does it.
One behavior per test. One assertion per test (ideally).
Name tests as sentences: "returns error when email is invalid"
```

**Checkpoint:** The test MUST fail before proceeding. A test that passes immediately proves nothing.

### Step 2: GREEN — Write Minimum Code to Pass

Write the simplest production code that makes the failing test pass. No more, no less.

```
Hardcode first if that's simplest. Generalize when the next test forces it.
Don't write code "you'll need later." Write code the test demands NOW.
Don't optimize. Don't refactor. Don't clean up. Just pass the test.
```

**Checkpoint:** All tests pass. If any test fails, fix it before moving on.

### Step 3: REFACTOR — Improve Without Changing Behavior

Now clean up. Extract helpers, rename variables, simplify logic. Tests stay green throughout.

```
Run tests after every refactoring step.
If a test breaks during refactor, undo immediately — you changed behavior.
Apply DRY, extract patterns, improve readability.
```

**Checkpoint:** All tests still pass. Code is clean. Repeat from Step 1 for next behavior.

---

## Rationalization Prevention

These are the excuses developers use to skip TDD. Recognize and reject them.

| Excuse | Why It Feels Right | Why It's Wrong | Correct Action |
|--------|-------------------|---------------|----------------|
| "I'll write tests after" | Need to see the shape first | Tests ARE the shape — they define the interface before implementation exists | Write the test first |
| "Too simple to test" | It's just a getter/setter | Getters break, defaults change, edge cases hide in "simple" code | Write it — takes 30 seconds |
| "I'll refactor later" | Just get it working now | "Later" never comes; technical debt compounds silently | Refactor now in Step 3 |
| "Test is too hard to write" | Setup is complex, mocking is painful | Hard-to-test code = bad design; the test is telling you the interface is wrong | Simplify the interface first |
| "Need to see the whole picture" | Can't test what I haven't designed yet | TDD IS design; each test reveals the next piece of the interface | Let the test guide the design |
| "Tests slow me down" | Faster to just write the code | Faster until the first regression; TDD is faster for anything > 50 lines | Trust the cycle |

See `references/rationalization-prevention.md` for extended examples with code.

---

## Process Enforcement

When implementing any feature under ambient BUILD/STANDARD:

1. **Identify the first behavior** — What is the simplest thing this feature must do?
2. **Write the test** — Describe that behavior as a failing test
3. **Run the test** — Confirm it fails (RED)
4. **Write minimum code** — Just enough to pass (GREEN)
5. **Refactor** — Clean up while tests stay green (REFACTOR)
6. **Repeat** — Next behavior, next test, next cycle

### File Organization

- Test file lives next to production file: `user.ts` → `user.test.ts`
- Follow project's existing test conventions (Jest, Vitest, pytest, etc.)
- Import the module under test, not internal helpers

### What to Test

| Test | Don't Test |
|------|-----------|
| Public API behavior | Private implementation details |
| Error conditions and edge cases | Framework internals |
| Integration points (boundaries) | Third-party library correctness |
| State transitions | Getter/setter plumbing (unless non-trivial) |

---

## When TDD Does Not Apply

- **QUICK depth** — Ambient classified as QUICK (chat, exploration, trivial edits)
- **Non-code tasks** — Documentation, configuration, CI changes
- **Exploratory prototyping** — User explicitly says "just spike this" or "prototype"
- **Existing test suite changes** — Modifying tests themselves (test-patterns skill applies instead)

When skipping TDD, never rationalize. State clearly: "Skipping TDD because: [specific reason from list above]."

---

## Integration with Ambient Mode

- **BUILD/STANDARD** → TDD enforced. Every new function/method gets test-first treatment.
- **BUILD/QUICK** → TDD skipped (trivial single-file edit).
- **BUILD/ESCALATE** → TDD mentioned in nudge toward `/implement`.
- **DEBUG/STANDARD** → TDD applies to the fix: write a test that reproduces the bug first, then fix.
