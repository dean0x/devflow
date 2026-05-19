---
name: review:guided
description: GUIDED review — load quality gates, review directly in main session
user-invocable: false
---

# Review (GUIDED)

Direct main-session review for GUIDED depth. Load skills, review, report.

1. **Load Skills** *(mandatory — do not skip)* — Load companion skills via Skill tool: `devflow:quality-gates`, `devflow:software-design`. If a skill fails to load, continue without it.
2. **Load Decisions** — Run `node ~/.devflow/scripts/hooks/lib/decisions-index.cjs index "{worktree}"` for DECISIONS_CONTEXT. Read `.devflow/features/index.json`, load relevant feature knowledge.
3. **Review** — Apply quality gates framework to changed files. Focus on the specific area the user asked about.
4. **Report** — Present findings with severity, file:line references, and actionable recommendations.
