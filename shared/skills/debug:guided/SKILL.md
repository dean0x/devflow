---
name: debug:guided
description: GUIDED debugging — load companion skills, investigate directly, fix with TDD
user-invocable: false
---

# Debug (GUIDED)

Direct main-session debugging for GUIDED depth. Load skills, investigate, fix.

1. **Load Skills** *(mandatory — do not skip)* — Load companion skills via Skill tool:
   - Always: `devflow:test-driven-development`, `devflow:software-design`, `devflow:testing`
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

2. **Load Decisions** — Run `node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "{worktree}"` for DECISIONS_CONTEXT. Read `.devflow/features/index.json`, load relevant feature knowledge. Use locally for hypothesis generation.
3. **Investigate** — Analyze the bug directly. Trace code, check logs, verify hypotheses.
4. **Fix** — If root cause is clear, implement the fix. Spawn `Agent(subagent_type="Simplifier")` on changed files.
