---
name: plan:guided
description: GUIDED planning — load companion skills, orient with Skimmer, design directly in main session
user-invocable: false
---

# Plan (GUIDED)

Direct main-session planning for GUIDED depth. Load skills, orient, design, present.

1. **Load Skills** *(mandatory — do not skip)* — Load companion skills via Skill tool: `devflow:test-driven-development`, `devflow:patterns`, `devflow:software-design`, `devflow:security`, `devflow:design-review`. If a skill fails to load, continue without it.
2. **Discover** — If the planning question is open-ended, ask clarifying questions via AskUserQuestion and present 2-3 approaches with tradeoffs before orienting. Skip if the user's prompt is already specific. If the user says "skip" or "just proceed": skip remaining questions, present inferred scope for confirmation.
3. **Load Decisions** — Load `DECISIONS_CONTEXT` via `node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "{worktree}"`. Read `.devflow/features/index.json` if it exists; based on the task, identify relevant feature knowledge entries, read them, and use as context for direct planning. Set `FEATURE_KNOWLEDGE = (none)` if no feature knowledge exists or none are relevant.
4. **Spawn Skimmer** — `Agent(subagent_type="Skimmer")` targeting the area of interest. Use orientation output to ground design decisions in real file structures and patterns.
5. **Design** — Using Skimmer findings + loaded skills + `DECISIONS_CONTEXT` + `FEATURE_KNOWLEDGE`, design the approach directly in main session. Apply `devflow:design-review` skill inline to check the plan for anti-patterns before presenting.
6. **Present** — Deliver structured plan. Use AskUserQuestion for ambiguous design choices.

## Output

Structured plan ready to feed into IMPLEMENT if user proceeds:

- Goal and scope
- Gap analysis findings (blocking vs. should-address)
- Architecture decisions with rationale
- File-level change list (create/modify/delete)
- Test strategy
- Design review notes (anti-patterns checked, any concerns)
- Risks and mitigations
- PR Description Guidance (problem, key changes, breaking changes, reviewer focus areas)
- Open questions (if any)
- Design artifact path (if written to disk)
