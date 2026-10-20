---
paths: []
---
# Code Quality

**Match existing patterns — consistency beats cleverness.**

- Single responsibility: one reason to change per module
- No regressions: every change must pass existing tests
- Behavior-focused tests: assert outcomes, not implementation details
- If you can't explain it in 5 minutes, it's too complex — simplify first
- Delete dead code — commented-out code is not version control
- Leave the end-state, not the transition — after removing or renaming, strip the residue: tombstone comments ("no longer does X"), `*_old`/`v2` names, guards for now-impossible states, leftover migration scaffolding. Git holds the history.
- Cut leftover debug statements, unused imports, variables used once right after assignment, nested ternaries, checks the type system enforces and catches around code that cannot throw — never at a trust boundary or a fail-closed path
- Zero warnings policy — treat all compiler and linter warnings as errors
