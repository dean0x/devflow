# QA Skill — Anti-Patterns

Common QA anti-patterns that produce false confidence.

## Violation 1: Happy-Path-Only Testing [1][2]

```
❌ Only testing the success case:
   "User logs in with correct credentials → success"
   No negative, boundary, or error scenarios

✅ Complete coverage:
   S1: Correct credentials → success (happy)
   S2: Wrong password → error message (negative)
   S3: Empty password → validation error (boundary)
   S4: Locked account → account locked message (negative)
   S5: SQL injection in username → sanitized, no breach (negative)
```

**Why**: Happy path tests verify ~20% of behavior. Most defects live in error handling and boundaries [1].

## Violation 2: Testing Implementation, Not Behavior [2][8]

```
❌ Testing internals:
   "Verify that addToCart() calls inventoryService.reserve()"
   "Check that the Redux store has items array with length 1"

✅ Testing user-observable behavior:
   "Add item to cart → cart count shows 1"
   "Add item to cart → item appears in checkout"
```

**Why**: Implementation tests break on refactoring. Behavior tests break when features break [8].

## Violation 3: Missing Evidence [8][12]

```
❌ No evidence captured:
   "Ran the command and it seemed to work"
   PASS (based on what?)

✅ Evidence captured:
   $ some-command --flag
   Exit code: 0
   Output: "Success: 3 items processed"
   File created: output.json (142 bytes)
   PASS (evidence: exit code 0, expected output string present)
```

**Why**: Without evidence, failures are unreproducible and pass results are unverifiable [8].

## Violation 4: Skipping Boundary Analysis [1][6][7]

```
❌ Testing one valid value:
   "Input: age=25 → accepted"
   (Ignores: age=0, age=-1, age=121, age=NaN)

✅ Boundary triplets:
   age=-1 → rejected (below minimum)
   age=0  → accepted (minimum)
   age=1  → accepted (above minimum)
   age=119 → accepted (below maximum)
   age=120 → accepted (maximum)
   age=121 → rejected (above maximum)
```

**Why**: ~65% of input-related defects occur at boundaries [7]. Single-value testing misses them all.

## Violation 5: Untraceable Scenarios [4][9]

```
❌ Vague scenarios:
   "Test that search works"
   "Make sure the form validates"

✅ Structured Given/When/Then:
   Given: Database contains users "alice", "bob", "charlie"
   When: Search for "ali"
   Then: Results contain "alice" only, displayed within 200ms
```

**Why**: Vague scenarios are non-reproducible. Structured scenarios are executable specifications [4][9].

## Violation 6: Ignoring Non-Functional Acceptance [5][12]

```
❌ Only functional testing:
   "Upload works" (but takes 30 seconds for a 1MB file)

✅ Including observable quality:
   S1: Upload 1MB file → completes within 2 seconds (performance)
   S2: Upload shows progress indicator (usability)
   S3: Upload failure shows retry option (error recovery)
```

**Why**: Users experience performance, usability, and error recovery — not just correct outputs [5].
