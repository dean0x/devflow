---
allowed-tools: Task
description: Create pull request with comprehensive analysis and smart description generation
---

## Your task

Launch the `PullRequest` sub-agent to create a PR from the current branch.

Pass `$ARGUMENTS` to the sub-agent (may contain base branch and/or `--draft` flag).

The agent will:
1. Detect current branch and base branch (auto-detect if not specified)
2. Run pre-flight checks (commits exist, no existing PR, branch pushed)
3. Analyze commits and code changes
4. Generate PR title and comprehensive description
5. Create the PR using `gh pr create`
6. Return the PR URL

Trust the agent's judgment. It handles all validation and creation.
