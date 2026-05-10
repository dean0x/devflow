---
name: implement:guided
description: GUIDED implementation — load companion skills, follow TDD, implement directly in main session
user-invocable: false
---

# Implementation (GUIDED)

Direct main-session implementation for GUIDED depth. Load skills, follow TDD, implement, simplify.

1. **Load Skills** *(mandatory — do not skip)* — Load companion skills via Skill tool:
   - Always: `devflow:test-driven-development`, `devflow:patterns`, `devflow:dependency-research`
   - Based on file types in scope (load all that match):

   | Pattern | Skill |
   |---------|-------|
   | .ts, .tsx | devflow:typescript |
   | .tsx, .jsx | devflow:react |
   | .go | devflow:go |
   | .java | devflow:java |
   | .py | devflow:python |
   | .rs | devflow:rust |
   | CSS/UI/styling | devflow:ui-design |
   | Forms/API/input | devflow:boundary-validation |
   | Auth/crypto/secrets | devflow:security |

   If a skill fails to load, continue without it — do not halt the workflow.

2. **Load Decisions** — Run `node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "{worktree}"` for DECISIONS_CONTEXT. Read `.features/index.json`, load relevant feature knowledge.
3. **Implement** — Follow loaded skills (TDD cycle, codebase patterns). Implement directly in main session.
4. **Simplify** — Spawn `Agent(subagent_type="Simplifier")` on changed files.
