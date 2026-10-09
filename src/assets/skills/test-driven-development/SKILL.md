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

**Affected tests**: the tests that cover the changed files, selected by the runner's related-test option (Jest's `--findRelatedTests`, Vitest's `related`) or, where the runner has none, the package or path that owns them. Every "run the tests" step below means the affected tests; the full suite belongs to Validate.

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

**Checkpoint:** All affected tests pass. If any test fails, fix it before moving on.

### Step 3: REFACTOR — Improve Without Changing Behavior

Now clean up: extract helpers, rename, simplify, apply DRY. Tests stay green throughout.

```
Run the affected tests after every refactoring step.
If a test breaks during refactor, undo immediately — you changed behavior.
```

**Checkpoint:** All affected tests still pass. Code is clean. Repeat from Step 1 for next behavior.

---

## Cycle Verification

After each RED-GREEN-REFACTOR cycle, ALL must hold:

- [ ] Test existed BEFORE production code (not concurrent, not after)
- [ ] Test failed for the RIGHT reason (expected behavior absent, not syntax/import error)
- [ ] Production code is minimal — no speculative additions beyond what the test demands
- [ ] ALL affected tests pass, not just the new one
- [ ] Refactoring happened in Step 3 (or code is already clean — state explicitly)
- [ ] No untested production code remains

If any fails: you skipped TDD. Back up and redo the cycle correctly.

---

## Rationalization Prevention

These are the excuses developers use to skip TDD. Recognize and reject them.

| Excuse | Why It Feels Right | Why It's Wrong | Correct Action |
|--------|-------------------|----------------|----------------|
| "I'll write tests after" | Need to see the shape first | Tests ARE the shape — they define the interface before implementation exists | Write the test first |
| "Too simple to test" | It's just a getter/setter | Getters break, defaults change, edge cases hide in "simple" code | Write it — takes 30 seconds |
| "I'll refactor later" | Just get it working now | "Later" never comes; technical debt compounds silently | Refactor now in Step 3 |
| "Test is too hard to write" or "the test setup is too complex" | Mocking is painful | Hard-to-test code = bad design, and complex setup = too much coupling; the test is telling you the interface is wrong | Simplify the interface first |
| "Need to see the whole picture" or "the architecture first" | Can't test what I haven't designed or structured yet | TDD IS design; each test reveals the next piece of the interface, and tests DEFINE the architecture | Let the tests drive the design and structure |
| "Tests slow me down" | Faster to just write the code | Faster until the first regression; TDD is faster for anything > 50 lines | Trust the cycle |
| "Framework is hard to set up" | Setup is complex | One-time cost vs recurring regression cost; untested code compounds debt | Set up the framework first — that IS the work |
| "This is infrastructure, not logic" | Plumbing doesn't need tests | Infrastructure carries data; broken plumbing floods everything downstream | Test the contract, not the internals |
| "Deadline is tight, no time for tests" | Ship now, test later | Untested code ships bugs; fixing bugs under deadline is slower than TDD | TDD is faster under pressure, not slower |

See `references/rationalization-prevention.md` for extended examples with code.

### Red Flags — STOP Immediately

The table above catches excuses *before starting*. These catch you *mid-work*: thoughts that signal you are about to skip a step.

| Thought | Correction |
|---------|------------|
| "Let me write the implementation first, tests after" | Delete the code. Write the test. Watch it fail. Then rewrite. |
| "I'll just spike this and add tests later" | Unless the user said "spike" — you're rationalizing, not prototyping. |
| "Let me get it working, then lock it with tests" | Those tests verify your implementation, not the requirement. Backwards. |
| "I know this works, I've written it before" | Past code passed past tests. This code needs its own failing test. |
| "One more function, then I'll write the test" | STOP. Write the test for what you have now. Increments, not batches. |

### Test-First vs Code-First

**Code-first** (wrong): write `parseConfig()`, then a test that mirrors it (`parseConfig("key=val")` passes). Empty input, malformed lines, multi-value keys and whitespace stay hidden until production.

**Test-first** (correct): "ignores comment lines", then "handles empty input", then "rejects malformed lines", each failing first and each driving the next slice of `parseConfig()`, so it handles the edges from the start.

Code-first tests verify what you *happened to build*. Test-first tests specify what *should exist*.

### When Stuck

| Blocker | Solution |
|---------|----------|
| Don't know what to test first | Test the simplest input/output pair. "Given X, expect Y." Start there. |
| Test needs complex setup/state | Extract the logic into a pure function. Test that. Integrate after. |
| Behavior depends on external state (DB, API, clock) | Inject the dependency as a parameter. Pass a fake in tests. |
| Multiple behaviors tangled together | Decompose. One test = one behavior. If you can't isolate it, the design needs splitting. |
| Modifying legacy code with no tests | Write a characterization test first — a test that captures the current behavior, even if wrong. Then make your change and see what breaks. |

---

## Process Enforcement

When implementing any feature under ambient IMPLEMENT, start from the simplest thing it must do, take that one behavior through RED, GREEN and REFACTOR, then repeat for the next behavior.

### File Organization

- Test file lives next to production file: `user.ts` → `user.test.ts`
- Follow project's existing test conventions (Jest, Vitest, pytest, etc.)
- Import the module under test, not internal helpers

### What to Test

| Test | Don't Test |
|------|------------|
| Public API behavior | Private implementation details |
| Error conditions and edge cases | Framework internals |
| Integration points (boundaries) | Third-party library correctness |
| State transitions | Getter/setter plumbing (unless non-trivial) |

---

## When TDD Does Not Apply

- **Quick/chat tasks** — Trivial edits, exploration, conversational requests
- **Non-code tasks** — Documentation, configuration, CI changes
- **Exploratory prototyping** — User explicitly says "just spike this" or "prototype"
- **Existing test suite changes** — Modifying tests themselves (devflow:testing skill applies instead)

When skipping TDD, never rationalize. State clearly: "Skipping TDD because: [specific reason from list above]."

---

## Integration with Ambient Mode

- **IMPLEMENT** → TDD enforced. Write the failing test before production code. Skill loaded via Code agent frontmatter.
- **DEBUG** → TDD applies to the fix: write a test that reproduces the bug first, then fix.
- **PLAN** → TDD shapes the plan: test strategy section, test-first file ordering, RED-GREEN-REFACTOR cycle awareness.
- **RESOLVE** → TDD enforced via the Code agent (issue-fix mode). Every fix needs a failing-then-passing regression test first.
- **PIPELINE** → TDD inherited transitively through `/implement` → the Code agent.
