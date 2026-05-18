---
name: research:guided
description: GUIDED research — infer types, spawn researchers directly in main session
user-invocable: false
---

# Research (GUIDED)

Direct main-session research for GUIDED depth. Load decisions, infer types, spawn researchers, present.

1. **Load Decisions** — Run `node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "{worktree}"` for DECISIONS_CONTEXT. Follow `devflow:apply-decisions` to Read full entry bodies on demand.
2. **Infer research types** — From the user's prompt, infer 1-2 research types. Load the corresponding skill via Skill tool:

   | Type | Skill |
   |------|-------|
   | codebase | devflow:research-codebase |
   | external | devflow:research-external |
   | market | devflow:research-market |
   | competitor | devflow:research-competitor |
   | technology | devflow:research-technology |

3. **Check tool availability** — If WebSearch/WebFetch are not available, restrict to `codebase` type only. Inform user that external research is not available in this session.
4. **Spawn 1-2 Researcher agents** with OUTPUT_PATH to `.devflow/docs/research/{topic-slug}/{YYYY-MM-DD_HHMM}/` and DECISIONS_CONTEXT from step 1.
5. **Present findings** with trust annotations (trusted/untrusted/mixed per finding).
