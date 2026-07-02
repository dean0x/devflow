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
- Zero warnings policy — treat all compiler and linter warnings as errors
