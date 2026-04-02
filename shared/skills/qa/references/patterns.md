# QA Skill — Correct Patterns

Scenario design patterns that produce reliable, maintainable acceptance tests.

## Pattern 1: Criterion-Driven Scenario Design [4][9]

Derive scenarios directly from acceptance criteria using Given/When/Then:

```
Criterion: "Admin users can delete any comment"

S1 (happy):    Given admin user + existing comment
               When DELETE /comments/{id}
               Then 200 + comment removed from database

S2 (negative): Given regular user + existing comment
               When DELETE /comments/{id}
               Then 403 + comment still exists

S3 (negative): Given admin user + non-existent comment
               When DELETE /comments/{id}
               Then 404

S4 (boundary): Given admin user + already-deleted comment
               When DELETE /comments/{id}
               Then 404 (idempotent)
```

**Why**: Direct criterion mapping ensures nothing is missed [4]. Every criterion generates at least one scenario.

## Pattern 2: Boundary Triplet Testing [1][6][10]

For every boundary, test three values: below, on, and above:

```
Constraint: "Username must be 3-20 characters"

Below minimum: "ab" (2 chars) → rejected
At minimum:    "abc" (3 chars) → accepted
Above minimum: "abcd" (4 chars) → accepted
Below maximum: 19 chars → accepted
At maximum:    20 chars → accepted
Above maximum: 21 chars → rejected
```

**Why**: Most defects cluster at boundaries [1][7]. The triplet pattern catches off-by-one errors systematically.

## Pattern 3: State-Based Scenario Chains [6][7]

Test state transitions that matter to the user:

```
Feature: Order lifecycle

S1: Created → Paid (happy path)
S2: Created → Cancelled (valid transition)
S3: Paid → Shipped (happy path)
S4: Shipped → Cancelled (should this be allowed? → negative)
S5: Cancelled → Paid (invalid transition → error)
```

**Why**: State machines reveal invalid transitions that happy-path testing misses [6].

## Pattern 4: Evidence-First Execution [8][12]

Capture evidence before asserting:

```bash
# Execute
OUTPUT=$(some-command 2>&1)
EXIT_CODE=$?

# Evidence captured — now assert
echo "Exit code: $EXIT_CODE"
echo "Output: $OUTPUT"

# Check expectations
if [ $EXIT_CODE -ne 0 ]; then
  echo "FAIL: Expected exit code 0, got $EXIT_CODE"
fi
```

**Why**: Raw evidence enables debugging when scenarios fail. Without it, you only know "it failed" but not why [8].

## Pattern 5: Regression Guard Scenarios [5][12]

After modifying existing code, verify unchanged behavior:

```
Feature: New search filter added to existing search

S1 (regression): Existing search without filter still works
S2 (regression): Existing search results unchanged
S3 (happy):      New filter produces expected results
S4 (integration): Filter + existing sort work together
```

**Why**: Most production bugs are regressions — features that used to work and stopped [12].

## Pattern 6: Exploratory Charters [3][11]

When criteria are vague, use structured exploration:

```
Charter: "Explore the file upload feature with hostile inputs"
Time-box: 15 minutes

Tour plan:
1. Upload file with special characters in name
2. Upload file with zero bytes
3. Upload file with executable extension
4. Simultaneous uploads of same file
5. Upload during network interruption (kill mid-transfer)

Record: What happened, what was surprising, what broke
```

**Why**: Scripted tests find expected bugs. Exploratory testing finds unexpected ones [3][11].
