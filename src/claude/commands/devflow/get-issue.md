---
allowed-tools: Task
description: Fetch GitHub issue details and create a working branch for implementation
---

## Your task

Launch the `get-issue` sub-agent with the issue identifier: `$ARGUMENTS`

The agent will:
1. Fetch issue by number or search term
2. Display issue details (title, body, labels, comments)
3. Create and checkout a branch named `{type}/{number}-{slug}`
4. Provide next steps for implementation

Pass the full `$ARGUMENTS` to the sub-agent as the issue input.
