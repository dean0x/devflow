---
paths: []
---
# Code Quality

**Match existing patterns — consistency beats cleverness.**

- Single responsibility: one reason to change per module
- Find the existing owner: extend it when new code shares its job, never add a parallel copy; a trust-boundary or fail-closed check is not a copy
- No regressions: every change must pass existing tests
- Behavior-focused tests: assert outcomes, not implementation details
- If you can't explain it in 5 minutes, it's too complex — simplify first
- Delete dead code — commented-out code is not version control
- Leave the end-state, not the transition — after removing or renaming, strip the residue: tombstone comments ("no longer does X"), `*_old`/`v2` names, guards for now-impossible states, leftover migration scaffolding. Git holds the history.
- When a change alters a name, path or behavior, update the current tracked docs that state the old fact, not released changelog entries; for a security fix, state the effect only
- Cut leftover debug statements, unused imports, unnecessary variables used once right after assignment, nested ternaries; cut checks the types enforce and catches around code that cannot throw, never at a trust boundary or fail-closed path
- Zero warnings policy — treat all compiler and linter warnings as errors
