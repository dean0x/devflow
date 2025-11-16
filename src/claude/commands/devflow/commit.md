---
allowed-tools: Task
description: Create intelligent atomic commits with safety checks and clean git history
---

## Your task

Launch the `commit` sub-agent to analyze changes, detect safety issues, group into atomic commits, and **execute them immediately**.

The agent will:
1. Analyze uncommitted changes
2. Run safety checks (abort if secrets/dangerous files found)
3. Group into logical atomic commits
4. **Execute commits without asking for confirmation**
5. Report what was committed

Trust the agent's judgment. It will only abort for genuine safety issues (secrets, credentials).
